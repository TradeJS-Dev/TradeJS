import { strategies, StrategyNames } from '@src/strategy';
import { connectors, ConnectorNames } from '@src/connectors';
import { ConnectorCreator, TestingBox } from '@types';
import { PRELOAD_DAYS } from '@constants';
import { getTimestamp } from '@utils/timestamp';

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

  const connector = (
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

  const prevData = data.filter(
    (candle) => candle.timestamp >= preloadStart && candle.timestamp < start,
  );
  const btcPrevData = btcData.filter(
    (candle) => candle.timestamp >= preloadStart && candle.timestamp < start,
  );
  const testData = data.filter((candle) => candle.timestamp >= start);
  const btcTestData = btcData.filter((candle) => candle.timestamp >= start);

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
