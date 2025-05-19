import { BreakoutStrategyCreator, config } from '@src/strategy/Breakout';
import { ByBitConnectorCreator } from '@src/connectors/ByBit';
import { getTimestamp } from '@utils/timestamp';
import { getTopTickers } from '@utils/tickers';
import { TestConfig } from '@types';

const TICKERS_LIMIT = 10;
const start = getTimestamp(30);
const end = getTimestamp();

const byBitConnector = ByBitConnectorCreator({
  key: '',
  secret: '',
});

export const scanner = async () => {
  const data = await byBitConnector.getTickers();

  return await getTopTickers(data, TICKERS_LIMIT);
};

const createConfig = async (): Promise<TestConfig> => {
  const tickers = await scanner();

  return tickers.map(({ value }) => ({
    name: 'breakout',
    symbol: value,
    strategy: BreakoutStrategyCreator,
    strategyConfig: {
      ...config,
    },
    options: {
      start,
      end,
    },
    connector: byBitConnector,
  }));
};

export default createConfig;
