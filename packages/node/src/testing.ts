import {
  AiDatasetRow,
  Candle,
  Connector,
  ConnectorCreator,
  KlineChartData,
  Signal,
  TestingBox,
} from '@tradejs/types';
import { alignSortedCandlesByTimestamp } from '@tradejs/core/indicators';
import { PRELOAD_DAYS } from '@tradejs/core/constants';
import { getTimestamp } from '@tradejs/core/time';
import { appendAiDatasetRow } from '@tradejs/infra/ai';
import {
  appendMlDatasetRow,
  buildMlTrainingRow,
  trimMlTrainingRowWindows,
} from '@tradejs/infra/ml';
import { logger } from '@tradejs/infra/logger';
import { buildAiPayload } from './ai';
import { getStrategyCreator } from './strategy/manifests';
import { buildMlPayload } from './mlPayload';
import {
  BUILTIN_CONNECTOR_NAMES,
  getConnectorCreatorByName,
} from './connectorsRegistry';
import { createTestConnector } from './testConnector';
import { getTradejsProjectCwd } from './tradejsConfig';

const preloadStart = getTimestamp(PRELOAD_DAYS);

type TestingKlineCacheState = {
  coinKlineCache: Map<string, KlineChartData>;
  btcKlineCache: Map<string, KlineChartData>;
  btcBinanceKlineCache: Map<string, KlineChartData>;
  btcCoinbaseKlineCache: Map<string, KlineChartData>;
  preparedDataCache: Map<string, PreparedTestingData>;
  connectorCache: Map<string, Connector>;
};

type PreparedTestingData = {
  prevData: KlineChartData;
  btcPrevData: KlineChartData;
  testData: KlineChartData;
  btcTestData: KlineChartData;
  btcBinancePrevData: KlineChartData;
  btcCoinbasePrevData: KlineChartData;
};

const createTestingKlineCacheState = (): TestingKlineCacheState => ({
  coinKlineCache: new Map<string, KlineChartData>(),
  btcKlineCache: new Map<string, KlineChartData>(),
  btcBinanceKlineCache: new Map<string, KlineChartData>(),
  btcCoinbaseKlineCache: new Map<string, KlineChartData>(),
  preparedDataCache: new Map<string, PreparedTestingData>(),
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
  end: number;
  interval: string;
  cacheOnly: boolean;
}) => {
  const { userName, connectorName, symbol, end, interval, cacheOnly } = params;
  return [
    userName,
    connectorName,
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
  start: number;
  end: number;
  interval: string;
  btcBinanceConnectorName: string;
  btcCoinbaseConnectorName: string;
}) => {
  const {
    userName,
    connectorName,
    symbol,
    start,
    end,
    interval,
    btcBinanceConnectorName,
    btcCoinbaseConnectorName,
  } = params;

  return [
    userName,
    connectorName,
    symbol,
    start,
    end,
    interval,
    btcBinanceConnectorName,
    btcCoinbaseConnectorName,
  ].join(':');
};

const getConnectorCacheKey = (params: {
  userName: string;
  connectorName: string;
}) => [params.userName, params.connectorName].join(':');

const splitCandlesForTesting = (
  candles: KlineChartData,
  start: number,
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

const getCachedConnector = async (params: {
  state: TestingKlineCacheState;
  projectRoot: string;
  userName: string;
  connectorName: string;
}): Promise<Connector | undefined> => {
  const { state, projectRoot, userName, connectorName } = params;
  const cacheKey = getConnectorCacheKey({ userName, connectorName });
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

export const testing: TestingBox = async ({
  userName,
  symbol,
  options: { start, end },
  name,
  testId,
  testSuiteId,
  strategyName,
  strategyConfig,
  connectorName,
  ml = false,
  ai = false,
  chunkId = 'single',
  timeoutMs,
}) => {
  if (!start) {
    throw new Error('no start');
  }
  // TODO: Add explicit end validation (and consistent error handling) similar to start validation.

  const startedAt = Date.now();
  const formatTimeoutMessage = (stage: string) =>
    `Test ${name} (${symbol}) timed out after ${timeoutMs}ms during ${stage}`;
  const getRemainingTimeoutMs = (stage: string) => {
    if (!timeoutMs || timeoutMs <= 0) {
      return null;
    }

    const remainingMs = timeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      throw new Error(formatTimeoutMessage(stage));
    }

    return remainingMs;
  };
  const throwIfTimedOut = (stage: string) => {
    getRemainingTimeoutMs(stage);
  };
  const withTimeout = async <T>(
    stage: string,
    promise: Promise<T>,
  ): Promise<T> => {
    const remainingMs = getRemainingTimeoutMs(stage);
    if (remainingMs == null) {
      return promise;
    }

    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(formatTimeoutMessage(stage)));
      }, remainingMs);

      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  };

  const { projectRoot, state } = getTestingKlineCacheState();

  const connector = await withTimeout(
    'connector init',
    getCachedConnector({
      state,
      projectRoot,
      userName,
      connectorName,
    }),
  );
  if (!connector) {
    throw new Error(`Unknown connector: ${connectorName}`);
  }
  const strategyCreator = await withTimeout(
    'strategy lookup',
    getStrategyCreator(strategyName, projectRoot),
  );
  if (!strategyCreator) {
    throw new Error(`Unknown strategy: ${strategyName}`);
  }
  const binanceConnector = await withTimeout(
    'binance connector init',
    getCachedConnector({
      state,
      projectRoot,
      userName,
      connectorName: BUILTIN_CONNECTOR_NAMES.Binance,
    }),
  );
  const coinbaseConnector = await withTimeout(
    'coinbase connector init',
    getCachedConnector({
      state,
      projectRoot,
      userName,
      connectorName: BUILTIN_CONNECTOR_NAMES.Coinbase,
    }),
  );
  if (!binanceConnector || !coinbaseConnector) {
    logger.warn(
      'Binance/Coinbase connectors are unavailable. Reusing %s for BTC references.',
      connectorName,
    );
  }

  const interval = '15';
  const cacheOnly = true;
  const coinCacheKey = getKlineCacheKey({
    userName,
    connectorName,
    symbol,
    end,
    interval,
    cacheOnly,
  });
  const btcCacheKey = getKlineCacheKey({
    userName,
    connectorName,
    symbol: 'BTCUSDT',
    end,
    interval,
    cacheOnly,
  });
  const btcBinanceConnectorName = binanceConnector
    ? BUILTIN_CONNECTOR_NAMES.Binance
    : connectorName;
  const btcCoinbaseConnectorName = coinbaseConnector
    ? BUILTIN_CONNECTOR_NAMES.Coinbase
    : connectorName;

  const cachedCoinData = state.coinKlineCache.get(coinCacheKey);
  const cachedBtcData = state.btcKlineCache.get(btcCacheKey);
  const btcBinanceCacheKey = getKlineCacheKey({
    userName,
    connectorName: btcBinanceConnectorName,
    symbol: 'BTCUSDT',
    end,
    interval,
    cacheOnly,
  });
  const btcCoinbaseCacheKey = getKlineCacheKey({
    userName,
    connectorName: btcCoinbaseConnectorName,
    symbol: 'BTCUSDT',
    end,
    interval,
    cacheOnly,
  });
  const cachedBtcBinanceData =
    state.btcBinanceKlineCache.get(btcBinanceCacheKey);
  const cachedBtcCoinbaseData =
    state.btcCoinbaseKlineCache.get(btcCoinbaseCacheKey);
  const preparedDataCacheKey = getPreparedDataCacheKey({
    userName,
    connectorName,
    symbol,
    start,
    end,
    interval,
    btcBinanceConnectorName,
    btcCoinbaseConnectorName,
  });

  let preparedData = state.preparedDataCache.get(preparedDataCacheKey);

  if (!preparedData) {
    const [data, btcData, btcBinanceData, btcCoinbaseData] = await withTimeout(
      'kline preload',
      Promise.all([
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
        cachedBtcData
          ? Promise.resolve(cachedBtcData)
          : connector.kline({
              symbol: 'BTCUSDT',
              start: preloadStart,
              end,
              interval,
              silent: true,
              cacheOnly,
            }),
        cachedBtcBinanceData
          ? Promise.resolve(cachedBtcBinanceData)
          : (binanceConnector ?? connector).kline({
              symbol: 'BTCUSDT',
              start: preloadStart,
              end,
              interval,
              silent: true,
              cacheOnly,
            }),
        cachedBtcCoinbaseData
          ? Promise.resolve(cachedBtcCoinbaseData)
          : (coinbaseConnector ?? connector).kline({
              symbol: 'BTCUSDT',
              start: preloadStart,
              end,
              interval,
              silent: true,
              cacheOnly,
            }),
      ]),
    );

    if (!cachedCoinData) {
      state.coinKlineCache.set(coinCacheKey, data);
    }
    if (!cachedBtcData) {
      state.btcKlineCache.set(btcCacheKey, btcData);
    }
    if (!cachedBtcBinanceData) {
      state.btcBinanceKlineCache.set(btcBinanceCacheKey, btcBinanceData);
    }
    if (!cachedBtcCoinbaseData) {
      state.btcCoinbaseKlineCache.set(btcCoinbaseCacheKey, btcCoinbaseData);
    }

    const { prevData: prevDataRaw, testData: testDataRaw } =
      splitCandlesForTesting(data, start);
    const { prevData: btcPrevDataRaw, testData: btcTestDataRaw } =
      splitCandlesForTesting(btcData, start);
    const { prevData: btcBinancePrevDataRaw } = splitCandlesForTesting(
      btcBinanceData,
      start,
    );
    const { prevData: btcCoinbasePrevDataRaw } = splitCandlesForTesting(
      btcCoinbaseData,
      start,
    );

    const { alignedCoinCandles: prevData, alignedBtcCandles: btcPrevData } =
      alignSortedCandlesByTimestamp(prevDataRaw, btcPrevDataRaw);
    const { alignedCoinCandles: testData, alignedBtcCandles: btcTestData } =
      alignSortedCandlesByTimestamp(testDataRaw, btcTestDataRaw);
    const { alignedBtcCandles: btcBinancePrevData } =
      alignSortedCandlesByTimestamp(prevDataRaw, btcBinancePrevDataRaw);
    const { alignedBtcCandles: btcCoinbasePrevData } =
      alignSortedCandlesByTimestamp(prevDataRaw, btcCoinbasePrevDataRaw);

    preparedData = {
      prevData,
      btcPrevData,
      testData,
      btcTestData,
      btcBinancePrevData,
      btcCoinbasePrevData,
    };
    state.preparedDataCache.set(preparedDataCacheKey, preparedData);
  }

  if (!preparedData) {
    throw new Error('Prepared backtest data not available');
  }

  const {
    prevData,
    btcPrevData,
    testData,
    btcTestData,
    btcBinancePrevData,
    btcCoinbasePrevData,
  } = preparedData;

  const testConnector = createTestConnector(connector, {
    userName,
    mlEnabled: ml,
    aiEnabled: ai,
  });

  const strategy = await withTimeout(
    'strategy init',
    strategyCreator({
      userName,
      config: strategyConfig,
      symbol,
      data: prevData,
      btcData: btcPrevData,
      btcBinanceData: btcBinancePrevData,
      btcCoinbaseData: btcCoinbasePrevData,
      connector: testConnector,
    }),
  );

  const pendingMlPayloadBySignalId = new Map<
    string,
    ReturnType<typeof buildMlPayload>
  >();
  const pendingAiRowBySignalId = new Map<
    string,
    Omit<AiDatasetRow, 'profit'>
  >();

  const flushClosedResultsBatch = async () => {
    if (!ml && !ai) return;
    const batch = await testConnector.drainMlResultsBatch();
    if (!batch.length) return;

    for (const resultRecord of batch) {
      const payload = pendingMlPayloadBySignalId.get(resultRecord.signalId);
      if (payload) {
        pendingMlPayloadBySignalId.delete(resultRecord.signalId);

        const fullRow = buildMlTrainingRow(payload, {
          profit: resultRecord.profit,
        });
        const row = trimMlTrainingRowWindows(fullRow, 5);
        await appendMlDatasetRow({
          strategyName,
          chunkId,
          row,
        });
      }

      const aiRowBase = pendingAiRowBySignalId.get(resultRecord.signalId);
      if (aiRowBase) {
        pendingAiRowBySignalId.delete(resultRecord.signalId);
        await appendAiDatasetRow({
          strategyName,
          chunkId,
          row: {
            ...aiRowBase,
            profit: resultRecord.profit,
          },
        });
      }
    }
  };

  for (let candleIndex = 0; candleIndex < testData.length; candleIndex++) {
    if (candleIndex % 25 === 0) {
      throwIfTimedOut('candle loop');
    }

    const candle = testData[candleIndex];
    const btcCandle = btcTestData[candleIndex];

    // Process exits on the current candle first. Any position opened below
    // can only be closed starting from the next candle to avoid same-bar lookahead.
    await withTimeout('stop-loss check', testConnector.checkSl(candle));
    await withTimeout('take-profit check', testConnector.checkTp(candle));

    const signal = await withTimeout(
      'strategy signal',
      strategy(candle, btcCandle),
    );
    if (ml && signal && typeof signal !== 'string' && signal.signalId) {
      const payload = buildMlPayload({
        signal,
        context: {
          userName,
          testId,
          testSuiteId,
          testName: name,
          symbol,
          strategyName,
          strategyConfig,
          connectorName,
        },
      });
      pendingMlPayloadBySignalId.set(signal.signalId, payload);
    }
    if (ai && signal && typeof signal !== 'string' && signal.signalId) {
      pendingAiRowBySignalId.set(signal.signalId, {
        signalId: signal.signalId,
        strategyName: signal.strategy || strategyName,
        symbol: signal.symbol || symbol,
        direction: signal.direction,
        timestamp: signal.timestamp,
        payload: buildAiPayload(signal as Signal),
        testId,
        testSuiteId,
        testName: name,
        connectorName,
      });
    }
  }

  await withTimeout('flush closed results', flushClosedResultsBatch());

  return await withTimeout('collect result', testConnector.getResult());
};
