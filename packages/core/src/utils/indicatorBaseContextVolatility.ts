import type { Candle } from '@tradejs/types';
import { safeDivide } from './indicatorMath';

export const calculateTrueRange = (
  current: Candle,
  previous: Candle | null,
): number =>
  previous == null
    ? current.high - current.low
    : Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close),
      );

const calculateRecentFiniteSeries = (
  length: number,
  lookback: number,
  calculateAt: (index: number) => number | null,
) => {
  const values: number[] = [];

  for (
    let index = length - 1;
    index >= 0 && values.length < lookback;
    index -= 1
  ) {
    const value = calculateAt(index);
    if (typeof value === 'number' && Number.isFinite(value)) {
      values.push(value);
    }
  }

  return values.reverse();
};

const calculateRealizedVolatilityAt = (
  closes: number[],
  index: number,
  period = 20,
) => {
  if (index < period) {
    return null;
  }

  const startIndex = index - period;
  const returns = closes
    .slice(startIndex + 1, index + 1)
    .map((close, offset) => {
      const previous = closes[startIndex + offset];
      return previous > 0 ? Math.log(close / previous) : 0;
    });
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    returns.length;

  return Math.sqrt(variance);
};

export const calculateRealizedVolatility = (
  closes: number[],
  period = 20,
): number | null =>
  calculateRealizedVolatilityAt(closes, closes.length - 1, period);

export const calculateRecentRealizedVolatilitySeries = (
  closes: number[],
  lookback: number,
  period = 20,
): number[] =>
  calculateRecentFiniteSeries(closes.length, lookback, (index) =>
    calculateRealizedVolatilityAt(closes, index, period),
  );

const calculateBbWidthPctAt = (
  closes: number[],
  index: number,
  period = 20,
  stdMultiplier = 2,
) => {
  const windowStart = index + 1 - period;
  if (windowStart < 0) {
    return null;
  }

  const window = closes.slice(windowStart, index + 1);
  const mean = window.reduce((sum, value) => sum + value, 0) / window.length;
  const variance =
    window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / window.length;
  const std = Math.sqrt(variance);

  return mean === 0 ? null : ((std * stdMultiplier * 2) / mean) * 100;
};

export const calculateRecentBbWidthPctSeries = (
  closes: number[],
  lookback: number,
  period = 20,
  stdMultiplier = 2,
): number[] =>
  calculateRecentFiniteSeries(closes.length, lookback, (index) =>
    calculateBbWidthPctAt(closes, index, period, stdMultiplier),
  );

const calculateAtrPctAt = (candles: Candle[], index: number, period = 14) => {
  const windowStart = index + 1 - period;
  if (windowStart < 0) {
    return null;
  }

  const atrValue =
    candles.slice(windowStart, index + 1).reduce((sum, item, windowIndex) => {
      const absoluteIndex = windowStart + windowIndex;
      const previous = absoluteIndex > 0 ? candles[absoluteIndex - 1] : null;
      return sum + calculateTrueRange(item, previous);
    }, 0) / period;

  return safeDivide(atrValue, candles[index].close);
};

export const calculateAtrAt = (
  candles: Candle[],
  index: number,
  period = 14,
): number | null => {
  const windowStart = index + 1 - period;
  if (windowStart < 0) {
    return null;
  }

  return (
    candles.slice(windowStart, index + 1).reduce((sum, item, windowIndex) => {
      const absoluteIndex = windowStart + windowIndex;
      const previous = absoluteIndex > 0 ? candles[absoluteIndex - 1] : null;
      return sum + calculateTrueRange(item, previous);
    }, 0) / period
  );
};

export const calculateAtrSeries = (
  candles: Candle[],
  period = 14,
): Array<number | null> => {
  const result: Array<number | null> = [];
  let rollingSum = 0;
  const ranges: number[] = [];

  for (let index = 0; index < candles.length; index += 1) {
    const range = calculateTrueRange(
      candles[index],
      candles[index - 1] ?? null,
    );
    ranges.push(range);
    rollingSum += range;
    if (ranges.length > period) {
      rollingSum -= ranges[ranges.length - period - 1] ?? 0;
    }

    result[index] = ranges.length >= period ? rollingSum / period : null;
  }

  return result;
};

export const calculateRecentAtrPctSeries = (
  candles: Candle[],
  lookback: number,
  period = 14,
): number[] =>
  calculateRecentFiniteSeries(candles.length, lookback, (index) =>
    calculateAtrPctAt(candles, index, period),
  );

export const calculateRangeExpansionAt = (
  candles: Candle[],
  index: number,
): number | null => {
  const item = candles[index];
  if (!item) {
    return null;
  }

  const previous = index > 0 ? candles[index - 1] : null;
  return safeDivide(item.high - item.low, calculateTrueRange(item, previous));
};

export const calculateRecentRangeExpansionSeries = (
  candles: Candle[],
  lookback: number,
): number[] =>
  calculateRecentFiniteSeries(candles.length, lookback, (index) =>
    calculateRangeExpansionAt(candles, index),
  );
