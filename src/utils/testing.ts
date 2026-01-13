import { strategies, StrategyNames } from '@src/strategy';
import { connectors, ConnectorNames } from '@src/connectors';
import { Candle, ConnectorCreator, TestingBox } from '@types';
import { PRELOAD_DAYS } from '@constants';
import { getTimestamp } from '@utils/timestamp';
import { alignSortedCandlesByTimestamp } from '@utils/correlation';

const preloadStart = getTimestamp(PRELOAD_DAYS);

export const testing: TestingBox = async ({
  userName,
  symbol,
  options: { start, end },
  strategyName,
  strategyConfig,
  connectorName,
}) => {
  if (!start) {
    throw new Error('no start');
  }

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

  const testConnector = connectors.Test(connector);

  const strategy = strategyCreator({
    config: strategyConfig,
    symbol,
    data: prevData,
    btcData: btcPrevData,
    connector: testConnector,
  });

  for (let candleIndex = 0; candleIndex < testData.length; candleIndex++) {
    await strategy(testData[candleIndex], btcTestData[candleIndex]);
    testConnector.checkSl(testData[candleIndex]);
    testConnector.checkTp(testData[candleIndex]);
  }

  return await testConnector.getResult();
};
