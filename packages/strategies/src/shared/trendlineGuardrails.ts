export type TrendLinePoint = {
  timestamp?: unknown;
  value?: unknown;
};

export type TrendLineRuntime = {
  mode?: unknown;
  points?: unknown;
  touches?: unknown;
};

export type SignalDirection = 'LONG' | 'SHORT';

export const toFiniteNumberOrNull = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export const getLastFiniteNumber = (value: unknown) => {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  return toFiniteNumberOrNull(value[value.length - 1]);
};

export const getBias = (fast: number | null, slow: number | null) => {
  if (fast == null || slow == null) {
    return null;
  }
  if (fast > slow) {
    return 'bullish';
  }
  if (fast < slow) {
    return 'bearish';
  }
  return 'flat';
};

export const getSpreadPct = (fast: number | null, slow: number | null) => {
  if (fast == null || slow == null || slow === 0) {
    return null;
  }

  return ((fast - slow) / slow) * 100;
};

export const getTrendLineFromPayload = (signal: {
  figures?: Record<string, unknown>;
  additionalIndicators?: Record<string, unknown>;
}) =>
  (signal.figures?.trendLine as Record<string, unknown> | undefined) ??
  (signal.additionalIndicators?.trendLine as
    | Record<string, unknown>
    | undefined) ??
  null;

export const getSortedTrendLinePoints = (
  trendLine: TrendLineRuntime | null,
): Array<{ timestamp: number; value: number }> => {
  const rawPoints = Array.isArray(trendLine?.points) ? trendLine.points : [];

  return rawPoints
    .map((point) => {
      if (!point || typeof point !== 'object') {
        return null;
      }

      const typedPoint = point as TrendLinePoint;
      const timestamp = toFiniteNumberOrNull(typedPoint.timestamp);
      const value = toFiniteNumberOrNull(typedPoint.value);
      if (timestamp == null || value == null) {
        return null;
      }

      return { timestamp, value };
    })
    .filter(Boolean)
    .sort((left, right) => left!.timestamp - right!.timestamp) as Array<{
    timestamp: number;
    value: number;
  }>;
};

export const buildTrendLineEvaluator = (trendLine: TrendLineRuntime | null) => {
  const points = getSortedTrendLinePoints(trendLine);
  if (points.length === 0) {
    return null;
  }

  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const deltaTime = lastPoint.timestamp - firstPoint.timestamp;
  if (deltaTime === 0) {
    return {
      firstPoint,
      lastPoint,
      evaluate: (_timestamp: number) => lastPoint.value,
    };
  }

  const slope = (lastPoint.value - firstPoint.value) / deltaTime;
  return {
    firstPoint,
    lastPoint,
    evaluate: (timestamp: number) =>
      firstPoint.value + slope * (timestamp - firstPoint.timestamp),
  };
};
