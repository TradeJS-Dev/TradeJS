import { BotConfig } from '@types';

const botConfig: BotConfig = [
  {
    symbol: 'DOGSUSDT',
    strategyName: 'Breakout',
    strategyConfig: {
      LIMIT: 100,
      MA_FAST: 10,
      MA_SLOW: 80,
      ATR_PERIOD: 10,
      ATR_OPEN: 0.7,
      ATR_CLOSE: 1,
      BB_PERIOD: 10,
      BB_STDDEV: 1.7,
      OBV_SMA_PERIOD: 80,
      BREAKOUT_LOOKBACK: 15,
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
    connectorName: 'ByBit',
    disabled: false,
  },
];

export default botConfig;
