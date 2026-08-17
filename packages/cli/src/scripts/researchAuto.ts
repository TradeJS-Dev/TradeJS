import args from 'args';
import chalk from 'chalk';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TTL_1M } from '@tradejs/core/constants';
import { toFileToken } from '@tradejs/infra/ai';
import { logger } from '@tradejs/infra/logger';
import { getData, getKeys, redisKeys, setData } from '@tradejs/infra/redis';
import { getStrategyDefaults } from '@tradejs/node/registry';
import { StrategyConfig, StrategyConfigGrid } from '@tradejs/types';
import {
  isRuntimeStrategyEnabled,
  loadRuntimeStrategyConfigs,
  loadRuntimeStrategyNames as loadRuntimeStrategyNamesFromRedis,
  resolveStrategyNameByConfigKey,
} from '../lib/runtimeRedis';
import { BACKTEST_CLI_RUNTIME_CONFIG_KEYS } from '../lib/runtimeStrategyBacktest';
import type { ResearchAgentRunRecord } from '../lib/researchAgent';
import {
  resolveResearchRoots,
  SOURCE_REPOSITORY_ROOT_ENV,
} from '../lib/researchRoots';
import { sendTelegramReport } from '../lib/telegramReports';

args.example(
  'yarn cli:node8g research:auto --strategy TrendLine --days 45',
  'Run the nightly backtest -> ai-export -> ai-train local research pipeline and save structured results to Redis',
);

args.option(['s', 'strategy'], 'Strategy name');
args.option(['c', 'config'], 'Backtest config name');
args.option(['U', 'user'], 'Use user config', 'root');
args.option(['o', 'connector'], 'Backtest connector', 'bybit');
args.option(['f', 'timeframe'], 'Backtest timeframe', '15');
args.option(['d', 'days'], 'Backtest days window', 45);
args.option(['n', 'recent'], 'AI train recent rows window', 1000);
args.option(['k', 'skip'], 'AI train skip rows from end', 0);
args.option(
  ['M', 'minQuality'],
  'Minimum AI quality required to approve entry',
  4,
);
args.option(['O', 'outDir'], 'AI export output directory', 'data/ai/export');
args.option(['A', 'skipAgent'], 'Skip direct research agent invocation', false);
args.option(['j', 'json'], 'Print structured JSON summary', false);

const flags = args.parse(process.argv);

type ResearchStepName =
  | 'prepareBacktestConfig'
  | 'cleanTests'
  | 'cleanAiExport'
  | 'backtest'
  | 'aiExport'
  | 'aiTrainLocal'
  | 'agentRun';

type ResearchStepResult = {
  status: 'pending' | 'running' | 'completed' | 'failed';
  command: string;
  args: string[];
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  stdoutTail?: string;
  stderrTail?: string;
  exitCode?: number;
};

type ResearchRunRecord = {
  runId: string;
  userName: string;
  strategy: string;
  config: string;
  connector: string;
  timeframe: string;
  days: number;
  recent: number;
  skip: number;
  minQuality: number;
  selectedBy: 'config' | 'strategy' | 'auto';
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt?: string;
  error?: string;
  steps: Record<ResearchStepName, ResearchStepResult>;
  artifacts: {
    strategyConfigKey?: string;
    backtestConfigKey?: string;
    strategyConfig?: StrategyConfig;
    backtestConfig?: StrategyConfigGrid;
    backtestResultKey?: string;
    backtestResult?: {
      finishedAt?: string;
      durationSeconds?: number;
      successTests?: number;
      errorTests?: number;
      bestConfig?: unknown;
      mergedConfig?: unknown;
    };
    aiExportFile?: string;
    aiTrainLocal?: unknown;
    agentRun?: unknown;
  };
};

type ResearchRunLockRecord = {
  runId: string;
  userName: string;
  strategy: string;
  pid: number;
  ppid: number;
  hostname: string;
  startedAt: string;
  argv: string[];
};

const { projectRoot, sourceRepositoryRoot } = resolveResearchRoots();
const dotenvPath =
  String(
    process.env.DOTENV_CONFIG_PATH || path.join(projectRoot, '.env'),
  ).trim() || path.join(projectRoot, '.env');

export const getResearchAutoLockPath = (userName: string) =>
  path.join(
    projectRoot,
    'data',
    'cache',
    'research-auto',
    `${toFileToken(userName)}.lock.json`,
  );

const readResearchAutoLock = async (
  lockPath: string,
): Promise<ResearchRunLockRecord | null> => {
  try {
    const raw = await fs.readFile(lockPath, 'utf8');
    return JSON.parse(raw) as ResearchRunLockRecord;
  } catch {
    return null;
  }
};

export const isProcessAlive = (pid: number) => {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as NodeJS.ErrnoException).code || '')
        : '';
    return code === 'EPERM';
  }
};

export const acquireResearchAutoLock = async ({
  runId,
  userName,
  strategy,
  startedAt,
}: Pick<
  ResearchRunRecord,
  'runId' | 'userName' | 'strategy' | 'startedAt'
>) => {
  const lockPath = getResearchAutoLockPath(userName);
  const nextLock: ResearchRunLockRecord = {
    runId,
    userName,
    strategy,
    pid: process.pid,
    ppid: process.ppid,
    hostname: os.hostname(),
    startedAt,
    argv: [...process.argv],
  };

  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  const writeLock = async () => {
    await fs.writeFile(lockPath, JSON.stringify(nextLock, null, 2), {
      flag: 'wx',
    });
  };

  try {
    await writeLock();
    return lockPath;
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as NodeJS.ErrnoException).code || '')
        : '';
    if (code !== 'EEXIST') {
      throw error;
    }
  }

  const existingLock = await readResearchAutoLock(lockPath);
  if (existingLock?.pid && isProcessAlive(existingLock.pid)) {
    throw new Error(
      `research:auto is already running for user ${userName} (runId=${existingLock.runId}, strategy=${existingLock.strategy}, pid=${existingLock.pid}, ppid=${existingLock.ppid}, startedAt=${existingLock.startedAt}, host=${existingLock.hostname})`,
    );
  }

  await fs.unlink(lockPath).catch(() => undefined);
  await writeLock();
  return lockPath;
};

export const releaseResearchAutoLock = async (
  lockPath: string | null | undefined,
) => {
  if (!lockPath) {
    return;
  }

  const existingLock = await readResearchAutoLock(lockPath);
  if (existingLock && existingLock.pid !== process.pid) {
    return;
  }

  await fs.unlink(lockPath).catch(() => undefined);
};

const resolvePositiveInteger = (
  value: string | undefined,
  fallback?: number,
) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
};

export const resolveHeapMbFromEnv = (envNames: string[], fallback?: number) => {
  for (const envName of envNames) {
    const resolved = resolvePositiveInteger(process.env[envName], undefined);
    if (resolved != null) {
      return resolved;
    }
  }
  return fallback;
};

export const buildNodeOptions = ({
  heapMb,
  baseNodeOptions = String(process.env.NODE_OPTIONS || '').trim(),
}: {
  heapMb?: number;
  baseNodeOptions?: string;
}) =>
  [
    heapMb ? `--max-old-space-size=${Math.max(256, heapMb)}` : '',
    ...baseNodeOptions
      .split(/\s+/)
      .map((value) => value.trim())
      .filter((value) => value && !value.startsWith('--max-old-space-size=')),
  ]
    .filter(Boolean)
    .join(' ');

const RESEARCH_AUTO_PARENT_HEAP_MB = resolveHeapMbFromEnv(
  ['RESEARCH_AUTO_PARENT_HEAP_MB'],
  1024,
);
const RESEARCH_AUTO_BACKTEST_PARENT_HEAP_MB = resolveHeapMbFromEnv(
  [
    'RESEARCH_AUTO_BACKTEST_PARENT_HEAP_MB',
    'BACKTEST_PARENT_HEAP_MB',
    'CLI_PARENT_HEAP_MB',
  ],
  1536,
);
const RESEARCH_AUTO_AI_TRAIN_PARENT_HEAP_MB = resolveHeapMbFromEnv(
  [
    'RESEARCH_AUTO_AI_TRAIN_PARENT_HEAP_MB',
    'AI_TRAIN_PARENT_HEAP_MB',
    'CLI_PARENT_HEAP_MB',
  ],
  2048,
);
const RESEARCH_AUTO_AGENT_PARENT_HEAP_MB = resolveHeapMbFromEnv(
  [
    'RESEARCH_AUTO_AGENT_PARENT_HEAP_MB',
    'AGENT_RUN_PARENT_HEAP_MB',
    'CLI_PARENT_HEAP_MB',
  ],
  2048,
);

export const trimTextTail = (value: string, limit = 4000) =>
  value.length <= limit ? value : value.slice(-limit);

export const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const createEmptySteps = (): Record<
  ResearchStepName,
  ResearchStepResult
> => ({
  prepareBacktestConfig: {
    status: 'pending',
    command: 'prepare-backtest-config',
    args: [],
  },
  cleanTests: {
    status: 'pending',
    command: 'clean-tests',
    args: [],
  },
  cleanAiExport: {
    status: 'pending',
    command: 'clean-dir',
    args: ['--dir', 'ai/export'],
  },
  backtest: {
    status: 'pending',
    command: 'backtest',
    args: [],
  },
  aiExport: {
    status: 'pending',
    command: 'ai-export',
    args: [],
  },
  aiTrainLocal: {
    status: 'pending',
    command: 'ai-train',
    args: [],
  },
  agentRun: {
    status: 'pending',
    command: 'agent-run',
    args: [],
  },
});

const saveRun = async (run: ResearchRunRecord) => {
  await setData(redisKeys.researchRun(run.userName, run.runId), run, {
    expire: TTL_1M,
  });
  await setData(redisKeys.researchLatestRun(run.userName, run.strategy), run, {
    expire: TTL_1M,
  });
};

export const listMergedFiles = async (outDir: string, strategyName: string) => {
  try {
    const entries = await fs.readdir(outDir);
    const prefix = `ai-dataset-${toFileToken(strategyName)}-merged-`;
    return entries
      .filter((name) => name.startsWith(prefix) && name.endsWith('.jsonl'))
      .sort()
      .map((name) => path.join(outDir, name));
  } catch {
    return [];
  }
};

export const getBacktestResultsPrefix = (userName: string, config: string) =>
  `users:${userName}:backtests:results:${config}:`;

export { resolveStrategyNameByConfigKey } from '../lib/runtimeRedis';

export const listRuntimeStrategyNames = async (userName: string) => {
  const strategyConfigs = await loadRuntimeStrategyConfigs(userName);
  return strategyConfigs
    .filter(({ strategyConfig }) => isRuntimeStrategyEnabled(strategyConfig))
    .map(({ strategyName }) => strategyName)
    .sort((left, right) => left.localeCompare(right));
};

export const toStrategyConfigGrid = (
  strategyConfig: StrategyConfig,
): StrategyConfigGrid => {
  return Object.fromEntries(
    Object.entries(strategyConfig)
      .filter(([key]) => !BACKTEST_CLI_RUNTIME_CONFIG_KEYS.has(key))
      .map(([key, value]) => [key, [value]]),
  );
};

export const formatMskDateTime = (value?: string) => {
  if (!value) {
    return 'n/a';
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }

  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
};

export const buildTelegramReport = (run: ResearchRunRecord) => {
  const aiTrainLocal = run.artifacts.aiTrainLocal as
    | {
        run?: {
          totalRows?: number;
          approvedRows?: number;
          minQuality?: number;
        };
        outcome?: {
          approvalRate?: number;
          precisionApproved?: number;
          recallWinners?: number;
          avgProfitApproved?: number;
          avgProfitApprovedPerMonth?: number;
          expectancyDelta?: number;
        };
      }
    | undefined;
  const agentRun = run.artifacts.agentRun as ResearchAgentRunRecord | undefined;

  const lines = [
    `<b>Research auto: ${escapeHtml(run.strategy)}</b>`,
    `Status: <b>${run.status}</b>`,
    `Run: <code>${escapeHtml(run.runId)}</code>`,
    `Selected by: <code>${escapeHtml(run.selectedBy)}</code>`,
    `Backtest config: <code>${escapeHtml(run.config)}</code>`,
    `Window: <code>${run.days}d</code>, timeframe <code>${escapeHtml(run.timeframe)}</code>, connector <code>${escapeHtml(run.connector)}</code>`,
    `Started: <code>${escapeHtml(formatMskDateTime(run.startedAt))} MSK</code>`,
    `Finished: <code>${escapeHtml(formatMskDateTime(run.finishedAt))} MSK</code>`,
  ];

  if (run.artifacts.backtestResultKey) {
    lines.push(
      `Backtest result key: <code>${escapeHtml(
        run.artifacts.backtestResultKey,
      )}</code>`,
    );
  }

  if (run.artifacts.aiExportFile) {
    lines.push(
      `AI export: <code>${escapeHtml(run.artifacts.aiExportFile)}</code>`,
    );
  }

  if (aiTrainLocal?.run || aiTrainLocal?.outcome) {
    lines.push('');
    lines.push('<b>AI Train Local</b>');
    if (typeof aiTrainLocal.run?.totalRows === 'number') {
      lines.push(
        `Rows: <code>${aiTrainLocal.run.totalRows}</code>, approved: <code>${aiTrainLocal.run.approvedRows ?? 0}</code>, minQuality: <code>${aiTrainLocal.run.minQuality ?? run.minQuality}</code>`,
      );
    }
    if (typeof aiTrainLocal.outcome?.approvalRate === 'number') {
      lines.push(
        `Approval rate: <code>${aiTrainLocal.outcome.approvalRate.toFixed(4)}</code>, precision: <code>${(aiTrainLocal.outcome.precisionApproved ?? 0).toFixed(4)}</code>, recall winners: <code>${(aiTrainLocal.outcome.recallWinners ?? 0).toFixed(4)}</code>`,
      );
      lines.push(
        `Avg approved PnL: <code>${(aiTrainLocal.outcome.avgProfitApproved ?? 0).toFixed(4)}</code>, monthly: <code>${(aiTrainLocal.outcome.avgProfitApprovedPerMonth ?? 0).toFixed(4)}</code>, expectancy delta: <code>${(aiTrainLocal.outcome.expectancyDelta ?? 0).toFixed(4)}</code>`,
      );
    }
  }

  if (run.error) {
    lines.push('');
    lines.push('<b>Error</b>');
    lines.push(`<code>${escapeHtml(run.error)}</code>`);
  }

  lines.push('');
  if (agentRun) {
    lines.push(`Agent layer: <code>${escapeHtml(agentRun.status)}</code>`);
    if (agentRun.branchName) {
      lines.push(
        `Agent branch: <code>${escapeHtml(agentRun.branchName)}</code>`,
      );
    }
    if (agentRun.commitHash) {
      lines.push(
        `Agent commit: <code>${escapeHtml(agentRun.commitHash)}</code>`,
      );
    }
    if (typeof agentRun.pullRequestNumber === 'number') {
      lines.push(`Agent PR: <code>#${agentRun.pullRequestNumber}</code>`);
    }
    if (agentRun.pullRequestUrl) {
      lines.push(
        `Agent PR URL: <code>${escapeHtml(agentRun.pullRequestUrl)}</code>`,
      );
    }
    if (agentRun.summary) {
      lines.push(`Agent summary: <code>${escapeHtml(agentRun.summary)}</code>`);
    }
  } else if (run.steps.agentRun?.status === 'pending') {
    lines.push('Agent layer: <code>pending</code>');
  } else {
    lines.push(
      `Agent layer: <code>${escapeHtml(run.steps.agentRun?.status || 'unknown')}</code>`,
    );
  }
  return lines.join('\n');
};

export const runCliCommand = async (params: {
  command: string;
  args: string[];
  nodeHeapMb?: number;
  liveLogPrefix?: string;
  heartbeatMs?: number;
  captureMode?: 'tail' | 'full';
  tailLimit?: number;
}): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}> => {
  const startedAt = Date.now();
  const captureMode = params.captureMode || 'tail';
  const tailLimit = Math.max(512, params.tailLimit || 16_384);
  const env = {
    ...process.env,
    PROJECT_CWD: projectRoot,
    [SOURCE_REPOSITORY_ROOT_ENV]: sourceRepositoryRoot,
    DOTENV_CONFIG_PATH: dotenvPath,
    ...(params.nodeHeapMb
      ? {
          NODE_OPTIONS: buildNodeOptions({
            heapMb: params.nodeHeapMb,
          }),
        }
      : {}),
  };

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.resolve(process.argv[1]), params.command, ...params.args],
      {
        cwd: projectRoot,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';
    let heartbeatTimer: NodeJS.Timeout | null = null;

    const appendChunk = (current: string, incoming: string) => {
      if (captureMode === 'full') {
        return current + incoming;
      }

      const next = current + incoming;
      return next.length <= tailLimit ? next : next.slice(-tailLimit);
    };

    const emitLines = (source: 'stdout' | 'stderr', text: string) => {
      const prefix = params.liveLogPrefix
        ? `[research:auto:${params.liveLogPrefix}:${source}] `
        : `[research:auto:${source}] `;
      for (const line of text
        .split(/\r?\n/)
        .map((value) => value.trimEnd())
        .filter(Boolean)) {
        logger.info(chalk.gray(`${prefix}${line}`));
      }
    };

    if (params.heartbeatMs && params.heartbeatMs > 0) {
      heartbeatTimer = setInterval(() => {
        const elapsedMs = Date.now() - startedAt;
        logger.info(
          chalk.gray(
            `[research:auto:${params.liveLogPrefix || params.command}] still running after ${Math.round(elapsedMs / 1000)}s`,
          ),
        );
      }, params.heartbeatMs);
    }

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout = appendChunk(stdout, text);
      if (params.liveLogPrefix) {
        emitLines('stdout', text);
      }
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr = appendChunk(stderr, text);
      if (params.liveLogPrefix) {
        emitLines('stderr', text);
      }
    });
    child.on('error', (error) => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      reject(error);
    });
    child.on('close', (code) => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      });
    });
  });
};

export const resolveTarget = async (): Promise<{
  strategy: string;
  config: string;
  selectedBy: ResearchRunRecord['selectedBy'];
}> => {
  const userName = String(flags.user || 'root').trim() || 'root';
  const explicitConfig = String(flags.config || '').trim();
  if (explicitConfig) {
    return {
      strategy: explicitConfig.split(':')[0] || explicitConfig,
      config: explicitConfig,
      selectedBy: 'config',
    };
  }

  const explicitStrategy = String(flags.strategy || '').trim();
  if (explicitStrategy) {
    return {
      strategy: explicitStrategy,
      config: `${explicitStrategy}:research`,
      selectedBy: 'strategy',
    };
  }

  const availableStrategies = await listRuntimeStrategyNames(userName);
  const candidates: Array<{
    strategy: string;
    config: string;
    lastFinishedAt: number;
  }> = [];

  for (const strategy of availableStrategies) {
    const config = `${strategy}:research`;

    const latestRun = (await getData(
      redisKeys.researchLatestRun(userName, strategy),
      null,
    )) as { finishedAt?: string } | null;
    const lastFinishedAt = latestRun?.finishedAt
      ? Date.parse(latestRun.finishedAt)
      : 0;
    candidates.push({
      strategy,
      config,
      lastFinishedAt: Number.isFinite(lastFinishedAt) ? lastFinishedAt : 0,
    });
  }

  if (!candidates.length) {
    throw new Error(
      `No research candidates found from runtime strategy configs for user ${userName}.`,
    );
  }

  candidates.sort(
    (left, right) =>
      left.lastFinishedAt - right.lastFinishedAt ||
      left.strategy.localeCompare(right.strategy),
  );

  logResearch(
    `auto candidates from runtime configs: ${candidates
      .map(
        ({ strategy, lastFinishedAt }) =>
          `${strategy}=${lastFinishedAt ? new Date(lastFinishedAt).toISOString() : 'never'}`,
      )
      .join(', ')}`,
  );

  return {
    strategy: candidates[0].strategy,
    config: candidates[0].config,
    selectedBy: 'auto',
  };
};

export const parseJsonOutput = <T>(stdout: string, label: string): T => {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error(`${label} returned empty stdout`);
  }

  return JSON.parse(trimmed) as T;
};

const logResearch = (message: string) => {
  logger.info(chalk.cyan(`[research:auto] ${message}`));
};

const executeNonBlockingStep = async (
  run: ResearchRunRecord,
  stepName: ResearchStepName,
  command: string,
  commandArgs: string[],
  options: {
    nodeHeapMb?: number;
    liveLog?: boolean;
    heartbeatMs?: number;
    captureMode?: 'tail' | 'full';
  } = {},
) => {
  logResearch(
    `starting optional step ${stepName}: ${command} ${commandArgs.join(' ')}`.trim(),
  );
  const startedAt = new Date().toISOString();
  run.steps[stepName] = {
    status: 'running',
    command,
    args: commandArgs,
    startedAt,
  };
  await saveRun(run);

  const result = await runCliCommand({
    command,
    args: commandArgs,
    nodeHeapMb: options.nodeHeapMb,
    liveLogPrefix: options.liveLog ? stepName : undefined,
    heartbeatMs: options.liveLog ? options.heartbeatMs || 60_000 : undefined,
    captureMode: options.captureMode,
  });

  run.steps[stepName] = {
    status: result.exitCode === 0 ? 'completed' : 'failed',
    command,
    args: commandArgs,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    stdoutTail: trimTextTail(result.stdout),
    stderrTail: trimTextTail(result.stderr),
  };
  await saveRun(run);

  logResearch(
    `finished optional step ${stepName}: exit=${result.exitCode}, duration=${result.durationMs}ms`,
  );

  return result;
};

export const main = async () => {
  const userName = String(flags.user || 'root').trim() || 'root';
  const connector = String(flags.connector || 'bybit').trim() || 'bybit';
  const timeframe = String(flags.timeframe || '15').trim() || '15';
  const days = Math.max(1, Number.parseInt(String(flags.days ?? 45), 10) || 45);
  const recent = Math.max(
    0,
    Number.parseInt(String(flags.recent ?? 1000), 10) || 1000,
  );
  const skip = Math.max(0, Number.parseInt(String(flags.skip ?? 0), 10) || 0);
  const minQuality = Math.max(
    0,
    Number.parseInt(String(flags.minQuality ?? 4), 10) || 4,
  );
  const jsonOutput = Boolean(flags.json);
  const skipAgent = Boolean(flags.skipAgent);
  const outDirArg =
    String(flags.outDir || 'data/ai/export').trim() || 'data/ai/export';
  const outDir = path.resolve(projectRoot, outDirArg);
  const cleanDirArg = path
    .relative(path.join(projectRoot, 'data'), outDir)
    .replace(/\\/g, '/');
  const target = await resolveTarget();
  const runId = `${Date.now()}-${toFileToken(target.strategy)}`;
  const run: ResearchRunRecord = {
    runId,
    userName,
    strategy: target.strategy,
    config: target.config,
    connector,
    timeframe,
    days,
    recent,
    skip,
    minQuality,
    selectedBy: target.selectedBy,
    status: 'running',
    startedAt: new Date().toISOString(),
    steps: createEmptySteps(),
    artifacts: {},
  };
  let lockPath: string | null = null;

  const executeStep = async (
    stepName: ResearchStepName,
    command: string,
    commandArgs: string[],
    options: {
      nodeHeapMb?: number;
      liveLog?: boolean;
      heartbeatMs?: number;
      captureMode?: 'tail' | 'full';
    } = {},
  ) => {
    logResearch(
      `starting step ${stepName}: ${command} ${commandArgs.join(' ')}`.trim(),
    );
    const startedAt = new Date().toISOString();
    run.steps[stepName] = {
      status: 'running',
      command,
      args: commandArgs,
      startedAt,
    };
    await saveRun(run);

    const result = await runCliCommand({
      command,
      args: commandArgs,
      nodeHeapMb: options.nodeHeapMb,
      liveLogPrefix: options.liveLog ? stepName : undefined,
      heartbeatMs: options.liveLog ? options.heartbeatMs || 60_000 : undefined,
      captureMode: options.captureMode,
    });

    run.steps[stepName] = {
      status: result.exitCode === 0 ? 'completed' : 'failed',
      command,
      args: commandArgs,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      stdoutTail: trimTextTail(result.stdout),
      stderrTail: trimTextTail(result.stderr),
    };
    await saveRun(run);

    if (result.exitCode !== 0) {
      logResearch(
        `step ${stepName} failed: exit=${result.exitCode}, output=${trimTextTail(
          result.stderr || result.stdout,
          400,
        )}`,
      );
      throw new Error(
        `${stepName} failed (exitCode=${result.exitCode}): ${trimTextTail(
          result.stderr || result.stdout,
          1200,
        )}`,
      );
    }

    logResearch(
      `finished step ${stepName}: exit=${result.exitCode}, duration=${result.durationMs}ms`,
    );

    return result;
  };

  const prepareBacktestConfig = async () => {
    logResearch(
      `preparing research backtest config ${target.config} from runtime strategy ${target.strategy}`,
    );
    const startedAt = new Date().toISOString();
    run.steps.prepareBacktestConfig = {
      status: 'running',
      command: 'prepare-backtest-config',
      args: ['--strategy', target.strategy, '--config', target.config],
      startedAt,
    };
    await saveRun(run);

    const strategyConfigKey = redisKeys.strategyConfig(
      userName,
      target.strategy,
    );
    const backtestConfigKey = redisKeys.backtestConfig(userName, target.config);
    const defaults =
      ((await getStrategyDefaults(target.strategy, projectRoot)) as
        | StrategyConfig
        | undefined) || {};
    const userStrategyConfig = (await getData(
      strategyConfigKey,
      {},
    )) as StrategyConfig;
    const strategyConfig = {
      ...defaults,
      ...userStrategyConfig,
    } as StrategyConfig;

    if (!Object.keys(strategyConfig).length) {
      throw new Error(
        `Strategy config "${target.strategy}" not found in Redis and no built-in defaults available`,
      );
    }

    const backtestConfig = toStrategyConfigGrid(strategyConfig);
    await setData(backtestConfigKey, backtestConfig, { expire: 0 });
    logResearch(
      `stored backtest config at ${backtestConfigKey} with ${Object.keys(strategyConfig).length} top-level fields`,
    );

    run.artifacts.strategyConfigKey = strategyConfigKey;
    run.artifacts.backtestConfigKey = backtestConfigKey;
    run.artifacts.strategyConfig = strategyConfig;
    run.artifacts.backtestConfig = backtestConfig;
    run.steps.prepareBacktestConfig = {
      status: 'completed',
      command: 'prepare-backtest-config',
      args: ['--strategy', target.strategy, '--config', target.config],
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - Date.parse(startedAt),
    };
    await saveRun(run);
  };

  const sendRunReport = async () => {
    const message = buildTelegramReport(run);
    await sendTelegramReport(message, { userName });
  };

  try {
    lockPath = await acquireResearchAutoLock({
      runId,
      userName,
      strategy: target.strategy,
      startedAt: run.startedAt,
    });
    logResearch(
      `run ${runId} acquired lock ${lockPath} (pid=${process.pid}, ppid=${process.ppid}, host=${os.hostname()})`,
    );
    await saveRun(run);
    logResearch(
      `run ${runId} selected target strategy=${target.strategy}, config=${target.config}, selectedBy=${target.selectedBy}`,
    );
    logResearch(
      `resource knobs: researchAutoHeapMb=${RESEARCH_AUTO_PARENT_HEAP_MB}, backtestParentHeapMb=${RESEARCH_AUTO_BACKTEST_PARENT_HEAP_MB}, aiTrainParentHeapMb=${RESEARCH_AUTO_AI_TRAIN_PARENT_HEAP_MB}, agentParentHeapMb=${RESEARCH_AUTO_AGENT_PARENT_HEAP_MB}, backtestWorkerHeapMb=${process.env.BACKTEST_WORKER_HEAP_MB || 'auto'}, backtestMaxParallel=${process.env.BACKTEST_MAX_PARALLEL || 'auto'}, klineConcurrency=${process.env.KLINE_CONCURRENCY_LIMIT || 'default'}`,
    );
    const backtestKeysBefore = new Set(
      await getKeys(getBacktestResultsPrefix(userName, target.config)),
    );
    const aiFilesBefore = new Set(
      await listMergedFiles(outDir, target.strategy),
    );
    logResearch(
      `baseline artifacts before run: backtests=${backtestKeysBefore.size}, aiMergedFiles=${aiFilesBefore.size}`,
    );

    await prepareBacktestConfig();
    await executeStep('cleanTests', 'clean-tests', ['--user', userName]);
    await executeStep('cleanAiExport', 'clean-dir', [
      '--dir',
      cleanDirArg.startsWith('..') ? 'ai/export' : cleanDirArg,
    ]);
    await executeStep(
      'backtest',
      'backtest',
      [
        '--user',
        userName,
        '--config',
        target.config,
        '--connector',
        connector,
        '--timeframe',
        timeframe,
        '--days',
        String(days),
        '--ai',
      ],
      {
        nodeHeapMb: RESEARCH_AUTO_BACKTEST_PARENT_HEAP_MB,
        liveLog: true,
        heartbeatMs: 30_000,
      },
    );
    await executeStep('aiExport', 'ai-export', [
      '--strategy',
      target.strategy,
      '--outDir',
      outDirArg,
    ]);
    const aiTrainResult = await executeStep(
      'aiTrainLocal',
      'ai-train',
      [
        '--strategy',
        target.strategy,
        '--recent',
        String(recent),
        '--skip',
        String(skip),
        '--minQuality',
        String(minQuality),
        '--localOnly',
        '--json',
      ],
      {
        nodeHeapMb: RESEARCH_AUTO_AI_TRAIN_PARENT_HEAP_MB,
        captureMode: 'full',
      },
    );

    const backtestKeysAfter = await getKeys(
      getBacktestResultsPrefix(userName, target.config),
    );
    const newBacktestKeys = backtestKeysAfter
      .filter((key) => !backtestKeysBefore.has(key))
      .sort();
    const backtestResultKey =
      newBacktestKeys[newBacktestKeys.length - 1] ||
      backtestKeysAfter.sort().at(-1);
    if (backtestResultKey) {
      logResearch(`detected backtest result key ${backtestResultKey}`);
      const backtestResult = await getData(backtestResultKey, null);
      run.artifacts.backtestResultKey = backtestResultKey;
      run.artifacts.backtestResult = backtestResult
        ? {
            finishedAt: backtestResult.finishedAt,
            durationSeconds: backtestResult.durationSeconds,
            successTests: backtestResult.successTests,
            errorTests: backtestResult.errorTests,
            bestConfig: backtestResult.bestConfig,
            mergedConfig: backtestResult.mergedConfig,
          }
        : undefined;
    } else {
      logResearch('no backtest result key detected after backtest step');
    }

    const aiFilesAfter = await listMergedFiles(outDir, target.strategy);
    const newAiFiles = aiFilesAfter
      .filter((filePath) => !aiFilesBefore.has(filePath))
      .sort();
    run.artifacts.aiExportFile =
      newAiFiles[newAiFiles.length - 1] || aiFilesAfter.at(-1);
    if (run.artifacts.aiExportFile) {
      logResearch(`detected AI export file ${run.artifacts.aiExportFile}`);
    } else {
      logResearch('no AI export file detected after ai-export step');
    }
    run.artifacts.aiTrainLocal = parseJsonOutput(
      aiTrainResult.stdout,
      'ai-train --json',
    );
    logResearch('parsed ai-train --json output successfully');

    run.status = 'completed';
    run.finishedAt = new Date().toISOString();
    await saveRun(run);
    logResearch(`run ${runId} completed successfully`);
    await sendRunReport();
    logResearch(`TG report sent for run ${runId}`);

    if (!skipAgent) {
      logResearch(`starting direct agent invocation for run ${runId}`);
      const agentResult = await executeNonBlockingStep(
        run,
        'agentRun',
        'agent-run',
        [
          '--user',
          userName,
          '--runId',
          run.runId,
          '--strategy',
          run.strategy,
          '--json',
        ],
        {
          nodeHeapMb: RESEARCH_AUTO_AGENT_PARENT_HEAP_MB,
          liveLog: true,
          heartbeatMs: 30_000,
          captureMode: 'full',
        },
      );

      try {
        run.artifacts.agentRun = parseJsonOutput(
          agentResult.stdout,
          'agent-run --json',
        );
      } catch (error) {
        run.artifacts.agentRun = {
          status: 'failed',
          error: (error as Error)?.message || String(error),
          stdout: trimTextTail(agentResult.stdout),
          stderr: trimTextTail(agentResult.stderr),
        };
      }

      await saveRun(run);
      logResearch(`agent invocation finished for run ${runId}`);
      await sendRunReport();
      logResearch(`updated TG report sent after agent for run ${runId}`);
    }

    if (jsonOutput) {
      console.log(JSON.stringify(run));
      process.exit(0);
    }

    console.log(chalk.green('Research auto finished'));
    console.log(
      chalk.gray(
        `strategy=${run.strategy}, config=${run.config}, runId=${run.runId}`,
      ),
    );
    if (run.artifacts.backtestResultKey) {
      console.log(
        chalk.gray(`backtestResultKey=${run.artifacts.backtestResultKey}`),
      );
    }
    if (run.artifacts.aiExportFile) {
      console.log(chalk.gray(`aiExportFile=${run.artifacts.aiExportFile}`));
    }
    process.exit(0);
  } catch (error) {
    run.status = 'failed';
    run.finishedAt = new Date().toISOString();
    run.error = (error as Error)?.message || String(error);
    await saveRun(run);
    logResearch(`run ${runId} failed: ${run.error}`);

    try {
      await sendRunReport();
      logResearch(`TG report sent for failed run ${runId}`);
    } catch (reportError) {
      const suffix = (reportError as Error)?.message || String(reportError);
      run.error = `${run.error}\nTelegram report failed: ${suffix}`;
      await saveRun(run);
      logResearch(`TG report failed for run ${runId}: ${suffix}`);
    }

    if (jsonOutput) {
      console.log(JSON.stringify(run));
    } else {
      console.error(chalk.red(run.error));
    }
    process.exit(1);
  } finally {
    await releaseResearchAutoLock(lockPath);
  }
};
