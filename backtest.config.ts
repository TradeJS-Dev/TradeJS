import { BreakoutStrategyCreator, config } from '@src/strategy/Breakout';
import { ByBitConnectorCreator } from '@src/connectors/ByBit';
import { getTimestamp } from '@utils/timestamp';
import { getTopTickers } from '@utils/tickers';
import { TestConfig } from '@types';

const start = getTimestamp(30);
const end = getTimestamp();
const TICKERS_LIMIT = 10;

const byBitConnector = ByBitConnectorCreator({
  key: '',
  secret: '',
});

export const scanner = async () => {
  const data = await byBitConnector.getTickers();

  const tickers = getTopTickers(data, TICKERS_LIMIT);
  return tickers.map(({value}) => (value));
};

const createConfig = async (): Promise<TestConfig> => {
  // const tickers = await scanner();
  const tickers = ['APTUSDT', 'SUIUSDT', 'HYPEUSDT'];

  return tickers.map((symbol) => ({
    name: 'breakout',
    symbol,
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
