import args from 'args';
import chalk from 'chalk';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { toFileToken } from '@tradejs/infra/ai';
import { getData, getKeys, redisKeys, setData } from '@tradejs/infra/redis';
import { getAvailableStrategyNames } from '@tradejs/node/strategies';
import { StrategyConfig, StrategyConfigGrid } from '@tradejs/types';
import { getBuiltInStrategyDefaultConfig } from '@tradejs/strategies';
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
args.option('skip', 'AI train skip rows from end', 0);
args.option('minQuality', 'Minimum AI quality required to approve entry', 4);
args.option('outDir', 'AI export output directory', 'data/ai/export');
args.option('json', 'Print structured JSON summary', false);

const flags = args.parse(process.argv);

type ResearchStepName =
  | 'prepareBacktestConfig'
  | 'cleanTests'
  | 'cleanAiExport'
  | 'backtest'
  | 'aiExport'
  | 'aiTrainLocal';

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
  };
};

const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();
const dotenvPath =
  String(
    process.env.DOTENV_CONFIG_PATH || path.join(projectRoot, '.env'),
  ).trim() || path.join(projectRoot, '.env');

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
});

const saveRun = async (run: ResearchRunRecord) => {
  await setData(redisKeys.researchRun(run.userName, run.runId), run, {
    expire: 0,
  });
  await setData(redisKeys.researchLatestRun(run.userName, run.strategy), run, {
    expire: 0,
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

export const toStrategyConfigGrid = (
  strategyConfig: StrategyConfig,
): StrategyConfigGrid => {
  return Object.fromEntries(
    Object.entries(strategyConfig).map(([key, value]) => [key, [value]]),
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
  lines.push('Agent layer: <code>not implemented</code>');
  return lines.join('\n');
};

export const runCliCommand = async (params: {
  command: string;
  args: string[];
  node8g?: boolean;
}): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}> => {
  const startedAt = Date.now();
  const env = {
    ...process.env,
    PROJECT_CWD: projectRoot,
    DOTENV_CONFIG_PATH: dotenvPath,
    ...(params.node8g
      ? {
          NODE_OPTIONS: [
            '--max-old-space-size=8192',
            String(process.env.NODE_OPTIONS || '').trim(),
          ]
            .filter(Boolean)
            .join(' '),
        }
      : {}),
  };

  return new Promise((resolve, reject) => {
    const child = spawn(
      'bash',
      ['./bin/run-cli-dist.sh', params.command, ...params.args],
      {
        cwd: projectRoot,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
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

  const availableStrategies = await getAvailableStrategyNames(projectRoot);
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
      `No research candidates found from registered strategies for user ${userName}.`,
    );
  }

  candidates.sort(
    (left, right) =>
      left.lastFinishedAt - right.lastFinishedAt ||
      left.strategy.localeCompare(right.strategy),
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

const main = async () => {
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

  const executeStep = async (
    stepName: ResearchStepName,
    command: string,
    commandArgs: string[],
    options: { node8g?: boolean } = {},
  ) => {
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
      node8g: options.node8g,
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
      throw new Error(
        `${stepName} failed (exitCode=${result.exitCode}): ${trimTextTail(
          result.stderr || result.stdout,
          1200,
        )}`,
      );
    }

    return result;
  };

  const prepareBacktestConfig = async () => {
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
      (getBuiltInStrategyDefaultConfig(target.strategy) as
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

  await saveRun(run);

  try {
    const backtestKeysBefore = new Set(
      await getKeys(getBacktestResultsPrefix(userName, target.config)),
    );
    const aiFilesBefore = new Set(
      await listMergedFiles(outDir, target.strategy),
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
      { node8g: true },
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
      { node8g: true },
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
    }

    const aiFilesAfter = await listMergedFiles(outDir, target.strategy);
    const newAiFiles = aiFilesAfter
      .filter((filePath) => !aiFilesBefore.has(filePath))
      .sort();
    run.artifacts.aiExportFile =
      newAiFiles[newAiFiles.length - 1] || aiFilesAfter.at(-1);
    run.artifacts.aiTrainLocal = parseJsonOutput(
      aiTrainResult.stdout,
      'ai-train --json',
    );

    run.status = 'completed';
    run.finishedAt = new Date().toISOString();
    await saveRun(run);
    await sendRunReport();

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

    try {
      await sendRunReport();
    } catch (reportError) {
      const suffix = (reportError as Error)?.message || String(reportError);
      run.error = `${run.error}\nTelegram report failed: ${suffix}`;
      await saveRun(run);
    }

    if (jsonOutput) {
      console.log(JSON.stringify(run));
    } else {
      console.error(chalk.red(run.error));
    }
    process.exit(1);
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(chalk.red((error as Error)?.message || String(error)));
    process.exit(1);
  });
}
