import { DerivativesInterval } from '@tradejs/infra/timescale';

export const SUPPORTED_DERIVATIVE_INTERVALS: DerivativesInterval[] = [
  '15m',
  '1h',
];

export const parseDerivativesIntervals = (
  value: unknown,
): DerivativesInterval[] => {
  const supported = new Set<DerivativesInterval>(
    SUPPORTED_DERIVATIVE_INTERVALS,
  );
  const values = String(value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return values.filter((item): item is DerivativesInterval =>
    supported.has(item as DerivativesInterval),
  );
};

export const toTimestampMs = (value: unknown): number | null => {
  if (value instanceof Date) {
    const ts = value.getTime();
    return Number.isFinite(ts) ? ts : null;
  }
  if (typeof value === 'string') {
    const ts = new Date(value).getTime();
    return Number.isFinite(ts) ? ts : null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

export const binarySearchLatestByTs = <T extends { ts: number }>(
  points: T[],
  ts: number,
) => {
  let lo = 0;
  let hi = points.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (points[mid].ts <= ts) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
};
