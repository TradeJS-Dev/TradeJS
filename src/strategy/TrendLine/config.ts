import { Interval, TrendLineOptions } from '@types';

export const config = {
  ENV: 'development',
  INTERVAL: '15' as Interval,
  MAKE_ORDERS: true,
  MAX_LOSS_VALUE: 1,
  MAX_CORRELATION: 0.45,
  TRENDLINE: {
    minTouches: 4,
    offset: 3,
  } as Partial<TrendLineOptions>,
  HIGHS: {
    enable: false,
    direction: 'LONG',
    TP: 4.4,
    SL: 1.6,
    minRiskRatio: 2,
  },
  LOWS: {
    enable: true,
    direction: 'LONG',
    TP: 2.9,
    SL: 0.95,
    minRiskRatio: 2,
  },
} as const;
