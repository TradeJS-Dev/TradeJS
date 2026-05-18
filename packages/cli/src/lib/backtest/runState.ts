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
const replayResultsByStrategyAndTicker = new Map<string, TestWorkerResult>();
const persistedTestSummaryByKey = new Map<string, Item>();
let runStartedAt = Date.now();
let testsStartedAt = runStartedAt;
let runtimeCompareConnector: Connector | null = null;
let runtimeCompareConnectorName = '';
let runtimeCompareWindow: RuntimeCompareWindow | null = null;

const getReplayStrategyResultKey = (result: Pick<TestWorkerResult, 'test'>) =>
  `${result.test.strategyName}:${result.test.symbol}`;

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
  replayResultsByStrategyAndTicker.clear();
  persistedTestSummaryByKey.clear();
  runStartedAt = Date.now();
  testsStartedAt = runStartedAt;
  runtimeCompareConnector = null;
  runtimeCompareConnectorName = '';
  runtimeCompareWindow = null;
};
