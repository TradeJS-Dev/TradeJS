import type { Candle } from '@tradejs/types';

export const isConfirmedPivotHigh = (
  candles: Candle[],
  index: number,
  lookback: number,
) => {
  const candidate = candles[index];
  if (!candidate) return false;

  for (
    let cursor = Math.max(0, index - lookback);
    cursor <= Math.min(candles.length - 1, index + lookback);
    cursor += 1
  ) {
    if (cursor !== index && candles[cursor].high > candidate.high) return false;
  }

  return true;
};

export const isConfirmedPivotLow = (
  candles: Candle[],
  index: number,
  lookback: number,
) => {
  const candidate = candles[index];
  if (!candidate) return false;

  for (
    let cursor = Math.max(0, index - lookback);
    cursor <= Math.min(candles.length - 1, index + lookback);
    cursor += 1
  ) {
    if (cursor !== index && candles[cursor].low < candidate.low) return false;
  }

  return true;
};
