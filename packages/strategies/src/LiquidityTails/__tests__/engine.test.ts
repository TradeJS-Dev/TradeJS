/** @jest-environment node */

import { config as DEFAULT_CONFIG } from '../config';
import { createLiquidityTailsEngine } from '../engine';

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
    LIQUIDITY_TAILS_ATR_LENGTH: 2,
    LIQUIDITY_TAILS_ATR_MULT: 0.3,
    LIQUIDITY_TAILS_MIN_WICK_RATIO: 1,
    LIQUIDITY_TAILS_WICK_DOMINANCE: 1.1,
    LIQUIDITY_TAILS_MIN_GAP: 1,
    ...overrides,
  }) as any;

describe('Liquidity Tails engine', () => {
  it('detects buy pressure zone retests with bullish reaction', () => {
    const engine = createLiquidityTailsEngine({ config: makeConfig() });
    const candles = [
      makeCandle(0, 100, 101, 99, 100),
      makeCandle(1, 100, 101, 99, 100),
      makeCandle(2, 100, 102, 95, 101),
      makeCandle(3, 99.5, 102, 99, 101),
    ];

    const states = candles.map((candle) => engine.next(candle as any));
    const signal = states[states.length - 1].signal;

    expect(signal?.direction).toBe('LONG');
    expect(signal?.zone.kind).toBe('buy_pressure');
    expect(signal?.zone.top).toBe(100);
    expect(signal?.zone.bottom).toBe(95);
    expect(signal?.reactionBodyAligned).toBe(true);
  });

  it('detects sell pressure zone retests with bearish reaction', () => {
    const engine = createLiquidityTailsEngine({ config: makeConfig() });
    const candles = [
      makeCandle(0, 100, 101, 99, 100),
      makeCandle(1, 100, 101, 99, 100),
      makeCandle(2, 101, 107, 100, 100),
      makeCandle(3, 101.5, 106, 99, 100),
    ];

    const states = candles.map((candle) => engine.next(candle as any));
    const signal = states[states.length - 1].signal;

    expect(signal?.direction).toBe('SHORT');
    expect(signal?.zone.kind).toBe('sell_pressure');
    expect(signal?.zone.top).toBe(107);
    expect(signal?.zone.bottom).toBe(101);
    expect(signal?.reactionBodyAligned).toBe(true);
  });
});
