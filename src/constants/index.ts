import { BacktestThresholds, BacktestStat } from '@types';

export const BACKTEST_DAYS = 180;
export const DASHBOARD_DAYS = 60;
export const PRELOAD_DAYS = 210;
export const BOT_PRELOAS_DAYS = 60;
export const PRELOAD_FALLBACK_DAYS = 180;

export const levelScore = {
  success: 1.2,
  warning: 1.1,
  error: 1,
};

export const rankedMetrics: (keyof BacktestStat)[] = [
  'profitFactor',
  'winRate',
  'riskRewardRatio',
  'expectancy',
  'averageReturn',
  'sharpeRatio',
  'sortinoRatio',
  'exposure',
  'maxDrawdown',
];

export const backtestThresholds: BacktestThresholds = {
  winRate: {
    thresholds: [35, 55],
    direction: 'higher',
    weight: 0.9,
    isPercent: true,
    precision: 1,
  },
  profitFactor: {
    thresholds: [1.2, 2.0],
    direction: 'higher',
    weight: 0.8,
    precision: 2,
  },
  riskRewardRatio: {
    thresholds: [1.5, 3.0],
    direction: 'higher',
    weight: 0.7,
    precision: 2,
  },
  expectancy: {
    thresholds: [0.2, 0.5],
    direction: 'higher',
    weight: 0.8,
    precision: 2,
  },
  sharpeRatio: {
    thresholds: [0.1, 0.5],
    direction: 'higher',
    weight: 0.7,
    precision: 2,
  },
  sortinoRatio: {
    thresholds: [0.2, 1.0],
    direction: 'higher',
    weight: 0.6,
    precision: 2,
  },
  exposure: {
    thresholds: [30, 70],
    direction: 'higher',
    weight: 0.4,
    isPercent: true,
    precision: 1,
  },
  averageReturn: {
    thresholds: [0.2, 0.6],
    direction: 'higher',
    weight: 0.6,
    precision: 2,
  },
  maxDrawdown: {
    thresholds: [40, 20],
    direction: 'lower',
    weight: 0.8,
    isPercent: true,
    precision: 1,
  },
  amount: {
    thresholds: [105, 120],
    direction: 'higher',
    weight: 0.5,
    isAmount: true,
    precision: 2,
  },
  maxAmount: {
    thresholds: [110, 130],
    direction: 'higher',
    weight: 0.4,
    isAmount: true,
    precision: 2,
  },
  minAmount: {
    thresholds: [90, 100],
    direction: 'higher',
    weight: 0.3,
    isAmount: true,
    precision: 2,
  },
  netProfit: {
    thresholds: [5, 20],
    direction: 'higher',
    weight: 0.5,
    isAmount: true,
    precision: 2,
  },
  grossProfit: {
    thresholds: [20, 50],
    direction: 'higher',
    weight: 0.3,
    isAmount: true,
    precision: 2,
  },
  grossLoss: {
    thresholds: [30, 15],
    direction: 'lower',
    weight: 0.3,
    isAmount: true,
    precision: 2,
  },
  wins: {
    thresholds: [20, 50],
    direction: 'higher',
    weight: 0.3,
    isPercent: false,
    precision: 0,
  },
  losses: {
    thresholds: [60, 30],
    direction: 'lower',
    weight: 0.2,
    isPercent: false,
    precision: 0,
  },
  orders: {
    thresholds: [30, 100],
    direction: 'higher',
    weight: 0.2,
    isPercent: false,
    precision: 0,
  },
};
