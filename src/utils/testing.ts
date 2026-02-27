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
const btcBinanceKlineCache = new Map<string, KlineChartData>();
const btcCoinbaseKlineCache = new Map<string, KlineChartData>();

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
  btcBinanceKlineCache.clear();
  btcCoinbaseKlineCache.clear();
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
  const binanceCreator = connectors[ConnectorNames.Binance];
  const coinbaseCreator = connectors[ConnectorNames.Coinbase];
  if (!binanceCreator || !coinbaseCreator) {
    throw new Error('Binance/Coinbase connectors are required for BTC spread');
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

  const cachedCoinData = coinKlineCache.get(coinCacheKey);
  const cachedBtcData = btcKlineCache.get(btcCacheKey);
  const btcBinanceCacheKey = getKlineCacheKey({
    userName,
    connectorName: ConnectorNames.Binance,
    symbol: 'BTCUSDT',
    end,
    interval,
    cacheOnly,
  });
  const btcCoinbaseCacheKey = getKlineCacheKey({
    userName,
    connectorName: ConnectorNames.Coinbase,
    symbol: 'BTCUSDT',
    end,
    interval,
    cacheOnly,
  });
  const cachedBtcBinanceData = btcBinanceKlineCache.get(btcBinanceCacheKey);
  const cachedBtcCoinbaseData = btcCoinbaseKlineCache.get(btcCoinbaseCacheKey);

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
      : binanceCreator({ userName }).then((binanceConnector) =>
          binanceConnector.kline({
            symbol: 'BTCUSDT',
            start: preloadStart,
            end,
            interval,
            silent: true,
            cacheOnly,
          }),
        ),
    cachedBtcCoinbaseData
      ? Promise.resolve(cachedBtcCoinbaseData)
      : coinbaseCreator({ userName }).then((coinbaseConnector) =>
          coinbaseConnector.kline({
            symbol: 'BTCUSDT',
            start: preloadStart,
            end,
            interval,
            silent: true,
            cacheOnly,
          }),
        ),
  ]);

  if (!cachedCoinData) {
    coinKlineCache.set(coinCacheKey, data);
  }
  if (!cachedBtcData) {
    btcKlineCache.set(btcCacheKey, btcData);
  }
  if (!cachedBtcBinanceData) {
    btcBinanceKlineCache.set(btcBinanceCacheKey, btcBinanceData);
  }
  if (!cachedBtcCoinbaseData) {
    btcCoinbaseKlineCache.set(btcCoinbaseCacheKey, btcCoinbaseData);
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
    btcBinanceData: btcBinancePrevData,
    btcCoinbaseData: btcCoinbasePrevData,
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
  }

  await flushMlResultsBatch();

  return await testConnector.getResult();
};
