/** @jest-environment node */

import { config as DEFAULT_CONFIG } from '../config';
import { createTrendFollowEngine } from '../engine';

const makeCandle = (
  index: number,
  open: number,
  high: number,
  low: number,
  close: number,
) => ({
  timestamp: 1_700_000_000_000 + index * 60_000,
  dt: new Date(1_700_000_000_000 + index * 60_000).toISOString(),
  open,
  high,
  low,
  close,
  volume: 1_000 + index * 100,
  turnover: close * (1_000 + index * 100),
});

const makeConfig = (overrides: Record<string, unknown> = {}) =>
  ({
    ...DEFAULT_CONFIG,
    TRENDFOLLOW_PIVOT_LENGTH: 2,
    TRENDFOLLOW_ATR_LENGTH: 2,
    TRENDFOLLOW_ATR_MULT: 1,
    ...overrides,
  }) as any;

describe('TrendFollow engine', () => {
  it('detects bull trend when close crosses confirmed pivot high', () => {
    const engine = createTrendFollowEngine({ config: makeConfig() });
    const candles = [
      makeCandle(0, 99, 100, 95, 98),
      makeCandle(1, 100, 105, 99, 101),
      makeCandle(2, 101, 110, 98, 102),
      makeCandle(3, 102, 104, 99, 103),
      makeCandle(4, 103, 103, 100, 102),
      makeCandle(5, 103, 113, 102, 112),
    ];

    const states = candles.map((candle) => engine.next(candle as any));
    const signal = states[states.length - 1].signal;

    expect(signal?.direction).toBe('LONG');
    expect(signal?.entryLevel).toBe(110);
    expect(signal?.trailStop).toBeLessThan(signal?.close ?? 0);
  });

  it('keeps absolute pivot indexes after the rolling candle buffer trims history', () => {
    const engine = createTrendFollowEngine({ config: makeConfig() });
    for (let index = 0; index < 40; index += 1) {
      const price = 50 + index;
      engine.next(makeCandle(index, price, price + 1, price - 1, price) as any);
    }

    const base = 40;
    const candles = [
      makeCandle(base, 99, 100, 95, 98),
      makeCandle(base + 1, 100, 105, 99, 101),
      makeCandle(base + 2, 101, 110, 98, 102),
      makeCandle(base + 3, 102, 104, 99, 103),
      makeCandle(base + 4, 103, 103, 100, 102),
      makeCandle(base + 5, 103, 113, 102, 112),
    ];

    const states = candles.map((candle) => engine.next(candle as any));
    const signal = states[states.length - 1].signal;

    expect(signal?.direction).toBe('LONG');
    expect(signal?.pivot.index).toBe(base + 2);
    expect(signal?.barsSinceSignal).toBe(0);
  });

  it('detects bear trend when close crosses confirmed pivot low', () => {
    const engine = createTrendFollowEngine({ config: makeConfig() });
    const candles = [
      makeCandle(0, 105, 110, 100, 106),
      makeCandle(1, 105, 106, 95, 99),
      makeCandle(2, 99, 104, 90, 98),
      makeCandle(3, 98, 103, 96, 97),
      makeCandle(4, 97, 102, 97, 96),
      makeCandle(5, 96, 97, 87, 88),
    ];

    const states = candles.map((candle) => engine.next(candle as any));
    const signal = states[states.length - 1].signal;

    expect(signal?.direction).toBe('SHORT');
    expect(signal?.entryLevel).toBe(90);
    expect(signal?.trailStop).toBeGreaterThan(signal?.close ?? 0);
  });
});
