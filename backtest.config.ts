import _ from 'lodash';
import { StrategyNames } from '@src/strategy';
import { ConnectorNames, connectors } from '@src/connectors';
import { getTimestamp } from '@utils/timestamp';
import { getTopTickers } from '@utils/tickers';
import { generateParamGrid, generateName } from '@utils/grid';
import { uuid } from '@utils/uuid';
import { TestConfig } from '@types';

const start = getTimestamp(180);
const end = getTimestamp();
const TICKERS_LIMIT = 10;
const LIST = ['DOGSUSDT'];
const EXCLUDE_TICKERS = ['DOGSUSDT'];

const byBitConnector = connectors.bybit({
  key: '',
  secret: '',
});

export const scanner = async () => {
  const data = await byBitConnector.getTickers();

  const tickers = getTopTickers(data, TICKERS_LIMIT);
  return tickers.map(({ value }) => value);
};

const createConfig = async (): Promise<TestConfig> => {
  const testId = uuid(6);
  const volatilityTicers = await scanner();
  const tickers = _.uniq([...volatilityTicers, ...LIST]).filter(
    (ticker) => !EXCLUDE_TICKERS.includes(ticker),
  );
  const paramGrid = generateParamGrid({
    LIMIT: [100],
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
      name: generateName(testId),
      symbol,
      options: { start, end },
      strategyName: StrategyNames.breakout,
      strategyConfig: params,
      connectorName: ConnectorNames.bybit,
    })),
  );
};

export default createConfig;
