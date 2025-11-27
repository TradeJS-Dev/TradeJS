import 'dotenv/config';
import type { TestThresholds } from '@types';

const { NODE_ENV } = process.env;

export const PRELOAD_DAYS = 210;
export const SIGNALS_PRELOAD_DAYS = 60;
export const BACKTEST_PRELOAD_DAYS = 180;
export const DASHBOARD_PRELOAD_DAYS = 90;
export const BOT_PRELOAD_DAYS = 180;
export const PRELOAD_FALLBACK_DAYS = 180;

export const TTL_1H = 3_600;
export const TTL_12H = 43_300;
export const TTL_1D = 86_400;
export const TTL_1M = 2_600_000;

export const TESTS_TOP_LIMIT = 40;
export const TESTS_LIMIT = 100_000;
export const TESTS_ORDERS_MIN_LIMIT = 40;

export const KLINE_CONCURRENCY_LIMIT = NODE_ENV === 'production' ? 5 : 10;
export const TG_CONCURRENCY_LIMIT = 3;
export const AI_CONCURRENCY_LIMIT = 3;
export const SCREENSHOT_CONCURRENCY_LIMIT = NODE_ENV === 'production' ? 1 : 2;

export const levelScore = {
  success: 1,
  warning: 0.9,
  error: 0.8,
};

// Мини-подсказка по порогам (thresholds):
// - Для direction: 'higher' — больше лучше, 'lower' — меньше лучше.
// - thresholds: [нижняя_граница, верхняя_граница] для выбранного направления.
//   Например, для 'lower': [плохо, хорош о] = [25, 12] (% MaxDD).
// - weight можно ставить 0, чтобы метрика не влияла на общий скоринг
//   (но при этом сохранялась в отчёте).

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
    weight: 10,
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
    weight: 35,
    isPercent: true,
    precision: 1,
  },

  // Риск и риск/доходность
  maxDrawdown: {
    thresholds: [25, 12],
    direction: 'lower',
    weight: 40,
    isPercent: true,
    precision: 1,
  },
  calmar: {
    thresholds: [0.5, 2.0],
    direction: 'higher',
    weight: 35,
    precision: 2,
  },

  // Качество сделок
  winRate: {
    thresholds: [40, 60],
    direction: 'higher',
    weight: 10,
    isPercent: true,
    precision: 1,
  },
  riskRewardRatio: {
    thresholds: [1.5, 2.5],
    direction: 'higher',
    weight: 10,
    precision: 2,
  },
  expectancy: {
    thresholds: [0.3, 1.0],
    direction: 'higher',
    weight: 25,
    isPercent: true,
    precision: 2,
  },
  maxConsecutiveWins: {
    thresholds: [2, 6],
    direction: 'higher',
    weight: 2,
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
    weight: 45,
    precision: 2,
  },

  score: {
    thresholds: [10, 100],
    direction: 'higher',
    precision: 0,
  },
};
