import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import path from 'path';
import { delKey, getData, getKeys, setData } from '@tradejs/infra/redis';
import { logger } from '@tradejs/infra/logger';
import type { StrategyConfigGrid } from '@tradejs/types';

const HEARTBEAT_TIMEOUT_MS = 20_000;
const SWEEP_INTERVAL_MS = 5_000;
const MAX_LOG_LINES = 220;
const DEFAULT_INTERVAL = '15';
const DEFAULT_CONNECTOR = 'bybit';

export type BacktestJobStatus =
  | 'running'
  | 'pausing'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type BacktestPeriodMode = 'days' | 'range';

export interface BacktestJobRequest {
  strategyName: string;
  configId: string;
  periodMode: BacktestPeriodMode;
  days?: number;
  startTime?: number;
  endTime?: number;
  ai: boolean;
  fast: boolean;
  interval: string;
  connector: string;
  tickers?: string;
  tickersLimit?: number;
  testsLimit?: number;
  parallel?: number;
}

export interface BacktestJobProgress {
  completed: number;
  total: number | null;
  percent: number;
  averageProfit: number | null;
  winRate: number | null;
  successTests: number | null;
  errorTests: number | null;
}

export interface BacktestJobRecord {
  id: string;
  userName: string;
  status: BacktestJobStatus;
  request: BacktestJobRequest;
  command: string;
  args: string[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  pausedAt?: string;
  cancelledAt?: string;
  lastHeartbeatAt?: string;
  pid?: number;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  runCount: number;
  progress: BacktestJobProgress;
  logs: string[];
  error?: string;
  pauseReason?: string;
}

export interface BacktestConfigSummary {
  id: string;
  strategyName: string;
  paramCount: number;
  combinationCount: number;
}

type BacktestProcessHandle = {
  child: ChildProcess;
  record: BacktestJobRecord;
  offset: number;
  pauseRequested: boolean;
  cancelRequested: boolean;
  killTimer?: ReturnType<typeof setTimeout>;
};

declare global {
  var __tradejsBacktestProcesses__:
    | Map<string, BacktestProcessHandle>
    | undefined;
  var __tradejsBacktestSweepTimer__: ReturnType<typeof setInterval> | undefined;
}

const getProcesses = () => {
  global.__tradejsBacktestProcesses__ ??= new Map();
  return global.__tradejsBacktestProcesses__;
};

const processKey = (userName: string, jobId: string) => `${userName}:${jobId}`;

const getJobsPrefix = (userName: string) => `users:${userName}:backtests:runs:`;

const getJobKey = (userName: string, jobId: string) =>
  `${getJobsPrefix(userName)}${jobId}`;

const getBacktestConfigsPrefix = (userName: string) =>
  `users:${userName}:backtests:configs:`;

const nowIso = () => new Date().toISOString();

const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();

const yarnCommand = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';

const emptyProgress = (): BacktestJobProgress => ({
  completed: 0,
  total: null,
  percent: 0,
  averageProfit: null,
  winRate: null,
  successTests: null,
  errorTests: null,
});

const toFiniteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toPositiveNumber = (value: unknown): number | undefined => {
  const parsed = toFiniteNumber(value);
  return parsed != null && parsed > 0 ? parsed : undefined;
};

const toPositiveInteger = (value: unknown): number | undefined => {
  const parsed = toPositiveNumber(value);
  return parsed == null ? undefined : Math.trunc(parsed);
};

const normalizeText = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const stripAnsi = (value: string) =>
  value.replace(
    /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
    '',
  );

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isStrategyConfigGrid = (value: unknown): value is StrategyConfigGrid =>
  isPlainObject(value) &&
  Object.values(value).every((item) => Array.isArray(item));

const estimateCombinationCount = (grid: StrategyConfigGrid) =>
  Object.values(grid).reduce((total, values) => total * values.length, 1);

const formatError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const appendLog = (record: BacktestJobRecord, rawLine: string) => {
  const line = stripAnsi(rawLine).trim();
  if (!line) {
    return;
  }

  record.logs = [...record.logs, line].slice(-MAX_LOG_LINES);
};

const recalculatePercent = (progress: BacktestJobProgress) => {
  if (!progress.total || progress.total <= 0) {
    progress.percent = 0;
    return;
  }

  progress.percent = Math.max(
    0,
    Math.min(100, (progress.completed / progress.total) * 100),
  );
};

export const parseBacktestProgressLine = (line: string, offset = 0) => {
  const text = stripAnsi(line);
  const progressMatch = text.match(
    /(\d+)\/(\d+).*?\bavg\s+(-?\d+(?:\.\d+)?)\$\s+win\s+(-?\d+(?:\.\d+)?)%/i,
  );

  if (progressMatch) {
    const completed = Number(progressMatch[1]);
    const total = Number(progressMatch[2]);
    return {
      completed: offset + completed,
      total: offset + total,
      averageProfit: Number(progressMatch[3]),
      winRate: Number(progressMatch[4]),
    };
  }

  const testsMatch = text.match(/\btests:\s*(\d+)\b/i);
  if (testsMatch) {
    return {
      total: offset + Number(testsMatch[1]),
    };
  }

  const successMatch = text.match(/\bSUCCESS TESTS:\s*(\d+)\b/i);
  if (successMatch) {
    return {
      successTests: offset + Number(successMatch[1]),
    };
  }

  const errorMatch = text.match(/\bERRORS:\s*(\d+)\b/i);
  if (errorMatch) {
    return {
      errorTests: Number(errorMatch[1]),
    };
  }

  return null;
};

const applyProgressLine = (
  record: BacktestJobRecord,
  line: string,
  offset: number,
) => {
  const parsed = parseBacktestProgressLine(line, offset);
  if (!parsed) {
    return;
  }

  record.progress = {
    ...record.progress,
    ...parsed,
  };
  recalculatePercent(record.progress);
};

const applyOutputChunk = (
  record: BacktestJobRecord,
  chunk: Buffer,
  offset: number,
) => {
  const text = chunk.toString('utf8');
  const lines = text.split(/\r|\n/);
  for (const line of lines) {
    appendLog(record, line);
    applyProgressLine(record, line, offset);
  }
};

const saveJob = async (record: BacktestJobRecord) => {
  record.updatedAt = nowIso();
  await setData(getJobKey(record.userName, record.id), record, { expire: 0 });
};

const loadJob = async (userName: string, jobId: string) =>
  (await getData(getJobKey(userName, jobId), null)) as BacktestJobRecord | null;

const getLiveRecord = async (userName: string, jobId: string) => {
  const handle = getProcesses().get(processKey(userName, jobId));
  if (handle) {
    return handle.record;
  }

  return loadJob(userName, jobId);
};

export const normalizeBacktestJobRequest = (
  payload: unknown,
): BacktestJobRequest => {
  if (!isPlainObject(payload)) {
    throw new Error('Invalid backtest request');
  }

  const configId = normalizeText(payload.configId);
  if (!configId) {
    throw new Error('Backtest config is required');
  }

  const derivedStrategyName = configId.split(':')[0] || configId;
  const strategyName =
    normalizeText(payload.strategyName) || derivedStrategyName;
  const periodMode: BacktestPeriodMode =
    payload.periodMode === 'range' ? 'range' : 'days';
  const interval = normalizeText(payload.interval) || DEFAULT_INTERVAL;
  const connector = normalizeText(payload.connector) || DEFAULT_CONNECTOR;

  const request: BacktestJobRequest = {
    strategyName,
    configId,
    periodMode,
    ai: payload.ai === true,
    fast: payload.fast === true,
    interval,
    connector,
  };

  if (periodMode === 'range') {
    const startTime = toPositiveInteger(payload.startTime);
    const endTime = toPositiveInteger(payload.endTime);
    if (!startTime || !endTime || startTime >= endTime) {
      throw new Error('Valid start and end timestamps are required');
    }
    request.startTime = startTime;
    request.endTime = endTime;
  } else {
    request.days = toPositiveNumber(payload.days) ?? 30;
  }

  const tickers = normalizeText(payload.tickers);
  if (tickers) {
    request.tickers = tickers;
  }

  const tickersLimit = toPositiveInteger(payload.tickersLimit);
  if (tickersLimit) {
    request.tickersLimit = tickersLimit;
  }

  const testsLimit = toPositiveInteger(payload.testsLimit);
  if (testsLimit) {
    request.testsLimit = testsLimit;
  }

  const parallel = toPositiveInteger(payload.parallel);
  if (parallel) {
    request.parallel = parallel;
  }

  return request;
};

export const buildBacktestCommandArgs = ({
  request,
  userName,
  skip = 0,
}: {
  request: BacktestJobRequest;
  userName: string;
  skip?: number;
}) => {
  const args = [
    'backtest',
    '--config',
    request.configId,
    '--user',
    userName,
    '--timeframe',
    request.interval,
    '--connector',
    request.connector,
    '--progressStep',
    '1',
  ];

  if (request.periodMode === 'range') {
    args.push(
      '--startTime',
      String(request.startTime),
      '--endTime',
      String(request.endTime),
    );
  } else if (request.days) {
    args.push('--days', String(request.days));
  }

  if (request.ai) {
    args.push('--ai');
  }

  if (request.fast) {
    args.push('--fast');
  }

  if (request.tickers) {
    args.push('--tickers', request.tickers);
  }

  if (request.tickersLimit) {
    args.push('--tickersLimit', String(request.tickersLimit));
  }

  if (request.parallel) {
    args.push('--parallel', String(request.parallel));
  }

  if (skip > 0) {
    args.push('--skip', String(skip));
  }

  if (request.testsLimit) {
    args.push('--tests', String(Math.max(0, request.testsLimit - skip)));
  }

  return args;
};

const shouldSkipLaunch = (record: BacktestJobRecord, skip: number) =>
  Boolean(record.request.testsLimit && skip >= record.request.testsLimit);

const finalizeWithoutLaunch = async (record: BacktestJobRecord) => {
  record.status = 'completed';
  record.finishedAt = nowIso();
  record.progress.total = record.progress.completed;
  record.progress.percent = 100;
  appendLog(record, 'No remaining tests to run.');
  await saveJob(record);
  return record;
};

const launchBacktestProcess = async (
  record: BacktestJobRecord,
  skip: number,
) => {
  ensureSweepTimer();

  if (shouldSkipLaunch(record, skip)) {
    return finalizeWithoutLaunch(record);
  }

  const key = processKey(record.userName, record.id);
  if (getProcesses().has(key)) {
    throw new Error('Backtest job is already running');
  }

  const args = buildBacktestCommandArgs({
    request: record.request,
    userName: record.userName,
    skip,
  });
  const child = spawn(yarnCommand, args, {
    cwd: projectRoot,
    env: {
      ...process.env,
      PROJECT_CWD: projectRoot,
      DOTENV_CONFIG_PATH:
        process.env.DOTENV_CONFIG_PATH || path.join(projectRoot, '.env'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const startedAt = nowIso();

  record.status = 'running';
  record.command = yarnCommand;
  record.args = args;
  record.pid = child.pid;
  record.exitCode = undefined;
  record.signal = undefined;
  record.error = undefined;
  record.pauseReason = undefined;
  record.startedAt ??= startedAt;
  record.lastHeartbeatAt = startedAt;
  record.runCount += 1;
  appendLog(record, `$ ${yarnCommand} ${args.join(' ')}`);
  await saveJob(record);

  const handle: BacktestProcessHandle = {
    child,
    record,
    offset: skip,
    pauseRequested: false,
    cancelRequested: false,
  };
  getProcesses().set(key, handle);

  child.stdout?.on('data', (chunk: Buffer) => {
    applyOutputChunk(record, chunk, handle.offset);
    void saveJob(record);
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    applyOutputChunk(record, chunk, handle.offset);
    void saveJob(record);
  });

  child.on('error', (error) => {
    record.status = 'failed';
    record.error = formatError(error);
    record.finishedAt = nowIso();
    appendLog(record, `Process error: ${record.error}`);
    getProcesses().delete(key);
    void saveJob(record);
  });

  child.on('exit', (code, signal) => {
    if (handle.killTimer) {
      clearTimeout(handle.killTimer);
    }

    record.exitCode = code;
    record.signal = signal;
    record.pid = undefined;
    getProcesses().delete(key);

    if (handle.cancelRequested) {
      record.status = 'cancelled';
      record.cancelledAt = nowIso();
      appendLog(record, 'Backtest cancelled.');
    } else if (handle.pauseRequested) {
      record.status = 'paused';
      record.pausedAt = nowIso();
      appendLog(record, 'Backtest paused.');
    } else if (code === 0) {
      record.status = 'completed';
      record.finishedAt = nowIso();
      if (record.progress.total != null) {
        record.progress.completed = record.progress.total;
        record.progress.percent = 100;
      }
      appendLog(record, 'Backtest completed.');
    } else {
      record.status = 'failed';
      record.finishedAt = nowIso();
      record.error = `Backtest process exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}`;
      appendLog(record, record.error);
    }

    void saveJob(record);
  });

  return record;
};

const requestProcessStop = (
  handle: BacktestProcessHandle,
  {
    cancel,
    reason,
  }: {
    cancel: boolean;
    reason: string;
  },
) => {
  const { child, record } = handle;
  if (cancel) {
    handle.cancelRequested = true;
    record.status = 'cancelled';
    record.cancelledAt = nowIso();
  } else {
    handle.pauseRequested = true;
    record.status = 'pausing';
    record.pauseReason = reason;
  }

  appendLog(record, cancel ? 'Cancelling backtest...' : 'Pausing backtest...');

  if (!child.killed) {
    child.kill('SIGTERM');
    handle.killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }, 8_000);
  }
};

const pauseRunningHandle = async (
  handle: BacktestProcessHandle,
  reason: string,
) => {
  requestProcessStop(handle, { cancel: false, reason });
  await saveJob(handle.record);
  return handle.record;
};

const isHeartbeatStale = (record: BacktestJobRecord, now = Date.now()) => {
  const heartbeatAt = Date.parse(record.lastHeartbeatAt || record.updatedAt);
  return (
    !Number.isFinite(heartbeatAt) || now - heartbeatAt > HEARTBEAT_TIMEOUT_MS
  );
};

const sweepRunningHandles = async () => {
  const now = Date.now();
  for (const handle of getProcesses().values()) {
    if (
      handle.record.status === 'running' &&
      isHeartbeatStale(handle.record, now)
    ) {
      await pauseRunningHandle(handle, 'heartbeat_lost');
    }
  }
};

const ensureSweepTimer = () => {
  if (global.__tradejsBacktestSweepTimer__) {
    return;
  }

  global.__tradejsBacktestSweepTimer__ = setInterval(() => {
    void sweepRunningHandles().catch((error) => {
      logger.warn('backtest job sweep failed: %s', formatError(error));
    });
  }, SWEEP_INTERVAL_MS);
  global.__tradejsBacktestSweepTimer__.unref?.();
};

const reconcileDetachedRunningJob = async (record: BacktestJobRecord) => {
  if (
    (record.status === 'running' || record.status === 'pausing') &&
    !getProcesses().has(processKey(record.userName, record.id))
  ) {
    record.status = 'paused';
    record.pausedAt = nowIso();
    record.pauseReason = 'detached_process';
    record.pid = undefined;
    appendLog(record, 'Backtest process is no longer attached; paused.');
    await saveJob(record);
  }
  return record;
};

export const listBacktestConfigs = async (
  userName: string,
): Promise<BacktestConfigSummary[]> => {
  const prefix = getBacktestConfigsPrefix(userName);
  const keys = await getKeys(prefix);
  const configs = await Promise.all(
    keys.map(async (key): Promise<BacktestConfigSummary | null> => {
      const id = key.slice(prefix.length);
      if (!id) {
        return null;
      }

      const grid = await getData(key, null);
      if (!isStrategyConfigGrid(grid)) {
        return null;
      }

      return {
        id,
        strategyName: id.split(':')[0] || id,
        paramCount: Object.keys(grid).length,
        combinationCount: estimateCombinationCount(grid),
      };
    }),
  );

  return configs
    .filter((config): config is BacktestConfigSummary => Boolean(config))
    .sort((left, right) => left.id.localeCompare(right.id));
};

export const listBacktestJobs = async (
  userName: string,
): Promise<BacktestJobRecord[]> => {
  ensureSweepTimer();
  await sweepRunningHandles();

  const keys = await getKeys(getJobsPrefix(userName));
  const records = await Promise.all(
    keys.map(async (key) => {
      const id = key.slice(getJobsPrefix(userName).length);
      const live = getProcesses().get(processKey(userName, id));
      return live?.record ?? ((await getData(key, null)) as BacktestJobRecord);
    }),
  );

  const reconciled = await Promise.all(
    records
      .filter(Boolean)
      .map((record) => reconcileDetachedRunningJob(record)),
  );

  return reconciled.sort(
    (left, right) =>
      Date.parse(right.createdAt || '') - Date.parse(left.createdAt || ''),
  );
};

export const getBacktestJob = async (userName: string, jobId: string) => {
  ensureSweepTimer();
  const record = await getLiveRecord(userName, jobId);
  return record ? reconcileDetachedRunningJob(record) : null;
};

export const startBacktestJob = async (userName: string, payload: unknown) => {
  const request = normalizeBacktestJobRequest(payload);
  const createdAt = nowIso();
  const record: BacktestJobRecord = {
    id: randomUUID(),
    userName,
    status: 'paused',
    request,
    command: yarnCommand,
    args: [],
    createdAt,
    updatedAt: createdAt,
    lastHeartbeatAt: createdAt,
    runCount: 0,
    progress: emptyProgress(),
    logs: [],
  };
  await saveJob(record);
  return launchBacktestProcess(record, 0);
};

export const heartbeatBacktestJob = async (userName: string, jobId: string) => {
  const record = await getBacktestJob(userName, jobId);
  if (!record) {
    return null;
  }

  if (record.status === 'running') {
    record.lastHeartbeatAt = nowIso();
    await saveJob(record);
  }

  return record;
};

export const pauseBacktestJob = async (
  userName: string,
  jobId: string,
  reason = 'manual_pause',
) => {
  const key = processKey(userName, jobId);
  const handle = getProcesses().get(key);
  if (handle) {
    return pauseRunningHandle(handle, reason);
  }

  const record = await loadJob(userName, jobId);
  if (!record) {
    return null;
  }

  if (record.status === 'running' || record.status === 'pausing') {
    record.status = 'paused';
    record.pausedAt = nowIso();
    record.pauseReason = reason;
    record.pid = undefined;
    appendLog(record, 'Backtest paused.');
    await saveJob(record);
  }

  return record;
};

export const resumeBacktestJob = async (userName: string, jobId: string) => {
  const record = await getBacktestJob(userName, jobId);
  if (!record) {
    return null;
  }

  if (record.status !== 'paused') {
    return record;
  }

  return launchBacktestProcess(record, record.progress.completed);
};

export const cancelBacktestJob = async (userName: string, jobId: string) => {
  const key = processKey(userName, jobId);
  const handle = getProcesses().get(key);
  if (handle) {
    requestProcessStop(handle, { cancel: true, reason: 'cancelled' });
    await saveJob(handle.record);
    return handle.record;
  }

  const record = await loadJob(userName, jobId);
  if (!record) {
    return null;
  }

  if (record.status !== 'completed') {
    record.status = 'cancelled';
    record.cancelledAt = nowIso();
    record.pid = undefined;
    appendLog(record, 'Backtest cancelled.');
    await saveJob(record);
  }

  return record;
};

export const deleteBacktestJob = async (userName: string, jobId: string) => {
  await cancelBacktestJob(userName, jobId);
  return delKey(getJobKey(userName, jobId));
};
