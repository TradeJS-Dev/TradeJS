import { Interval } from '@types';

export const config = {
  INTERVAL: '15' as Interval,
  ATR_PERIOD: 14,
  BB_PERIOD: 20,
  BB_STDDEV: 2,
  MIN_OBV_SLOPE: 0,
  MA_FAST: 49,
  MA_SLOW: 99,
  LIMIT: 100,
  ATR_OPEN: 0.5,
  ATR_CLOSE: 1.5,
  TP_LONG: [
    { profit: 0.1, rate: 0.25 },
    { profit: 0.2, rate: 0.5 },
  ],
  TP_SHORT: [
    { profit: 0.05, rate: 0.25 },
    { profit: 0.1, rate: 0.5 },
  ],
  Sl: 0.1,
};
