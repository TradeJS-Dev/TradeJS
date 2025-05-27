import _ from 'lodash';
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
  return tickers.map(({ value }) => value);
};

const createConfig = async (): Promise<TestConfig> => {
  const volatilityTicers = await scanner();
  const tickers = _.uniq([...volatilityTicers]);
  const paramGrid = generateParamGrid({
    MA_FAST: [30],
    MA_SLOW: [ 110 ],
    Sl: [0.05, 0.07],
    ATR_PERIOD: [14],
    ATR_OPEN: [0.7, 0.9],
    ATR_CLOSE: [2, 2.5],
    BB_PERIOD: [14, 15, 16],
    BB_STDDEV: [2],
    TP_LONG: [
      [
        { profit: 0.2, rate: 0.5 },
        { profit: 0.4, rate: 0.5 },
      ],
    ],
    TP_SHORT: [
      [
        { profit: 0.05, rate: 0.3 },
        { profit: 0.1, rate: 0.3 },
        { profit: 0.2, rate: 0.3 },
      ],
    ],
  });

  return tickers.flatMap((symbol) =>
    paramGrid.map((params) => ({
      name: generateName('rev'),
      symbol,
      options: { start, end },
      strategyCreator: strategies.BreakoutStrategyCreator,
      strategyConfig: params,
      connector: byBitConnector,
    })),
  );
};

export default createConfig;
