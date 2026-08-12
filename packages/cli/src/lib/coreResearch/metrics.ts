import type {
  CoreResearchCohort,
  CoreResearchCohortMetrics,
  CoreResearchMetrics,
  CoreResearchTrade,
  CoreResearchWindowMetrics,
} from './types';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const CORE_RESEARCH_COHORTS: CoreResearchCohort[] = [
  'ALL',
  'LONG',
  'SHORT',
];

const selectCohort = (
  trades: CoreResearchTrade[],
  cohort: CoreResearchCohort,
) =>
  cohort === 'ALL'
    ? trades
    : trades.filter((trade) => trade.direction === cohort);

const quantile = (sorted: number[], probability: number) => {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
};

const compareChronologicalTrades = (
  left: CoreResearchTrade,
  right: CoreResearchTrade,
) =>
  left.exitTimestamp - right.exitTimestamp ||
  (left.signalId < right.signalId
    ? -1
    : left.signalId > right.signalId
      ? 1
      : 0);

export const orderCoreResearchTrades = (trades: CoreResearchTrade[]) => {
  for (let index = 1; index < trades.length; index += 1) {
    if (compareChronologicalTrades(trades[index - 1], trades[index]) > 0) {
      return [...trades].sort(compareChronologicalTrades);
    }
  }
  return trades;
};

export const summarizeCoreResearchTrades = (
  trades: CoreResearchTrade[],
  periodDays: number,
): CoreResearchMetrics => {
  const sorted = orderCoreResearchTrades(trades);
  let pnl = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let equity = 0;
  let peak = 0;
  let realizedMaxDrawdown = 0;
  let consecutiveLosses = 0;
  let maximumConsecutiveLosses = 0;
  for (const trade of sorted) {
    pnl += trade.netProfit;
    if (trade.netProfit > 0) {
      wins += 1;
      grossProfit += trade.netProfit;
      consecutiveLosses = 0;
    } else {
      losses += 1;
      if (trade.netProfit === 0) breakeven += 1;
      else {
        grossLoss += Math.abs(trade.netProfit);
        consecutiveLosses += 1;
        maximumConsecutiveLosses = Math.max(
          maximumConsecutiveLosses,
          consecutiveLosses,
        );
      }
    }
    equity += trade.netProfit;
    peak = Math.max(peak, equity);
    realizedMaxDrawdown = Math.max(realizedMaxDrawdown, peak - equity);
  }
  const count = sorted.length;
  const pnlDistribution = sorted
    .map((trade) => trade.netProfit)
    .sort((left, right) => left - right);
  const holdingHours = sorted
    .map((trade) => (trade.exitTimestamp - trade.entryTimestamp) / 3_600_000)
    .sort((left, right) => left - right);
  const averageWin = wins > 0 ? grossProfit / wins : null;
  const strictLosses = losses - breakeven;
  const averageLoss = strictLosses > 0 ? grossLoss / strictLosses : null;
  return {
    trades: count,
    wins,
    losses,
    breakeven,
    pnl,
    pnlPerTrade: count > 0 ? pnl / count : null,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    profitFactorStatus:
      grossLoss > 0
        ? 'finite'
        : grossProfit > 0
          ? 'infinite_no_gross_loss'
          : 'undefined',
    winRatePct: count > 0 ? (wins / count) * 100 : null,
    realizedMaxDrawdown,
    cadencePerDay: periodDays > 0 ? count / periodDays : null,
    averageWin,
    averageLoss,
    payoffRatio:
      averageWin != null && averageLoss != null && averageLoss > 0
        ? averageWin / averageLoss
        : null,
    medianPnl: quantile(pnlDistribution, 0.5),
    pnlP05: quantile(pnlDistribution, 0.05),
    pnlP95: quantile(pnlDistribution, 0.95),
    medianHoldingHours: quantile(holdingHours, 0.5),
    maximumConsecutiveLosses,
  };
};

export const summarizeCoreResearchCohorts = (
  trades: CoreResearchTrade[],
  periodDays: number,
): CoreResearchCohortMetrics =>
  Object.fromEntries(
    CORE_RESEARCH_COHORTS.map((cohort) => [
      cohort,
      summarizeCoreResearchTrades(selectCohort(trades, cohort), periodDays),
    ]),
  ) as CoreResearchCohortMetrics;

export const summarizeCoreResearchWindow = (params: {
  trades: CoreResearchTrade[];
  label: string;
  start: number;
  end: number;
}): CoreResearchWindowMetrics => {
  const { trades, label, start, end } = params;
  const periodDays = (end - start) / DAY_MS;
  const selected = trades.filter(
    (trade) => trade.exitTimestamp >= start && trade.exitTimestamp < end,
  );
  return {
    label,
    start,
    end,
    periodDays,
    cohorts: summarizeCoreResearchCohorts(selected, periodDays),
  };
};

export const buildTerminalWindows = (params: {
  trades: CoreResearchTrade[];
  end: number;
  terminalDays: number[];
}) =>
  params.terminalDays.map((days) =>
    summarizeCoreResearchWindow({
      trades: params.trades,
      label: `${days}d`,
      start: params.end - days * DAY_MS,
      end: params.end,
    }),
  );

export const buildEqualTimeFolds = (params: {
  trades: CoreResearchTrade[];
  start: number;
  end: number;
  folds: number;
}) => {
  const duration = (params.end - params.start) / params.folds;
  return Array.from({ length: params.folds }, (_, index) => {
    const start = params.start + index * duration;
    const end =
      index === params.folds - 1
        ? params.end
        : params.start + (index + 1) * duration;
    return summarizeCoreResearchWindow({
      trades: params.trades,
      label: `fold-${index + 1}`,
      start,
      end,
    });
  });
};

export const buildMonthlyWindows = (params: {
  trades: CoreResearchTrade[];
  start: number;
  end: number;
}) => {
  const windows: CoreResearchWindowMetrics[] = [];
  const cursor = new Date(params.start);
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() < params.end) {
    const monthStart = Math.max(cursor.getTime(), params.start);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    const monthEnd = Math.min(cursor.getTime(), params.end);
    windows.push(
      summarizeCoreResearchWindow({
        trades: params.trades,
        label: new Date(monthStart).toISOString().slice(0, 7),
        start: monthStart,
        end: monthEnd,
      }),
    );
  }
  return windows;
};

export const buildRegimeMetrics = (
  trades: CoreResearchTrade[],
  periodDays: number,
) => {
  const grouped = new Map<string, CoreResearchTrade[]>();
  for (const trade of trades) {
    const bucket = grouped.get(trade.regime.key) ?? [];
    bucket.push(trade);
    grouped.set(trade.regime.key, bucket);
  }
  return Object.fromEntries(
    [...grouped.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, bucket]) => [
        key,
        summarizeCoreResearchCohorts(bucket, periodDays),
      ]),
  );
};

export const buildCostStress = (params: {
  trades: CoreResearchTrade[];
  periodDays: number;
  extraRoundTripBps: number[];
}) =>
  params.extraRoundTripBps.map((extraRoundTripBps) => {
    const stressed = params.trades.map((trade) => ({
      ...trade,
      netProfit:
        trade.netProfit -
        (Math.abs(trade.entryPrice * trade.qty) * extraRoundTripBps) / 10_000,
    }));
    return {
      extraRoundTripBps,
      cohorts: summarizeCoreResearchCohorts(stressed, params.periodDays),
    };
  });
