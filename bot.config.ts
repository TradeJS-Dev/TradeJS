import { StrategyNames } from '@src/strategy';
import { ConnectorNames } from '@src/connectors';
import { BotConfig } from '@types';

const botConfig: BotConfig = [
  {
    symbol: 'DOGSUSDT',
    disabled: true,
    strategyName: StrategyNames.BreakoutWeights,
    strategyConfig: {
      LIMIT: 100,
      MA_FAST: 14,
      MA_SLOW: 85,
      ATR_PERIOD: 15,
      ATR_OPEN: 0.6,
      ATR_CLOSE: 1.3,
      BB_PERIOD: 13,
      BB_STDDEV: 2,
      OBV_SMA_PERIOD: 75,
      BREAKOUT_LOOKBACK: 20,
      SL_LONG: 0.05,
      SL_SHORT: 0.08,
      TP_LONG: [
        {
          profit: 0.2,
          rate: 0.5,
        },
        {
          profit: 0.4,
          rate: 0.5,
        },
      ],
      TP_SHORT: [
        {
          profit: 0.03,
          rate: 0.25,
        },
        {
          profit: 0.07,
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
      ],
    },
    connectorName: ConnectorNames.ByBit,
  },
  {
    symbol: 'DEGENUSDT',
    disabled: true,
    strategyName: StrategyNames.BreakoutWeights,
    strategyConfig: {
      LIMIT: 100,
      MA_FAST: 16,
      MA_SLOW: 90,
      ATR_PERIOD: 15,
      ATR_OPEN: 0.6,
      ATR_CLOSE: 1.2,
      BB_PERIOD: 13,
      BB_STDDEV: 2,
      OBV_SMA_PERIOD: 70,
      BREAKOUT_LOOKBACK: 20,
      SL_LONG: 0.08,
      SL_SHORT: 0.08,
      TP_LONG: [
        {
          profit: 0.2,
          rate: 0.5,
        },
        {
          profit: 0.4,
          rate: 0.5,
        },
      ],
      TP_SHORT: [
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
    },
    connectorName: ConnectorNames.ByBit,
  },
];

export default botConfig;
