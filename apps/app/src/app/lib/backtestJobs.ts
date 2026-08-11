import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import path from 'path';
import { TTL_1M } from '@tradejs/core/constants';
import {
  delKey,
  getData,
  getKeys,
  redisKeys,
  setData,
} from '@tradejs/infra/redis';
import { logger } from '@tradejs/infra/logger';
import type { StrategyConfigGrid } from '@tradejs/types';
import type {
  BacktestConfigSummary,
  BacktestJobProgress,
  BacktestJobRecord,
  BacktestJobRequest,
  BacktestJobStatus,
} from './backtestJobContracts';
import {
  buildBacktestCommandArgs,
  normalizeBacktestJobRequest,
} from './backtestJobRequest';
import { parseBacktestProgressLine } from './backtestJobProgress';
export type {
  BacktestConfigSummary,
  BacktestJobProgress,
  BacktestJobRecord,
  BacktestJobRequest,
  BacktestJobStatus,
  BacktestPeriodMode,
} from './backtestJobContracts';
export {
  buildBacktestCommandArgs,
  normalizeBacktestJobRequest,
} from './backtestJobRequest';
export { parseBacktestProgressLine } from './backtestJobProgress';

const HEARTBEAT_TIMEOUT_MS = 20_000;
const SWEEP_INTERVAL_MS = 5_000;
const MAX_LOG_LINES = 220;
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

const getBacktestConfigsPrefix = (userName: string) =>
  `users:${userName}:backtests:configs:`;

const nowIso = () => new Date().toISOString();

const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();

const localCliCommand = path.join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tradejs.cmd' : 'tradejs',
);
const cliCommand = existsSync(localCliCommand) ? localCliCommand : 'tradejs';

const emptyProgress = (): BacktestJobProgress => ({
  completed: 0,
  total: null,
  percent: 0,
  averageProfit: null,
  winRate: null,
  successTests: null,
  errorTests: null,
});

const normalizeText = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const stripAnsi = (value: string) =>
  value.replace(
    /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
    '',
  );

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const BACKTEST_JOB_STATUSES = new Set<BacktestJobStatus>([
  'running',
  'pausing',
  'paused',
  'completed',
  'failed',
  'cancelled',
]);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isNullableFiniteNumber = (value: unknown) =>
  value === null || isFiniteNumber(value);

const isOptionalFiniteNumber = (value: unknown) =>
  value === undefined || isFiniteNumber(value);

const isOptionalString = (value: unknown) =>
  value === undefined || typeof value === 'string';

const isBacktestJobRequest = (value: unknown): value is BacktestJobRequest => {
  if (!isPlainObject(value)) {
    return false;
  }

  const periodIsValid =
    value.periodMode === 'days'
      ? isFiniteNumber(value.days)
      : value.periodMode === 'range' &&
        isFiniteNumber(value.startTime) &&
        isFiniteNumber(value.endTime);

  return (
    normalizeText(value.strategyName).length > 0 &&
    normalizeText(value.configId).length > 0 &&
    periodIsValid &&
    typeof value.ai === 'boolean' &&
    typeof value.fast === 'boolean' &&
    normalizeText(value.interval).length > 0 &&
    normalizeText(value.connector).length > 0 &&
    isOptionalString(value.tickers) &&
    isOptionalFiniteNumber(value.tickersLimit) &&
    isOptionalFiniteNumber(value.testsLimit) &&
    isOptionalFiniteNumber(value.parallel)
  );
};

const isBacktestJobProgress = (value: unknown): value is BacktestJobProgress =>
  isPlainObject(value) &&
  isFiniteNumber(value.completed) &&
  isNullableFiniteNumber(value.total) &&
  isFiniteNumber(value.percent) &&
  isNullableFiniteNumber(value.averageProfit) &&
  isNullableFiniteNumber(value.winRate) &&
  isNullableFiniteNumber(value.successTests) &&
  isNullableFiniteNumber(value.errorTests);

export const isBacktestJobRecord = (
  value: unknown,
): value is BacktestJobRecord =>
  isPlainObject(value) &&
  normalizeText(value.id).length > 0 &&
  normalizeText(value.userName).length > 0 &&
  typeof value.status === 'string' &&
  BACKTEST_JOB_STATUSES.has(value.status as BacktestJobStatus) &&
  isBacktestJobRequest(value.request) &&
  typeof value.command === 'string' &&
  Array.isArray(value.args) &&
  value.args.every((item) => typeof item === 'string') &&
  normalizeText(value.createdAt).length > 0 &&
  normalizeText(value.updatedAt).length > 0 &&
  isOptionalString(value.startedAt) &&
  isOptionalString(value.finishedAt) &&
  isOptionalString(value.pausedAt) &&
  isOptionalString(value.cancelledAt) &&
  isOptionalString(value.lastHeartbeatAt) &&
  isOptionalFiniteNumber(value.pid) &&
  (value.exitCode === null || isOptionalFiniteNumber(value.exitCode)) &&
  (value.signal === null || isOptionalString(value.signal)) &&
  isFiniteNumber(value.runCount) &&
  isBacktestJobProgress(value.progress) &&
  Array.isArray(value.logs) &&
  value.logs.every((item) => typeof item === 'string') &&
  isOptionalString(value.error) &&
  isOptionalString(value.pauseReason);

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
  await setData(redisKeys.backtestJob(record.userName, record.id), record, {
    expire: TTL_1M,
  });
};

const loadJob = async (userName: string, jobId: string) => {
  const stored = await getData(redisKeys.backtestJob(userName, jobId), null);
  if (stored == null) {
    return null;
  }

  if (
    !isBacktestJobRecord(stored) ||
    stored.userName !== userName ||
    stored.id !== jobId
  ) {
    logger.warn('ignored invalid backtest job record: %s', jobId);
    return null;
  }

  return stored;
};

const getLiveRecord = async (userName: string, jobId: string) => {
  const handle = getProcesses().get(processKey(userName, jobId));
  if (handle) {
    return handle.record;
  }

  return loadJob(userName, jobId);
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
  const child = spawn(cliCommand, args, {
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
  record.command = cliCommand;
  record.args = args;
  record.pid = child.pid;
  record.exitCode = undefined;
  record.signal = undefined;
  record.error = undefined;
  record.pauseReason = undefined;
  record.startedAt ??= startedAt;
  record.lastHeartbeatAt = startedAt;
  record.runCount += 1;
  appendLog(record, `$ ${cliCommand} ${args.join(' ')}`);
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

const reconcileEmptyCompletedJob = async (record: BacktestJobRecord) => {
  if (record.status !== 'completed') {
    return record;
  }

  const noTestsMessage = record.logs.find((line) =>
    /^(No tests selected|No backtest tests selected)\b/.test(line),
  );
  if (!noTestsMessage) {
    return record;
  }

  record.status = 'failed';
  record.error = noTestsMessage;
  appendLog(record, 'Backtest failed because no tests were generated.');
  await saveJob(record);
  return record;
};

const reconcileStoredJob = async (record: BacktestJobRecord) =>
  reconcileEmptyCompletedJob(await reconcileDetachedRunningJob(record));

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

  const jobsPrefix = redisKeys.backtestJobs(userName);
  const keys = await getKeys(jobsPrefix);
  const records = await Promise.all(
    keys.map(async (key) => {
      const id = key.slice(jobsPrefix.length);
      const live = getProcesses().get(processKey(userName, id));
      return live?.record ?? loadJob(userName, id);
    }),
  );

  const reconciled = await Promise.all(
    records
      .filter((record): record is BacktestJobRecord => Boolean(record))
      .map((record) => reconcileStoredJob(record)),
  );

  return reconciled.sort(
    (left, right) =>
      Date.parse(right.createdAt || '') - Date.parse(left.createdAt || ''),
  );
};

export const getBacktestJob = async (userName: string, jobId: string) => {
  ensureSweepTimer();
  const record = await getLiveRecord(userName, jobId);
  return record ? reconcileStoredJob(record) : null;
};

export const startBacktestJob = async (userName: string, payload: unknown) => {
  const request = normalizeBacktestJobRequest(payload);
  const createdAt = nowIso();
  const record: BacktestJobRecord = {
    id: randomUUID(),
    userName,
    status: 'paused',
    request,
    command: cliCommand,
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
  return delKey(redisKeys.backtestJob(userName, jobId));
};
