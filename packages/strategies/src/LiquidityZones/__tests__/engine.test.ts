/** @jest-environment node */

import { config as DEFAULT_CONFIG } from '../config';
import { createLiquidityZonesEngine } from '../engine';

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
    LIQUIDITY_ZONES_PIVOT_LOOKBACK: 1,
    LIQUIDITY_ZONES_MIN_FILTER_VALUE: 0,
    ...overrides,
  }) as any;

describe('Liquidity Zones engine', () => {
  it('detects swing-low liquidity zone retests', () => {
    const engine = createLiquidityZonesEngine({ config: makeConfig() });
    const candles = [
      makeCandle(0, 102, 105, 100, 103),
      makeCandle(1, 100, 102, 90, 101),
      makeCandle(2, 99, 105, 99, 104),
    ];

    const states = candles.map((candle) => engine.next(candle as any));
    const signal = states[states.length - 1].signal;

    expect(signal?.direction).toBe('LONG');
    expect(signal?.zone.kind).toBe('swing_low_liquidity');
    expect(signal?.zone.top).toBe(100);
    expect(signal?.zone.bottom).toBe(90);
    expect(signal?.reactionBodyAligned).toBe(true);
  });

  it('detects swing-high liquidity zone retests', () => {
    const engine = createLiquidityZonesEngine({ config: makeConfig() });
    const candles = [
      makeCandle(0, 98, 100, 95, 97),
      makeCandle(1, 100, 110, 99, 101),
      makeCandle(2, 106, 107, 96, 100),
    ];

    const states = candles.map((candle) => engine.next(candle as any));
    const signal = states[states.length - 1].signal;

    expect(signal?.direction).toBe('SHORT');
    expect(signal?.zone.kind).toBe('swing_high_liquidity');
    expect(signal?.zone.top).toBe(110);
    expect(signal?.zone.bottom).toBe(101);
    expect(signal?.reactionBodyAligned).toBe(true);
  });

  it('keeps absolute zone indexes after the rolling candle buffer trims history', () => {
    const engine = createLiquidityZonesEngine({ config: makeConfig() });
    for (let index = 0; index < 20; index += 1) {
      engine.next(makeCandle(index, 100, 101, 99, 100) as any);
    }

    const base = 20;
    const candles = [
      makeCandle(base, 102, 105, 100, 103),
      makeCandle(base + 1, 100, 102, 90, 101),
      makeCandle(base + 2, 99, 105, 99, 104),
    ];

    const states = candles.map((candle) => engine.next(candle as any));
    const signal = states[states.length - 1].signal;

    expect(signal?.direction).toBe('LONG');
    expect(signal?.zone.startIndex).toBe(base + 1);
    expect(signal?.zoneAgeBars).toBe(1);
  });
});
