import { Interval } from '@types';

export const TRENDLINE = 'TRENDLINE';

export const config = {
  env: 'development',
  interval: '15' as Interval,
  minTouches: 4,
  offset: 3,
  makeOrders: true,
  MAX_LOSS_VALUE: 1,
  MAX_CORRELATION: 0.45,
  STRATEGY_CONFIG: {
    highs: {
      [TRENDLINE]: {
        enable: false,
        direction: 'LONG',
        TP: 4.4,
        SL: 1.6,
        minRiskRatio: 2,
      },
    },
    lows: {
      [TRENDLINE]: {
        enable: true,
        direction: 'LONG',
        TP: 2.9,
        SL: 0.9,
        minRiskRatio: 2,
      },
    },
  },
} as const;
