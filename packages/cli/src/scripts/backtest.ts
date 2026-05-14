const ListIt = require('list-it');
import args from 'args';
import ProgressBar from 'progress';
import { fork } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'node:crypto';
import chalk from 'chalk';
import { format } from 'date-fns';
import { ConnectorNames } from '@tradejs/connectors';
import {
  DEFAULT_CONNECTOR_NAME,
  getConnectorCreatorByName,
  resolveConnectorName,
} from '@tradejs/node/connectors';
import { drawStatInCLI, getTickers, update } from '@tradejs/node/cli';
import {
  calculateStatsFull,
  createTestSuite,
  mergeConfigs,
  parseTestName,
} from '@tradejs/core/backtest';
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
  ClosedPnlRecord,
  Connector,
  OrderLog,
  PositionLogData,
  RuntimeTradeRecord,
  StrategyConfig,
  TestSuite,
  TestStat,
  Test,
  TestWorkerResult,
  ConnectorCreator,
  StrategyConfigGrid,
} from '@tradejs/types';
import {
  compareTradeParityEntries,
  dedupeRuntimeParityEntries,
  extractBacktestEntryParityEntries,
  extractRuntimeParityEntries,
  type MatchedTradeParityEntry,
  type TradeParityEntry,
} from '../lib/runtimeParity';
import {
  backfillDerivativesContextForBacktest,
  shouldBackfillDerivativesContextForBacktest,
} from '../lib/derivativesContextBackfill';
import { normalizeCliArgv } from '../lib/cliArgs';
import { resolveTimeWindow } from '../lib/timeWindow';

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
args.option(
  'live',
  'Run backtests for all active runtime strategies like yarn signals',
  false,
);
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

const flags = args.parse(process.argv);
const hasCliFlag = (argv: string[], names: string[]) =>
  argv.some(
    (arg) =>
      names.includes(arg) || names.some((name) => arg.startsWith(`${name}=`)),
  );
const interval = flags.timeframe.toString() as Interval;
const progressStep = Math.max(1, parseInt(String(flags.progressStep), 10));
const testsLimit = Math.max(0, parseInt(String(flags.tests), 10));
const testsSkip = Math.max(0, parseInt(String(flags.skip ?? 0), 10));
const hasExplicitTestsLimit = hasCliFlag(normalizedArgv, ['--tests', '-n']);
const testItemTimeoutMs = 240_000;
const workerHeapMb = resolveWorkerHeapMb();
const effectiveParallel = resolveEffectiveParallel(flags.parallel);
const resultArtifactsIoConcurrency = Math.max(
  8,
  Math.min(32, effectiveParallel * 4),
);
const uuid = (len = 12) => randomUUID().slice(-len);
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

const HEADERS_LIVE_RESULTS_BY_STRATEGY = [
  chalk.blue('STRATEGY'),
  chalk.yellow('TICKERS'),
  chalk.yellow('TRADE TICKERS'),
  chalk.cyan('ORDERS'),
  chalk.cyan('WIN/LOSS (%)'),
  chalk.cyan('PROFIT'),
  chalk.cyan('AVG TRADE'),
];

const HEADERS_LIVE_RUNTIME_COMPARISON = [
  chalk.blue('STRATEGY'),
  chalk.cyan('BT ENTRIES'),
  chalk.cyan('BT PNL'),
  chalk.yellow('RT TRADES'),
  chalk.yellow('RT PNL'),
  chalk.green('MATCHED'),
  chalk.yellow('RT ONLY'),
  chalk.magenta('BT ONLY'),
];

const LIVE_BACKTEST_RESULTS_CONFIG = 'live';
const LIVE_RUNTIME_COMPARE_TOLERANCE_BARS = 1;
const LIVE_RUNTIME_COMPARE_TOLERANCE_MS =
  LIVE_RUNTIME_COMPARE_TOLERANCE_BARS * 15 * 60 * 1000;

type ErrorMessage = { id?: number; error?: unknown; payload?: any };
type RuntimeStrategyBacktestConfig = {
  strategyName: string;
  strategyConfig: StrategyConfig;
  backtestConfig: StrategyConfigGrid;
};
type LiveStrategySummary = {
  strategyName: string;
  strategyConfig: StrategyConfig;
  tickers: number;
  tickersWithTrades: number;
  orders: number;
  wins: number;
  losses: number;
  netProfit: number;
  avgTradeProfit: number;
  winRate: number;
};
type RuntimeTradeStrategySummary = {
  strategyName: string;
  trades: number;
  activeTrades: number;
  closedTrades: number;
  totalPnl: number;
};
type LiveRuntimeParityRow = {
  strategyName: string;
  backtestEntries: number;
  backtestNetProfit: number;
  runtimeTrades: number;
  runtimePnl: number;
  matched: number;
  runtimeOnly: number;
  backtestOnly: number;
};
type LiveRuntimeComparisonSummary = {
  syncedTradesCount: number;
  windowTradesCount: number;
  runtimeEntriesCount: number;
  backtestEntriesCount: number;
  matchedCount: number;
  runtimeOnlyCount: number;
  backtestOnlyCount: number;
  rows: LiveRuntimeParityRow[];
};
type LiveStrategyResultsSnapshot = {
  summaries: LiveStrategySummary[];
  backtestEntries: TradeParityEntry[];
};

export const buildLiveReplayStrategyConfig = ({
  strategyConfig,
  interval,
}: {
  strategyConfig: StrategyConfig;
  interval: Interval;
}): StrategyConfig => ({
  ...strategyConfig,
  ENV: 'PARITY',
  MAKE_ORDERS: true,
  INTERVAL: interval,
  RECORD_RUNTIME_TRADES: false,
});

let successTests = 0;
let errorTests = 0;
const errorMessages: ErrorMessage[] = [];
let results: TestWorkerResult[] = [];
const resultsByTickers = new Map<string, TestWorkerResult>();
const liveResultsByStrategyAndTicker = new Map<string, TestWorkerResult>();
const persistedTestSummaryByKey = new Map<string, Item>();

const userName = flags.user;
const runStartedAt = Date.now();
let testsStartedAt = runStartedAt;
let activeConnectorForRuntimeCompare: Connector | null = null;
let activeConnectorNameForRuntimeCompare = '';
let activeWindowForRuntimeCompare: { start: number; end: number } | null = null;

const createListIt = () =>
  new ListIt({
    autoAlign: true,
    headerUnderline: true,
  });

const createTable = (headers: string[], rows: string[][]) =>
  createListIt().setHeaderRow(headers).d(rows).toString();

const createTimestamp = (date: Date) => format(date, 'yyyyMMddHHmm');

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

export const resolveStrategyNameByConfigKey = (
  userName: string,
  key: string,
): string | null => {
  const parts = key.split(':');
  if (parts.length !== 5) {
    return null;
  }

  const [users, keyUserName, strategiesKey, strategyName, configKey] = parts;
  if (
    users !== 'users' ||
    keyUserName !== userName ||
    strategiesKey !== 'strategies' ||
    configKey !== 'config' ||
    !strategyName
  ) {
    return null;
  }

  return strategyName;
};

export const toStrategyConfigGrid = (
  strategyConfig: StrategyConfig,
): StrategyConfigGrid =>
  Object.fromEntries(
    Object.entries(strategyConfig).map(([key, value]) => [key, [value]]),
  );

const loadRuntimeStrategyBacktestConfigs = async (
  userName: string,
): Promise<RuntimeStrategyBacktestConfig[]> => {
  const keys = await getKeys(`${redisKeys.strategies(userName)}:`);
  const configKeys = keys
    .filter((key) => key.endsWith(':config'))
    .sort((a, b) => a.localeCompare(b));

  const configs = await Promise.all(
    configKeys.map(
      async (key): Promise<RuntimeStrategyBacktestConfig | null> => {
        const strategyName = resolveStrategyNameByConfigKey(userName, key);
        if (!strategyName) {
          return null;
        }

        const strategyConfig = (await getData(
          key,
          null,
        )) as StrategyConfig | null;
        if (
          !strategyConfig ||
          typeof strategyConfig !== 'object' ||
          Array.isArray(strategyConfig)
        ) {
          console.log(
            chalk.yellow(`Skip invalid runtime strategy config: ${key}`),
          );
          return null;
        }

        return {
          strategyName,
          strategyConfig,
          backtestConfig: toStrategyConfigGrid(strategyConfig),
        };
      },
    ),
  );

  return configs.filter(Boolean) as RuntimeStrategyBacktestConfig[];
};

const getLiveStrategyResultKey = (result: Pick<TestWorkerResult, 'test'>) =>
  `${result.test.strategyName}:${result.test.symbol}`;

const isRuntimeTradeRecord = (value: unknown): value is RuntimeTradeRecord => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.orderId === 'string' &&
    typeof record.strategy === 'string' &&
    typeof record.symbol === 'string' &&
    typeof record.entryTimestamp === 'number' &&
    typeof record.entryPrice === 'number' &&
    typeof record.qty === 'number'
  );
};

const loadRuntimeTrades = async (
  userName: string,
): Promise<RuntimeTradeRecord[]> => {
  const keys = await getKeys(redisKeys.runtimeTrades(userName));
  const trades = await Promise.all(keys.map((key) => getData(key, null)));

  return trades
    .filter(isRuntimeTradeRecord)
    .sort((left, right) => left.entryTimestamp - right.entryTimestamp);
};

const loadClosedPnlRows = async ({
  connector,
  startTime,
  endTime,
}: {
  connector: Connector;
  startTime: number;
  endTime: number;
}): Promise<ClosedPnlRecord[]> => {
  if (typeof connector.getClosedPnl !== 'function') {
    console.log(
      chalk.yellow(
        'runtime compare: connector does not support getClosedPnl, using runtime trade records as-is',
      ),
    );
    return [];
  }

  try {
    const rows = await connector.getClosedPnl({
      startTime,
      endTime,
      limit: 100,
    });

    if (rows.length >= 100) {
      console.log(
        chalk.yellow(
          'runtime compare: exchange closed pnl returned 100 rows (connector cap); older closed trades in the window may be truncated',
        ),
      );
    }

    return rows.sort((left, right) => left.closedAt - right.closedAt);
  } catch (error) {
    console.log(
      chalk.yellow(
        `runtime compare: getClosedPnl failed: ${(error as Error)?.message || String(error)}`,
      ),
    );
    return [];
  }
};

const consumeClosedPnlMatch = (
  buckets: Map<string, ClosedPnlRecord[]>,
  trade: RuntimeTradeRecord,
) => {
  const rows = buckets.get(trade.symbol);
  if (!rows?.length) {
    return null;
  }

  const minimumClosedAt = trade.entryTimestamp - 5 * 60_000;
  const matchIndex = rows.findIndex(
    (row) => Number.isFinite(row.closedAt) && row.closedAt >= minimumClosedAt,
  );

  if (matchIndex < 0) {
    return null;
  }

  const [row] = rows.splice(matchIndex, 1);
  return row ?? null;
};

const syncRuntimeTrades = async ({
  userName,
  connector,
  trades,
  startTime,
  endTime,
}: {
  userName: string;
  connector: Connector;
  trades: RuntimeTradeRecord[];
  startTime: number;
  endTime: number;
}): Promise<RuntimeTradeRecord[]> => {
  const openPositions =
    typeof connector.getOpenPositionPnl === 'function'
      ? await connector.getOpenPositionPnl()
      : [];
  const openPositionsBySymbol = new Map(
    openPositions.map((position) => [position.symbol, position]),
  );
  const activeOrderIdBySymbol = new Map<string, string | null>();
  const symbols = [...new Set(trades.map((trade) => trade.symbol))];

  await Promise.all(
    symbols.map(async (symbol) => {
      const activeRef = (await getData(
        redisKeys.runtimeActiveTrade(userName, symbol),
        null,
      )) as { orderId?: string } | null;
      activeOrderIdBySymbol.set(
        symbol,
        typeof activeRef?.orderId === 'string' ? activeRef.orderId : null,
      );
    }),
  );

  const closedPnlRows = await loadClosedPnlRows({
    connector,
    startTime,
    endTime,
  });
  const closedPnlBuckets = new Map<string, ClosedPnlRecord[]>();

  for (const row of closedPnlRows) {
    const bucket = closedPnlBuckets.get(row.symbol) ?? [];
    bucket.push(row);
    closedPnlBuckets.set(row.symbol, bucket);
  }

  const syncedTrades: RuntimeTradeRecord[] = [];

  for (const trade of trades) {
    if (trade.status !== 'active') {
      syncedTrades.push(trade);
      continue;
    }

    const openPosition = openPositionsBySymbol.get(trade.symbol);
    const activeOrderId = activeOrderIdBySymbol.get(trade.symbol);
    const isCurrentActiveTrade = activeOrderId === trade.orderId;

    if (
      isCurrentActiveTrade &&
      openPosition &&
      openPosition.direction === trade.direction
    ) {
      syncedTrades.push({
        ...trade,
        status: 'active',
        currentPrice: openPosition.currentPrice,
        currentPnl: openPosition.unrealizedPnl,
        lastSyncedAt: endTime,
      });
      continue;
    }

    const matchedClosedPnl = consumeClosedPnlMatch(closedPnlBuckets, trade);
    syncedTrades.push({
      ...trade,
      status: 'closed',
      currentPrice: matchedClosedPnl?.exitPrice ?? trade.currentPrice ?? null,
      currentPnl:
        matchedClosedPnl?.closedPnl ??
        trade.closedPnl ??
        trade.currentPnl ??
        null,
      closedPnl:
        matchedClosedPnl?.closedPnl ??
        trade.closedPnl ??
        trade.currentPnl ??
        null,
      exitPrice: matchedClosedPnl?.exitPrice ?? trade.exitPrice ?? null,
      exitTimestamp:
        matchedClosedPnl?.closedAt ?? trade.exitTimestamp ?? endTime,
      lastSyncedAt: endTime,
    });
  }

  return syncedTrades;
};

export const summarizeRuntimeTradesByStrategy = (
  trades: RuntimeTradeRecord[],
): RuntimeTradeStrategySummary[] => {
  const summaryByStrategy = new Map<string, RuntimeTradeStrategySummary>();

  for (const trade of trades) {
    const summary = summaryByStrategy.get(trade.strategy) ?? {
      strategyName: trade.strategy,
      trades: 0,
      activeTrades: 0,
      closedTrades: 0,
      totalPnl: 0,
    };

    summary.trades += 1;
    if (trade.status === 'active') {
      summary.activeTrades += 1;
    } else {
      summary.closedTrades += 1;
    }

    const pnl =
      trade.status === 'active'
        ? trade.currentPnl
        : trade.closedPnl ?? trade.currentPnl;
    if (typeof pnl === 'number' && Number.isFinite(pnl)) {
      summary.totalPnl += pnl;
    }

    summaryByStrategy.set(trade.strategy, summary);
  }

  return [...summaryByStrategy.values()]
    .map((summary) => ({
      ...summary,
      totalPnl: Number(summary.totalPnl.toFixed(2)),
    }))
    .sort((left, right) => left.strategyName.localeCompare(right.strategyName));
};

export const summarizeTradeParityByStrategy = ({
  runtimeEntries,
  runtimeDuplicateEntries,
  backtestEntries,
  matchedEntries,
  runtimeOnlyEntries,
  backtestOnlyEntries,
}: {
  runtimeEntries: TradeParityEntry[];
  runtimeDuplicateEntries: TradeParityEntry[];
  backtestEntries: TradeParityEntry[];
  matchedEntries: MatchedTradeParityEntry[];
  runtimeOnlyEntries: TradeParityEntry[];
  backtestOnlyEntries: TradeParityEntry[];
}) => {
  const rows = new Map<
    string,
    {
      runtime: number;
      runtimeDuplicates: number;
      backtest: number;
      matched: number;
      runtimeOnly: number;
      backtestOnly: number;
    }
  >();

  const ensureRow = (strategyName: string) => {
    const row = rows.get(strategyName) ?? {
      runtime: 0,
      runtimeDuplicates: 0,
      backtest: 0,
      matched: 0,
      runtimeOnly: 0,
      backtestOnly: 0,
    };
    rows.set(strategyName, row);
    return row;
  };

  for (const entry of runtimeEntries) {
    ensureRow(entry.strategy).runtime += 1;
  }
  for (const entry of runtimeDuplicateEntries) {
    ensureRow(entry.strategy).runtimeDuplicates += 1;
  }
  for (const entry of backtestEntries) {
    ensureRow(entry.strategy).backtest += 1;
  }
  for (const entry of matchedEntries) {
    ensureRow(entry.runtime.strategy).matched += 1;
  }
  for (const entry of runtimeOnlyEntries) {
    ensureRow(entry.strategy).runtimeOnly += 1;
  }
  for (const entry of backtestOnlyEntries) {
    ensureRow(entry.strategy).backtestOnly += 1;
  }

  return [...rows.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
};

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

const resolveResultArtifacts = async (result: TestWorkerResult) =>
  getLogsById(result.orderLogId);

const setTestData = async (
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

const persistTestSummariesIndex = async () => {
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

export const backtest = async () => {
  let strategyName = '';
  let typedBacktestConfig: StrategyConfigGrid | null = null;
  let liveRuntimeStrategies: RuntimeStrategyBacktestConfig[] = [];

  if (flags.live) {
    liveRuntimeStrategies = await loadRuntimeStrategyBacktestConfigs(userName);
    if (!liveRuntimeStrategies.length) {
      console.log(
        chalk.yellow(
          `No active runtime strategy configs found by users:${userName}:strategies:*:config`,
        ),
      );
      return;
    }
  } else {
    if (!flags.config) {
      throw new Error('Backtest config not send');
    }

    strategyName = flags.config.split(':')[0];

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

    typedBacktestConfig = backtestConfig as StrategyConfigGrid;
    if (!isStrategyConfigGrid(typedBacktestConfig)) {
      throw new Error(
        `Backtest config "${flags.config}" must include strategyName and strategyConfig grid`,
      );
    }
  }

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

    return;
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

  if (flags.updateOnly) {
    return;
  }

  let testSuite = flags.live
    ? liveRuntimeStrategies.flatMap(
        ({
          strategyName: runtimeStrategyName,
          strategyConfig: runtimeStrategyConfig,
        }) =>
          createTestSuite(
            userName,
            tickers,
            runtimeStrategyName,
            toStrategyConfigGrid(
              buildLiveReplayStrategyConfig({
                strategyConfig: runtimeStrategyConfig,
                interval,
              }),
            ),
            connectorName,
          ),
      )
    : createTestSuite(
        userName,
        tickers,
        strategyName,
        typedBacktestConfig as StrategyConfigGrid,
        connectorName,
      );
  const mlEnabled = Boolean(flags.ml);
  const aiEnabled = Boolean(flags.ai);
  const requestedTestsLimit = resolveRequestedTestsLimit({
    isLiveMode: Boolean(flags.live),
    requestedLimit: testsLimit,
    hasExplicitLimit: hasExplicitTestsLimit,
  });
  testSuite = testSuite
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

  if (!testSuite.length) {
    console.log(
      chalk.yellow(
        `No tests selected (skip=${testsSkip}, limit=${
          Number.isFinite(requestedTestsLimit) ? requestedTestsLimit : 'all'
        }).`,
      ),
    );
    return;
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
        symbols: testSuite.map((test) => test.symbol),
        startMs: window.start,
        endMs: window.end,
        preloadStartMs: preloadStart,
      }),
    );
  }

  testsStartedAt = Date.now();

  const chunks = chunkTestSuiteBySymbol(testSuite, effectiveParallel);
  let completedTests = 0;
  let isFinishing = false;
  const workers = new Set<ReturnType<typeof fork>>();

  const maybeFinish = async () => {
    if (isFinishing) {
      return;
    }

    if (completedTests !== testSuite.length || workers.size > 0) {
      return;
    }

    isFinishing = true;
    await finish();
  };

  const stopWorkers = () => {
    for (const worker of workers) {
      if (!worker.killed) {
        worker.kill('SIGTERM');
      }
    }
  };

  process.once('SIGINT', () => {
    stopWorkers();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    stopWorkers();
    process.exit(143);
  });

  console.log(chalk.yellow(`tests: ${testSuite.length}`));
  if (flags.live) {
    console.log(
      chalk.gray(
        `mode: live (${liveRuntimeStrategies
          .map(({ strategyName: runtimeStrategyName }) => runtimeStrategyName)
          .join(', ')})`,
      ),
    );
  }
  console.log(
    chalk.gray(`parallel: ${effectiveParallel}, workerHeapMb: ${workerHeapMb}`),
  );
  console.log(
    chalk.gray(
      `window: ${formatUnix(window.start)} -> ${formatUnix(window.end)} (${formatWindowDays(window.start, window.end)}d, ${window.source})`,
    ),
  );
  console.log(
    chalk.gray(
      `preload: ${formatUnix(preloadStart)} -> ${formatUnix(window.end)} (${BACKTEST_PRELOAD_DAYS}d warmup)`,
    ),
  );

  console.log('');
  const bar = new ProgressBar(
    ':current/:total [:bar][:percent] :symbol :amount :eta(s)',
    {
      total: testSuite.length,
      width: 20,
    },
  );

  for (const chunk of chunks) {
    const chunkId = uuid();
    const chunkWithId = chunk.map((test) => ({ ...test, chunkId }));
    const tester = fork(testerWorkerPath, [], {
      execArgv: testerNeedsTsRuntime
        ? [
            `--max-old-space-size=${workerHeapMb}`,
            '-r',
            'ts-node/register',
            '-r',
            'tsconfig-paths/register',
          ]
        : [`--max-old-space-size=${workerHeapMb}`],
    });
    workers.add(tester);

    tester.on('message', async (msg: any) => {
      if (msg.done) {
        workers.delete(tester);
        await maybeFinish();
        return;
      }

      completedTests++;

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
      } else {
        successTests++;
      }

      const result = msg as TestWorkerResult;

      if (flags.live) {
        liveResultsByStrategyAndTicker.set(
          getLiveStrategyResultKey(result),
          result,
        );
      }

      const nextTopResults = insertTopResult(results, result, flags.top);
      if (nextTopResults.added || results !== nextTopResults.results) {
        updateTopResults(nextTopResults.results);
      }

      if (!flags.live) {
        updateBestTickerResult(result);
      }

      if (
        completedTests % progressStep === 0 ||
        completedTests === testSuite.length
      ) {
        const bestResult = results[0];
        const symbol = bestResult?.test.symbol || '-';
        const profit = bestResult?.stat.profit || 0;

        const profitStr = `${(profit || 0).toFixed(2)}$`;

        bar.tick(
          completedTests === testSuite.length
            ? completedTests % progressStep
            : progressStep,
          {
            symbol: chalk.yellow(symbol),
            amount: profit > 0 ? chalk.green(profitStr) : chalk.red(profitStr),
          },
        );
      }
    });

    tester.on('error', (err) => {
      recordError({ error: err?.message ?? err });
      console.error(chalk.red(`Worker error: ${err.message}`));
    });

    tester.on('exit', (code) => {
      workers.delete(tester);
      if (code !== 0) {
        recordError({ error: `Worker exited with code ${code}` });
        console.error(chalk.red(`Worker exited with code ${code}`));
      }

      void maybeFinish();
    });

    await setData(redisKeys.cacheChunk(userName, chunkId), chunkWithId, {
      expire: TTL_1D,
    });

    tester.send({ chunkId, userName });
  }
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

const saveAndPrintLiveResultsByStrategy =
  async (): Promise<LiveStrategyResultsSnapshot> => {
    const summaryByStrategy = new Map<string, LiveStrategySummary>();
    const backtestEntries: TradeParityEntry[] = [];
    const liveResults = Array.from(liveResultsByStrategyAndTicker.values());
    const processedResults = new Array<{
      test: Test;
      stat: TestStat | null;
      extractedEntries: TradeParityEntry[];
    }>(liveResults.length);

    await runWithConcurrency(
      liveResults,
      Math.min(resultArtifactsIoConcurrency, liveResults.length || 1),
      async (result, index) => {
        const { test } = result;
        const { orderLog, positionLog } = await resolveResultArtifacts(result);
        if (!orderLog || !positionLog) {
          throw new Error(`Logs not found for live result ${test.name}`);
        }

        const stat = calculateStatsFull(positionLog) as TestStat | null;
        if (!stat && positionLog.length > 0) {
          throw new Error(
            `Position log is empty for live result ${test.name} despite ${positionLog.length} positions`,
          );
        }

        await setTestData(test, stat ?? {}, orderLog);
        processedResults[index] = {
          test,
          stat,
          extractedEntries: extractBacktestEntryParityEntries(orderLog),
        };
      },
    );

    for (const processedResult of processedResults) {
      if (!processedResult) {
        continue;
      }

      const { test, stat, extractedEntries } = processedResult;
      backtestEntries.push(...extractedEntries);

      const existing = summaryByStrategy.get(test.strategyName) ?? {
        strategyName: test.strategyName,
        strategyConfig: test.strategyConfig,
        tickers: 0,
        tickersWithTrades: 0,
        orders: 0,
        wins: 0,
        losses: 0,
        netProfit: 0,
        avgTradeProfit: 0,
        winRate: 0,
      };

      existing.tickers += 1;
      if (stat?.orders) {
        existing.tickersWithTrades += 1;
        existing.orders += stat.orders ?? 0;
        existing.wins += stat.wins ?? 0;
        existing.losses += stat.losses ?? 0;
        existing.netProfit += stat.netProfit ?? 0;
      }

      summaryByStrategy.set(test.strategyName, existing);
    }

    const summaries = [...summaryByStrategy.values()]
      .map((summary) => {
        const winRate =
          summary.orders > 0 ? (summary.wins / summary.orders) * 100 : 0;
        const avgTradeProfit =
          summary.orders > 0 ? summary.netProfit / summary.orders : 0;

        return {
          ...summary,
          netProfit: Number(summary.netProfit.toFixed(2)),
          avgTradeProfit: Number(avgTradeProfit.toFixed(2)),
          winRate: Number(winRate.toFixed(2)),
        };
      })
      .sort(
        (left, right) =>
          right.netProfit - left.netProfit ||
          left.strategyName.localeCompare(right.strategyName),
      );

    const rows = summaries.map((summary) => {
      const profit = `${summary.netProfit.toFixed(2)}$`;
      const avgTrade = `${summary.avgTradeProfit.toFixed(2)}$`;
      const profitColor =
        summary.netProfit > 0
          ? chalk.green
          : summary.netProfit < 0
            ? chalk.red
            : chalk.gray;
      const avgTradeColor =
        summary.avgTradeProfit > 0
          ? chalk.green
          : summary.avgTradeProfit < 0
            ? chalk.red
            : chalk.gray;

      return [
        chalk.blue(summary.strategyName),
        chalk.yellow(String(summary.tickers)),
        chalk.yellow(String(summary.tickersWithTrades)),
        chalk.cyan(String(summary.orders)),
        chalk.cyan(
          `${summary.wins}/${summary.losses} (${summary.winRate.toFixed(2)}%)`,
        ),
        profitColor(profit),
        avgTradeColor(avgTrade),
      ];
    });

    console.log('');
    console.log('LIVE RESULTS BY STRATEGY:');
    console.log(createTable(HEADERS_LIVE_RESULTS_BY_STRATEGY, rows));
    console.log('');

    return {
      summaries,
      backtestEntries,
    };
  };

const saveAndPrintLiveRuntimeComparison = async ({
  liveStrategySummaries,
  backtestEntries,
}: {
  liveStrategySummaries: LiveStrategySummary[];
  backtestEntries: TradeParityEntry[];
}): Promise<LiveRuntimeComparisonSummary | null> => {
  if (!activeConnectorForRuntimeCompare || !activeWindowForRuntimeCompare) {
    return null;
  }

  const relevantStrategies = new Set(
    liveStrategySummaries.map((summary) => summary.strategyName),
  );
  const rawRuntimeTrades = await loadRuntimeTrades(userName);
  const syncedRuntimeTrades = await syncRuntimeTrades({
    userName,
    connector: activeConnectorForRuntimeCompare,
    trades: rawRuntimeTrades,
    startTime: activeWindowForRuntimeCompare.start,
    endTime: activeWindowForRuntimeCompare.end,
  });
  const windowRuntimeTrades = syncedRuntimeTrades.filter(
    (trade) =>
      trade.entryTimestamp >= activeWindowForRuntimeCompare!.start &&
      trade.entryTimestamp < activeWindowForRuntimeCompare!.end &&
      relevantStrategies.has(trade.strategy),
  );

  if (!windowRuntimeTrades.length) {
    console.log('');
    console.log(
      chalk.yellow(
        `LIVE VS RUNTIME: no runtime trades found for ${activeConnectorNameForRuntimeCompare} in ${formatUnix(
          activeWindowForRuntimeCompare.start,
        )} -> ${formatUnix(activeWindowForRuntimeCompare.end)}`,
      ),
    );
    console.log('');
    return {
      syncedTradesCount: syncedRuntimeTrades.length,
      windowTradesCount: 0,
      runtimeEntriesCount: 0,
      backtestEntriesCount: backtestEntries.length,
      matchedCount: 0,
      runtimeOnlyCount: 0,
      backtestOnlyCount: backtestEntries.length,
      rows: liveStrategySummaries.map((summary) => ({
        strategyName: summary.strategyName,
        backtestEntries: backtestEntries.filter(
          (entry) => entry.strategy === summary.strategyName,
        ).length,
        backtestNetProfit: summary.netProfit,
        runtimeTrades: 0,
        runtimePnl: 0,
        matched: 0,
        runtimeOnly: 0,
        backtestOnly: backtestEntries.filter(
          (entry) => entry.strategy === summary.strategyName,
        ).length,
      })),
    };
  }

  const runtimeSummaries =
    summarizeRuntimeTradesByStrategy(windowRuntimeTrades);
  const runtimeSummaryByStrategy = new Map(
    runtimeSummaries.map((summary) => [summary.strategyName, summary]),
  );
  const rawRuntimeEntries = extractRuntimeParityEntries(windowRuntimeTrades);
  const runtimeDedupe = dedupeRuntimeParityEntries(rawRuntimeEntries);
  const comparison = compareTradeParityEntries({
    runtimeEntries: runtimeDedupe.entries,
    backtestEntries,
    toleranceMs: LIVE_RUNTIME_COMPARE_TOLERANCE_MS,
  });
  const parityRows = summarizeTradeParityByStrategy({
    runtimeEntries: runtimeDedupe.entries,
    runtimeDuplicateEntries: runtimeDedupe.duplicateEntries,
    backtestEntries,
    matchedEntries: comparison.matched,
    runtimeOnlyEntries: comparison.runtimeOnly,
    backtestOnlyEntries: comparison.backtestOnly,
  });
  const parityByStrategy = new Map(parityRows);
  const liveSummaryByStrategy = new Map(
    liveStrategySummaries.map((summary) => [summary.strategyName, summary]),
  );

  const strategyNames = new Set<string>([
    ...liveSummaryByStrategy.keys(),
    ...runtimeSummaryByStrategy.keys(),
    ...parityByStrategy.keys(),
  ]);
  const rows = [...strategyNames]
    .sort((left, right) => left.localeCompare(right))
    .map((strategyName) => {
      const liveSummary = liveSummaryByStrategy.get(strategyName);
      const runtimeSummary = runtimeSummaryByStrategy.get(strategyName);
      const parity = parityByStrategy.get(strategyName);

      return {
        strategyName,
        backtestEntries: parity?.backtest ?? 0,
        backtestNetProfit: liveSummary?.netProfit ?? 0,
        runtimeTrades: runtimeSummary?.trades ?? 0,
        runtimePnl: runtimeSummary?.totalPnl ?? 0,
        matched: parity?.matched ?? 0,
        runtimeOnly: parity?.runtimeOnly ?? 0,
        backtestOnly: parity?.backtestOnly ?? 0,
      };
    });

  const colorizedRows = rows.map((row) => {
    const btPnlColor =
      row.backtestNetProfit > 0
        ? chalk.green
        : row.backtestNetProfit < 0
          ? chalk.red
          : chalk.gray;
    const rtPnlColor =
      row.runtimePnl > 0
        ? chalk.green
        : row.runtimePnl < 0
          ? chalk.red
          : chalk.gray;

    return [
      chalk.blue(row.strategyName),
      chalk.cyan(String(row.backtestEntries)),
      btPnlColor(`${row.backtestNetProfit.toFixed(2)}$`),
      chalk.yellow(String(row.runtimeTrades)),
      rtPnlColor(`${row.runtimePnl.toFixed(2)}$`),
      chalk.green(String(row.matched)),
      chalk.yellow(String(row.runtimeOnly)),
      chalk.magenta(String(row.backtestOnly)),
    ];
  });

  console.log('');
  console.log(
    `LIVE VS RUNTIME BY STRATEGY (connector=${activeConnectorNameForRuntimeCompare}, tolerance=${LIVE_RUNTIME_COMPARE_TOLERANCE_BARS} bar)`,
  );
  console.log(createTable(HEADERS_LIVE_RUNTIME_COMPARISON, colorizedRows));
  console.log('');

  return {
    syncedTradesCount: syncedRuntimeTrades.length,
    windowTradesCount: windowRuntimeTrades.length,
    runtimeEntriesCount: runtimeDedupe.entries.length,
    backtestEntriesCount: backtestEntries.length,
    matchedCount: comparison.matched.length,
    runtimeOnlyCount: comparison.runtimeOnly.length,
    backtestOnlyCount: comparison.backtestOnly.length,
    rows,
  };
};

const finish = async () => {
  const liveStrategySnapshot = flags.live
    ? await saveAndPrintLiveResultsByStrategy()
    : null;
  const liveRuntimeComparison = flags.live
    ? await saveAndPrintLiveRuntimeComparison({
        liveStrategySummaries: liveStrategySnapshot?.summaries ?? [],
        backtestEntries: liveStrategySnapshot?.backtestEntries ?? [],
      })
    : null;

  if (flags.live) {
    // Live mode already persists every strategy/ticker test above.
  } else if (flags.tickers) {
    await saveAndPrintResults();
  } else {
    await saveAndPrintResultsByTickers();
  }
  await persistTestSummariesIndex();
  console.log(
    chalk.gray(`tests run: done in ${formatDuration(testsStartedAt)}`),
  );
  console.log(
    chalk.gray(`backtest total: done in ${formatDuration(runStartedAt)}`),
  );
  console.log('');

  const bestConfig = flags.live ? null : results[0]?.test.strategyConfig;
  const mergedConfig = flags.live
    ? null
    : mergeConfigs(
        results.map(({ test: { strategyConfig } }) => strategyConfig),
      );

  if (!flags.live) {
    console.log(chalk.gray('BEST CONFIG:'));
    console.log(chalk.green(toJson(bestConfig, true)));
    console.log('');

    console.log(chalk.gray('MERGED CONFIG:'));
    console.log(chalk.blue(toJson(mergedConfig, true)));
    console.log('');
  }

  console.log(`${chalk.green('SUCCESS TESTS')}: ${successTests}`);
  console.log(`${chalk.red('ERRORS')}: ${errorTests}`);
  console.log('');

  const finishedAt = new Date();
  const durationSeconds = Number(
    ((Date.now() - runStartedAt) / 1000).toFixed(2),
  );
  const timestamp = createTimestamp(finishedAt);

  await setData(
    redisKeys.backtestResults(
      userName,
      flags.live ? LIVE_BACKTEST_RESULTS_CONFIG : flags.config,
      timestamp,
    ),
    {
      config: flags.live ? LIVE_BACKTEST_RESULTS_CONFIG : flags.config,
      mode: flags.live ? 'live' : 'config',
      user: userName,
      startedAt: new Date(runStartedAt).toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationSeconds,
      results: flags.live
        ? Array.from(liveResultsByStrategyAndTicker.values())
        : results,
      resultsByTickers: flags.live ? [] : Array.from(resultsByTickers.values()),
      resultsByStrategies: liveStrategySnapshot?.summaries ?? null,
      runtimeComparison: liveRuntimeComparison,
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

if (require.main === module) {
  void backtest();
}
