export interface Metrics {
  // Период и частота
  periodDays: number; // дни
  periodMonths: number; // месяцы
  orders: number; // кол-во закрытых сделок
  ordersPerMonth: number; // сделок в месяц
  wins: number;
  losses: number;
  exposure: number; // %, доля времени в рынке

  // Доходность
  amount: number; // финальный капитал
  maxAmount: number;
  minAmount: number;
  netProfit: number; // прирост в тех же ед., что и капитал
  totalReturn: number; // %, общий рост за период
  cagr: number; // %, годовая геом. доходность

  // Риск
  maxDrawdown: number; // %, максимальная просадка
  calmar: number | null; // CAGR / MaxDD

  // Качество сделок
  winRate: number; // %
  riskRewardRatio: number | null; // payoff = avgWin/avgLoss
  expectancy: number; // %, ожидаемая доходность на сделку
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;

  // Риск-доходность (временная)
  sharpeRatio: number | null; // годовой Sharpe по месячным ретернам equity
}

export interface EOMPoint {
  month: string; // 'YYYY-MM'
  ts: number; // timestamp конца месяца (ms)
  amount: number; // equity на конец месяца
}

export interface MonthlyEquityStats {
  eomSeries: EOMPoint[];
  monthlyReturns: number[]; // доли: 0.12 = 12%
  monthlyMean: number; // арифметическое среднее (доля)
  monthlyStd: number; // std (population по умолчанию)
  monthlyDownsideStd: number; // std отрицательных отклонений от MAR
  sharpeMonthly: number | null; // (mean - MAR)/std
  sharpeMonthlyAnnualized: number | null; // * sqrt(12)
  sortinoMonthly: number | null; // (mean - MAR)/downsideStd
  sortinoMonthlyAnnualized: number | null; // * sqrt(12)
  positiveMonths: number; // количество месяцев с r_t > 0
  maxMonthlyGain: number; // максимум r_t (доля)
  maxMonthlyDrop: number; // минимум r_t (доля)
}

export type ThresholdLevel = 'error' | 'warning' | 'success' | 'neutral';

export interface MetricThreshold {
  thresholds: [number, number];
  direction: 'higher' | 'lower';
  isPercent?: boolean;
  isAmount?: boolean;
  neutralValue?: number;
  precision: number;
}
