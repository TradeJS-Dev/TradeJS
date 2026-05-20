import { Candle, MlCandleIndicatorsSnapshot } from '@tradejs/types';
import { ML_BASE_CANDLES_WINDOW } from '../constants';

export const CANDLE_WINDOW = ML_BASE_CANDLES_WINDOW;
export const BASE_INTERVAL_MINUTES = 15;
export const INDICATOR_TIMEFRAMES = [
  { minutes: 60, suffix: '1h' },
  { minutes: 240, suffix: '4h' },
  { minutes: 1440, suffix: '1d' },
] as const;
export const ONE_DAY_MS = 86_400_000;
export const ONE_DAY_CANDLE_WINDOW =
  ONE_DAY_MS / (BASE_INTERVAL_MINUTES * 60_000);

export const toMlCandle = (candle: Candle): Candle => ({
  open: Number(candle.open) || 0,
  high: Number(candle.high) || 0,
  low: Number(candle.low) || 0,
  close: Number(candle.close) || 0,
  volume: Number(candle.volume) || 0,
  turnover: Number(candle.turnover) || 0,
  timestamp: Number(candle.timestamp) || 0,
});

export const cloneMlCandle = (candle: Candle): Candle => ({
  open: candle.open,
  high: candle.high,
  low: candle.low,
  close: candle.close,
  volume: candle.volume,
  turnover: candle.turnover,
  timestamp: candle.timestamp,
});

export const buildCandleSignature = (
  candle: Candle | undefined,
): string | null => {
  if (!candle) return null;
  return [
    candle.timestamp,
    candle.open,
    candle.high,
    candle.low,
    candle.close,
    candle.volume,
    candle.turnover,
  ].join(':');
};

export const resampleCandles = (
  candles: Candle[],
  targetMinutes: number,
): Candle[] => {
  if (targetMinutes <= BASE_INTERVAL_MINUTES) return candles.map(toMlCandle);

  const bucketMs = targetMinutes * 60_000;
  const buckets = new Map<number, Candle>();
  for (const raw of candles) {
    const candle = toMlCandle(raw);
    const ts = candle.timestamp;
    if (!Number.isFinite(ts) || ts <= 0) continue;

    const bucket = Math.floor(ts / bucketMs) * bucketMs;
    const current = buckets.get(bucket);
    if (!current) {
      buckets.set(bucket, { ...candle, timestamp: bucket });
      continue;
    }

    current.high = Math.max(current.high, candle.high);
    current.low = Math.min(current.low, candle.low);
    current.close = candle.close;
    current.volume += candle.volume;
    current.turnover += candle.turnover;
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, candle]) => candle);
};

export const createIncrementalResampleCache = (targetMinutes: number) => {
  const bucketMs = targetMinutes * 60_000;
  const candles: Candle[] = [];

  return {
    restore: (seedCandles: Candle[]) => {
      candles.length = 0;
      seedCandles.forEach((candle) => {
        candles.push(cloneMlCandle(candle));
      });
    },
    push: (raw: Candle) => {
      const candle = toMlCandle(raw);
      const ts = candle.timestamp;
      if (!Number.isFinite(ts) || ts <= 0) {
        return;
      }

      const bucket = Math.floor(ts / bucketMs) * bucketMs;
      const last = candles[candles.length - 1];
      if (!last || last.timestamp !== bucket) {
        candles.push({ ...candle, timestamp: bucket });
        return;
      }

      last.high = Math.max(last.high, candle.high);
      last.low = Math.min(last.low, candle.low);
      last.close = candle.close;
      last.volume += candle.volume;
      last.turnover += candle.turnover;
    },
    snapshot: (limit?: number) => {
      if (limit == null || limit >= candles.length) {
        return candles;
      }

      return candles.slice(0, limit);
    },
    size: () => candles.length,
  };
};

export const buildMlCandleIndicators = (
  candles: Candle[],
  btcCandles: Candle[],
): MlCandleIndicatorsSnapshot => ({
  candles15m: candles.slice(-CANDLE_WINDOW).map(toMlCandle),
  candles1h: resampleCandles(candles, 60).slice(-CANDLE_WINDOW),
  candles4h: resampleCandles(candles, 240).slice(-CANDLE_WINDOW),
  candles1d: resampleCandles(candles, 1440).slice(-CANDLE_WINDOW),
  btcCandles15m: btcCandles.slice(-CANDLE_WINDOW).map(toMlCandle),
  btcCandles1h: resampleCandles(btcCandles, 60).slice(-CANDLE_WINDOW),
  btcCandles4h: resampleCandles(btcCandles, 240).slice(-CANDLE_WINDOW),
  btcCandles1d: resampleCandles(btcCandles, 1440).slice(-CANDLE_WINDOW),
});

export const percentChange = (
  current: number,
  previous: number,
): number | null => {
  if (
    !Number.isFinite(current) ||
    !Number.isFinite(previous) ||
    previous === 0
  ) {
    return null;
  }
  return ((current - previous) / previous) * 100;
};

export type IndicatorValue = number | null | undefined;

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const toNullable = (value: unknown): number | null =>
  isFiniteNumber(value) ? value : null;

export const safeDivide = (
  numerator: number | null,
  denominator: number | null,
) => {
  if (
    numerator == null ||
    denominator == null ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return null;
  }

  return numerator / denominator;
};

export const calculateZScore = (
  values: Array<number | null | undefined>,
  current: number | null,
) => {
  const finite = values.filter(isFiniteNumber);
  if (current == null || finite.length < 3) return null;

  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  const variance =
    finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / finite.length;
  const std = Math.sqrt(variance);
  if (!Number.isFinite(std) || std === 0) return 0;

  return (current - mean) / std;
};

export const getLastFiniteValue = (
  values: Array<number | null | undefined>,
): number | null => {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const value = values[i];
    if (isFiniteNumber(value)) return value;
  }
  return null;
};

export const getRelativeChange = (
  current: number | null,
  reference: number | null,
): number | null => {
  if (
    current == null ||
    reference == null ||
    !Number.isFinite(current) ||
    !Number.isFinite(reference) ||
    reference === 0
  ) {
    return null;
  }

  return (current - reference) / Math.abs(reference);
};

export const calculateLineSlope = (
  values: Array<number | null | undefined>,
  lookback = 5,
) => {
  const finite = values.filter(isFiniteNumber);
  const window = finite.slice(-lookback);
  if (window.length < 2) return null;

  const first = window[0];
  const last = window[window.length - 1];
  return (last - first) / (window.length - 1);
};

export const calculateRangePosition = (
  price: number,
  low: number | null,
  high: number | null,
) => {
  if (
    !Number.isFinite(price) ||
    low == null ||
    high == null ||
    !Number.isFinite(low) ||
    !Number.isFinite(high) ||
    high <= low
  ) {
    return null;
  }

  return (price - low) / (high - low);
};

export const averageLastN = (
  values: number[],
  period: number,
): number | null => {
  const safePeriod = Math.max(1, Math.floor(period));
  const window = values
    .filter((value) => Number.isFinite(value))
    .slice(-safePeriod);
  if (window.length < safePeriod) return null;
  return window.reduce((sum, value) => sum + value, 0) / window.length;
};
