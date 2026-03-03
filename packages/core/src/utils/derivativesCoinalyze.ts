import { DerivativesRow, DerivativesInterval } from './timescale';
import {
  parseDerivativesIntervals,
  toFiniteNumber as toFinite,
} from './derivativesFeatureUtils';

export type CoinalyzePoint = {
  symbol: string;
  ts: number;
  openInterest?: number | null;
  fundingRate?: number | null;
  liqLong?: number | null;
  liqShort?: number | null;
  liqTotal?: number | null;
};

export const normalizeCoinalyzeSymbols = (input: unknown): string[] =>
  String(input ?? '')
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);

export const normalizeDerivativesIntervals = (
  input: unknown,
): DerivativesInterval[] => parseDerivativesIntervals(input);

export const toCoinalyzeTimestampMs = (value: unknown): number | null => {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num > 10_000_000_000_000) return Math.floor(num / 1000);
  if (num > 10_000_000_000) return Math.floor(num);
  return Math.floor(num * 1000);
};

export const toFiniteNumber = (value: unknown): number | null =>
  Number.isFinite(Number(value)) ? toFinite(value) : null;

export const toArrayData = <T>(value: unknown): T[] => {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    const maybeData = (value as Record<string, unknown>).data;
    if (Array.isArray(maybeData)) return maybeData as T[];
    const maybeResult = (value as Record<string, unknown>).result;
    if (Array.isArray(maybeResult)) return maybeResult as T[];
  }
  return [];
};

export const mergeCoinalyzeMetrics = (params: {
  symbol: string;
  oiRaw: unknown;
  fundingRaw: unknown;
  liqRaw: unknown;
}): CoinalyzePoint[] => {
  const { symbol, oiRaw, fundingRaw, liqRaw } = params;
  const points = new Map<number, CoinalyzePoint>();
  const upsertPoint = (ts: number) => {
    let point = points.get(ts);
    if (!point) {
      point = { symbol, ts };
      points.set(ts, point);
    }
    return point;
  };

  for (const item of toArrayData<Record<string, unknown>>(oiRaw)) {
    const ts = toCoinalyzeTimestampMs(
      item.t ?? item.ts ?? item.time ?? item.timestamp,
    );
    if (!ts) continue;
    const point = upsertPoint(ts);
    point.openInterest = toFiniteNumber(
      item.open_interest ?? item.openInterest ?? item.oi ?? item.value,
    );
  }

  for (const item of toArrayData<Record<string, unknown>>(fundingRaw)) {
    const ts = toCoinalyzeTimestampMs(
      item.t ?? item.ts ?? item.time ?? item.timestamp,
    );
    if (!ts) continue;
    const point = upsertPoint(ts);
    point.fundingRate = toFiniteNumber(
      item.funding_rate ?? item.fundingRate ?? item.rate ?? item.value,
    );
  }

  for (const item of toArrayData<Record<string, unknown>>(liqRaw)) {
    const ts = toCoinalyzeTimestampMs(
      item.t ?? item.ts ?? item.time ?? item.timestamp,
    );
    if (!ts) continue;
    const point = upsertPoint(ts);
    point.liqLong = toFiniteNumber(
      item.liq_long ?? item.long_liq ?? item.longLiquidations ?? item.long,
    );
    point.liqShort = toFiniteNumber(
      item.liq_short ?? item.short_liq ?? item.shortLiquidations ?? item.short,
    );
    point.liqTotal =
      toFiniteNumber(
        item.liq_total ?? item.total_liq ?? item.totalLiquidations,
      ) ?? (point.liqLong ?? 0) + (point.liqShort ?? 0);
  }

  return [...points.values()].sort((a, b) => a.ts - b.ts);
};

export const coinalyzePointsToRows = (
  points: CoinalyzePoint[],
  interval: DerivativesInterval,
  source: string,
): DerivativesRow[] =>
  points.map((point) => ({
    symbol: point.symbol,
    interval,
    ts: new Date(point.ts),
    openInterest: point.openInterest ?? null,
    fundingRate: point.fundingRate ?? null,
    liqLong: point.liqLong ?? null,
    liqShort: point.liqShort ?? null,
    liqTotal: point.liqTotal ?? null,
    source,
  }));
