import type {
  DerivativesContext,
  DerivativesContextRiskFlag,
  DerivativesInterval,
  DerivativesIntervalContext,
  DerivativesPressure,
  DerivativesRow,
  Direction,
} from '@tradejs/types';

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_STALE_AFTER_MS: Record<DerivativesInterval, number> = {
  '15m': 45 * 60 * 1000,
  '1h': 3 * HOUR_MS,
};

const DERIVATIVES_INTERVALS: DerivativesInterval[] = ['15m', '1h'];

type NormalizedDerivativesRow = DerivativesRow & {
  tsMs: number;
  openInterest: number | null;
  fundingRate: number | null;
  liqLong: number | null;
  liqShort: number | null;
  liqTotal: number | null;
};

const toFiniteNumberOrNull = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toTimestampMs = (value: unknown): number | null => {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }

  const num = toFiniteNumberOrNull(value);
  if (num == null) return null;
  return num > 10_000_000_000 ? Math.floor(num) : Math.floor(num * 1000);
};

const roundNullable = (value: number | null, digits = 6): number | null => {
  if (value == null || !Number.isFinite(value)) return null;
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
};

const pctChange = (current: number | null, previous: number | null) => {
  if (
    current == null ||
    previous == null ||
    !Number.isFinite(current) ||
    !Number.isFinite(previous) ||
    previous === 0
  ) {
    return null;
  }

  return ((current - previous) / Math.abs(previous)) * 100;
};

const normalizeRows = (
  rows: DerivativesRow[] | undefined,
  timestamp: number,
): NormalizedDerivativesRow[] =>
  (rows ?? [])
    .map((row) => ({
      ...row,
      tsMs: toTimestampMs(row.ts),
      openInterest: toFiniteNumberOrNull(row.openInterest),
      fundingRate: toFiniteNumberOrNull(row.fundingRate),
      liqLong: toFiniteNumberOrNull(row.liqLong),
      liqShort: toFiniteNumberOrNull(row.liqShort),
      liqTotal: toFiniteNumberOrNull(row.liqTotal),
    }))
    .filter((row): row is NormalizedDerivativesRow => {
      return row.tsMs != null && row.tsMs <= timestamp;
    })
    .sort((a, b) => a.tsMs - b.tsMs);

const findRowAtOrBefore = <
  TRow extends {
    tsMs: number;
  },
>(
  rows: TRow[],
  targetTs: number,
): TRow | null => {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i].tsMs <= targetTs) {
      return rows[i];
    }
  }
  return null;
};

const calculateZScore = (
  values: Array<number | null>,
  current: number | null,
) => {
  const finite = values.filter(
    (value): value is number =>
      typeof value === 'number' && Number.isFinite(value),
  );
  if (current == null || finite.length < 3) return null;

  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  const variance =
    finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / finite.length;
  const std = Math.sqrt(variance);
  if (!Number.isFinite(std) || std === 0) return 0;

  return (current - mean) / std;
};

const calculateAverage = (values: Array<number | null>) => {
  const finite = values.filter(
    (value): value is number =>
      typeof value === 'number' && Number.isFinite(value),
  );
  if (!finite.length) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
};

const buildIntervalContext = (params: {
  interval: DerivativesInterval;
  rows: DerivativesRow[] | undefined;
  timestamp: number;
  staleAfterMs: number;
}): DerivativesIntervalContext | null => {
  const { interval, rows, timestamp, staleAfterMs } = params;
  const normalizedRows = normalizeRows(rows, timestamp);
  const latest = normalizedRows[normalizedRows.length - 1];
  if (!latest) return null;

  const openInterest = latest.openInterest;
  const row1h = findRowAtOrBefore(normalizedRows, latest.tsMs - HOUR_MS);
  const row4h = findRowAtOrBefore(normalizedRows, latest.tsMs - 4 * HOUR_MS);
  const row24h = findRowAtOrBefore(normalizedRows, latest.tsMs - 24 * HOUR_MS);
  const liqLong = latest.liqLong;
  const liqShort = latest.liqShort;
  const liqTotal = latest.liqTotal ?? (liqLong ?? 0) + (liqShort ?? 0);
  const previousLiquidations = normalizedRows
    .slice(0, -1)
    .map((row) => row.liqTotal ?? (row.liqLong ?? 0) + (row.liqShort ?? 0));
  const avgPreviousLiquidations = calculateAverage(previousLiquidations);
  const liqSpikeRatio =
    liqTotal != null &&
    avgPreviousLiquidations != null &&
    avgPreviousLiquidations > 0
      ? liqTotal / avgPreviousLiquidations
      : null;
  const liqImbalance =
    liqTotal != null && liqTotal > 0
      ? ((liqShort ?? 0) - (liqLong ?? 0)) / liqTotal
      : null;

  return {
    interval,
    asOfTs: latest.tsMs,
    stale: timestamp - latest.tsMs > staleAfterMs,
    points: normalizedRows.length,
    openInterest: roundNullable(openInterest),
    oiChangePct1h: roundNullable(
      pctChange(openInterest, row1h?.openInterest ?? null),
      4,
    ),
    oiChangePct4h: roundNullable(
      pctChange(openInterest, row4h?.openInterest ?? null),
      4,
    ),
    oiChangePct24h: roundNullable(
      pctChange(openInterest, row24h?.openInterest ?? null),
      4,
    ),
    fundingRate: roundNullable(latest.fundingRate, 8),
    fundingZScore: roundNullable(
      calculateZScore(
        normalizedRows.map((row) => row.fundingRate),
        latest.fundingRate,
      ),
      4,
    ),
    liqLong: roundNullable(liqLong),
    liqShort: roundNullable(liqShort),
    liqTotal: roundNullable(liqTotal),
    liqImbalance: roundNullable(liqImbalance, 4),
    liqSpikeRatio: roundNullable(liqSpikeRatio, 4),
  };
};

const getPrimaryContext = (
  intervals: Partial<Record<DerivativesInterval, DerivativesIntervalContext>>,
) => intervals['15m'] ?? intervals['1h'] ?? null;

const isCrowdedLong = (context: DerivativesIntervalContext) =>
  (context.fundingRate != null && context.fundingRate >= 0.0005) ||
  (context.fundingZScore != null && context.fundingZScore >= 1.5);

const isCrowdedShort = (context: DerivativesIntervalContext) =>
  (context.fundingRate != null && context.fundingRate <= -0.0005) ||
  (context.fundingZScore != null && context.fundingZScore <= -1.5);

const hasLiquidationSpike = (context: DerivativesIntervalContext) =>
  context.liqSpikeRatio != null && context.liqSpikeRatio >= 2;

const detectPressure = (
  context: DerivativesIntervalContext | null,
): DerivativesPressure => {
  if (!context) return 'neutral';
  if (
    hasLiquidationSpike(context) &&
    context.liqImbalance != null &&
    context.liqImbalance <= -0.35
  ) {
    return 'long_flush';
  }
  if (
    hasLiquidationSpike(context) &&
    context.liqImbalance != null &&
    context.liqImbalance >= 0.35
  ) {
    return 'short_flush';
  }
  if (isCrowdedLong(context)) return 'crowded_long';
  if (isCrowdedShort(context)) return 'crowded_short';
  return 'neutral';
};

const collectRiskFlags = (
  contexts: DerivativesIntervalContext[],
): DerivativesContextRiskFlag[] => {
  const flags = new Set<DerivativesContextRiskFlag>();
  if (!contexts.length) {
    flags.add('missing_derivatives');
    return [...flags];
  }

  if (contexts.some((context) => context.stale)) {
    flags.add('stale_derivatives');
  }

  for (const context of contexts) {
    if (isCrowdedLong(context)) flags.add('crowded_long');
    if (isCrowdedShort(context)) flags.add('crowded_short');
    if (context.oiChangePct1h != null && context.oiChangePct1h < -1) {
      flags.add('oi_falling');
    }
    if (
      context.oiChangePct1h != null &&
      Math.abs(context.oiChangePct1h) < 0.15
    ) {
      flags.add('oi_not_confirming');
    }
    if (
      hasLiquidationSpike(context) &&
      context.liqImbalance != null &&
      context.liqImbalance <= -0.35
    ) {
      flags.add('long_liquidation_spike');
    }
    if (
      hasLiquidationSpike(context) &&
      context.liqImbalance != null &&
      context.liqImbalance >= 0.35
    ) {
      flags.add('short_liquidation_spike');
    }
  }

  return [...flags];
};

const resolveDirectionAligned = (params: {
  direction: Direction;
  primary: DerivativesIntervalContext | null;
  pressure: DerivativesPressure;
  riskFlags: DerivativesContextRiskFlag[];
}) => {
  const { direction, primary, pressure, riskFlags } = params;
  if (!primary || primary.stale || riskFlags.includes('missing_derivatives')) {
    return null;
  }

  if (direction === 'LONG') {
    if (pressure === 'crowded_long' || riskFlags.includes('oi_falling')) {
      return false;
    }
    if (
      pressure === 'short_flush' ||
      (primary.oiChangePct1h != null &&
        primary.oiChangePct1h > 0.25 &&
        !riskFlags.includes('crowded_long'))
    ) {
      return true;
    }
    return null;
  }

  if (pressure === 'crowded_short' || riskFlags.includes('oi_falling')) {
    return false;
  }
  if (
    pressure === 'long_flush' ||
    (primary.oiChangePct1h != null &&
      primary.oiChangePct1h > 0.25 &&
      !riskFlags.includes('crowded_short'))
  ) {
    return true;
  }
  return null;
};

export const buildDerivativesContext = (params: {
  symbol: string;
  direction: Direction;
  timestamp: number;
  rowsByInterval: Partial<Record<DerivativesInterval, DerivativesRow[]>>;
  intervals?: DerivativesInterval[];
  staleAfterMsByInterval?: Partial<Record<DerivativesInterval, number>>;
}): DerivativesContext => {
  const {
    symbol,
    direction,
    timestamp,
    rowsByInterval,
    intervals = DERIVATIVES_INTERVALS,
    staleAfterMsByInterval = {},
  } = params;
  const intervalContexts: Partial<
    Record<DerivativesInterval, DerivativesIntervalContext>
  > = {};

  for (const interval of intervals) {
    const context = buildIntervalContext({
      interval,
      rows: rowsByInterval[interval],
      timestamp,
      staleAfterMs:
        staleAfterMsByInterval[interval] ?? DEFAULT_STALE_AFTER_MS[interval],
    });
    if (context) {
      intervalContexts[interval] = context;
    }
  }

  const contexts = Object.values(intervalContexts);
  const primary = getPrimaryContext(intervalContexts);
  const pressure = detectPressure(primary);
  const riskFlags = collectRiskFlags(contexts);

  return {
    source: 'coinalyze',
    symbol,
    timestamp,
    intervals: intervalContexts,
    summary: {
      pressure,
      directionAligned: resolveDirectionAligned({
        direction,
        primary,
        pressure,
        riskFlags,
      }),
      riskFlags,
    },
  };
};
