import { TestingBox } from '@types';
import { TestConnectorCreator } from '@src/connectors/Test';
import { getTimestamp } from '@utils/timestamp';

const preloadStart = getTimestamp(120);

const uploadedCoins = new Array<string>();

export const testing: TestingBox = async (
  symbol,
  { start, end },
  strategyCreator,
  strategyConfig,
  connector,
) => {
  if (!start) {
    throw new Error('no start');
  }

  const data = await connector.kline({
    symbol,
    start: preloadStart,
    end,
    interval: '15',
    silent: false,
    cacheOnly: uploadedCoins.includes(symbol),
  });

  uploadedCoins.push(symbol);

  const prevData = data.filter((candle) => candle.timestamp < start);
  const testData = data.filter((candle) => candle.timestamp >= start);

  const strategy = strategyCreator(strategyConfig, prevData);
  const testConnector = TestConnectorCreator(connector);

  for await (const candle of testData) {
    await strategy(symbol, candle, testConnector);
    testConnector.checkSl(candle);
    testConnector.checkTp(candle);
  }

  return testConnector.getStat();
};
