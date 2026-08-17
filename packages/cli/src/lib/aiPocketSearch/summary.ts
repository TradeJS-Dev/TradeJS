import type {
  AiPocketCoverageFamily,
  AiPocketSearchRow,
  AiPocketSummary,
  AiPocketCoverageSummary,
} from './contracts';
import {
  DAY_MS,
  DAYS_PER_WEEK,
  DAYS_PER_MONTH,
  isFiniteNumber,
} from './features';

export const formatNumber = (value: number) => {
  if (Number.isInteger(value)) {
    return String(value);
  }
  const abs = Math.abs(value);
  if (abs > 0 && abs < 0.001) {
    return value.toExponential(3);
  }
  return Number(value.toPrecision(6)).toString();
};

export const formatPredicateValue = (
  value: string | number | boolean | null,
) => {
  if (typeof value === 'number') {
    return formatNumber(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  return String(value);
};

export const roundThreshold = (value: number) => Number(value.toPrecision(8));

export const quantileAt = (values: number[], quantile: number) => {
  const index = Math.floor((values.length - 1) * quantile);
  return values[Math.max(0, Math.min(values.length - 1, index))];
};

export const getPeriodDays = (rows: AiPocketSearchRow[]) => {
  let minTimestamp: number | null = null;
  let maxTimestamp: number | null = null;
  for (const row of rows) {
    const timestamp =
      typeof row.timestamp === 'number' && Number.isFinite(row.timestamp)
        ? row.timestamp
        : null;
    if (timestamp == null) {
      continue;
    }
    minTimestamp =
      minTimestamp == null ? timestamp : Math.min(minTimestamp, timestamp);
    maxTimestamp =
      maxTimestamp == null ? timestamp : Math.max(maxTimestamp, timestamp);
  }
  if (minTimestamp == null || maxTimestamp == null) {
    return null;
  }
  return Math.max((maxTimestamp - minTimestamp) / DAY_MS, 1);
};

type AiPocketSummaryAccumulator = {
  support: number;
  grossProfit: number;
  grossLoss: number;
  wins: number;
  directionCounts: Map<string, number>;
  symbolCounts: Map<
    string,
    {
      count: number;
      totalProfit: number;
    }
  >;
  monthProfits: Map<string, number>;
  eventStats: Map<string, { count: number; totalProfit: number }>;
  equityPoints: Array<{ timestamp: number; profit: number }>;
};

export const createSummaryAccumulator = (): AiPocketSummaryAccumulator => ({
  support: 0,
  grossProfit: 0,
  grossLoss: 0,
  wins: 0,
  directionCounts: new Map<string, number>(),
  symbolCounts: new Map<
    string,
    {
      count: number;
      totalProfit: number;
    }
  >(),
  monthProfits: new Map<string, number>(),
  eventStats: new Map<string, { count: number; totalProfit: number }>(),
  equityPoints: [],
});

export const addSummaryRow = (
  accumulator: AiPocketSummaryAccumulator,
  row: AiPocketSearchRow,
) => {
  const profit = Number(row.profit);
  accumulator.support += 1;

  if (profit > 0) {
    accumulator.grossProfit += profit;
    accumulator.wins += 1;
  } else if (profit < 0) {
    accumulator.grossLoss += Math.abs(profit);
  }

  const direction =
    typeof row.direction === 'string' && row.direction.trim()
      ? row.direction
      : 'UNKNOWN';
  accumulator.directionCounts.set(
    direction,
    (accumulator.directionCounts.get(direction) ?? 0) + 1,
  );

  const symbol =
    typeof row.symbol === 'string' && row.symbol.trim()
      ? row.symbol
      : 'UNKNOWN';
  const symbolBucket = accumulator.symbolCounts.get(symbol) ?? {
    count: 0,
    totalProfit: 0,
  };
  symbolBucket.count += 1;
  symbolBucket.totalProfit += profit;
  accumulator.symbolCounts.set(symbol, symbolBucket);

  const timestamp =
    typeof row.timestamp === 'number' && Number.isFinite(row.timestamp)
      ? row.timestamp
      : Number.POSITIVE_INFINITY;
  const eventKey = Number.isFinite(timestamp)
    ? String(timestamp)
    : `UNKNOWN:${accumulator.support}`;
  const event = accumulator.eventStats.get(eventKey) ?? {
    count: 0,
    totalProfit: 0,
  };
  event.count += 1;
  event.totalProfit += profit;
  accumulator.eventStats.set(eventKey, event);
  const month =
    Number.isFinite(timestamp) && timestamp !== Number.POSITIVE_INFINITY
      ? new Date(timestamp).toISOString().slice(0, 7)
      : 'UNKNOWN';
  accumulator.monthProfits.set(
    month,
    (accumulator.monthProfits.get(month) ?? 0) + profit,
  );
  accumulator.equityPoints.push({ timestamp, profit });
};

const emptyAiPocketSummary = ({
  fullPeriodDays,
  supportRatio,
}: {
  fullPeriodDays: number | null;
  supportRatio: number;
}): AiPocketSummary => ({
  support: 0,
  supportRatio,
  events: 0,
  eventBalancedProfit: 0,
  tradesPerEvent: null,
  p95Batch: 0,
  maxBatch: 0,
  topEventCountShare: null,
  topEventProfitShare: null,
  topSymbolCountShare: null,
  topSymbolProfitShare: null,
  totalProfit: 0,
  grossProfit: 0,
  grossLoss: 0,
  profitFactor: null,
  winRate: null,
  avgProfit: null,
  maxDrawdown: 0,
  maxDrawdownPctOfGrossProfit: null,
  maxDrawdownPctOfTotalProfit: null,
  recoveryFactor: null,
  maxConsecutiveWins: 0,
  maxConsecutiveLosses: 0,
  avgTradesPerDay: fullPeriodDays == null ? null : 0,
  avgTradesPerWeek: fullPeriodDays == null ? null : 0,
  avgProfitPerDay: fullPeriodDays == null ? null : 0,
  avgProfitPerMonth: fullPeriodDays == null ? null : 0,
  losingMonths: 0,
  worstMonth: null,
  directionCounts: {},
  topSymbols: [],
});

export const finalizeAiPocketSummary = ({
  rows,
  accumulator,
}: {
  rows: AiPocketSearchRow[];
  accumulator: AiPocketSummaryAccumulator;
}): AiPocketSummary => {
  const fullPeriodDays = getPeriodDays(rows);
  const support = accumulator.support;
  const supportRatio = rows.length > 0 ? support / rows.length : 0;

  if (support === 0) {
    return {
      ...emptyAiPocketSummary({ fullPeriodDays, supportRatio }),
    };
  }

  let equity = 0;
  let peakEquity = 0;
  let maxDrawdown = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;

  accumulator.equityPoints.sort(
    (left, right) => left.timestamp - right.timestamp,
  );
  for (const point of accumulator.equityPoints) {
    equity += point.profit;
    peakEquity = Math.max(peakEquity, equity);
    maxDrawdown = Math.max(maxDrawdown, Math.max(0, peakEquity - equity));

    if (point.profit > 0) {
      currentWinStreak += 1;
      currentLossStreak = 0;
    } else if (point.profit < 0) {
      currentLossStreak += 1;
      currentWinStreak = 0;
    } else {
      currentWinStreak = 0;
      currentLossStreak = 0;
    }

    maxConsecutiveWins = Math.max(maxConsecutiveWins, currentWinStreak);
    maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLossStreak);
  }

  const grossProfit = accumulator.grossProfit;
  const grossLoss = accumulator.grossLoss;
  const totalProfit = grossProfit - grossLoss;
  const avgTradesPerDay =
    fullPeriodDays == null ? null : support / fullPeriodDays;
  const avgProfitPerDay =
    fullPeriodDays == null ? null : totalProfit / fullPeriodDays;
  const losingMonthEntries = [...accumulator.monthProfits.entries()].filter(
    ([, profit]) => profit < 0,
  );
  const worstMonth =
    [...accumulator.monthProfits.entries()].sort(
      (left, right) => left[1] - right[1],
    )[0] ?? null;
  const eventStats = [...accumulator.eventStats.values()];
  const events = eventStats.length;
  const batchSizes = eventStats
    .map((event) => event.count)
    .sort((left, right) => left - right);
  const p95Batch =
    batchSizes[Math.max(0, Math.ceil(batchSizes.length * 0.95) - 1)] ?? 0;
  const maxBatch = batchSizes.at(-1) ?? 0;
  const absoluteEventProfit = eventStats.reduce(
    (sum, event) => sum + Math.abs(event.totalProfit),
    0,
  );
  const absoluteSymbolProfit = [...accumulator.symbolCounts.values()].reduce(
    (sum, symbol) => sum + Math.abs(symbol.totalProfit),
    0,
  );

  return {
    support,
    supportRatio,
    events,
    eventBalancedProfit: eventStats.reduce(
      (sum, event) => sum + event.totalProfit / event.count,
      0,
    ),
    tradesPerEvent: events > 0 ? support / events : null,
    p95Batch,
    maxBatch,
    topEventCountShare: support > 0 ? maxBatch / support : null,
    topEventProfitShare:
      absoluteEventProfit > 0
        ? Math.max(...eventStats.map((event) => Math.abs(event.totalProfit))) /
          absoluteEventProfit
        : null,
    topSymbolCountShare:
      support > 0
        ? Math.max(
            ...[...accumulator.symbolCounts.values()].map(
              (symbol) => symbol.count,
            ),
          ) / support
        : null,
    topSymbolProfitShare:
      absoluteSymbolProfit > 0
        ? Math.max(
            ...[...accumulator.symbolCounts.values()].map((symbol) =>
              Math.abs(symbol.totalProfit),
            ),
          ) / absoluteSymbolProfit
        : null,
    totalProfit,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    winRate: support > 0 ? accumulator.wins / support : null,
    avgProfit: support > 0 ? totalProfit / support : null,
    maxDrawdown,
    maxDrawdownPctOfGrossProfit:
      grossProfit > 0 ? maxDrawdown / grossProfit : null,
    maxDrawdownPctOfTotalProfit:
      totalProfit > 0 ? maxDrawdown / totalProfit : null,
    recoveryFactor: maxDrawdown > 0 ? totalProfit / maxDrawdown : null,
    maxConsecutiveWins,
    maxConsecutiveLosses,
    avgTradesPerDay,
    avgTradesPerWeek:
      avgTradesPerDay == null ? null : avgTradesPerDay * DAYS_PER_WEEK,
    avgProfitPerDay,
    avgProfitPerMonth:
      avgProfitPerDay == null ? null : avgProfitPerDay * DAYS_PER_MONTH,
    losingMonths: losingMonthEntries.length,
    worstMonth: worstMonth
      ? {
          month: worstMonth[0],
          totalProfit: worstMonth[1],
        }
      : null,
    directionCounts: Object.fromEntries(accumulator.directionCounts.entries()),
    topSymbols: [...accumulator.symbolCounts.entries()]
      .map(([symbol, value]) => ({
        symbol,
        ...value,
      }))
      .sort(
        (left, right) =>
          right.count - left.count ||
          Math.abs(right.totalProfit) - Math.abs(left.totalProfit),
      )
      .slice(0, 5),
  };
};

const summarizeSelectedRows = (
  rows: AiPocketSearchRow[],
  selected: AiPocketSearchRow[],
): AiPocketSummary => {
  const accumulator = createSummaryAccumulator();
  for (const row of selected) {
    addSummaryRow(accumulator, row);
  }
  return finalizeAiPocketSummary({ rows, accumulator });
};

export const summarizeMask = (rows: AiPocketSearchRow[], mask: Uint8Array) => {
  const accumulator = createSummaryAccumulator();
  for (let index = 0; index < rows.length; index += 1) {
    if (mask[index] === 1) {
      addSummaryRow(accumulator, rows[index]);
    }
  }
  return finalizeAiPocketSummary({ rows, accumulator });
};

export const summarizeRowIndexes = (
  rows: AiPocketSearchRow[],
  rowIndexes: number[],
) => {
  const accumulator = createSummaryAccumulator();
  for (const rowIndex of rowIndexes) {
    addSummaryRow(accumulator, rows[rowIndex]);
  }
  return finalizeAiPocketSummary({ rows, accumulator });
};

export const summarizeAiPocketRows = (rows: AiPocketSearchRow[]) =>
  summarizeSelectedRows(rows, rows);

export const summarizeAiPocketFeatureCoverage = (
  rows: AiPocketSearchRow[],
  family: AiPocketCoverageFamily,
): AiPocketCoverageSummary => {
  const coveredRows = rows.filter(
    (row) => row.featureCoverage?.[family] === true,
  );
  const allEvents = new Set<number>();
  const coveredEvents = new Set<number>();
  let minTimestamp: number | null = null;
  let maxTimestamp: number | null = null;

  for (const row of rows) {
    if (isFiniteNumber(row.timestamp)) {
      allEvents.add(row.timestamp);
    }
  }
  for (const row of coveredRows) {
    if (!isFiniteNumber(row.timestamp)) {
      continue;
    }
    coveredEvents.add(row.timestamp);
    minTimestamp =
      minTimestamp == null
        ? row.timestamp
        : Math.min(minTimestamp, row.timestamp);
    maxTimestamp =
      maxTimestamp == null
        ? row.timestamp
        : Math.max(maxTimestamp, row.timestamp);
  }

  return {
    family,
    rows: coveredRows.length,
    rowRatio: rows.length > 0 ? coveredRows.length / rows.length : 0,
    events: coveredEvents.size,
    eventRatio: allEvents.size > 0 ? coveredEvents.size / allEvents.size : 0,
    minTimestamp,
    maxTimestamp,
  };
};
