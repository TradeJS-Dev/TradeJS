import { Connector, Item, TestWorkerResult } from '@tradejs/types';

export type ErrorMessage = { id?: number; error?: unknown; payload?: any };

type RuntimeCompareWindow = {
  start: number;
  end: number;
};

let successTests = 0;
let errorTests = 0;
const errorMessages: ErrorMessage[] = [];
let topResults: TestWorkerResult[] = [];
const bestTickerResults = new Map<string, TestWorkerResult>();
const configResultBuckets = new Map<string, ConfigResultBucket>();
const progressStats: AggregateBacktestStats = {
  count: 0,
  netProfitSum: 0,
  wins: 0,
  losses: 0,
  ordersSum: 0,
  winRateSum: 0,
  winRateCount: 0,
};
const replayResultsByStrategyAndTicker = new Map<string, TestWorkerResult>();
const persistedTestSummaryByKey = new Map<string, Item>();
let runStartedAt = Date.now();
let testsStartedAt = runStartedAt;
let runtimeCompareConnector: Connector | null = null;
let runtimeCompareConnectorName = '';
let runtimeCompareWindow: RuntimeCompareWindow | null = null;

const getReplayStrategyResultKey = (result: Pick<TestWorkerResult, 'test'>) =>
  `${result.test.strategyName}:${result.test.symbol}`;

export type AggregateBacktestStats = {
  count: number;
  netProfitSum: number;
  wins: number;
  losses: number;
  ordersSum: number;
  winRateSum: number;
  winRateCount: number;
};

export type ConfigResultBucket = AggregateBacktestStats & {
  configId: string;
  strategyConfig: TestWorkerResult['test']['strategyConfig'];
  results: TestWorkerResult[];
};

const getResultNetProfit = (result: TestWorkerResult) => {
  const stat = result.stat as typeof result.stat & { netProfit?: number };
  return Number(stat.netProfit ?? stat.profit ?? 0);
};

const addResultToAggregate = (
  aggregate: AggregateBacktestStats,
  result: TestWorkerResult,
) => {
  aggregate.count += 1;
  aggregate.netProfitSum += getResultNetProfit(result);

  const stat = result.stat as typeof result.stat & {
    wins?: number;
    losses?: number;
    orders?: number;
    winRate?: number;
  };
  const orders = Number(stat.orders ?? 0);
  if (Number.isFinite(orders)) {
    aggregate.ordersSum += orders;
  }

  const wins = Number(stat.wins ?? 0);
  const losses = Number(stat.losses ?? 0);
  if (Number.isFinite(wins)) {
    aggregate.wins += wins;
  }
  if (Number.isFinite(losses)) {
    aggregate.losses += losses;
  }

  const winRate = Number(stat.winRate);
  if (Number.isFinite(winRate)) {
    aggregate.winRateSum += winRate;
    aggregate.winRateCount += 1;
  }
};

export const getAggregateAverageProfit = (aggregate: AggregateBacktestStats) =>
  aggregate.count > 0 ? aggregate.netProfitSum / aggregate.count : 0;

export const getAggregateWinRate = (aggregate: AggregateBacktestStats) => {
  const closedTrades = aggregate.wins + aggregate.losses;
  if (closedTrades > 0) {
    return (aggregate.wins / closedTrades) * 100;
  }
  return aggregate.winRateCount > 0
    ? aggregate.winRateSum / aggregate.winRateCount
    : 0;
};

export const incrementSuccessTests = () => {
  successTests += 1;
};

export const incrementErrorTests = () => {
  errorTests += 1;
};

export const recordRunError = (error: ErrorMessage) => {
  errorMessages.push(error);
};

export const getRunStartedAt = () => runStartedAt;

export const getTestsStartedAt = () => testsStartedAt;

export const markTestsStarted = () => {
  testsStartedAt = Date.now();
};

export const getRunCounters = () => ({
  successTests,
  errorTests,
  errors: [...errorMessages],
});

export const getTopResults = () => topResults;

export const replaceTopResults = (results: TestWorkerResult[]) => {
  topResults = results;
};

export const getBestTickerResults = () =>
  Array.from(bestTickerResults.values());

export const getBestTickerResultForSymbol = (symbol: string) =>
  bestTickerResults.get(symbol);

export const setBestTickerResultForSymbol = (
  symbol: string,
  result: TestWorkerResult,
) => {
  bestTickerResults.set(symbol, result);
};

export const recordResultAggregates = (result: TestWorkerResult) => {
  addResultToAggregate(progressStats, result);

  const configId = result.test.configId || result.test.name;
  const existing = configResultBuckets.get(configId);
  const bucket =
    existing ??
    ({
      configId,
      strategyConfig: result.test.strategyConfig,
      results: [],
      count: 0,
      netProfitSum: 0,
      wins: 0,
      losses: 0,
      ordersSum: 0,
      winRateSum: 0,
      winRateCount: 0,
    } satisfies ConfigResultBucket);

  bucket.results.push(result);
  addResultToAggregate(bucket, result);
  configResultBuckets.set(configId, bucket);
};

export const getProgressStats = (): AggregateBacktestStats => ({
  ...progressStats,
});

export const getConfigResultBuckets = () =>
  Array.from(configResultBuckets.values());

export const getTopConfigResultBuckets = (limit: number) =>
  getConfigResultBuckets()
    .sort((left, right) => {
      const profitDelta =
        getAggregateAverageProfit(right) - getAggregateAverageProfit(left);
      if (profitDelta !== 0) {
        return profitDelta;
      }
      const winRateDelta =
        getAggregateWinRate(right) - getAggregateWinRate(left);
      if (winRateDelta !== 0) {
        return winRateDelta;
      }
      return right.count - left.count;
    })
    .slice(0, Math.max(0, limit));

export const storeReplayResult = (result: TestWorkerResult) => {
  replayResultsByStrategyAndTicker.set(
    getReplayStrategyResultKey(result),
    result,
  );
};

export const getReplayResults = () =>
  Array.from(replayResultsByStrategyAndTicker.values());

export const getPersistedTestSummariesMap = () => persistedTestSummaryByKey;

export const setPersistedTestSummary = (key: string, item: Item) => {
  persistedTestSummaryByKey.set(key, item);
};

export const setRuntimeCompareContext = ({
  connector,
  connectorName,
  window,
}: {
  connector: Connector | null;
  connectorName: string;
  window: RuntimeCompareWindow | null;
}) => {
  runtimeCompareConnector = connector;
  runtimeCompareConnectorName = connectorName;
  runtimeCompareWindow = window;
};

export const getRuntimeCompareContext = () => ({
  connector: runtimeCompareConnector,
  connectorName: runtimeCompareConnectorName,
  window: runtimeCompareWindow,
});

export const resetRunState = () => {
  successTests = 0;
  errorTests = 0;
  errorMessages.length = 0;
  topResults = [];
  bestTickerResults.clear();
  configResultBuckets.clear();
  progressStats.count = 0;
  progressStats.netProfitSum = 0;
  progressStats.wins = 0;
  progressStats.losses = 0;
  progressStats.ordersSum = 0;
  progressStats.winRateSum = 0;
  progressStats.winRateCount = 0;
  replayResultsByStrategyAndTicker.clear();
  persistedTestSummaryByKey.clear();
  runStartedAt = Date.now();
  testsStartedAt = runStartedAt;
  runtimeCompareConnector = null;
  runtimeCompareConnectorName = '';
  runtimeCompareWindow = null;
};
