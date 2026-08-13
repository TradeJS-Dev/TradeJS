import args from 'args';
import chalk from 'chalk';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { TTL_1M } from '@tradejs/core/constants';
import { normalizeAiEndpoint } from '@tradejs/core/aiEndpoints';
import { getData, redisKeys, setData } from '@tradejs/infra/redis';
import { getUserSettings } from '@tradejs/infra/userSettings';
import { sendTelegramReport } from '../lib/telegramReports';
import {
  assertDiffAllowed,
  buildResearchAgentBranchName,
  buildResearchAgentCommitMessage,
  buildResearchAgentPrBody,
  buildResearchAgentPrTitle,
  getResearchAgentAllowedPathPrefixes,
  normalizeDiffOutput,
  parseGithubRepositoryFromRemote,
  RESEARCH_AGENT_MODEL,
  RESEARCH_AGENT_REASONING_EFFORT,
  ResearchAgentRunRecord,
} from '../lib/researchAgent';

args.example(
  'yarn cli:node8g agent-run --runId 1710000000000-trendline --strategy TrendLine',
  'Run the OpenRouter-based research follow-up coding agent in a git worktree',
);

args.option(['U', 'user'], 'Use user config', 'root');
args.option(['r', 'runId'], 'Research run id');
args.option(['s', 'strategy'], 'Strategy name');
args.option('json', 'Print structured JSON summary', false);

const flags = args.parse(process.argv);

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
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt?: string;
  error?: string;
  artifacts: {
    strategyConfig?: Record<string, unknown>;
    backtestConfig?: Record<string, unknown[]>;
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
    agentRun?: ResearchAgentRunRecord;
  };
};

type ValidationKey = 'prettify' | 'typecheck' | 'unit';

const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();

const AGENT_SYSTEM_PROMPT = `You are a senior TypeScript trading research coding agent working inside the TradeJS monorepo.

Output ONLY one of:
1. A unified git diff relative to repo root that can be applied with git apply.
2. The exact token NO_CHANGES if no safe change should be made.

Rules:
- Keep the patch small and surgical.
- Prefer strategy-scoped tests over broad refactors.
- If you change strategy logic, also add or update tests in the same strategy directory.
- Do not touch package boundaries or unrelated files.
- Do not add markdown fences, commentary, or explanations.
- Do not modify files outside the allowed paths listed by the user.
- Deleting files is not allowed.
`;

const trimTextTail = (value: string, limit = 4_000) =>
  value.length <= limit ? value : value.slice(-limit);

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const isOpenRouterEndpoint = (value: string) => {
  try {
    return new URL(value).hostname.toLowerCase().includes('openrouter');
  } catch {
    return value.toLowerCase().includes('openrouter');
  }
};

const resolveChatCompletionsUrl = (endpoint: string) => {
  const normalized = endpoint.replace(/\/+$/, '');
  if (normalized.endsWith('/chat/completions')) {
    return normalized;
  }
  if (normalized.endsWith('/v1')) {
    return `${normalized}/chat/completions`;
  }
  return `${normalized}/chat/completions`;
};

const runCommand = async (
  command: string,
  commandArgs: string[],
  options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
  } = {},
) =>
  new Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd || projectRoot,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

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
      });
    });
  });

const runCommandOrThrow = async (
  command: string,
  commandArgs: string[],
  options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
  } = {},
) => {
  const result = await runCommand(command, commandArgs, options);
  if (result.exitCode !== 0) {
    throw new Error(
      `${command} ${commandArgs.join(' ')} failed: ${trimTextTail(
        result.stderr || result.stdout,
        2_000,
      )}`,
    );
  }
  return result;
};

const listFilesRecursive = async (targetPath: string): Promise<string[]> => {
  try {
    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const absolutePath = path.join(targetPath, entry.name);
        if (entry.isDirectory()) {
          return listFilesRecursive(absolutePath);
        }
        return [absolutePath];
      }),
    );
    return nested.flat().sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
};

const collectStrategyContextFiles = async (
  worktreePath: string,
  strategy: string,
) => {
  const strategyRoot = path.join(
    worktreePath,
    'packages',
    'strategies',
    'src',
    strategy,
  );
  const strategyFiles = await listFilesRecursive(strategyRoot);
  const files = strategyFiles.filter((filePath) =>
    /\.(ts|tsx|md)$/.test(filePath),
  );

  return [...new Set(files)].sort((left, right) => left.localeCompare(right));
};

const renderFileContext = async (worktreePath: string, filePath: string) => {
  const relativePath = path
    .relative(worktreePath, filePath)
    .replace(/\\/g, '/');
  const content = await fs.readFile(filePath, 'utf8');
  return [
    `=== FILE: ${relativePath} ===`,
    content,
    `=== END FILE: ${relativePath} ===`,
  ].join('\n');
};

const buildPrompt = async (
  worktreePath: string,
  run: ResearchRunRecord,
  allowedPaths: string[],
) => {
  const files = await collectStrategyContextFiles(worktreePath, run.strategy);
  const contexts = await Promise.all(
    files.map((filePath) => renderFileContext(worktreePath, filePath)),
  );

  return [
    `Strategy: ${run.strategy}`,
    `Research run id: ${run.runId}`,
    `Allowed paths: ${allowedPaths.join(', ')}`,
    `Backtest config: ${run.config}`,
    `Window: ${run.days} days, timeframe=${run.timeframe}, connector=${run.connector}`,
    '',
    'Research run summary:',
    JSON.stringify(
      {
        status: run.status,
        finishedAt: run.finishedAt,
        backtestResultKey: run.artifacts.backtestResultKey,
        backtestResult: run.artifacts.backtestResult,
        aiExportFile: run.artifacts.aiExportFile,
        aiTrainLocal: run.artifacts.aiTrainLocal,
        strategyConfig: run.artifacts.strategyConfig,
        backtestConfig: run.artifacts.backtestConfig,
      },
      null,
      2,
    ),
    '',
    'Task:',
    '- Inspect the research results and current strategy files.',
    '- Produce the smallest safe follow-up patch.',
    '- Prefer strategy-scoped tests or NO_CHANGES if the data does not justify a production logic change.',
    '- If you change strategy logic, include matching regression tests.',
    '- Do not create or modify notes/: local research notes are permanently Git-ignored and are not allowed in agent commits.',
    '',
    contexts.join('\n\n'),
  ].join('\n');
};

const extractAssistantContent = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }
        if (!item || typeof item !== 'object') {
          return '';
        }
        const record = item as { text?: unknown; type?: unknown };
        if (record.type === 'text' && typeof record.text === 'string') {
          return record.text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  return '';
};

const requestAgentDiff = async (
  userName: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
) => {
  const settings = await getUserSettings(userName);
  const aiApiEndpoint = normalizeAiEndpoint(settings.AI_API_ENDPOINT);
  if (!settings.AI_API_KEY || !aiApiEndpoint) {
    throw new Error(`AI settings are incomplete for user ${userName}`);
  }
  if (!isOpenRouterEndpoint(aiApiEndpoint)) {
    throw new Error(
      `Research agent requires OpenRouter endpoint, got: ${aiApiEndpoint}`,
    );
  }

  const response = await fetch(resolveChatCompletionsUrl(aiApiEndpoint), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.AI_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://tradejs.dev',
      'X-Title': 'TradeJS Research Agent',
    },
    body: JSON.stringify({
      model: RESEARCH_AGENT_MODEL,
      messages,
      reasoning: {
        effort: RESEARCH_AGENT_REASONING_EFFORT,
        exclude: true,
      },
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `OpenRouter request failed (${response.status}): ${await response.text()}`,
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: unknown;
      };
    }>;
  };
  const content = extractAssistantContent(
    payload.choices?.[0]?.message?.content,
  );
  const normalized = normalizeDiffOutput(content);
  if (!normalized) {
    throw new Error('Research agent returned empty content');
  }

  return normalized;
};

const applyDiff = async (worktreePath: string, diffText: string) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tradejs-agent-'));
  const patchPath = path.join(tempDir, 'agent.patch');

  try {
    await fs.writeFile(patchPath, diffText, 'utf8');
    await runCommandOrThrow(
      'git',
      [
        '-C',
        worktreePath,
        'apply',
        '--index',
        '--whitespace=nowarn',
        patchPath,
      ],
      { cwd: worktreePath },
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
};

const getChangedFilesFromGit = async (worktreePath: string) => {
  const result = await runCommandOrThrow(
    'git',
    ['-C', worktreePath, 'status', '--short'],
    { cwd: worktreePath },
  );

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(3).trim());
};

const runValidationSuite = async (
  worktreePath: string,
  agentRun: ResearchAgentRunRecord,
) => {
  const commands: Array<[ValidationKey, string[]]> = [
    ['prettify', ['yarn', 'prettify']],
    ['typecheck', ['yarn', 'typecheck']],
    ['unit', ['yarn', 'unit']],
  ];

  agentRun.validation = {
    prettify: 'pending',
    typecheck: 'pending',
    unit: 'pending',
  };

  for (const [key, command] of commands) {
    const result = await runCommand(command[0], command.slice(1), {
      cwd: worktreePath,
      env: {
        PROJECT_CWD: worktreePath,
        DOTENV_CONFIG_PATH: process.env.DOTENV_CONFIG_PATH,
      },
    });
    if (result.exitCode !== 0) {
      agentRun.validation[key] = 'failed';
      throw new Error(
        `${key} failed: ${trimTextTail(result.stderr || result.stdout, 2_000)}`,
      );
    }
    agentRun.validation[key] = 'passed';
  }
};

const buildAgentTelegramReport = (agentRun: ResearchAgentRunRecord) => {
  const lines = [
    `<b>Research agent: ${escapeHtml(agentRun.strategy)}</b>`,
    `Status: <b>${escapeHtml(agentRun.status)}</b>`,
    `Run: <code>${escapeHtml(agentRun.runId)}</code>`,
    `Model: <code>${escapeHtml(agentRun.model || RESEARCH_AGENT_MODEL)}</code>`,
    `Reasoning: <code>${escapeHtml(agentRun.reasoningEffort || RESEARCH_AGENT_REASONING_EFFORT)}</code>`,
  ];

  if (agentRun.branchName) {
    lines.push(`Branch: <code>${escapeHtml(agentRun.branchName)}</code>`);
  }
  if (agentRun.commitHash) {
    lines.push(`Commit: <code>${escapeHtml(agentRun.commitHash)}</code>`);
  }
  if (agentRun.commitMessage) {
    lines.push(
      `Commit message: <code>${escapeHtml(agentRun.commitMessage)}</code>`,
    );
  }
  if (typeof agentRun.pullRequestNumber === 'number') {
    lines.push(`PR: <code>#${agentRun.pullRequestNumber}</code>`);
  }
  if (agentRun.pullRequestUrl) {
    lines.push(`PR URL: <code>${escapeHtml(agentRun.pullRequestUrl)}</code>`);
  }
  if (agentRun.changedFiles?.length) {
    lines.push(
      `Changed files: <code>${escapeHtml(agentRun.changedFiles.join(', '))}</code>`,
    );
  }
  if (agentRun.summary) {
    lines.push(`Summary: <code>${escapeHtml(agentRun.summary)}</code>`);
  }
  if (agentRun.validation) {
    lines.push(
      `Validation: <code>${escapeHtml(
        Object.entries(agentRun.validation)
          .map(([key, value]) => `${key}=${value}`)
          .join(', '),
      )}</code>`,
    );
  }
  if (agentRun.error) {
    lines.push('');
    lines.push('<b>Error</b>');
    lines.push(`<code>${escapeHtml(agentRun.error)}</code>`);
  }

  return lines.join('\n');
};

const loadRun = async (userName: string, runId: string, strategy: string) => {
  if (runId) {
    const record = (await getData(
      redisKeys.researchRun(userName, runId),
      null,
    )) as ResearchRunRecord | null;
    if (record) {
      return record;
    }
  }

  if (strategy) {
    const latest = (await getData(
      redisKeys.researchLatestRun(userName, strategy),
      null,
    )) as ResearchRunRecord | null;
    if (latest) {
      return latest;
    }
  }

  throw new Error(
    `Research run not found for user=${userName}, runId=${runId || 'n/a'}, strategy=${strategy || 'n/a'}`,
  );
};

const saveAgentRun = async (
  userName: string,
  runId: string,
  strategy: string,
  agentRun: ResearchAgentRunRecord,
) => {
  const run = (await getData(
    redisKeys.researchRun(userName, runId),
    null,
  )) as ResearchRunRecord | null;
  if (!run) {
    return;
  }

  run.artifacts = {
    ...run.artifacts,
    agentRun,
  };
  await setData(redisKeys.researchRun(userName, runId), run, {
    expire: TTL_1M,
  });
  await setData(redisKeys.researchLatestRun(userName, strategy), run, {
    expire: TTL_1M,
  });
};

const resolveGithubRepository = async (worktreePath: string) => {
  if (process.env.AGENT_GITHUB_REPOSITORY?.trim()) {
    return process.env.AGENT_GITHUB_REPOSITORY.trim();
  }

  const remote = await runCommandOrThrow(
    'git',
    ['-C', worktreePath, 'remote', 'get-url', 'origin'],
    { cwd: worktreePath },
  );
  const repository = parseGithubRepositoryFromRemote(remote.stdout.trim());
  if (!repository) {
    throw new Error(`Unable to resolve GitHub repository from origin remote`);
  }
  return repository;
};

const createGithubPullRequest = async (params: {
  worktreePath: string;
  branchName: string;
  title: string;
  body: string;
}) => {
  const token =
    process.env.AGENT_GITHUB_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new Error('AGENT_GITHUB_TOKEN is required to create pull requests');
  }

  const repository = await resolveGithubRepository(params.worktreePath);
  const [owner, repo] = repository.split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid GitHub repository value: ${repository}`);
  }

  const baseBranch = process.env.AGENT_GITHUB_BASE_BRANCH?.trim() || 'stable';
  const head = `${owner}:${params.branchName}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'TradeJS-Research-Agent',
  };

  const existingResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(
      head,
    )}&base=${encodeURIComponent(baseBranch)}`,
    { headers },
  );
  if (!existingResponse.ok) {
    throw new Error(
      `GitHub PR lookup failed (${existingResponse.status}): ${await existingResponse.text()}`,
    );
  }

  const existing = (await existingResponse.json()) as Array<{
    number: number;
    html_url: string;
    title: string;
  }>;
  if (existing[0]) {
    return {
      number: existing[0].number,
      url: existing[0].html_url,
      title: existing[0].title,
      reused: true,
    };
  }

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: params.title,
        head: params.branchName,
        base: baseBranch,
        body: params.body,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `GitHub PR create failed (${response.status}): ${await response.text()}`,
    );
  }

  const payload = (await response.json()) as {
    number: number;
    html_url: string;
    title: string;
  };
  return {
    number: payload.number,
    url: payload.html_url,
    title: payload.title,
    reused: false,
  };
};

const createWorktree = async (branchName: string) => {
  const worktreeToken = branchName.replace(/[/:]+/g, '--');
  const worktreeRoot = path.join(projectRoot, '.agent-worktrees');
  const worktreePath = path.join(worktreeRoot, worktreeToken);
  await fs.mkdir(worktreeRoot, { recursive: true });

  await runCommand('git', ['worktree', 'remove', '--force', worktreePath], {
    cwd: projectRoot,
  });
  await runCommandOrThrow('git', ['fetch', 'origin', 'stable'], {
    cwd: projectRoot,
  });
  await runCommandOrThrow(
    'git',
    ['worktree', 'add', '-B', branchName, worktreePath, 'origin/stable'],
    {
      cwd: projectRoot,
    },
  );

  return worktreePath;
};

const cleanupWorktree = async (worktreePath: string) => {
  await runCommand('git', ['worktree', 'remove', '--force', worktreePath], {
    cwd: projectRoot,
  });
};

export const main = async () => {
  const userName = String(flags.user || 'root').trim() || 'root';
  const requestedRunId = String(flags.runId || '').trim();
  const requestedStrategy = String(flags.strategy || '').trim();
  const jsonOutput = Boolean(flags.json);
  const run = await loadRun(userName, requestedRunId, requestedStrategy);

  const branchName = buildResearchAgentBranchName(run.strategy, run.runId);
  const commitMessage = buildResearchAgentCommitMessage(
    run.strategy,
    run.runId,
  );
  const prTitle = buildResearchAgentPrTitle(run.strategy, run.runId);
  const allowedPrefixes = getResearchAgentAllowedPathPrefixes(run.strategy);
  const agentRun: ResearchAgentRunRecord = {
    status: 'running',
    strategy: run.strategy,
    runId: run.runId,
    branchName,
    commitMessage,
    pullRequestTitle: prTitle,
    model: RESEARCH_AGENT_MODEL,
    reasoningEffort: RESEARCH_AGENT_REASONING_EFFORT,
    summary: 'Awaiting model patch',
    startedAt: new Date().toISOString(),
  };
  let worktreePath = '';

  await saveAgentRun(userName, run.runId, run.strategy, agentRun);

  try {
    worktreePath = await createWorktree(branchName);
    const userPrompt = await buildPrompt(worktreePath, run, allowedPrefixes);
    const messages: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string;
    }> = [
      { role: 'system', content: AGENT_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];

    let diffText = '';
    let changedFiles: string[] = [];

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      diffText = await requestAgentDiff(userName, messages);
      if (diffText === 'NO_CHANGES') {
        agentRun.status = 'no_changes';
        agentRun.summary = 'Model decided not to change code or notes';
        agentRun.finishedAt = new Date().toISOString();
        await saveAgentRun(userName, run.runId, run.strategy, agentRun);
        await sendTelegramReport(buildAgentTelegramReport(agentRun), {
          userName,
        });

        if (jsonOutput) {
          console.log(JSON.stringify(agentRun));
        } else {
          console.log(chalk.yellow(agentRun.summary));
        }
        return;
      }

      changedFiles = assertDiffAllowed(diffText, allowedPrefixes);

      try {
        await applyDiff(worktreePath, diffText);
        break;
      } catch (error) {
        if (attempt >= 2) {
          throw error;
        }
        messages.push({ role: 'assistant', content: diffText });
        messages.push({
          role: 'user',
          content: `The previous unified diff failed to apply.\nError:\n${String(
            (error as Error)?.message || error,
          )}\n\nReturn a corrected unified diff only. Keep the same allowed paths.`,
        });
      }
    }

    agentRun.summary = `Applied model diff touching ${changedFiles.length} file(s)`;
    await runValidationSuite(worktreePath, agentRun);

    const effectiveChangedFiles = await getChangedFilesFromGit(worktreePath);
    if (!effectiveChangedFiles.length) {
      agentRun.status = 'no_changes';
      agentRun.summary =
        'Patch applied cleanly but produced no working tree changes';
      agentRun.finishedAt = new Date().toISOString();
      await saveAgentRun(userName, run.runId, run.strategy, agentRun);
      await sendTelegramReport(buildAgentTelegramReport(agentRun), {
        userName,
      });

      if (jsonOutput) {
        console.log(JSON.stringify(agentRun));
      } else {
        console.log(chalk.yellow(agentRun.summary));
      }
      return;
    }

    await runCommandOrThrow('git', ['-C', worktreePath, 'add', '.'], {
      cwd: worktreePath,
    });
    await runCommandOrThrow(
      'git',
      ['-C', worktreePath, 'commit', '-m', commitMessage],
      {
        cwd: worktreePath,
        env: {
          GIT_AUTHOR_NAME:
            process.env.GIT_AUTHOR_NAME || 'TradeJS Research Agent',
          GIT_AUTHOR_EMAIL:
            process.env.GIT_AUTHOR_EMAIL || 'research-agent@tradejs.dev',
          GIT_COMMITTER_NAME:
            process.env.GIT_COMMITTER_NAME || 'TradeJS Research Agent',
          GIT_COMMITTER_EMAIL:
            process.env.GIT_COMMITTER_EMAIL || 'research-agent@tradejs.dev',
        },
      },
    );
    await runCommandOrThrow(
      'git',
      ['-C', worktreePath, 'push', '-u', 'origin', branchName],
      { cwd: worktreePath },
    );

    const commitHash = (
      await runCommandOrThrow(
        'git',
        ['-C', worktreePath, 'rev-parse', 'HEAD'],
        {
          cwd: worktreePath,
        },
      )
    ).stdout.trim();

    agentRun.status = 'completed';
    agentRun.commitHash = commitHash;
    agentRun.changedFiles = effectiveChangedFiles;
    agentRun.summary = `Committed validated patch on branch ${branchName}`;
    const prBody = buildResearchAgentPrBody({
      strategy: run.strategy,
      runId: run.runId,
      config: run.config,
      connector: run.connector,
      timeframe: run.timeframe,
      days: run.days,
      recent: run.recent,
      changedFiles: effectiveChangedFiles,
      validation: agentRun.validation,
      summary: agentRun.summary,
      aiTrainLocal: (run.artifacts.aiTrainLocal ?? null) as {
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
      } | null,
    });
    const pr = await createGithubPullRequest({
      worktreePath,
      branchName,
      title: prTitle,
      body: prBody,
    });
    agentRun.pullRequestNumber = pr.number;
    agentRun.pullRequestUrl = pr.url;
    agentRun.pullRequestTitle = pr.title;
    agentRun.summary = pr.reused
      ? `Committed validated patch on branch ${branchName}; reused PR #${pr.number}`
      : `Committed validated patch on branch ${branchName}; created PR #${pr.number}`;
    agentRun.finishedAt = new Date().toISOString();
    await saveAgentRun(userName, run.runId, run.strategy, agentRun);
    await sendTelegramReport(buildAgentTelegramReport(agentRun), {
      userName,
    });

    if (jsonOutput) {
      console.log(JSON.stringify(agentRun));
    } else {
      console.log(chalk.green(agentRun.summary));
      console.log(chalk.gray(`branch=${branchName}`));
      console.log(chalk.gray(`commit=${commitHash}`));
      if (agentRun.pullRequestUrl) {
        console.log(chalk.gray(`pullRequest=${agentRun.pullRequestUrl}`));
      }
    }
  } catch (error) {
    agentRun.status = 'failed';
    agentRun.error = (error as Error)?.message || String(error);
    agentRun.finishedAt = new Date().toISOString();
    await saveAgentRun(userName, run.runId, run.strategy, agentRun);

    try {
      await sendTelegramReport(buildAgentTelegramReport(agentRun), {
        userName,
      });
    } catch {}

    if (jsonOutput) {
      console.log(JSON.stringify(agentRun));
    } else {
      console.error(chalk.red(agentRun.error));
    }
    process.exit(1);
  } finally {
    if (worktreePath) {
      await cleanupWorktree(worktreePath);
    }
  }
};
