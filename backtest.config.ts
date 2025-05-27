import * as strategies from '@src/strategy';
import { ByBitConnectorCreator } from '@src/connectors/ByBit';
import { getTimestamp } from '@utils/timestamp';
import { getTopTickers } from '@utils/tickers';
import { generateParamGrid, generateName } from '@utils/grid';
import { TestConfig } from '@types';

const start = getTimestamp(90);
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
  // const tickers = await scanner();
  const tickers = ['DOGSUSDT'];
  const paramGrid = generateParamGrid({
    MA_FAST: [28, 29, 30, 31, 32],
    MA_SLOW: [ 106, 107, 108, 109, 110 ],
    Sl: [0.04, 0.05, 0.06],
    ATR_PERIOD: [14],
    ATR_OPEN: [0.7],
    ATR_CLOSE: [2],
    BB_PERIOD: [15],
    BB_STDDEV: [2],
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
        { profit: 0.04, rate: 0.5 },
        { profit: 0.08, rate: 0.5 },
      ],
      [
        { profit: 0.05, rate: 0.5 },
        { profit: 0.1, rate: 0.5 },
      ],
      [
        { profit: 0.1, rate: 0.5 },
        { profit: 0.2, rate: 0.5 },
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
