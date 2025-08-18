import _ from 'lodash';
import { StrategyNames } from '@src/strategy';
import { ConnectorNames } from '@src/connectors';
import { BacktestConfig } from '@types';

export const backtestConfig: BacktestConfig = {
  connectorName: ConnectorNames.ByBit,
  strategyName: StrategyNames.Breakout,
  strategyConfig: {
    LIMIT: [100],
    MA_FAST: [15, 20, 25],
    MA_SLOW: [90, 100, 120, 140],
    ATR_PERIOD: [8, 10, 15],
    ATR_OPEN: [0.5, 0.7, 0.9],
    ATR_CLOSE: [1.5, 1.7, 2],
    BB_PERIOD: [6, 8, 10],
    BB_STDDEV: [1.9, 2.1],
    OBV_SMA_PERIOD: [80, 90, 100],
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
      [
        {
          profit: 0.4,
          rate: 0.5,
        },
        {
          profit: 0.6,
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
  },
};
