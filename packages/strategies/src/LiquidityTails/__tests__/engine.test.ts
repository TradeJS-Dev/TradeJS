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
    expect(signal?.retestOrdinal).toBe(1);
    expect(signal?.candidateAction).toBe('initial_entry');
    expect(signal?.candidateOrdinal).toBe(1);
    expect(signal?.zone.traded).toBe(false);
    expect(signal?.zone.retestsObserved).toBe(1);
    expect(signal?.zone.entryCandidatesEmitted).toBe(1);
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
    expect(signal?.retestOrdinal).toBe(1);
  });

  it('requires efficient rejection when the causal entry filter is enabled', () => {
    const engine = createLiquidityTailsEngine({
      config: makeConfig({
        LIQUIDITY_TAILS_MIN_REJECTION_EFFICIENCY_RATIO: 1.1,
      }),
    });
    const candles = [
      makeCandle(0, 100, 101, 99, 100),
      makeCandle(1, 100, 101, 99, 100),
      makeCandle(2, 100, 102, 95, 101),
      makeCandle(3, 99.5, 102, 99, 101),
    ];

    const states = candles.map((candle) => engine.next(candle as any));

    expect(states.at(-1)?.signal).toBeNull();
  });

  it('rejects an initial entry after the configured zone age', () => {
    const engine = createLiquidityTailsEngine({
      config: makeConfig({ LIQUIDITY_TAILS_MAX_ENTRY_ZONE_AGE_BARS: 2 }),
    });
    const candles = [
      makeCandle(0, 100, 101, 99, 100),
      makeCandle(1, 100, 101, 99, 100),
      makeCandle(2, 100, 102, 95, 101),
      makeCandle(3, 102, 102.5, 101.5, 102),
      makeCandle(4, 102, 102.5, 101.5, 102),
      makeCandle(5, 99.5, 102, 99, 101),
    ];

    const states = candles.map((candle) => engine.next(candle as any));

    expect(states.at(-1)?.signal).toBeNull();
  });

  it('emits one separated secondary retest when scale-in is enabled', () => {
    const engine = createLiquidityTailsEngine({ config: makeConfig() });
    const candles = [
      makeCandle(0, 100, 101, 99, 100),
      makeCandle(1, 100, 101, 99, 100),
      makeCandle(2, 100, 102, 95, 101),
      makeCandle(3, 99.5, 102, 99, 101),
      makeCandle(4, 102, 102.5, 101.5, 102),
      makeCandle(5, 102, 102.5, 101.5, 102),
      makeCandle(6, 99.5, 102, 99, 101),
    ];

    const signals = candles
      .map((candle) => engine.next(candle as any).signal)
      .filter(Boolean);

    expect(signals).toHaveLength(2);
    expect(signals.map((signal) => signal?.retestOrdinal)).toEqual([1, 2]);
    expect(signals.map((signal) => signal?.candidateAction)).toEqual([
      'initial_entry',
      'scale_in',
    ]);
    expect(signals.map((signal) => signal?.candidateOrdinal)).toEqual([1, 2]);
    expect(signals[0]?.zone.id).toBe(signals[1]?.zone.id);
  });

  it('emits three separated secondary retests when configured', () => {
    const engine = createLiquidityTailsEngine({
      config: makeConfig({ LIQUIDITY_TAILS_SCALE_IN_COUNT: 3 }),
    });
    const candles = [
      makeCandle(0, 100, 101, 99, 100),
      makeCandle(1, 100, 101, 99, 100),
      makeCandle(2, 100, 102, 95, 101),
      makeCandle(3, 99.5, 102, 99, 101),
      makeCandle(4, 102, 102.5, 101.5, 102),
      makeCandle(5, 102, 102.5, 101.5, 102),
      makeCandle(6, 99.5, 102, 99, 101),
      makeCandle(7, 102, 102.5, 101.5, 102),
      makeCandle(8, 102, 102.5, 101.5, 102),
      makeCandle(9, 99.5, 102, 99, 101),
      makeCandle(10, 102, 102.5, 101.5, 102),
      makeCandle(11, 102, 102.5, 101.5, 102),
      makeCandle(12, 99.5, 102, 99, 101),
    ];

    const signals = candles
      .map((candle) => engine.next(candle as any).signal)
      .filter(Boolean);

    expect(signals.map((signal) => signal?.retestOrdinal)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(new Set(signals.map((signal) => signal?.zone.id)).size).toBe(1);
  });

  it('does not emit a secondary retest when scale-in is disabled', () => {
    const engine = createLiquidityTailsEngine({
      config: makeConfig({ LIQUIDITY_TAILS_SCALE_IN_ENABLED: false }),
    });
    const candles = [
      makeCandle(0, 100, 101, 99, 100),
      makeCandle(1, 100, 101, 99, 100),
      makeCandle(2, 100, 102, 95, 101),
      makeCandle(3, 99.5, 102, 99, 101),
      makeCandle(4, 102, 102.5, 101.5, 102),
      makeCandle(5, 102, 102.5, 101.5, 102),
      makeCandle(6, 99.5, 102, 99, 101),
    ];

    const signals = candles
      .map((candle) => engine.next(candle as any).signal)
      .filter(Boolean);

    expect(signals).toHaveLength(1);
    expect(signals[0]?.retestOrdinal).toBe(1);
  });

  it('emits a secondary retest for the early-exit policy', () => {
    const engine = createLiquidityTailsEngine({
      config: makeConfig({
        LIQUIDITY_TAILS_EXIT_ON_SCALE_IN_RETEST: true,
        LIQUIDITY_TAILS_SCALE_IN_ENABLED: false,
      }),
    });
    const candles = [
      makeCandle(0, 100, 101, 99, 100),
      makeCandle(1, 100, 101, 99, 100),
      makeCandle(2, 100, 102, 95, 101),
      makeCandle(3, 99.5, 102, 99, 101),
      makeCandle(4, 102, 102.5, 101.5, 102),
      makeCandle(5, 102, 102.5, 101.5, 102),
      makeCandle(6, 99.5, 102, 99, 101),
    ];

    const signals = candles
      .map((candle) => engine.next(candle as any).signal)
      .filter(Boolean);

    expect(signals.map((signal) => signal?.retestOrdinal)).toEqual([1, 2]);
  });

  it('replays secondary-retest state identically from initial candles', () => {
    const candles = [
      makeCandle(0, 100, 101, 99, 100),
      makeCandle(1, 100, 101, 99, 100),
      makeCandle(2, 100, 102, 95, 101),
      makeCandle(3, 99.5, 102, 99, 101),
      makeCandle(4, 102, 102.5, 101.5, 102),
      makeCandle(5, 102, 102.5, 101.5, 102),
      makeCandle(6, 99.5, 102, 99, 101),
    ];
    const continuous = createLiquidityTailsEngine({ config: makeConfig() });
    const expected = candles.reduce(
      (_, candle) => continuous.next(candle as any),
      continuous.getState(),
    );
    const resumed = createLiquidityTailsEngine({
      config: makeConfig(),
      initialCandles: candles.slice(0, -1) as any,
    });

    expect(resumed.next(candles.at(-1) as any)).toEqual(expected);
  });

  it('does not advance retest ordinals twice for the same timestamp', () => {
    const engine = createLiquidityTailsEngine({ config: makeConfig() });
    const candles = [
      makeCandle(0, 100, 101, 99, 100),
      makeCandle(1, 100, 101, 99, 100),
      makeCandle(2, 100, 102, 95, 101),
      makeCandle(3, 99.5, 102, 99, 101),
    ];
    for (const candle of candles.slice(0, -1)) engine.next(candle as any);

    const first = engine.next(candles.at(-1) as any);
    const duplicate = engine.next(candles.at(-1) as any);

    expect(duplicate).toEqual(first);
    expect(duplicate.signal?.zone.retestsObserved).toBe(1);
    expect(duplicate.signal?.zone.candidatesEmitted).toBe(1);
  });
});
