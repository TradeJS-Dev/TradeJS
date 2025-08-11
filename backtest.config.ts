import _ from 'lodash';
import { BACKTEST_DAYS } from '@constants';
import { StrategyNames } from '@src/strategy';
import { ConnectorNames, connectors } from '@src/connectors';
import { getTimestamp } from '@utils/timestamp';
import { getTopTickers } from '@utils/tickers';
import { generateParamGrid, generateName } from '@utils/grid';
import { uuid } from '@utils/uuid';
import { TestSuite } from '@types';

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

const createTestSuite = async (): Promise<TestSuite> => {
  const testSuiteId = uuid(6);
  const volatilityTickers = await scanner();
  // const tickers = _.uniq([...volatilityTickers, ...LIST]).filter(
  //   (ticker) => !EXCLUDE_TICKERS.includes(ticker),
  // );
  const tickers = [...LIST];
  const paramGrid = generateParamGrid({
    LIMIT: [100],
    MA_FAST: [10],
    MA_SLOW: [80],
    ATR_PERIOD: [9, 15],
    ATR_OPEN: [0.6],
    ATR_CLOSE: [1, 1.2],
    BB_PERIOD: [10, 11],
    BB_STDDEV: [1.3, 1.7],
    OBV_SMA_PERIOD: [75],
    BREAKOUT_LOOKBACK: [15, 20, 25],
    SL_LONG: [0.07],
    SL_SHORT: [0.07],
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
    paramGrid.map((params) => {
      const testId = uuid(6);
      return {
      name: `${symbol}_${testSuiteId}_${testId}`,
      testId,
      testSuiteId,
      symbol,
      options: { start, end },
      strategyName: StrategyNames.Breakout,
      strategyConfig: params,
      connectorName: ConnectorNames.ByBit,
      };
    }),
  );
};

export default createTestSuite;
