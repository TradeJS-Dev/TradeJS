import { strategies, StrategyNames } from '@src/strategy';
import { connectors, ConnectorNames } from '@src/connectors';
import { ConnectorCreator, TestingBox } from '@types';
import { PRELOAD_DAYS } from '@constants';
import { getTimestamp } from '@utils/timestamp';

const preloadStart = getTimestamp(PRELOAD_DAYS);

export const testing: TestingBox = async ({
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
    userName: 'root',
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

  const prevData = data.filter(
    (candle) => candle.timestamp >= preloadStart && candle.timestamp < start,
  );
  const testData = data.filter((candle) => candle.timestamp >= start);

  const strategy = strategyCreator(strategyConfig, prevData);
  const testConnector = connectors.Test(connector);

  for await (const candle of testData) {
    await strategy(symbol, candle, testConnector);
    testConnector.checkSl(candle);
    testConnector.checkTp(candle);
  }

  return await testConnector.getResult();
};
