import { Interval, TrendLineOptions } from '@types';

export const TRENDLINE = 'TRENDLINE';

export const config = {
  ENV: 'development',
  INTERVAL: '15' as Interval,
  MAKE_ORDERS: true,
  MAX_LOSS_VALUE: 1,
  MAX_CORRELATION: 0.45,
  TRENDLINE_CONFIG: {
    minTouches: 4,
    offset: 3,
  } as Partial<TrendLineOptions>,
  HIGHS_CONFIG: {
    [TRENDLINE]: {
      enable: false,
      direction: 'LONG',
      TP: 4.4,
      SL: 1.6,
      minRiskRatio: 2,
    },
  },
  LOWS_CONFIG: {
    [TRENDLINE]: {
      enable: true,
      direction: 'LONG',
      TP: 2.9,
      SL: 0.95,
      minRiskRatio: 2,
    },
  },
} as const;
