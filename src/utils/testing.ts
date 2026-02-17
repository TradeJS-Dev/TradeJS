import { strategies, StrategyNames } from '@src/strategy';
import { connectors, ConnectorNames } from '@src/connectors';
import { Candle, ConnectorCreator, KlineChartData, TestingBox } from '@types';
import { PRELOAD_DAYS } from '@constants';
import { getTimestamp } from '@utils/timestamp';
import { alignSortedCandlesByTimestamp } from '@utils/correlation';
import { buildMlPayload } from '@utils/mlPayload';
import {
  buildMlTrainingRow,
  trimMlTrainingRowWindows,
} from '@utils/mlTrainingTransform';
import { appendMlDatasetRow } from '@utils/mlDatasetFile';

const preloadStart = getTimestamp(PRELOAD_DAYS);
const coinKlineCache = new Map<string, KlineChartData>();
const btcKlineCache = new Map<string, KlineChartData>();

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

export const resetTestingKlineCache = () => {
  coinKlineCache.clear();
  btcKlineCache.clear();
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
  chunkId = 'single',
}) => {
  if (!start) {
    throw new Error('no start');
  }
  // TODO: Add explicit end validation (and consistent error handling) similar to start validation.

  const connector = await (
    connectors[connectorName as ConnectorNames] as ConnectorCreator
  )({
    userName,
  });
  const strategyCreator = strategies[strategyName as StrategyNames];

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

  const cachedCoinData = coinKlineCache.get(coinCacheKey);
  const cachedBtcData = btcKlineCache.get(btcCacheKey);

  const [data, btcData] =
    cachedCoinData && cachedBtcData
      ? [cachedCoinData, cachedBtcData]
      : await Promise.all([
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
        ]);

  if (!cachedCoinData) {
    coinKlineCache.set(coinCacheKey, data);
  }
  if (!cachedBtcData) {
    btcKlineCache.set(btcCacheKey, btcData);
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

  const testConnector = connectors.Test(connector, {
    userName,
    mlEnabled: ml,
  });

  const strategy = await strategyCreator({
    userName,
    config: strategyConfig,
    symbol,
    data: prevData,
    btcData: btcPrevData,
    connector: testConnector,
  });

  const pendingMlPayloadBySignalId = new Map<
    string,
    ReturnType<typeof buildMlPayload>
  >();

  const flushMlResultsBatch = async () => {
    if (!ml) return;
    const batch = await testConnector.drainMlResultsBatch();
    if (!batch.length) return;

    for (const resultRecord of batch) {
      const payload = pendingMlPayloadBySignalId.get(resultRecord.signalId);
      if (!payload) continue;
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
  };

  for (let candleIndex = 0; candleIndex < testData.length; candleIndex++) {
    const candle = testData[candleIndex];
    const btcCandle = btcTestData[candleIndex];

    const signal = await strategy(candle, btcCandle);
    await testConnector.checkSl(candle);
    await testConnector.checkTp(candle);
    await flushMlResultsBatch();

    if (ml && signal && typeof signal !== 'string') {
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
      if (signal.signalId) {
        pendingMlPayloadBySignalId.set(signal.signalId, payload);
      }
    }
  }

  await flushMlResultsBatch();

  return await testConnector.getResult();
};
