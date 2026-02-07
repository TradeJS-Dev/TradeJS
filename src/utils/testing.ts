import { strategies, StrategyNames } from '@src/strategy';
import { connectors, ConnectorNames } from '@src/connectors';
import { Candle, ConnectorCreator, TestingBox } from '@types';
import { PRELOAD_DAYS, TTL_3M } from '@constants';
import { getTimestamp } from '@utils/timestamp';
import { alignSortedCandlesByTimestamp } from '@utils/correlation';
import { redisKeys, setData } from '@utils/redis';
import { buildMlPayload } from '@utils/mlPayload';

const preloadStart = getTimestamp(PRELOAD_DAYS);
const ML_CANDLES_WINDOW = 50;

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

  const testConnector = connectors.Test(connector, { userName });

  const strategy = await strategyCreator({
    userName,
    config: strategyConfig,
    symbol,
    data: prevData,
    btcData: btcPrevData,
    connector: testConnector,
  });

  for (let candleIndex = 0; candleIndex < testData.length; candleIndex++) {
    const candle = testData[candleIndex];
    const btcCandle = btcTestData[candleIndex];

    candlesHistory.push(candle);
    btcCandlesHistory.push(btcCandle);

    const signal = await strategy(candle, btcCandle);
    await testConnector.checkSl(candle);
    await testConnector.checkTp(candle);

    if (signal && typeof signal !== 'string') {
      await setData(
        redisKeys.mlSignal(strategyName, signal.signalId),
        buildMlPayload({
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
          candles: candlesHistory.slice(-ML_CANDLES_WINDOW),
          btcCandles: btcCandlesHistory.slice(-ML_CANDLES_WINDOW),
        }),
        {
          stringify: true,
          expire: TTL_3M,
        },
      );
    }
  }

  return await testConnector.getResult();
};
