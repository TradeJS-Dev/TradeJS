import _ from 'lodash';
import { BACKTEST_DAYS } from '@constants';
import { StrategyNames } from '@src/strategy';
import { ConnectorNames, connectors } from '@src/connectors';
import { getTimestamp } from '@utils/timestamp';
import { getTopTickers } from '@utils/tickers';
import { generateParamGrid, generateName } from '@utils/grid';
import { uuid } from '@utils/uuid';
import { TestConfig } from '@types';

const start = getTimestamp(BACKTEST_DAYS);
const end = getTimestamp();
const TICKERS_LIMIT = 10;
const LIST = ['DOGSUSDT'];
const EXCLUDE_TICKERS = ['DOGSUSDT'];

const byBitConnector = connectors.ByBit({
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
  const volatilityTickers = await scanner();
  // const tickers = _.uniq([...volatilityTickers, ...LIST]).filter(
  //   (ticker) => !EXCLUDE_TICKERS.includes(ticker),
  // );
  const tickers = [...LIST];
  const paramGrid = generateParamGrid({
    LIMIT: [100],
    MA_FAST: [12, 16, 20],
    MA_SLOW: [80, 90, 100],
    ATR_PERIOD: [12, 15, 18],
    ATR_OPEN: [0.5, 0.6],
    ATR_CLOSE: [1, 1.2, 1.4],
    BB_PERIOD: [10, 13, 15],
    BB_STDDEV: [1.5, 2],
    OBV_SMA_PERIOD: [60, 70, 80],
    BREAKOUT_LOOKBACK: [10, 15, 20, 24],
    SL_LONG: [0.06, 0.08],
    SL_SHORT: [0.06, 0.08],
    TP_LONG: [
      [
        {
          profit: 0.2,
          rate: 0.5,
        },
        {
          profit: 0.4,
          rate: 0.5,
        },
      ],
    ],
    TP_SHORT: [
      [
        {
          profit: 0.06,
          rate: 0.25,
        },
        {
          profit: 0.1,
          rate: 0.25,
        },
        {
          profit: 0.15,
          rate: 0.25,
        },
        {
          profit: 0.2,
          rate: 0.25,
        },
      ],
    ],
  });

  return tickers.flatMap((symbol) =>
    paramGrid.map((params) => ({
      name: generateName(testId),
      symbol,
      options: { start, end },
      strategyName: StrategyNames.Breakout,
      strategyConfig: params,
      connectorName: ConnectorNames.ByBit,
    })),
  );
};

export default createConfig;
