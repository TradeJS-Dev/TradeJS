import type {
  DerivativesContext,
  DerivativesContextRiskFlag,
  DerivativesInterval,
  DerivativesIntervalContext,
  DerivativesPriceOiDivergenceType,
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

type NormalizedDerivativesRow = {
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
): NormalizedDerivativesRow[] => {
  const normalized: NormalizedDerivativesRow[] = [];

  for (const row of rows ?? []) {
    const tsMs = toTimestampMs(row.ts);
    if (tsMs == null || tsMs > timestamp) {
      continue;
    }

    normalized.push({
      tsMs,
      openInterest: toFiniteNumberOrNull(row.openInterest),
      fundingRate: toFiniteNumberOrNull(row.fundingRate),
      liqLong: toFiniteNumberOrNull(row.liqLong),
      liqShort: toFiniteNumberOrNull(row.liqShort),
      liqTotal: toFiniteNumberOrNull(row.liqTotal),
    });
  }

  normalized.sort((a, b) => a.tsMs - b.tsMs);
  return normalized;
};

const findRowAtOrBefore = <
  TRow extends {
    tsMs: number;
  },
>(
  rows: TRow[],
  targetTs: number,
  endIndex = rows.length - 1,
): TRow | null => {
  for (let i = Math.min(endIndex, rows.length - 1); i >= 0; i -= 1) {
    if (rows[i].tsMs <= targetTs) {
      return rows[i];
    }
  }
  return null;
};

const calculateAverageLiquidationsBefore = (
  rows: NormalizedDerivativesRow[],
  endIndex: number,
) => {
  let sum = 0;
  let count = 0;

  for (let index = 0; index < endIndex; index += 1) {
    const row = rows[index];
    const value = row.liqTotal ?? (row.liqLong ?? 0) + (row.liqShort ?? 0);
    if (typeof value === 'number' && Number.isFinite(value)) {
      sum += value;
      count += 1;
    }
  }

  return count > 0 ? sum / count : null;
};

const calculateFundingZScore = (
  rows: NormalizedDerivativesRow[],
  current: number | null,
  endIndex: number,
) => {
  if (current == null) return null;

  let sum = 0;
  let count = 0;
  for (let index = 0; index <= endIndex; index += 1) {
    const value = rows[index].fundingRate;
    if (typeof value === 'number' && Number.isFinite(value)) {
      sum += value;
      count += 1;
    }
  }
  if (count < 3) return null;

  const mean = sum / count;
  let varianceSum = 0;
  for (let index = 0; index <= endIndex; index += 1) {
    const value = rows[index].fundingRate;
    if (typeof value === 'number' && Number.isFinite(value)) {
      varianceSum += (value - mean) ** 2;
    }
  }

  const std = Math.sqrt(varianceSum / count);
  if (!Number.isFinite(std) || std === 0) return 0;
  return (current - mean) / std;
};

const buildIntervalContext = (params: {
  interval: DerivativesInterval;
  rows: NormalizedDerivativesRow[];
  timestamp: number;
  staleAfterMs: number;
  latestIndex?: number;
}): DerivativesIntervalContext | null => {
  const { interval, rows, timestamp, staleAfterMs } = params;
  const latestIndex =
    params.latestIndex ??
    (() => {
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (rows[index].tsMs <= timestamp) {
          return index;
        }
      }
      return -1;
    })();
  const latest = latestIndex >= 0 ? rows[latestIndex] : null;
  if (!latest) return null;

  const openInterest = latest.openInterest;
  const row1h = findRowAtOrBefore(rows, latest.tsMs - HOUR_MS, latestIndex);
  const row4h = findRowAtOrBefore(rows, latest.tsMs - 4 * HOUR_MS, latestIndex);
  const row24h = findRowAtOrBefore(
    rows,
    latest.tsMs - 24 * HOUR_MS,
    latestIndex,
  );
  const liqLong = latest.liqLong;
  const liqShort = latest.liqShort;
  const liqTotal = latest.liqTotal ?? (liqLong ?? 0) + (liqShort ?? 0);
  const avgPreviousLiquidations = calculateAverageLiquidationsBefore(
    rows,
    latestIndex,
  );
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
    points: latestIndex + 1,
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
      calculateFundingZScore(rows, latest.fundingRate, latestIndex),
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
  priceChangePct1h?: number | null;
  intervals?: DerivativesInterval[];
  staleAfterMsByInterval?: Partial<Record<DerivativesInterval, number>>;
}): DerivativesContext => {
  const {
    symbol,
    direction,
    timestamp,
    rowsByInterval,
    priceChangePct1h = null,
    intervals = DERIVATIVES_INTERVALS,
    staleAfterMsByInterval = {},
  } = params;
  const intervalContexts: Partial<
    Record<DerivativesInterval, DerivativesIntervalContext>
  > = {};
  const normalizedRowsByInterval: Partial<
    Record<DerivativesInterval, NormalizedDerivativesRow[]>
  > = {};

  for (const interval of intervals) {
    const normalizedRows = normalizeRows(rowsByInterval[interval], timestamp);
    normalizedRowsByInterval[interval] = normalizedRows;
    const context = buildIntervalContext({
      interval,
      rows: normalizedRows,
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
  const fundingChange1h =
    primary?.fundingRate != null && primary.interval === '15m'
      ? (() => {
          const normalizedRows = normalizedRowsByInterval['15m'] ?? [];
          const latest = normalizedRows[normalizedRows.length - 1];
          const row1h = latest
            ? findRowAtOrBefore(normalizedRows, latest.tsMs - HOUR_MS)
            : null;
          return latest?.fundingRate != null && row1h?.fundingRate != null
            ? roundNullable(latest.fundingRate - row1h.fundingRate, 8)
            : null;
        })()
      : null;
  const oiAcceleration =
    primary?.oiChangePct1h != null && primary?.oiChangePct4h != null
      ? roundNullable(primary.oiChangePct1h - primary.oiChangePct4h / 4, 4)
      : null;
  let priceOiDivergenceType: DerivativesPriceOiDivergenceType = 'unknown';
  if (
    priceChangePct1h != null &&
    Number.isFinite(priceChangePct1h) &&
    primary?.oiChangePct1h != null &&
    Number.isFinite(primary.oiChangePct1h)
  ) {
    const priceUp = priceChangePct1h > 0.05;
    const priceDown = priceChangePct1h < -0.05;
    const oiUp = primary.oiChangePct1h > 0.15;
    const oiDown = primary.oiChangePct1h < -0.15;

    priceOiDivergenceType =
      priceUp && oiUp
        ? 'price_up_oi_up'
        : priceUp && oiDown
          ? 'price_up_oi_down'
          : priceDown && oiUp
            ? 'price_down_oi_up'
            : priceDown && oiDown
              ? 'price_down_oi_down'
              : 'flat_or_mixed';
  }
  const crowdingPersistenceBars =
    primary?.interval === '15m'
      ? (() => {
          const normalizedRows = normalizedRowsByInterval['15m'] ?? [];
          if (!normalizedRows.length) return null;
          let persistence = 0;
          const latestContext = primary;
          const crowdedState = isCrowdedLong(latestContext)
            ? 'crowded_long'
            : isCrowdedShort(latestContext)
              ? 'crowded_short'
              : null;
          if (!crowdedState) return 0;

          for (let i = normalizedRows.length - 1; i >= 0; i -= 1) {
            const candidate = normalizedRows[i];
            const probe = buildIntervalContext({
              interval: '15m',
              rows: normalizedRows,
              timestamp: candidate.tsMs,
              staleAfterMs: DEFAULT_STALE_AFTER_MS['15m'],
              latestIndex: i,
            });
            if (!probe) break;
            const probeState = isCrowdedLong(probe)
              ? 'crowded_long'
              : isCrowdedShort(probe)
                ? 'crowded_short'
                : null;
            if (probeState !== crowdedState) break;
            persistence += 1;
          }

          return persistence;
        })()
      : null;

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
      fundingChange1h,
      oiAcceleration,
      priceOiDivergenceType,
      crowdingPersistenceBars,
    },
  };
};
