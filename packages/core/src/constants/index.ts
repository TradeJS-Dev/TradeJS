import type { TestThresholds } from '@tradejs/types';

export const FEE_PERCENT = 0.002;
export const BACKTEST_BASE_SLIPPAGE_BPS = 40;
export const BACKTEST_SPREAD_SLIPPAGE_MULTIPLIER = 1;
export const BACKTEST_MARKET_IMPACT_BPS = 0;
export const INITIAL_BACKTEST_AMOUNT = 100;

export const CORRELATION_WINDOW = 50;
export const SPREAD_WINDOW = 50;

export const PRELOAD_DAYS = 200;
export const SIGNALS_PRELOAD_DAYS = 60;
export const SIGNALS_CLI_PRELOAD_DAYS = 60;
export const BACKTEST_DEFAULT_DAYS = 160;
export const BACKTEST_PRELOAD_DAYS = 60;
export const DASHBOARD_PRELOAD_DAYS = 160;
export const BOT_PRELOAD_DAYS = 160;
export const PRELOAD_FALLBACK_DAYS = 160;

export const TTL_1H = 3_600;
export const TTL_3H = 10_800;
export const TTL_12H = 43_300;
export const TTL_1D = 86_400;
export const TTL_3D = 259_200;
export const TTL_10D = 864_000;
export const TTL_1M = 2_600_000;
export const TTL_3M = 7_800_000;

export const TESTS_TOP_LIMIT = 50;
export const TESTS_LIMIT = 100_000;
export const TESTS_ORDERS_MIN_LIMIT = 3;

export const MARKET_CATEGORY = 'linear';
export const ML_CANDLE_FEATURE_WINDOW = 50;
export const ML_BASE_CANDLES_WINDOW = 50;
export const DERIVATIVES_CONTEXT_REFERENCE_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
] as const;

export const TRENDLINE_DEFAULTS = {
  maxLines: 20,
  range: 15,
  firstRange: 80,
  epsilon: 0.003,
  epsilonOffset: 0.005,
  minTouches: 4,
  minDistance: 50,
  minTouchGap: 15,
  maxTouchGap: 60,
  offset: 1000,
  capture: false,
  bestLines: 4,
  maxDistance: 2000,
};

// Мини-подсказка по порогам (thresholds):
// - Для direction: 'higher' — больше лучше, 'lower' — меньше лучше.
// - thresholds: [нижняя_граница, верхняя_граница] для выбранного направления.
//   Например, для 'lower': [плохо, хорошо] = [25, 12] (% MaxDD).

export const TestThresholdsConfig: TestThresholds = {
  // Период и частота — используем как требования к качеству теста, в скоринг не влияют
  periodDays: {
    thresholds: [30, 120],
    direction: 'higher',
    precision: 0,
  },
  periodMonths: {
    thresholds: [1, 6],
    direction: 'higher',
    precision: 2,
  },
  orders: {
    thresholds: [30, 200],
    direction: 'higher',
    precision: 0,
  },
  wins: {
    thresholds: [30, 100],
    direction: 'higher',
    precision: 0,
  },
  losses: {
    thresholds: [20, 50],
    direction: 'lower',
    precision: 0,
  },
  ordersPerMonth: {
    thresholds: [4, 20],
    direction: 'higher',
    precision: 2,
  },
  exposure: {
    thresholds: [20, 60],
    direction: 'higher',
    isPercent: true,
    precision: 1,
  },

  // Доходность
  amount: {
    thresholds: [105, 120],
    direction: 'higher',
    isAmount: true,
    precision: 2,
  },
  maxAmount: {
    thresholds: [140, 180],
    direction: 'higher',
    isAmount: true,
    precision: 2,
  },
  minAmount: {
    thresholds: [80, 90],
    direction: 'higher',
    isAmount: true,
    precision: 2,
  },
  netProfit: {
    thresholds: [5, 20],
    direction: 'higher',
    isAmount: true,
    precision: 2,
  },
  totalReturn: {
    thresholds: [10, 50],
    direction: 'higher',
    isPercent: true,
    precision: 1,
  },
  cagr: {
    thresholds: [15, 40],
    direction: 'higher',
    isPercent: true,
    precision: 1,
  },

  // Риск и риск/доходность
  maxDrawdown: {
    thresholds: [25, 12],
    direction: 'lower',
    isPercent: true,
    precision: 1,
  },
  calmar: {
    thresholds: [0.5, 2.0],
    direction: 'higher',
    precision: 2,
  },

  // Качество сделок
  winRate: {
    thresholds: [40, 60],
    direction: 'higher',
    isPercent: true,
    precision: 1,
  },
  riskRewardRatio: {
    thresholds: [1.5, 2.5],
    direction: 'higher',
    precision: 2,
  },
  expectancy: {
    thresholds: [0.3, 1.0],
    direction: 'higher',
    isPercent: true,
    precision: 2,
  },
  maxConsecutiveWins: {
    thresholds: [2, 6],
    direction: 'higher',
    precision: 0,
  },
  maxConsecutiveLosses: {
    thresholds: [5, 2],
    direction: 'lower',
    precision: 0,
  },

  // Sharpe (годовой, по месячным ретернам equity)
  sharpeRatio: {
    thresholds: [0.5, 1.5],
    direction: 'higher',
    precision: 2,
  },

  score: {
    thresholds: [10, 100],
    direction: 'higher',
    precision: 0,
  },
};
