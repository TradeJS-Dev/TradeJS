import { strategies, StrategyNames } from '@src/strategy';
import { connectors, ConnectorNames } from '@src/connectors';
import { Candle, ConnectorCreator, TestingBox } from '@types';
import { ML_BASE_CANDLES_WINDOW, PRELOAD_DAYS } from '@constants';
import { getTimestamp } from '@utils/timestamp';
import { alignSortedCandlesByTimestamp } from '@utils/correlation';
import { buildMlPayload } from '@utils/mlPayload';
import {
  buildMlTrainingRow,
  trimMlTrainingRowWindows,
} from '@utils/mlTrainingTransform';
import { appendMlDatasetRow } from '@utils/mlDatasetFile';

const preloadStart = getTimestamp(PRELOAD_DAYS);
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

  const data = await connector.kline({
    symbol,
    start: preloadStart,
    end,
    interval: '15',
    silent: true,
    cacheOnly: true,
  });

  const btcData = await connector.kline({
    symbol: 'BTCUSDT',
    start: preloadStart,
    end,
    interval: '15',
    silent: true,
    cacheOnly: true,
  });

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

  const candlesHistory = [...prevData];
  const btcCandlesHistory = [...btcPrevData];

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

    candlesHistory.push(candle);
    btcCandlesHistory.push(btcCandle);

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
        candles: candlesHistory.slice(-ML_BASE_CANDLES_WINDOW),
        btcCandles: btcCandlesHistory.slice(-ML_BASE_CANDLES_WINDOW),
      });
      if (signal.signalId) {
        pendingMlPayloadBySignalId.set(signal.signalId, payload);
      }
    }
  }

  await flushMlResultsBatch();

  return await testConnector.getResult();
};
