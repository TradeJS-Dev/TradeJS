import * as strategies from '@src/strategy';
import { ByBitConnectorCreator } from '@src/connectors/ByBit';
import { getTimestamp } from '@utils/timestamp';
import { getTopTickers } from '@utils/tickers';
import { generateParamGrid, generateName } from '@utils/grid';
import { TestConfig } from '@types';

const start = getTimestamp(60);
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
  const tickers = ['DOGSUSDT'];
  const paramGrid = generateParamGrid({
    MA_FAST: [20, 50],
    MA_SLOW: [100, 150],
    Sl: [0.1, 0.2],
  });

  return tickers.flatMap(symbol =>
    paramGrid.map(params => ({
      name: generateName('rev', params),
      symbol,
      options: { start, end },
      strategyCreator: strategies.BreakoutStrategyCreator,
      strategyConfig: params,
      connector: byBitConnector,
    }))
  );
};

export default createConfig;
