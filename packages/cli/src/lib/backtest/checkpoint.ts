import { createHash, randomUUID } from 'node:crypto';
import {
  getData,
  getHashJsonValues,
  redisKeys,
  setData,
  setHashJsonField,
} from '@tradejs/infra/redis';
import type { Test, TestSuite, TestWorkerResult } from '@tradejs/types';
import { createTimestamp } from '../runFormatting';

export type BacktestRunStatus = 'running' | 'completed' | 'interrupted';

export type BacktestRunManifest = {
  runId: string;
  status: BacktestRunStatus;
  userName: string;
  config: string;
  command: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  connectorName: string;
  interval: string;
  window: { start: number; end: number; source: string };
  preloadStart: number;
  flags: {
    ai: boolean;
    backtestEntryDelayBars: number;
    backtestPriceMode: string;
    cacheOnly: boolean;
    fast: boolean;
    ml: boolean;
  };
  marketContextPreparedAt?: string;
  testSuite: TestSuite;
};

export type BacktestCheckpointResult = {
  result: TestWorkerResult;
  status: 'success';
  testKey: string;
  updatedAt: string;
};

const toStableJson = (value: unknown): string => {
  if (value == null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => toStableJson(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${toStableJson(item)}`)
    .join(',')}}`;
};

const hashValue = (value: unknown) =>
  createHash('sha1').update(toStableJson(value)).digest('hex').slice(0, 16);

export const createBacktestRunId = (date = new Date()) =>
  `${createTimestamp(date)}-${randomUUID().slice(0, 8)}`;

export const buildBacktestTestKey = (test: Test) =>
  hashValue({
    ai: Boolean(test.ai),
    configId: test.configId ?? '',
    connectorName: test.connectorName,
    interval: String(test.interval ?? ''),
    ml: Boolean(test.ml),
    options: test.options,
    strategyConfig: test.strategyConfig,
    strategyName: test.strategyName,
    symbol: test.symbol,
    userName: test.userName,
  });

export const buildCompletedTestKeySet = (
  completed: BacktestCheckpointResult[],
) => new Set(completed.map((item) => item.testKey));

export const filterCompletedBacktestResultsForSuite = ({
  completed,
  testSuite,
}: {
  completed: BacktestCheckpointResult[];
  testSuite: TestSuite;
}) => {
  const suiteKeys = new Set(
    testSuite.map((test) => buildBacktestTestKey(test)),
  );
  return completed.filter((item) => suiteKeys.has(item.testKey));
};

export const filterRemainingBacktestTests = ({
  completed,
  testSuite,
}: {
  completed: BacktestCheckpointResult[];
  testSuite: TestSuite;
}) => {
  const completedKeys = buildCompletedTestKeySet(completed);
  return testSuite.filter(
    (test) => !completedKeys.has(buildBacktestTestKey(test)),
  );
};

export const createBacktestRunManifest = async (
  manifest: Omit<
    BacktestRunManifest,
    'createdAt' | 'runId' | 'status' | 'updatedAt'
  > & {
    runId?: string;
  },
): Promise<BacktestRunManifest> => {
  const now = new Date().toISOString();
  const run: BacktestRunManifest = {
    ...manifest,
    runId: manifest.runId ?? createBacktestRunId(new Date(now)),
    status: 'running',
    createdAt: now,
    updatedAt: now,
  };

  await Promise.all([
    setData(redisKeys.backtestRun(run.userName, run.runId), run, { expire: 0 }),
    setData(redisKeys.backtestLatestRun(run.userName, run.config), run.runId, {
      expire: 0,
    }),
  ]);
  return run;
};

export const saveBacktestCheckpointResult = async ({
  result,
  runId,
  userName,
}: {
  result: TestWorkerResult;
  runId: string;
  userName: string;
}) => {
  const testKey = buildBacktestTestKey(result.test);
  await setHashJsonField(
    redisKeys.backtestRunResults(userName, runId),
    testKey,
    {
      result,
      status: 'success',
      testKey,
      updatedAt: new Date().toISOString(),
    } satisfies BacktestCheckpointResult,
    { expire: 0 },
  );
};

export const loadBacktestCheckpointResults = async ({
  runId,
  userName,
}: {
  runId: string;
  userName: string;
}) =>
  getHashJsonValues<BacktestCheckpointResult>(
    redisKeys.backtestRunResults(userName, runId),
  );

export const loadBacktestRunManifest = async ({
  runId,
  userName,
}: {
  runId: string;
  userName: string;
}) =>
  (await getData(
    redisKeys.backtestRun(userName, runId),
    null,
  )) as BacktestRunManifest | null;

export const resolveBacktestRunIdForContinue = async ({
  config,
  requestedRunId,
  userName,
}: {
  config: string;
  requestedRunId?: string;
  userName: string;
}) => {
  if (requestedRunId?.trim()) {
    return requestedRunId.trim();
  }
  const latest = await getData(
    redisKeys.backtestLatestRun(userName, config),
    null,
  );
  return typeof latest === 'string' && latest.trim() ? latest.trim() : null;
};

export const markBacktestRunStatus = async ({
  run,
  status,
}: {
  run: BacktestRunManifest;
  status: BacktestRunStatus;
}) => {
  const now = new Date().toISOString();
  const nextRun: BacktestRunManifest = {
    ...run,
    status,
    updatedAt: now,
    ...(status === 'completed' ? { completedAt: now } : {}),
  };
  await setData(redisKeys.backtestRun(run.userName, run.runId), nextRun, {
    expire: 0,
  });
  return nextRun;
};
