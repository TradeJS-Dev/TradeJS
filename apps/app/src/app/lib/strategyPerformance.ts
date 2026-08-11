export type EquityLog = ReadonlyArray<readonly [number, number]>;

export type TradingSession = 'Asia' | 'Europe' | 'US';

export interface StrategyTradePoint {
  index: number;
  timestamp: number;
  pnl: number;
  equity: number;
  hour: number;
  session: TradingSession;
}

export interface DrawdownPoint {
  timestamp: number;
  drawdownPercent: number;
}

export interface RollingPerformancePoint {
  index: number;
  winRate: number;
  pnl: number;
}

export interface DistributionBin {
  id: string;
  min: number;
  max: number;
  count: number;
}

export interface SessionPnlStat {
  session: TradingSession;
  pnl: number;
  orders: number;
}

export interface HourlyPnlStat {
  hour: number;
  pnl: number;
  orders: number;
}

export interface MonthlyStat {
  id: string;
  year: number;
  monthIndex: number;
  monthLabel: string;
  orders: number;
  wins: number;
  pnl: number;
}

export interface YearlyMonthlyStats {
  year: number;
  months: MonthlyStat[];
}

export interface QuarterlyMonthlyStats {
  label: string;
  monthIndexes: readonly number[];
  months: (MonthlyStat | null)[];
  hasData: boolean;
}

const resolveTradingSession = (hour: number): TradingSession => {
  if (hour < 8) return 'Asia';
  if (hour < 16) return 'Europe';
  return 'US';
};

export const getEquityStepPnl = (orderLog: EquityLog, index: number) => {
  const current = orderLog[index];
  const previous = orderLog[index - 1];
  if (!current || !previous) return null;

  const pnl = current[1] - previous[1];
  return Number.isFinite(pnl) ? pnl : null;
};

const calculateMaxPnlStreak = (
  orderLog: EquityLog,
  isStreakPnl: (pnl: number) => boolean,
) => {
  let currentStreak = 0;
  let maxStreak = 0;

  for (let index = 1; index < orderLog.length; index += 1) {
    const pnl = getEquityStepPnl(orderLog, index);
    if (pnl == null) continue;

    if (isStreakPnl(pnl)) {
      currentStreak += 1;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  return maxStreak;
};

export const calculateMaxGrossStreak = (orderLog: EquityLog) =>
  calculateMaxPnlStreak(orderLog, (pnl) => pnl > 0);

export const calculateMaxLossStreak = (orderLog: EquityLog) =>
  calculateMaxPnlStreak(orderLog, (pnl) => pnl < 0);

export const calculateMaxDrawdownValue = (orderLog: EquityLog) => {
  if (!orderLog.length) return null;

  let peak = orderLog[0]?.[1] ?? 0;
  let maxDrawdownPercent = 0;

  for (const [, amount] of orderLog) {
    if (!Number.isFinite(amount)) continue;

    peak = Math.max(peak, amount);
    if (peak <= 0) continue;

    maxDrawdownPercent = Math.max(
      maxDrawdownPercent,
      ((peak - amount) / peak) * 100,
    );
  }

  return maxDrawdownPercent;
};

export const formatMaxDrawdownPercent = (orderLog: EquityLog) => {
  const value = calculateMaxDrawdownValue(orderLog);
  return value == null ? null : `${value.toFixed(1)}%`;
};

export const buildStrategyTradePoints = (
  orderLog: EquityLog,
): StrategyTradePoint[] => {
  const points: StrategyTradePoint[] = [];

  for (let index = 1; index < orderLog.length; index += 1) {
    const current = orderLog[index];
    const previous = orderLog[index - 1];
    if (!current || !previous) continue;

    const [timestamp, equity] = current;
    const pnl = equity - previous[1];
    if (
      !Number.isFinite(timestamp) ||
      !Number.isFinite(equity) ||
      !Number.isFinite(pnl)
    ) {
      continue;
    }

    const hour = new Date(timestamp).getUTCHours();
    points.push({
      index,
      timestamp,
      pnl,
      equity,
      hour,
      session: resolveTradingSession(hour),
    });
  }

  return points;
};

export const buildDrawdownPoints = (orderLog: EquityLog): DrawdownPoint[] => {
  let peak = orderLog[0]?.[1] ?? 0;

  return orderLog
    .map(([timestamp, equity]) => {
      if (!Number.isFinite(timestamp) || !Number.isFinite(equity)) return null;

      peak = Math.max(peak, equity);
      return {
        timestamp,
        drawdownPercent: peak > 0 ? ((peak - equity) / peak) * 100 : 0,
      };
    })
    .filter((point): point is DrawdownPoint => point != null);
};

export const buildRollingPerformance = (
  trades: StrategyTradePoint[],
  windowSize = 50,
): RollingPerformancePoint[] =>
  trades.map((trade, index) => {
    const windowTrades = trades.slice(
      Math.max(0, index - windowSize + 1),
      index + 1,
    );
    const wins = windowTrades.filter((item) => item.pnl > 0).length;

    return {
      index: trade.index,
      winRate: windowTrades.length > 0 ? (wins / windowTrades.length) * 100 : 0,
      pnl: windowTrades.reduce((sum, item) => sum + item.pnl, 0),
    };
  });

export const buildPnlDistribution = (
  trades: StrategyTradePoint[],
  binCount = 12,
): DistributionBin[] => {
  if (!trades.length) return [];

  const pnlValues = trades.map((trade) => trade.pnl);
  const min = Math.min(...pnlValues);
  const max = Math.max(...pnlValues);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];

  if (min === max) {
    return [{ id: `${min}:${max}`, min, max, count: trades.length }];
  }

  const step = (max - min) / binCount;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    id: String(index),
    min: min + step * index,
    max: index === binCount - 1 ? max : min + step * (index + 1),
    count: 0,
  }));

  for (const pnl of pnlValues) {
    const rawIndex = Math.floor((pnl - min) / step);
    const bin = bins[Math.max(0, Math.min(binCount - 1, rawIndex))];
    if (bin) bin.count += 1;
  }

  return bins;
};

export const buildSessionPnlStats = (
  trades: StrategyTradePoint[],
): SessionPnlStat[] => {
  const stats = new Map<TradingSession, SessionPnlStat>(
    (['Asia', 'Europe', 'US'] as const).map((session) => [
      session,
      { session, pnl: 0, orders: 0 },
    ]),
  );

  for (const trade of trades) {
    const stat = stats.get(trade.session);
    if (!stat) continue;
    stat.pnl += trade.pnl;
    stat.orders += 1;
  }

  return [...stats.values()];
};

export const buildHourlyPnlStats = (
  trades: StrategyTradePoint[],
): HourlyPnlStat[] => {
  const stats = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    pnl: 0,
    orders: 0,
  }));

  for (const trade of trades) {
    const stat = stats[trade.hour];
    if (!stat) continue;
    stat.pnl += trade.pnl;
    stat.orders += 1;
  }

  return stats;
};

const getMonthLabel = (monthIndex: number) =>
  new Date(Date.UTC(2026, monthIndex - 1, 1)).toLocaleString('en-US', {
    month: 'short',
  });

const monthQuarters = [
  { label: 'Q1', months: [1, 2, 3] },
  { label: 'Q2', months: [4, 5, 6] },
  { label: 'Q3', months: [7, 8, 9] },
  { label: 'Q4', months: [10, 11, 12] },
] as const;

export const buildQuarterlyMonthlyStats = (
  months: MonthlyStat[],
): QuarterlyMonthlyStats[] => {
  const byMonth = new Map(months.map((month) => [month.monthIndex, month]));

  return monthQuarters
    .map((quarter) => {
      const quarterMonths = quarter.months.map(
        (monthIndex) => byMonth.get(monthIndex) ?? null,
      );

      return {
        label: quarter.label,
        monthIndexes: quarter.months,
        months: quarterMonths,
        hasData: quarterMonths.some((month) => month != null),
      };
    })
    .filter((quarter) => quarter.hasData);
};

export const buildMonthlyStats = (
  orderLog: EquityLog,
): YearlyMonthlyStats[] => {
  const grouped = new Map<string, MonthlyStat>();

  for (let index = 1; index < orderLog.length; index += 1) {
    const current = orderLog[index];
    const previous = orderLog[index - 1];
    if (!current || !previous) continue;

    const [timestamp, amount] = current;
    const previousAmount = previous[1];
    if (
      !Number.isFinite(timestamp) ||
      !Number.isFinite(amount) ||
      !Number.isFinite(previousAmount)
    ) {
      continue;
    }

    const date = new Date(timestamp);
    const year = date.getUTCFullYear();
    const monthIndex = date.getUTCMonth() + 1;
    const id = `${year}-${String(monthIndex).padStart(2, '0')}`;
    const pnl = amount - previousAmount;
    const existing = grouped.get(id) ?? {
      id,
      year,
      monthIndex,
      monthLabel: getMonthLabel(monthIndex),
      orders: 0,
      wins: 0,
      pnl: 0,
    };

    existing.orders += 1;
    existing.wins += pnl > 0 ? 1 : 0;
    existing.pnl += pnl;
    grouped.set(id, existing);
  }

  const yearlyStats = new Map<number, MonthlyStat[]>();
  for (const month of [...grouped.values()].sort(
    (left, right) =>
      left.year - right.year || left.monthIndex - right.monthIndex,
  )) {
    const months = yearlyStats.get(month.year) ?? [];
    months.push(month);
    yearlyStats.set(month.year, months);
  }

  return [...yearlyStats.entries()]
    .sort(([leftYear], [rightYear]) => leftYear - rightYear)
    .map(([year, months]) => ({ year, months }));
};
