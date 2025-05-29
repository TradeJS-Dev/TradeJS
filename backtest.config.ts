import _ from 'lodash';
import * as strategies from '@src/strategy';
import { ByBitConnectorCreator } from '@src/connectors/ByBit';
import { getTimestamp } from '@utils/timestamp';
import { getTopTickers } from '@utils/tickers';
import { generateParamGrid, generateName } from '@utils/grid';
import { TestConfig } from '@types';

const start = getTimestamp(180);
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
  const tickers = _.uniq(['DOGSUSDT']);
  const paramGrid = generateParamGrid({
    MA_FAST: [12, 14, 16],
    MA_SLOW: [80, 85, 90],
    ATR_PERIOD: [15, 16],
    ATR_OPEN: [0.5, 0.6],
    ATR_CLOSE: [1.2, 1.3],
    BB_PERIOD: [13],
    BB_STDDEV: [2],
    OBV_SMA_PERIOD: [70, 75, 80],
    BREAKOUT_LOOKBACK: [15, 20, 25],
    SL_LONG: [0.08, 0.1],
    SL_SHORT: [0.08, 0.1],
    TP_LONG: [
      [
        { profit: 0.1, rate: 0.5 },
        { profit: 0.2, rate: 0.5 },
      ],
      [
        { profit: 0.2, rate: 0.5 },
        { profit: 0.4, rate: 0.5 },
      ],
    ],
    TP_SHORT: [
      [
        { profit: 0.03, rate: 0.25 },
        { profit: 0.07, rate: 0.25 },
        { profit: 0.1, rate: 0.25 },
        { profit: 0.15, rate: 0.25 },
      ],
      [
        { profit: 0.06, rate: 0.25 },
        { profit: 0.1, rate: 0.25 },
        { profit: 0.15, rate: 0.25 },
        { profit: 0.2, rate: 0.25 },
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
