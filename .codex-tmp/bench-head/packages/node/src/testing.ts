import {
  AiDatasetRow,
  Candle,
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
};

const createTestingKlineCacheState = (): TestingKlineCacheState => ({
  coinKlineCache: new Map<string, KlineChartData>(),
  btcKlineCache: new Map<string, KlineChartData>(),
  btcBinanceKlineCache: new Map<string, KlineChartData>(),
  btcCoinbaseKlineCache: new Map<string, KlineChartData>(),
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
}) => {
  if (!start) {
    throw new Error('no start');
  }
  // TODO: Add explicit end validation (and consistent error handling) similar to start validation.

  const { projectRoot, state } = getTestingKlineCacheState();

  const connectorCreator = await getConnectorCreatorByName(
    connectorName,
    projectRoot,
  );
  if (!connectorCreator) {
    throw new Error(`Unknown connector: ${connectorName}`);
  }
  const connector = await (connectorCreator as ConnectorCreator)({
    userName,
  });
  const strategyCreator = await getStrategyCreator(strategyName, projectRoot);
  if (!strategyCreator) {
    throw new Error(`Unknown strategy: ${strategyName}`);
  }
  const binanceCreator = await getConnectorCreatorByName(
    BUILTIN_CONNECTOR_NAMES.Binance,
    projectRoot,
  );
  const coinbaseCreator = await getConnectorCreatorByName(
    BUILTIN_CONNECTOR_NAMES.Coinbase,
    projectRoot,
  );
  if (!binanceCreator || !coinbaseCreator) {
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

  const cachedCoinData = state.coinKlineCache.get(coinCacheKey);
  const cachedBtcData = state.btcKlineCache.get(btcCacheKey);
  const btcBinanceCacheKey = getKlineCacheKey({
    userName,
    connectorName: binanceCreator
      ? BUILTIN_CONNECTOR_NAMES.Binance
      : connectorName,
    symbol: 'BTCUSDT',
    end,
    interval,
    cacheOnly,
  });
  const btcCoinbaseCacheKey = getKlineCacheKey({
    userName,
    connectorName: coinbaseCreator
      ? BUILTIN_CONNECTOR_NAMES.Coinbase
      : connectorName,
    symbol: 'BTCUSDT',
    end,
    interval,
    cacheOnly,
  });
  const cachedBtcBinanceData =
    state.btcBinanceKlineCache.get(btcBinanceCacheKey);
  const cachedBtcCoinbaseData =
    state.btcCoinbaseKlineCache.get(btcCoinbaseCacheKey);

  const [data, btcData, btcBinanceData, btcCoinbaseData] = await Promise.all([
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
      : binanceCreator
        ? binanceCreator({ userName }).then((binanceConnector) =>
            binanceConnector.kline({
              symbol: 'BTCUSDT',
              start: preloadStart,
              end,
              interval,
              silent: true,
              cacheOnly,
            }),
          )
        : connector.kline({
            symbol: 'BTCUSDT',
            start: preloadStart,
            end,
            interval,
            silent: true,
            cacheOnly,
          }),
    cachedBtcCoinbaseData
      ? Promise.resolve(cachedBtcCoinbaseData)
      : coinbaseCreator
        ? coinbaseCreator({ userName }).then((coinbaseConnector) =>
            coinbaseConnector.kline({
              symbol: 'BTCUSDT',
              start: preloadStart,
              end,
              interval,
              silent: true,
              cacheOnly,
            }),
          )
        : connector.kline({
            symbol: 'BTCUSDT',
            start: preloadStart,
            end,
            interval,
            silent: true,
            cacheOnly,
          }),
  ]);

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

  const prevDataRaw = data.filter(
    (candle: Candle) =>
      candle.timestamp >= preloadStart && candle.timestamp < start,
  );
  const btcPrevDataRaw = btcData.filter(
    (candle: Candle) =>
      candle.timestamp >= preloadStart && candle.timestamp < start,
  );
  const testDataRaw = data.filter(
    (candle: Candle) => candle.timestamp >= start,
  );
  const btcTestDataRaw = btcData.filter(
    (candle: Candle) => candle.timestamp >= start,
  );

  const { alignedCoinCandles: prevData, alignedBtcCandles: btcPrevData } =
    alignSortedCandlesByTimestamp(prevDataRaw, btcPrevDataRaw);
  const { alignedCoinCandles: testData, alignedBtcCandles: btcTestData } =
    alignSortedCandlesByTimestamp(testDataRaw, btcTestDataRaw);
  const { alignedBtcCandles: btcBinancePrevData } =
    alignSortedCandlesByTimestamp(
      prevDataRaw,
      btcBinanceData.filter(
        (candle: Candle) =>
          candle.timestamp >= preloadStart && candle.timestamp < start,
      ),
    );
  const { alignedBtcCandles: btcCoinbasePrevData } =
    alignSortedCandlesByTimestamp(
      prevDataRaw,
      btcCoinbaseData.filter(
        (candle: Candle) =>
          candle.timestamp >= preloadStart && candle.timestamp < start,
      ),
    );

  const testConnector = createTestConnector(connector, {
    userName,
    mlEnabled: ml,
    aiEnabled: ai,
  });

  const strategy = await strategyCreator({
    userName,
    config: strategyConfig,
    symbol,
    data: prevData,
    btcData: btcPrevData,
    btcBinanceData: btcBinancePrevData,
    btcCoinbaseData: btcCoinbasePrevData,
    connector: testConnector,
  });

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
    const candle = testData[candleIndex];
    const btcCandle = btcTestData[candleIndex];

    // Process exits on the current candle first. Any position opened below
    // can only be closed starting from the next candle to avoid same-bar lookahead.
    await testConnector.checkSl(candle);
    await testConnector.checkTp(candle);

    const signal = await strategy(candle, btcCandle);
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

  await flushClosedResultsBatch();

  return await testConnector.getResult();
};
