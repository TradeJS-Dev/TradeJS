const ListIt = require('list-it');
import args from 'args';
import fs from 'fs';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { format } from 'date-fns';
import { ConnectorNames } from '@tradejs/connectors';
import {
  DEFAULT_CONNECTOR_NAME,
  getConnectorCreatorByName,
  resolveConnectorName,
} from '@tradejs/node/connectors';
import {
  drawStatInCLI,
  getTickers,
  loadTradejsConfig,
  update,
} from '@tradejs/node/cli';
import { calculateStatsFull, parseTestName } from '@tradejs/core/backtest';
import type { TradejsConfigHooks } from '@tradejs/core/config';
import { createTestSuite, mergeConfigs } from '@tradejs/core/grid';
import { runWithConcurrency } from '@tradejs/core/async';
import { toJson } from '@tradejs/core/data';
import {
  BACKTEST_DEFAULT_DAYS,
  BACKTEST_PRELOAD_DAYS,
  TESTS_LIMIT,
  TESTS_TOP_LIMIT,
  TTL_1D,
  TTL_1M,
} from '@tradejs/core/constants';
import {
  formatUnix,
  getBacktestPreloadStart,
  getTimestamp,
} from '@tradejs/core/time';
import { setData, getData, getKeys, redisKeys } from '@tradejs/infra/redis';
import {
  Interval,
  Item,
  Connector,
  OrderLog,
  PositionLogData,
  StrategyConfig,
  TestSuite,
  TestStat,
  Test,
  TestWorkerResult,
  ConnectorCreator,
  StrategyConfigGrid,
} from '@tradejs/types';
import {
  backfillDerivativesContextForBacktest,
  shouldBackfillDerivativesContextForBacktest,
} from '../lib/derivativesContextBackfill';
import { normalizeCliArgv } from '../lib/cliArgs';
import { loadRuntimeStrategyConfigs } from '../lib/runtimeRedis';
import { resolveTimeWindow } from '../lib/timeWindow';
import { executeBacktestWorkerPool } from './backtestWorkerPool';

const BYTES_IN_MB = 1024 * 1024;
const MAX_PARALLEL = Math.min(os.cpus().length, 6);

export const resolveDefaultWorkerHeapMb = (
  totalMemoryBytes = os.totalmem(),
) => {
  const totalMemoryMb = Math.max(0, Math.floor(totalMemoryBytes / BYTES_IN_MB));
  if (totalMemoryMb >= 64_000) {
    return 3072;
  }
  if (totalMemoryMb >= 24_000) {
    return 2048;
  }
  return 1536;
};

export const resolveDefaultParallel = (
  totalMemoryBytes = os.totalmem(),
  cpuCount = os.cpus().length,
  workerHeapMb = resolveDefaultWorkerHeapMb(totalMemoryBytes),
) => {
  const totalMemoryMb = Math.max(0, Math.floor(totalMemoryBytes / BYTES_IN_MB));
  const memoryBudgetMb = Math.max(workerHeapMb, totalMemoryMb - 2048);
  const parallelByMemory = Math.max(
    1,
    Math.floor(memoryBudgetMb / workerHeapMb),
  );
  return Math.max(1, Math.min(cpuCount, MAX_PARALLEL, parallelByMemory, 4));
};

const DEFAULT_WORKER_HEAP_MB = resolveDefaultWorkerHeapMb();
const DEFAULT_PARALLEL = resolveDefaultParallel(
  os.totalmem(),
  os.cpus().length,
  DEFAULT_WORKER_HEAP_MB,
);

export const resolveWorkerHeapMb = (
  value: unknown = process.env.BACKTEST_WORKER_HEAP_MB,
  fallback = DEFAULT_WORKER_HEAP_MB,
) => Math.max(256, parseInt(String(value ?? fallback), 10) || fallback);

export const resolveEffectiveParallel = (
  flagValue: unknown,
  envValue: unknown = process.env.BACKTEST_MAX_PARALLEL,
  fallback = MAX_PARALLEL,
) =>
  Math.max(
    1,
    Math.min(
      parseInt(String(flagValue), 10) || fallback,
      parseInt(String(envValue ?? fallback), 10) || fallback,
    ),
  );

export const resolveRequestedTestsLimit = ({
  isLiveMode,
  requestedLimit,
  hasExplicitLimit,
}: {
  isLiveMode: boolean;
  requestedLimit: number;
  hasExplicitLimit: boolean;
}) =>
  isLiveMode && !hasExplicitLimit ? Number.POSITIVE_INFINITY : requestedLimit;

args.example(
  ' yarn backtest -t 400 --cacheOnly',
  'Run tests on uploaded data for 400 tickers',
);

args.option(['t', 'tickers'], 'Selected tickers');
args.option(['e', 'exclude'], 'Exclude tickers from tests');
args.option(['l', 'tickersLimit'], 'Tickers limit');
args.option(['n', 'tests'], 'Tests limit', TESTS_LIMIT);
args.option(['s', 'skip'], 'Skip first N tests', 0);
args.option(['p', 'parallel'], 'Parallel tasks', DEFAULT_PARALLEL);
args.option(['f', 'timeframe'], 'Timeframe', 15);
args.option(['d', 'days'], 'Run backtest only for the last N days');
args.option('startTime', 'Explicit backtest start timestamp (ms or seconds)');
args.option('endTime', 'Explicit backtest end timestamp (ms or seconds)');
args.option(['T', 'top'], 'Return N best tests', TESTS_TOP_LIMIT);
args.option(['u', 'updateOnly'], 'Only update tickers history', false);
args.option(['C', 'cacheOnly'], 'Do not update tickers history', false);
args.option(['c', 'config'], 'Backtest config', 'breakout');
args.option(['L', 'showTickersList'], 'Just show only ticker list', false);
args.option(['g', 'progressStep'], 'Progress step', 100);
args.option(['U', 'user'], 'Use user config', 'root');
args.option(
  ['o', 'connector'],
  'Connector provider or name for backtest (e.g. bybit, binance, coinbase, custom)',
  'bybit',
);
args.option(
  ['m', 'ml'],
  'Write ML dataset rows to per-worker JSONL chunks',
  false,
);
args.option(
  ['A', 'ai'],
  'Write AI prompt rows to per-worker JSONL chunks',
  false,
);

const normalizedArgv = normalizeCliArgv(process.argv, {
  '--AI': '--ai',
  '--ML': '--ml',
  '-C': '--cacheOnly',
  '-E': '--endTime',
  '-P': '--progressStep',
  '-S': '--startTime',
  '-T': '--top',
  '-U': '--user',
});

process.argv = normalizedArgv;

if (
  normalizedArgv.some(
    (arg) => arg === '--live' || String(arg).startsWith('--live='),
  )
) {
  throw new Error(
    '`--live` was removed from `yarn backtest`. Use `yarn replay` instead.',
  );
}

const flags = args.parse(process.argv);
const hasCliFlag = (argv: string[], names: string[]) =>
  argv.some(
    (arg) =>
      names.includes(arg) || names.some((name) => arg.startsWith(`${name}=`)),
  );
export const interval = flags.timeframe.toString() as Interval;
const progressStep = Math.max(1, parseInt(String(flags.progressStep), 10));
const testsLimit = Math.max(0, parseInt(String(flags.tests), 10));
const testsSkip = Math.max(0, parseInt(String(flags.skip ?? 0), 10));
const hasExplicitTestsLimit = hasCliFlag(normalizedArgv, ['--tests', '-n']);
export const isUpdateOnlyRun = Boolean(flags.updateOnly);
const testItemTimeoutMs = 240_000;
const workerHeapMb = resolveWorkerHeapMb();
const effectiveParallel = resolveEffectiveParallel(flags.parallel);
export const resultArtifactsIoConcurrency = Math.max(
  8,
  Math.min(32, effectiveParallel * 4),
);
const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();
const testerWorkerPathCandidates = [
  // `tradejs` bin runs from dist/cli.js, so bundled commands resolve from `dist`.
  path.resolve(__dirname, './workers/testerWorker.js'),
  // Direct execution of dist/scripts/backtest.js resolves from `dist/scripts`.
  path.resolve(__dirname, '../workers/testerWorker.js'),
  // ts-node execution resolves from `src/scripts`.
  path.resolve(__dirname, '../workers/testerWorker.ts'),
];
const testerWorkerPath = testerWorkerPathCandidates.find((candidate) =>
  fs.existsSync(candidate),
);
if (!testerWorkerPath) {
  throw new Error(
    `Tester worker file not found. Checked: ${testerWorkerPathCandidates.join(', ')}`,
  );
}
const testerNeedsTsRuntime = testerWorkerPath.endsWith('.ts');

const HEADERS_RESULTS = [
  chalk.blue('ID'),
  chalk.yellow('SYMBOL'),
  chalk.cyan('PROFIT'),
  chalk.cyan('ORDERS'),
  chalk.cyan('WIN/LOSS (%)'),
  chalk.cyan('RISK'),
  chalk.cyan('MAX DRAWDOWN (%)'),
];

const HEADERS_RESULTS_BY_TICKERS = [
  chalk.blue('ID'),
  chalk.yellow('SYMBOL'),
  chalk.cyan('PROFIT'),
  chalk.cyan('ORDERS'),
  chalk.cyan('WIN/LOSS (%)'),
  chalk.cyan('RISK'),
  chalk.cyan('MAX DRAWDOWN (%)'),
];

type ErrorMessage = { id?: number; error?: unknown; payload?: any };
export type ResolvedWindow = {
  start: number;
  end: number;
  source: string;
};
export type PreparedRunEnvironment = {
  connectorName: string;
  marketConnector: Connector;
  tickers: string[];
  window: ResolvedWindow;
  preloadStart: number;
};
type LoadedBacktestConfig = {
  strategyName: string;
  strategyConfigGrid: StrategyConfigGrid;
};
export type RuntimeStrategyBacktestConfig = {
  strategyName: string;
  strategyConfig: StrategyConfig;
  backtestConfig: StrategyConfigGrid;
};
const normalizeConfigHookList = <THook extends (...args: any[]) => unknown>(
  value: THook | THook[] | undefined,
): THook[] => {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  return value ? [value] : [];
};

export const getUnsupportedLiveProjectHookStages = (
  hooks: TradejsConfigHooks | undefined,
): string[] => {
  const unsupportedStages: string[] = [];

  if (normalizeConfigHookList(hooks?.beforeSignals as any).length > 0) {
    unsupportedStages.push('beforeSignals');
  }

  return unsupportedStages;
};

let successTests = 0;
let errorTests = 0;
const errorMessages: ErrorMessage[] = [];
let results: TestWorkerResult[] = [];
const resultsByTickers = new Map<string, TestWorkerResult>();
const replayResultsByStrategyAndTicker = new Map<string, TestWorkerResult>();
const persistedTestSummaryByKey = new Map<string, Item>();

export const userName = flags.user;
let runStartedAt = Date.now();
let testsStartedAt = runStartedAt;
let activeConnectorForRuntimeCompare: Connector | null = null;
let activeConnectorNameForRuntimeCompare = '';
let activeWindowForRuntimeCompare: { start: number; end: number } | null = null;

export const storeReplayResult = (result: TestWorkerResult) => {
  replayResultsByStrategyAndTicker.set(
    getReplayStrategyResultKey(result),
    result,
  );
};

export const getReplayResults = () =>
  Array.from(replayResultsByStrategyAndTicker.values());

export const getRuntimeCompareContext = () => ({
  connector: activeConnectorForRuntimeCompare,
  connectorName: activeConnectorNameForRuntimeCompare,
  window: activeWindowForRuntimeCompare,
});

export const getRunStartedAt = () => runStartedAt;
export const getRunCounters = () => ({
  successTests,
  errorTests,
  errors: [...errorMessages],
});

export const resetRunState = () => {
  successTests = 0;
  errorTests = 0;
  errorMessages.length = 0;
  results = [];
  resultsByTickers.clear();
  replayResultsByStrategyAndTicker.clear();
  persistedTestSummaryByKey.clear();
  runStartedAt = Date.now();
  testsStartedAt = runStartedAt;
  activeConnectorForRuntimeCompare = null;
  activeConnectorNameForRuntimeCompare = '';
  activeWindowForRuntimeCompare = null;
};

const createListIt = () =>
  new ListIt({
    autoAlign: true,
    headerUnderline: true,
  });

export const createTable = (headers: string[], rows: string[][]) =>
  createListIt().setHeaderRow(headers).d(rows).toString();

export const createTimestamp = (date: Date) => format(date, 'yyyyMMddHHmm');

const formatDuration = (startedAt: number) => {
  const seconds = (Date.now() - startedAt) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = Math.round(seconds % 60);
  return `${minutes}m ${restSeconds}s`;
};

const formatWindowDays = (startMs: number, endMs: number) => {
  const days = Math.max(0, (endMs - startMs) / (24 * 60 * 60 * 1000));
  return Number.isInteger(days) ? String(days) : days.toFixed(2);
};

const timeOperation = async <T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const startedAt = Date.now();
  try {
    return await operation();
  } finally {
    console.log(chalk.gray(`${label}: done in ${formatDuration(startedAt)}`));
  }
};

const isGoodTest = (result: TestWorkerResult) =>
  result.stat?.orders > 5 && result.stat?.profit > 10;

const getResultAmount = (result: TestWorkerResult) => result.stat.amount ?? 0;

const recordError = (error: ErrorMessage) => {
  errorMessages.push(error);
};

const insertTopResult = (
  currentResults: TestWorkerResult[],
  nextResult: TestWorkerResult,
  limit: number,
) => {
  if (limit <= 0) {
    return {
      results: [] as TestWorkerResult[],
      added: false,
    };
  }

  const nextResults = [...currentResults];
  const nextAmount = getResultAmount(nextResult);
  let insertIndex = nextResults.length;

  for (let index = 0; index < nextResults.length; index += 1) {
    if (nextAmount > getResultAmount(nextResults[index])) {
      insertIndex = index;
      break;
    }
  }

  if (insertIndex === nextResults.length && nextResults.length >= limit) {
    return {
      results: currentResults,
      added: false,
    };
  }

  nextResults.splice(insertIndex, 0, nextResult);
  if (nextResults.length > limit) {
    nextResults.length = limit;
  }

  return {
    results: nextResults,
    added: nextResults.some(
      (candidate) => candidate.test.name === nextResult.test.name,
    ),
  };
};

const updateTopResults = (nextResults: TestWorkerResult[]) => {
  results = nextResults;
};

const updateBestTickerResult = (result: TestWorkerResult) => {
  if (!isGoodTest(result)) {
    return false;
  }

  const previousResult = resultsByTickers.get(result.test.symbol);
  if (previousResult && previousResult.stat.profit >= result.stat.profit) {
    return false;
  }

  resultsByTickers.set(result.test.symbol, result);

  return true;
};

export const chunkTestSuiteBySymbol = (
  testSuite: TestSuite,
  requestedChunks: number,
): TestSuite[] => {
  if (!testSuite.length) {
    return [];
  }

  const chunkCount = Math.max(1, Math.min(requestedChunks, testSuite.length));
  const testsBySymbol = new Map<string, TestSuite>();

  for (const test of testSuite) {
    const existing = testsBySymbol.get(test.symbol);
    if (existing) {
      existing.push(test);
      continue;
    }
    testsBySymbol.set(test.symbol, [test]);
  }

  const symbolGroups = Array.from(testsBySymbol.entries())
    .sort(([leftSymbol, leftTests], [rightSymbol, rightTests]) => {
      if (rightTests.length !== leftTests.length) {
        return rightTests.length - leftTests.length;
      }
      return leftSymbol.localeCompare(rightSymbol);
    })
    .map(([, tests]) => tests);

  const workerCount = Math.min(chunkCount, symbolGroups.length);
  const chunks = Array.from({ length: workerCount }, () => [] as TestSuite);
  const chunkSizes = new Array(workerCount).fill(0);

  for (const tests of symbolGroups) {
    let targetIndex = 0;
    for (let index = 1; index < chunks.length; index += 1) {
      if (chunkSizes[index] < chunkSizes[targetIndex]) {
        targetIndex = index;
      }
    }

    chunks[targetIndex].push(...tests);
    chunkSizes[targetIndex] += tests.length;
  }

  return chunks.filter((chunk) => chunk.length > 0);
};

const isStrategyConfigGrid = (value: unknown): value is StrategyConfigGrid => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.values(value as Record<string, unknown>).every((item) =>
    Array.isArray(item),
  );
};

export const toStrategyConfigGrid = (
  strategyConfig: StrategyConfig,
): StrategyConfigGrid =>
  Object.fromEntries(
    Object.entries(strategyConfig).map(([key, value]) => [key, [value]]),
  );

export const loadRuntimeStrategyBacktestConfigs = async (
  userName: string,
): Promise<RuntimeStrategyBacktestConfig[]> => {
  const configs = await loadRuntimeStrategyConfigs(userName, {
    onInvalidConfig: (key) => {
      console.log(chalk.yellow(`Skip invalid runtime strategy config: ${key}`));
    },
  });

  return configs.map(({ strategyName, strategyConfig }) => ({
    strategyName,
    strategyConfig,
    backtestConfig: toStrategyConfigGrid(strategyConfig),
  }));
};

export const getReplayStrategyResultKey = (
  result: Pick<TestWorkerResult, 'test'>,
) => `${result.test.strategyName}:${result.test.symbol}`;

export const mergePersistedTestSummaries = (
  existing: Item[] | null | undefined,
  persisted: Map<string, Item>,
) => {
  const mergedByKey = new Map<string, Item>();

  for (const item of existing || []) {
    const strategyName =
      typeof item?.data?.strategyName === 'string'
        ? item.data.strategyName
        : '';
    if (!strategyName || typeof item?.value !== 'string') {
      continue;
    }
    mergedByKey.set(`${strategyName}:${item.value}`, item);
  }

  for (const [key, item] of persisted) {
    mergedByKey.set(key, item);
  }

  return [...mergedByKey.values()];
};

const resolveBacktestConnectorName = async (
  value: unknown,
): Promise<string> => {
  const connectorName = await resolveConnectorName(value, projectRoot);
  if (connectorName) {
    return connectorName;
  }

  console.log(
    chalk.yellow(
      `Unknown connector "${String(value || '').trim() || String(value)}". Fallback to ${DEFAULT_CONNECTOR_NAME}.`,
    ),
  );
  return DEFAULT_CONNECTOR_NAME;
};

const getLogsById = async (orderLogId: string) => {
  const [orderLog, positionLog] = (await Promise.all([
    getData(redisKeys.cacheOrders(userName, orderLogId), null),
    getData(redisKeys.cachePositions(userName, orderLogId), null),
  ])) as [OrderLog[], PositionLogData];

  return { orderLog, positionLog };
};

export const resolveResultArtifacts = async (result: TestWorkerResult) =>
  getLogsById(result.orderLogId);

export const setTestData = async (
  test: Test,
  stat: Partial<TestStat>,
  orderLog: OrderLog[],
) => {
  await Promise.all([
    setData(
      redisKeys.testOrders(test.userName, test.strategyName, test.name),
      orderLog,
      {
        expire: TTL_1M,
      },
    ),
    setData(
      redisKeys.testConfig(test.userName, test.strategyName, test.name),
      test,
      {
        expire: TTL_1M,
      },
    ),
    setData(
      redisKeys.testStat(test.userName, test.strategyName, test.name),
      stat,
      {
        expire: TTL_1M,
      },
    ),
  ]);

  const { testId } = parseTestName(test.name);
  persistedTestSummaryByKey.set(`${test.strategyName}:${test.name}`, {
    value: test.name,
    label: `${test.symbol}_${testId}`,
    description: `${stat.netProfit || 0}$`,
    data: {
      netProfit: stat.netProfit || 0,
      strategyName: test.strategyName,
    },
  });
};

export const persistTestSummariesIndex = async () => {
  const existing = (await getData(redisKeys.testSummaries(userName), [])) as
    | Item[]
    | null;
  await setData(
    redisKeys.testSummaries(userName),
    mergePersistedTestSummaries(existing, persistedTestSummaryByKey),
    {
      expire: 0,
    },
  );
};

const loadBacktestConfig = async (): Promise<LoadedBacktestConfig> => {
  if (!flags.config) {
    throw new Error('Backtest config not send');
  }

  const strategyName = flags.config.split(':')[0];
  if (!strategyName) {
    throw new Error('Strategy name not found');
  }

  const backtestConfig = await getData(
    redisKeys.backtestConfig(userName, flags.config),
    null,
  );
  if (!backtestConfig) {
    throw new Error(`Backtest config "${flags.config}" not found`);
  }

  const strategyConfigGrid = backtestConfig as StrategyConfigGrid;
  if (!isStrategyConfigGrid(strategyConfigGrid)) {
    throw new Error(
      `Backtest config "${flags.config}" must include strategyName and strategyConfig grid`,
    );
  }

  return {
    strategyName,
    strategyConfigGrid,
  };
};

export const loadReplayStrategies = async (): Promise<
  RuntimeStrategyBacktestConfig[]
> => {
  const runtimeStrategies = await loadRuntimeStrategyBacktestConfigs(userName);
  if (!runtimeStrategies.length) {
    console.log(
      chalk.yellow(
        `No active runtime strategy configs found by users:${userName}:strategies:*:config`,
      ),
    );
    return [];
  }

  const projectConfig = await loadTradejsConfig(projectRoot);
  const unsupportedReplayHookStages = getUnsupportedLiveProjectHookStages(
    projectConfig.hooks,
  );
  if (unsupportedReplayHookStages.length > 0) {
    throw new Error(
      `yarn replay does not support project hooks ${unsupportedReplayHookStages.join(
        ', ',
      )}. These hooks change runtime behaviour in yarn signals, so replay would produce misleading results. Use a replay flow that executes project hooks or temporarily disable ${unsupportedReplayHookStages.join(
        ', ',
      )} for this comparison.`,
    );
  }

  return runtimeStrategies;
};

export const prepareRunEnvironment =
  async (): Promise<PreparedRunEnvironment | null> => {
    const connectorName = await resolveBacktestConnectorName(flags.connector);
    const connectorFactory = await getConnectorCreatorByName(
      connectorName,
      projectRoot,
    );
    if (!connectorFactory) {
      throw new Error(`Connector "${connectorName}" is not registered`);
    }
    const marketConnector = await (connectorFactory as ConnectorCreator)({
      userName: flags.user,
    });
    activeConnectorForRuntimeCompare = marketConnector;
    activeConnectorNameForRuntimeCompare = connectorName;

    const tickers = await timeOperation('tickers load', () =>
      getTickers(
        marketConnector,
        flags.tickers,
        flags.exclude,
        flags.tickersLimit,
      ),
    );

    if (flags.showTickersList) {
      console.log(chalk.gray(JSON.stringify(tickers.sort(), null, 2)));
      return null;
    }

    const window = resolveTimeWindow({
      days: flags.days,
      startTime: flags.startTime,
      endTime: flags.endTime,
      defaultStartMs: getTimestamp(BACKTEST_DEFAULT_DAYS),
      defaultEndMs: getTimestamp(),
    });
    activeWindowForRuntimeCompare = {
      start: window.start,
      end: window.end,
    };
    const preloadStart = getBacktestPreloadStart(
      window.start,
      BACKTEST_PRELOAD_DAYS,
    );

    if (!flags.cacheOnly) {
      await timeOperation(`update ${connectorName}`, () =>
        update(marketConnector, interval, tickers, undefined, {
          connectorLabel: connectorName,
          preloadStart,
          preloadEnd: window.end,
        }),
      );

      const binanceConnectorCreator = await getConnectorCreatorByName(
        ConnectorNames.Binance,
        projectRoot,
      );
      const coinbaseConnectorCreator = await getConnectorCreatorByName(
        ConnectorNames.Coinbase,
        projectRoot,
      );
      if (!binanceConnectorCreator || !coinbaseConnectorCreator) {
        throw new Error('Binance/Coinbase connectors are required');
      }

      const binanceConnector = await (
        binanceConnectorCreator as ConnectorCreator
      )({
        userName: flags.user,
      });
      const coinbaseConnector = await (
        coinbaseConnectorCreator as ConnectorCreator
      )({
        userName: flags.user,
      });
      await timeOperation(`update ${ConnectorNames.Binance}`, () =>
        update(binanceConnector, interval, ['BTCUSDT'], undefined, {
          connectorLabel: ConnectorNames.Binance,
          preloadStart,
          preloadEnd: window.end,
        }),
      );
      await timeOperation(`update ${ConnectorNames.Coinbase}`, () =>
        update(coinbaseConnector, interval, ['BTCUSDT'], undefined, {
          connectorLabel: ConnectorNames.Coinbase,
          preloadStart,
          preloadEnd: window.end,
        }),
      );
    }

    return {
      connectorName,
      marketConnector,
      tickers,
      window,
      preloadStart,
    };
  };

export const buildPreparedTestSuite = async ({
  testSuite,
  window,
  preloadStart,
  isReplay,
}: {
  testSuite: TestSuite;
  window: ResolvedWindow;
  preloadStart: number;
  isReplay: boolean;
}): Promise<TestSuite | null> => {
  const mlEnabled = Boolean(flags.ml);
  const aiEnabled = Boolean(flags.ai);
  const requestedTestsLimit = resolveRequestedTestsLimit({
    isLiveMode: isReplay,
    requestedLimit: testsLimit,
    hasExplicitLimit: hasExplicitTestsLimit,
  });
  const preparedSuite = testSuite
    .map((test) => ({
      ...test,
      options: {
        start: window.start,
        end: window.end,
      },
      ml: mlEnabled,
      ai: aiEnabled,
      timeoutMs: testItemTimeoutMs,
    }))
    .slice(
      testsSkip,
      Number.isFinite(requestedTestsLimit)
        ? testsSkip + requestedTestsLimit
        : undefined,
    );

  if (!preparedSuite.length) {
    console.log(
      chalk.yellow(
        `No tests selected (skip=${testsSkip}, limit=${
          Number.isFinite(requestedTestsLimit) ? requestedTestsLimit : 'all'
        }).`,
      ),
    );
    return null;
  }

  if (
    shouldBackfillDerivativesContextForBacktest({
      aiEnabled,
      cacheOnly: Boolean(flags.cacheOnly),
      mlEnabled,
    })
  ) {
    await timeOperation('derivatives context backfill', () =>
      backfillDerivativesContextForBacktest({
        userName,
        symbols: preparedSuite.map((test) => test.symbol),
        startMs: window.start,
        endMs: window.end,
        preloadStartMs: preloadStart,
      }),
    );
  }

  return preparedSuite;
};

export const trackTopResult = (result: TestWorkerResult) => {
  const nextTopResults = insertTopResult(results, result, flags.top);
  if (nextTopResults.added || results !== nextTopResults.results) {
    updateTopResults(nextTopResults.results);
  }
};

const buildRunIntroLines = ({
  testSuite,
  window,
  preloadStart,
  replayModeLabel,
}: {
  testSuite: TestSuite;
  window: ResolvedWindow;
  preloadStart: number;
  replayModeLabel?: string;
}) => {
  const lines = [chalk.yellow(`tests: ${testSuite.length}`)];
  if (replayModeLabel) {
    lines.push(chalk.gray(replayModeLabel));
  }
  lines.push(
    chalk.gray(`parallel: ${effectiveParallel}, workerHeapMb: ${workerHeapMb}`),
  );
  lines.push(
    chalk.gray(
      `window: ${formatUnix(window.start)} -> ${formatUnix(window.end)} (${formatWindowDays(window.start, window.end)}d, ${window.source})`,
    ),
  );
  lines.push(
    chalk.gray(
      `preload: ${formatUnix(preloadStart)} -> ${formatUnix(window.end)} (${BACKTEST_PRELOAD_DAYS}d warmup)`,
    ),
  );
  return lines;
};

export const executeTestSuite = async ({
  testSuite,
  window,
  preloadStart,
  replayModeLabel,
  onResult,
  onFinish,
}: {
  testSuite: TestSuite;
  window: ResolvedWindow;
  preloadStart: number;
  replayModeLabel?: string;
  onResult: (result: TestWorkerResult) => void;
  onFinish: () => Promise<void>;
}) => {
  testsStartedAt = Date.now();
  await executeBacktestWorkerPool({
    testSuite,
    userName,
    progressStep,
    workerHeapMb,
    testerWorkerPath,
    testerNeedsTsRuntime,
    introLines: buildRunIntroLines({
      testSuite,
      window,
      preloadStart,
      replayModeLabel,
    }),
    chunkTestSuite: (suite) => chunkTestSuiteBySymbol(suite, effectiveParallel),
    onMessage: (msg) => {
      if (msg.error) {
        errorTests++;
        recordError({
          id: msg.id,
          error: msg.error,
          payload: msg,
        });

        console.error(
          chalk.red(`Error in test #${msg.id}: ${JSON.stringify(msg)}`),
        );
        return;
      }

      successTests++;
      onResult(msg as TestWorkerResult);
    },
    onWorkerError: (message) => {
      recordError({ error: message });
      console.error(chalk.red(message));
    },
    getProgressSnapshot: () => {
      const bestResult = results[0];
      return {
        symbol: bestResult?.test.symbol || '-',
        profit: bestResult?.stat.profit || 0,
      };
    },
    onFinish,
  });
};

const saveAndPrintResults = async () => {
  const colorizedResults: string[][] = [];
  for await (const result of results) {
    const { test } = result;

    const { symbol, name } = test;

    const { orderLog, positionLog } = await resolveResultArtifacts(result);
    if (!orderLog || !positionLog) {
      throw new Error(`Logs not found for test ${name}`);
    }

    const stat = calculateStatsFull(positionLog) as TestStat;
    if (!stat && result.stat.orders > 0) {
      throw new Error(
        `Position log is empty for test ${name} despite ${result.stat.orders} closed orders`,
      );
    }

    await setTestData(test, stat, orderLog);

    const statRow = [
      chalk.blue(name),
      chalk.yellow(symbol),
      ...drawStatInCLI(stat, [
        'netProfit',
        'orders',
        'winRate',
        'riskRewardRatio',
        'maxDrawdown',
      ]),
    ];

    colorizedResults.push(statRow);
  }

  console.log('');
  console.log('RESULTS:');
  console.log(createTable(HEADERS_RESULTS, colorizedResults));
  console.log('');
};

const saveAndPrintResultsByTickers = async () => {
  const colorizedResultsByTickers: string[][] = [];
  for await (const result of resultsByTickers.values()) {
    const { test } = result;

    const { symbol, name } = test;

    const { orderLog, positionLog } = await resolveResultArtifacts(result);
    if (!orderLog || !positionLog) {
      throw new Error(`Logs not found for ticker result ${name}`);
    }

    const stat = calculateStatsFull(positionLog) as TestStat;
    if (!stat && result.stat.orders > 0) {
      throw new Error(
        `Position log is empty for ticker result ${name} despite ${result.stat.orders} closed orders`,
      );
    }

    await setTestData(test, stat, orderLog);

    const statRow = [
      chalk.blue(name),
      chalk.yellow(symbol),
      ...drawStatInCLI(stat, [
        'netProfit',
        'orders',
        'winRate',
        'riskRewardRatio',
        'maxDrawdown',
      ]),
    ];

    colorizedResultsByTickers.push(statRow);
  }

  console.log('');
  console.log('RESULTS BY TICKERS:');
  console.log(
    createTable(HEADERS_RESULTS_BY_TICKERS, colorizedResultsByTickers),
  );
  console.log('');
};

export const printRunOutro = () => {
  console.log(
    chalk.gray(`tests run: done in ${formatDuration(testsStartedAt)}`),
  );
  console.log(
    chalk.gray(`backtest total: done in ${formatDuration(runStartedAt)}`),
  );
  console.log('');
  console.log(`${chalk.green('SUCCESS TESTS')}: ${successTests}`);
  console.log(`${chalk.red('ERRORS')}: ${errorTests}`);
  console.log('');
};

const finishBacktest = async () => {
  if (flags.tickers) {
    await saveAndPrintResults();
  } else {
    await saveAndPrintResultsByTickers();
  }
  await persistTestSummariesIndex();

  const bestConfig = results[0]?.test.strategyConfig;
  const mergedConfig = mergeConfigs(
    results.map(({ test: { strategyConfig } }) => strategyConfig),
  );

  printRunOutro();
  console.log(chalk.gray('BEST CONFIG:'));
  console.log(chalk.green(toJson(bestConfig, true)));
  console.log('');
  console.log(chalk.gray('MERGED CONFIG:'));
  console.log(chalk.blue(toJson(mergedConfig, true)));
  console.log('');

  const finishedAt = new Date();
  const durationSeconds = Number(
    ((Date.now() - runStartedAt) / 1000).toFixed(2),
  );
  const timestamp = createTimestamp(finishedAt);

  await setData(
    redisKeys.backtestResults(userName, flags.config, timestamp),
    {
      config: flags.config,
      mode: 'config',
      user: userName,
      startedAt: new Date(runStartedAt).toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationSeconds,
      results,
      resultsByTickers: Array.from(resultsByTickers.values()),
      resultsByStrategies: null,
      runtimeComparison: null,
      bestConfig,
      mergedConfig,
      successTests,
      errors: errorMessages,
      errorTests,
    },
    {
      expire: 0,
    },
  );

  process.exit();
};

export const backtest = async () => {
  resetRunState();
  const config = await loadBacktestConfig();
  const preparedRun = await prepareRunEnvironment();
  if (!preparedRun || flags.updateOnly) {
    return;
  }

  const testSuite = await buildPreparedTestSuite({
    testSuite: createTestSuite(
      userName,
      preparedRun.tickers,
      config.strategyName,
      config.strategyConfigGrid,
      preparedRun.connectorName,
    ),
    window: preparedRun.window,
    preloadStart: preparedRun.preloadStart,
    isReplay: false,
  });
  if (!testSuite) {
    return;
  }

  await executeTestSuite({
    testSuite,
    window: preparedRun.window,
    preloadStart: preparedRun.preloadStart,
    onResult: (result) => {
      trackTopResult(result);
      updateBestTickerResult(result);
    },
    onFinish: finishBacktest,
  });
};

if (require.main === module) {
  void backtest();
}
