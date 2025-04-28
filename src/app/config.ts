import { KlineIntervalV3 } from 'bybit-api';

export const config = {
  filters: {
    symbol: 'SEIUSDT',
    interval: '15' as KlineIntervalV3,
  },
  indicators: {
    vol: {
      enabled: true,
    },
    ma: {
      enabled: true,
      periods: [2, 50],
    },
    ema: {
      enabled: false,
      periods: [2, 30],
    },
    wma: {
      enabled: false,
      periods: [2, 40],
    },
  },
  backtest: {
    enabled: false,
    symbol: 'SEIUSDT',
    id: '1',
  },
};
