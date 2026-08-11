import {
  Connector,
  ConnectorCreator,
  Interval,
  KlineChartData,
  KlineChartItem,
  Test,
  TestingBox,
  TestingBoxResult,
} from '@tradejs/types';
import { alignSortedCandlesByTimestamp } from '@tradejs/core/indicators';
import {
  BACKTEST_EXECUTION_INTERVAL,
  BACKTEST_LOWER_TIMEFRAME_EXECUTION_ENABLED,
} from '@tradejs/core/constants';
import {
  releaseStrategyIndicatorsReplayCache,
  releaseStrategyReplayCache,
} from '@tradejs/core/strategies';
import { getBacktestPreloadStart } from '@tradejs/core/time';
import { logger } from '@tradejs/infra/logger';
import { getStrategyCreator } from './strategy/manifests';
import {
  BUILTIN_CONNECTOR_NAMES,
  getConnectorCreatorByName,
} from './connectorsRegistry';
import { getTradejsProjectCwd } from './tradejsConfig';
import type { PreparedBacktestData } from './backtest/contracts';
import { createBacktestProgress } from './backtest/progress';
import { BacktestSession, createBacktestSession } from './backtest/session';

type TestingKlineCacheState = {
  coinKlineCache: Map<string, KlineChartData>;
  btcKlineCache: Map<string, KlineChartData>;
  ethKlineCache: Map<string, KlineChartData>;
  btcBinanceKlineCache: Map<string, KlineChartData>;
  btcCoinbaseKlineCache: Map<string, KlineChartData>;
  preparedDataCache: Map<string, PreparedBacktestData>;
  connectorCache: Map<string, Connector>;
};

type TestingGroupResult = {
  test: Test;
  result: TestingBoxResult;
};

const CLOSED_RESULT_FLUSH_INTERVAL = 500;

const buildCandleByTimestamp = (candles?: KlineChartData) =>
  new Map(
    (candles ?? [])
      .filter((candle) => typeof candle?.timestamp === 'number')
      .map((candle) => [candle.timestamp, candle]),
  ) as Map<number, KlineChartItem>;

const createTestingKlineCacheState = (): TestingKlineCacheState => ({
  coinKlineCache: new Map<string, KlineChartData>(),
  btcKlineCache: new Map<string, KlineChartData>(),
  ethKlineCache: new Map<string, KlineChartData>(),
  btcBinanceKlineCache: new Map<string, KlineChartData>(),
  btcCoinbaseKlineCache: new Map<string, KlineChartData>(),
  preparedDataCache: new Map<string, PreparedBacktestData>(),
  connectorCache: new Map<string, Connector>(),
});

const testingKlineCacheStateByProjectRoot = new Map<
  string,
  TestingKlineCacheState
>();

const getTestingKlineCacheState = (
  cwd = getTradejsProjectCwd(),
): {
  projectRoot: string;
  state: TestingKlineCacheState;
} => {
  const projectRoot = getTradejsProjectCwd(cwd);
  let state = testingKlineCacheStateByProjectRoot.get(projectRoot);
  if (!state) {
    state = createTestingKlineCacheState();
    testingKlineCacheStateByProjectRoot.set(projectRoot, state);
  }

  return {
    projectRoot,
    state,
  };
};

const getKlineCacheKey = (params: {
  userName: string;
  connectorName: string;
  symbol: string;
  preloadStart: number;
  end: number;
  interval: Interval;
  cacheOnly: boolean;
  universe?: string;
  accountId?: string;
}) => {
  const {
    userName,
    connectorName,
    symbol,
    preloadStart,
    end,
    interval,
    cacheOnly,
    universe,
    accountId,
  } = params;
  return [
    userName,
    connectorName,
    universe ?? 'crypto',
    accountId ?? 'default',
    symbol,
    preloadStart,
    end,
    interval,
    cacheOnly ? 1 : 0,
  ].join(':');
};

const getPreparedDataCacheKey = (params: {
  userName: string;
  connectorName: string;
  symbol: string;
  preloadStart: number;
  start: number;
  end: number;
  interval: Interval;
  btcBinanceConnectorName: string;
  btcCoinbaseConnectorName: string;
  backtestExecutionInterval: Interval;
  universe?: string;
  accountId?: string;
}) => {
  const {
    userName,
    connectorName,
    symbol,
    preloadStart,
    start,
    end,
    interval,
    btcBinanceConnectorName,
    btcCoinbaseConnectorName,
    backtestExecutionInterval,
    universe,
    accountId,
  } = params;

  return [
    userName,
    connectorName,
    universe ?? 'crypto',
    accountId ?? 'default',
    symbol,
    preloadStart,
    start,
    end,
    interval,
    backtestExecutionInterval,
    btcBinanceConnectorName,
    btcCoinbaseConnectorName,
  ].join(':');
};

const getConnectorCacheKey = (params: {
  userName: string;
  connectorName: string;
  universe?: string;
  accountId?: string;
}) =>
  [
    params.userName,
    params.connectorName,
    params.universe ?? 'crypto',
    params.accountId ?? 'default',
  ].join(':');

const BACKTEST_INTERVAL: Interval = '15';
const resolveBacktestExecutionInterval = (
  interval: Interval,
): Interval | null => {
  const normalized = String(interval);
  if (normalized === '15') {
    return BACKTEST_EXECUTION_INTERVAL as Interval;
  }
  if (normalized === '60') {
    return '15' as Interval;
  }
  return null;
};

const resolveIntervalMs = (interval: Interval) => {
  const intervalMinutes = Number(interval);
  return Number.isFinite(intervalMinutes) && intervalMinutes > 0
    ? intervalMinutes * 60_000
    : Number(BACKTEST_INTERVAL) * 60_000;
};

const splitCandlesForTesting = (
  candles: KlineChartData,
  start: number,
  preloadStart: number,
): {
  prevData: KlineChartData;
  testData: KlineChartData;
} => {
  const prevData: KlineChartData = [];
  const testData: KlineChartData = [];

  for (const candle of candles) {
    if (candle.timestamp < preloadStart) continue;
    if (candle.timestamp < start) {
      prevData.push(candle);
    } else {
      testData.push(candle);
    }
  }

  return { prevData, testData };
};

const getCurrentOpenTimestamp = (interval: Interval) => {
  const intervalMs = resolveIntervalMs(interval);
  return Math.floor(Date.now() / intervalMs) * intervalMs;
};

const filterClosedAlignedCandles = (
  data: KlineChartData,
  btcData: KlineChartData,
  interval: Interval,
): {
  data: KlineChartData;
  btcData: KlineChartData;
} => {
  const currentOpenTimestamp = getCurrentOpenTimestamp(interval);
  const closedData: KlineChartData = [];
  const closedBtcData: KlineChartData = [];

  for (let index = 0; index < data.length; index += 1) {
    const candle = data[index];
    const btcCandle = btcData[index];
    if (!candle || !btcCandle || candle.timestamp >= currentOpenTimestamp) {
      continue;
    }
    closedData.push(candle);
    closedBtcData.push(btcCandle);
  }

  return {
    data: closedData,
    btcData: closedBtcData,
  };
};

const shouldLoadBacktestExecutionCandles = (interval: Interval) => {
  if (!BACKTEST_LOWER_TIMEFRAME_EXECUTION_ENABLED) {
    return false;
  }
  const executionInterval = resolveBacktestExecutionInterval(interval);
  if (!executionInterval) {
    return false;
  }
  const primaryMs = resolveIntervalMs(interval);
  const executionMs = resolveIntervalMs(executionInterval);
  return executionMs > 0 && executionMs < primaryMs;
};

const getCachedConnector = async (params: {
  state: TestingKlineCacheState;
  projectRoot: string;
  userName: string;
  connectorName: string;
  universe?: Test['universe'];
  accountId?: string;
  deploymentId?: string;
}): Promise<Connector | undefined> => {
  const {
    state,
    projectRoot,
    userName,
    connectorName,
    universe,
    accountId,
    deploymentId,
  } = params;
  const cacheKey = getConnectorCacheKey({
    userName,
    connectorName,
    universe,
    accountId,
  });
  const cachedConnector = state.connectorCache.get(cacheKey);
  if (cachedConnector) {
    return cachedConnector;
  }

  const connectorCreator = await getConnectorCreatorByName(
    connectorName,
    projectRoot,
  );
  if (!connectorCreator) {
    return undefined;
  }

  const connector = await (connectorCreator as ConnectorCreator)({
    userName,
    universe,
    accountId,
    deploymentId,
  });
  state.connectorCache.set(cacheKey, connector);

  return connector;
};

export const resetTestingKlineCache = (cwd?: string) => {
  const normalizedCwd = String(cwd ?? '').trim();
  if (!normalizedCwd) {
    testingKlineCacheStateByProjectRoot.clear();
    return;
  }

  testingKlineCacheStateByProjectRoot.delete(
    getTradejsProjectCwd(normalizedCwd),
  );
};

export const releaseTestingSymbolCache = (params: {
  cwd?: string;
  userName: string;
  connectorName: string;
  symbol: string;
}) => {
  const { cwd, userName, connectorName, symbol } = params;
  const { state } = getTestingKlineCacheState(cwd);
  const connectorPrefix = [userName, connectorName].join(':') + ':';
  for (const cache of [state.coinKlineCache, state.preparedDataCache]) {
    for (const key of cache.keys()) {
      if (key.startsWith(connectorPrefix) && key.split(':').includes(symbol)) {
        cache.delete(key);
      }
    }
  }
};

const prepareTestingData = async (params: {
  state: TestingKlineCacheState;
  projectRoot: string;
  userName: string;
  connectorName: string;
  symbol: string;
  preloadStart: number;
  start: number;
  end: number;
  interval: Interval;
  universe?: Test['universe'];
  accountId?: string;
  deploymentId?: string;
}) => {
  const {
    state,
    projectRoot,
    userName,
    connectorName,
    symbol,
    preloadStart,
    start,
    end,
    interval,
    universe = 'crypto',
    accountId,
    deploymentId,
  } = params;
  const binanceConnector =
    universe === 'crypto'
      ? await getCachedConnector({
          state,
          projectRoot,
          userName,
          connectorName: BUILTIN_CONNECTOR_NAMES.Binance,
        })
      : undefined;
  const coinbaseConnector =
    universe === 'crypto'
      ? await getCachedConnector({
          state,
          projectRoot,
          userName,
          connectorName: BUILTIN_CONNECTOR_NAMES.Coinbase,
        })
      : undefined;

  const cacheOnly = true;
  const connector = await getCachedConnector({
    state,
    projectRoot,
    userName,
    connectorName,
    universe,
    accountId,
    deploymentId,
  });
  if (!connector) {
    throw new Error(`Unknown connector: ${connectorName}`);
  }

  if (!binanceConnector || !coinbaseConnector) {
    logger.warn(
      'Binance/Coinbase connectors are unavailable. Reusing %s for BTC references.',
      connectorName,
    );
  }

  const coinCacheKey = getKlineCacheKey({
    userName,
    connectorName,
    symbol,
    preloadStart,
    end,
    interval,
    cacheOnly,
    universe,
    accountId,
  });
  const btcCacheKey = getKlineCacheKey({
    userName,
    connectorName,
    symbol: 'BTCUSDT',
    preloadStart,
    end,
    interval,
    cacheOnly,
    universe,
    accountId,
  });
  const ethCacheKey = getKlineCacheKey({
    userName,
    connectorName,
    symbol: 'ETHUSDT',
    preloadStart,
    end,
    interval,
    cacheOnly,
    universe,
    accountId,
  });
  const btcBinanceConnectorName = binanceConnector
    ? BUILTIN_CONNECTOR_NAMES.Binance
    : connectorName;
  const btcCoinbaseConnectorName = coinbaseConnector
    ? BUILTIN_CONNECTOR_NAMES.Coinbase
    : connectorName;
  const btcBinanceCacheKey = getKlineCacheKey({
    userName,
    connectorName: btcBinanceConnectorName,
    symbol: 'BTCUSDT',
    preloadStart,
    end,
    interval,
    cacheOnly,
    universe: 'crypto',
  });
  const btcCoinbaseCacheKey = getKlineCacheKey({
    userName,
    connectorName: btcCoinbaseConnectorName,
    symbol: 'BTCUSDT',
    preloadStart,
    end,
    interval,
    cacheOnly,
    universe: 'crypto',
  });

  const cachedCoinData = state.coinKlineCache.get(coinCacheKey);
  const cachedBtcData = state.btcKlineCache.get(btcCacheKey);
  const cachedEthData = state.ethKlineCache.get(ethCacheKey);
  const cachedBtcBinanceData =
    state.btcBinanceKlineCache.get(btcBinanceCacheKey);
  const cachedBtcCoinbaseData =
    state.btcCoinbaseKlineCache.get(btcCoinbaseCacheKey);
  const backtestExecutionInterval = resolveBacktestExecutionInterval(interval);
  const backtestExecutionCacheInterval = backtestExecutionInterval ?? interval;
  const shouldLoadExecutionCandles =
    backtestExecutionInterval != null &&
    shouldLoadBacktestExecutionCandles(interval);
  const executionCoinCacheKey = getKlineCacheKey({
    userName,
    connectorName,
    symbol,
    preloadStart,
    end,
    interval: backtestExecutionCacheInterval,
    cacheOnly,
    universe,
    accountId,
  });
  const executionBtcCacheKey = getKlineCacheKey({
    userName,
    connectorName,
    symbol: 'BTCUSDT',
    preloadStart,
    end,
    interval: backtestExecutionCacheInterval,
    cacheOnly,
    universe,
    accountId,
  });
  const cachedExecutionCoinData = shouldLoadExecutionCandles
    ? state.coinKlineCache.get(executionCoinCacheKey)
    : undefined;
  const cachedExecutionBtcData = shouldLoadExecutionCandles
    ? state.btcKlineCache.get(executionBtcCacheKey)
    : undefined;
  const preparedDataCacheKey = getPreparedDataCacheKey({
    userName,
    connectorName,
    symbol,
    preloadStart,
    start,
    end,
    interval,
    backtestExecutionInterval: backtestExecutionCacheInterval,
    btcBinanceConnectorName,
    btcCoinbaseConnectorName,
    universe,
    accountId,
  });

  const cachedPreparedData = state.preparedDataCache.get(preparedDataCacheKey);
  if (cachedPreparedData) {
    return cachedPreparedData;
  }

  const btcDataPromise: Promise<KlineChartData> =
    universe === 'tradfi'
      ? Promise.resolve([])
      : cachedBtcData
        ? Promise.resolve(cachedBtcData)
        : connector.kline({
            symbol: 'BTCUSDT',
            start: preloadStart,
            end,
            interval,
            silent: true,
            cacheOnly,
          });
  const ethDataPromise: Promise<KlineChartData> =
    universe === 'tradfi'
      ? Promise.resolve([])
      : cachedEthData
        ? Promise.resolve(cachedEthData)
        : connector.kline({
            symbol: 'ETHUSDT',
            start: preloadStart,
            end,
            interval,
            silent: true,
            cacheOnly,
          });
  const btcBinanceDataPromise: Promise<KlineChartData> =
    universe === 'tradfi'
      ? Promise.resolve([])
      : cachedBtcBinanceData
        ? Promise.resolve(cachedBtcBinanceData)
        : btcBinanceCacheKey === btcCacheKey
          ? btcDataPromise
          : (binanceConnector ?? connector).kline({
              symbol: 'BTCUSDT',
              start: preloadStart,
              end,
              interval,
              silent: true,
              cacheOnly,
            });
  const btcCoinbaseDataPromise: Promise<KlineChartData> =
    universe === 'tradfi'
      ? Promise.resolve([])
      : cachedBtcCoinbaseData
        ? Promise.resolve(cachedBtcCoinbaseData)
        : btcCoinbaseCacheKey === btcCacheKey
          ? btcDataPromise
          : (coinbaseConnector ?? connector).kline({
              symbol: 'BTCUSDT',
              start: preloadStart,
              end,
              interval,
              silent: true,
              cacheOnly,
            });
  const executionDataPromise: Promise<KlineChartData> =
    !shouldLoadExecutionCandles
      ? Promise.resolve([])
      : cachedExecutionCoinData
        ? Promise.resolve(cachedExecutionCoinData)
        : connector.kline({
            symbol,
            start: preloadStart,
            end,
            interval: backtestExecutionInterval!,
            silent: true,
            cacheOnly,
          });
  const executionBtcDataPromise: Promise<KlineChartData> =
    universe === 'tradfi' || !shouldLoadExecutionCandles
      ? Promise.resolve([])
      : cachedExecutionBtcData
        ? Promise.resolve(cachedExecutionBtcData)
        : connector.kline({
            symbol: 'BTCUSDT',
            start: preloadStart,
            end,
            interval: backtestExecutionInterval!,
            silent: true,
            cacheOnly,
          });

  const [
    dataRaw,
    btcDataRaw,
    ethDataRaw,
    btcBinanceDataRaw,
    btcCoinbaseDataRaw,
    executionDataRaw,
    executionBtcDataRaw,
  ] = await Promise.all([
    cachedCoinData
      ? Promise.resolve(cachedCoinData)
      : connector.kline({
          symbol,
          start: preloadStart,
          end,
          interval,
          silent: true,
          cacheOnly,
        }),
    btcDataPromise,
    ethDataPromise,
    btcBinanceDataPromise,
    btcCoinbaseDataPromise,
    executionDataPromise,
    executionBtcDataPromise,
  ]);

  if (!cachedCoinData) {
    state.coinKlineCache.set(coinCacheKey, dataRaw);
  }
  if (!cachedBtcData) {
    state.btcKlineCache.set(btcCacheKey, btcDataRaw);
  }
  if (!cachedEthData) {
    state.ethKlineCache.set(ethCacheKey, ethDataRaw);
  }
  if (!cachedBtcBinanceData) {
    state.btcBinanceKlineCache.set(btcBinanceCacheKey, btcBinanceDataRaw);
  }
  if (!cachedBtcCoinbaseData) {
    state.btcCoinbaseKlineCache.set(btcCoinbaseCacheKey, btcCoinbaseDataRaw);
  }
  if (shouldLoadExecutionCandles && !cachedExecutionCoinData) {
    state.coinKlineCache.set(executionCoinCacheKey, executionDataRaw);
  }
  if (shouldLoadExecutionCandles && !cachedExecutionBtcData) {
    state.btcKlineCache.set(executionBtcCacheKey, executionBtcDataRaw);
  }

  const aligned =
    universe === 'tradfi'
      ? { alignedCoinCandles: dataRaw, alignedBtcCandles: dataRaw }
      : alignSortedCandlesByTimestamp(dataRaw, btcDataRaw);
  const { data, btcData } = filterClosedAlignedCandles(
    aligned.alignedCoinCandles,
    aligned.alignedBtcCandles,
    interval,
  );
  const btcBinanceData =
    universe === 'tradfi'
      ? []
      : alignSortedCandlesByTimestamp(data, btcBinanceDataRaw)
          .alignedBtcCandles;
  const btcCoinbaseData =
    universe === 'tradfi'
      ? []
      : alignSortedCandlesByTimestamp(data, btcCoinbaseDataRaw)
          .alignedBtcCandles;
  const ethData =
    universe === 'tradfi'
      ? []
      : alignSortedCandlesByTimestamp(data, ethDataRaw).alignedBtcCandles;
  const alignedExecution = shouldLoadExecutionCandles
    ? universe === 'tradfi'
      ? {
          alignedCoinCandles: executionDataRaw,
          alignedBtcCandles: executionDataRaw,
        }
      : alignSortedCandlesByTimestamp(executionDataRaw, executionBtcDataRaw)
    : { alignedCoinCandles: [], alignedBtcCandles: [] };
  const { data: backtestExecutionData, btcData: backtestExecutionBtcData } =
    filterClosedAlignedCandles(
      alignedExecution.alignedCoinCandles,
      alignedExecution.alignedBtcCandles,
      backtestExecutionCacheInterval,
    );
  const backtestExecutionDataByTimestamp = buildCandleByTimestamp(
    backtestExecutionData,
  );
  const backtestExecutionBtcDataByTimestamp = buildCandleByTimestamp(
    backtestExecutionBtcData,
  );

  const { prevData, testData } = splitCandlesForTesting(
    data,
    start,
    preloadStart,
  );
  const { prevData: btcPrevData, testData: btcTestData } =
    splitCandlesForTesting(btcData, start, preloadStart);
  const { prevData: ethPrevData, testData: ethTestData } =
    splitCandlesForTesting(ethData, start, preloadStart);
  const preparedData = {
    data,
    btcData,
    ethData,
    prevData,
    btcPrevData,
    ethPrevData,
    testData,
    btcTestData,
    ethTestData,
    btcBinanceData,
    btcCoinbaseData,
    backtestExecutionInterval: backtestExecutionCacheInterval,
    backtestExecutionData,
    backtestExecutionBtcData,
    backtestExecutionDataByTimestamp,
    backtestExecutionBtcDataByTimestamp,
  };
  state.preparedDataCache.set(preparedDataCacheKey, preparedData);

  return preparedData;
};

export const canRunTestsInSharedCandleLoop = (tests: Test[]): boolean => {
  if (tests.length <= 1) {
    return false;
  }

  const first = tests[0];
  const firstStart = first.options?.start;
  const firstEnd = first.options?.end;
  return tests.every(
    (test) =>
      test.userName === first.userName &&
      test.connectorName === first.connectorName &&
      (test.universe ?? 'crypto') === (first.universe ?? 'crypto') &&
      (test.accountId ?? null) === (first.accountId ?? null) &&
      (test.deploymentId ?? null) === (first.deploymentId ?? null) &&
      test.symbol === first.symbol &&
      test.strategyName === first.strategyName &&
      test.options?.start === firstStart &&
      test.options?.end === firstEnd &&
      Boolean(test.ml) === Boolean(first.ml) &&
      Boolean(test.ai) === Boolean(first.ai) &&
      Boolean(test.fast) === Boolean(first.fast) &&
      Boolean(test.collectReplaySignalEvaluations) ===
        Boolean(first.collectReplaySignalEvaluations) &&
      (test.interval ?? BACKTEST_INTERVAL) ===
        (first.interval ?? BACKTEST_INTERVAL) &&
      (test.timeoutMs ?? null) === (first.timeoutMs ?? null),
  );
};

export const testing: TestingBox = async (test) => {
  const {
    userName,
    symbol,
    options: { start, end },
    name,
    strategyName,
    connectorName,
    universe = 'crypto',
    accountId,
    deploymentId,
    interval = BACKTEST_INTERVAL,
    timeoutMs,
  } = test;
  if (!start) {
    throw new Error('no start');
  }
  // TODO: Add explicit end validation (and consistent error handling) similar to start validation.
  const preloadStart = getBacktestPreloadStart(start);

  const progress = createBacktestProgress({
    testName: name,
    symbol,
    strategyName,
    timeoutMs,
    timeoutSubject: `Test ${name} (${symbol})`,
  });

  const { projectRoot, state } = getTestingKlineCacheState();

  const connector = await progress.run('connector init', () =>
    getCachedConnector({
      state,
      projectRoot,
      userName,
      connectorName,
      universe,
      accountId,
      deploymentId,
    }),
  );
  if (!connector) {
    throw new Error(`Unknown connector: ${connectorName}`);
  }
  const strategyCreator = await progress.run('strategy lookup', () =>
    getStrategyCreator(strategyName, projectRoot),
  );
  if (!strategyCreator) {
    throw new Error(`Unknown strategy: ${strategyName}`);
  }
  const preparedData = await progress.run('kline preload', () =>
    prepareTestingData({
      state,
      projectRoot,
      userName,
      connectorName,
      symbol,
      preloadStart,
      start,
      end,
      interval,
      universe,
      accountId,
      deploymentId,
    }),
  );

  if (!preparedData) {
    throw new Error('Prepared backtest data not available');
  }

  const { testData, btcTestData } = preparedData;
  const session = await createBacktestSession({
    test,
    connector,
    strategyCreator,
    preparedData,
    interval,
    monitor: progress,
  });

  for (let candleIndex = 0; candleIndex < testData.length; candleIndex++) {
    if (candleIndex % 25 === 0) {
      progress.checkpoint('candle loop');
    }
    progress.setCandle(candleIndex + 1, testData.length);
    await session.next(testData[candleIndex], btcTestData[candleIndex]);

    if ((candleIndex + 1) % CLOSED_RESULT_FLUSH_INTERVAL === 0) {
      await session.flush();
    }
  }

  return session.result();
};

export const testingGroupInSharedCandleLoop = async (
  tests: Test[],
): Promise<TestingGroupResult[]> => {
  if (!canRunTestsInSharedCandleLoop(tests)) {
    const results: TestingGroupResult[] = [];
    for (const test of tests) {
      const result = await testing(test);
      if (result) {
        results.push({ test, result });
      }
    }
    return results;
  }

  const first = tests[0];
  const {
    userName,
    symbol,
    options: { start, end },
    strategyName,
    connectorName,
    universe = 'crypto',
    accountId,
    deploymentId,
    interval = BACKTEST_INTERVAL,
    chunkId = 'single',
    timeoutMs,
  } = first;
  if (!start) {
    throw new Error('no start');
  }

  const preloadStart = getBacktestPreloadStart(start);
  const progress = createBacktestProgress({
    testName: first.name,
    symbol,
    strategyName,
    timeoutMs,
    timeoutSubject: `Test group ${strategyName}/${symbol}`,
  });

  const { projectRoot, state } = getTestingKlineCacheState();
  const connector = await progress.run('connector init', () =>
    getCachedConnector({
      state,
      projectRoot,
      userName,
      connectorName,
      universe,
      accountId,
      deploymentId,
    }),
  );
  if (!connector) {
    throw new Error(`Unknown connector: ${connectorName}`);
  }
  const strategyCreator = await progress.run('strategy lookup', () =>
    getStrategyCreator(strategyName, projectRoot),
  );
  if (!strategyCreator) {
    throw new Error(`Unknown strategy: ${strategyName}`);
  }
  const preparedData = await progress.run('kline preload', () =>
    prepareTestingData({
      state,
      projectRoot,
      userName,
      connectorName,
      symbol,
      preloadStart,
      start,
      end,
      interval,
      universe,
      accountId,
      deploymentId,
    }),
  );
  if (!preparedData) {
    throw new Error('Prepared backtest data not available');
  }

  const { testData, btcTestData } = preparedData;

  const sharedIndicatorsReplayKey = [
    'shared',
    userName,
    connectorName,
    strategyName,
    symbol,
    interval,
    start,
    end,
    chunkId,
  ].join(':');

  const runners: { test: Test; session: BacktestSession }[] = [];
  try {
    for (const test of tests) {
      runners.push({
        test,
        session: await createBacktestSession({
          test,
          connector,
          strategyCreator,
          preparedData,
          interval,
          sharedIndicatorsReplayKey,
          monitor: progress,
        }),
      });
    }

    for (let candleIndex = 0; candleIndex < testData.length; candleIndex++) {
      if (candleIndex % 25 === 0) {
        progress.checkpoint('candle loop');
      }
      progress.setCandle(candleIndex + 1, testData.length);

      const candle = testData[candleIndex];
      const btcCandle = btcTestData[candleIndex];
      const detectorNoSignalByKey = new Map<string, string>();

      for (const runner of runners) {
        const { session } = runner;
        const detectorFanoutKey = session.detectorFanoutKey;
        const detectorSkipCode = detectorFanoutKey
          ? detectorNoSignalByKey.get(detectorFanoutKey)
          : undefined;
        const signal = await session.next(candle, btcCandle, detectorSkipCode);
        if (
          detectorFanoutKey &&
          session.detectorNoSignalSkipReason &&
          typeof signal === 'string' &&
          signal === session.detectorNoSignalSkipReason
        ) {
          detectorNoSignalByKey.set(detectorFanoutKey, signal);
        }
      }

      if ((candleIndex + 1) % CLOSED_RESULT_FLUSH_INTERVAL === 0) {
        await Promise.all(runners.map(({ session }) => session.flush()));
      }
    }

    const results: TestingGroupResult[] = [];
    for (const runner of runners) {
      results.push({
        test: runner.test,
        result: await runner.session.result(),
      });
    }

    return results;
  } finally {
    releaseStrategyIndicatorsReplayCache(sharedIndicatorsReplayKey);
    releaseStrategyReplayCache(sharedIndicatorsReplayKey);
  }
};
