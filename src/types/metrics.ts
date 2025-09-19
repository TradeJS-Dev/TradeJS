export interface Metrics {
  winRate: number;
  profitFactor: number;
  riskRewardRatio: number | null;
  expectancy: number;
  averageReturn: number;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  exposure: number;
  maxDrawdown: number;
  amount: number;
  maxAmount: number;
  minAmount: number;
  wins: number;
  losses: number;
  orders: number;
  netProfit: number;
  netProfitByLong: number;
  netProfitByShort: number;
  grossProfit: number;
  grossLoss: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
}

export type ThresholdLevel = 'error' | 'warning' | 'success';

export interface MetricThreshold {
  thresholds: [number, number];
  direction: 'higher' | 'lower';
  weight: number;
  isPercent?: boolean;
  isAmount?: boolean;
  isScored?: boolean;
  precision: number;
}

export interface MetricScore {
  level: 'success' | 'warning' | 'error';
  score: number; // от 0 до 1
  weight: number;
}
