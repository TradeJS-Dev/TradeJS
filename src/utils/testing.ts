import { TestingBox } from '@types';
import { PRELOAD_DAYS } from '@constants';
import { connectors } from '@src/connectors';
import { getTimestamp } from '@utils/timestamp';

const preloadStart = getTimestamp(PRELOAD_DAYS);

export const testing: TestingBox = async ({
  symbol,
  options: { start, end },
  strategyCreator,
  strategyConfig,
  connector,
}) => {
  if (!start) {
    throw new Error('no start');
  }

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

  return testConnector.getResult();
};
