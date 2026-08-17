/** @jest-environment node */

import { appendRecentCandle, takeRecentCandles } from '../state';

const makeCandle = (timestamp: number, close = 100) => ({
  timestamp,
  dt: new Date(timestamp).toISOString(),
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: 1_000,
  turnover: close * 1_000,
});

describe('recent candle helpers', () => {
  it('keeps only the requested tail of initial history', () => {
    const candles = [1, 2, 3, 4].map((timestamp) => makeCandle(timestamp));

    expect(takeRecentCandles(candles, 2).map((item) => item.timestamp)).toEqual(
      [3, 4],
    );
  });

  it('deduplicates the current candle by timestamp when appending', () => {
    const candles = [1, 2, 3].map((timestamp) => makeCandle(timestamp));
    const updated = appendRecentCandle(candles, makeCandle(3, 105), 3);

    expect(updated.map((item) => item.timestamp)).toEqual([1, 2, 3]);
    expect(updated.at(-1)?.close).toBe(105);
  });

  it('bounds appended history to the configured limit', () => {
    const candles = [1, 2, 3].map((timestamp) => makeCandle(timestamp));
    const updated = appendRecentCandle(candles, makeCandle(4), 3);

    expect(updated.map((item) => item.timestamp)).toEqual([2, 3, 4]);
  });
});
