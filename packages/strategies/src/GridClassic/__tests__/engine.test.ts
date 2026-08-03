/** @jest-environment node */

import type { Candle } from '@tradejs/types';
import { config as DEFAULT_CONFIG, type GridClassicConfig } from '../config';
import { createGridClassicEngine } from '../engine';

const makeCandle = (
  index: number,
  close: number,
  overrides: Partial<Candle> = {},
): Candle => ({
  timestamp: 1_700_000_000_000 + index * 900_000,
  open: close,
  high: close + 0.4,
  low: close - 0.4,
  close,
  volume: 1_000,
  turnover: close * 1_000,
  ...overrides,
});

const rangeCycle = [100, 103, 105, 103, 100, 97, 95, 97];

const testConfig = {
  ...DEFAULT_CONFIG,
  GRIDCLASSIC_ATR_PERIOD: 3,
  GRIDCLASSIC_PIVOT_LEFT_BARS: 2,
  GRIDCLASSIC_PIVOT_RIGHT_BARS: 2,
  GRIDCLASSIC_LOOKBACK_BARS: 48,
  GRIDCLASSIC_MIN_PIVOTS_PER_SIDE: 2,
  GRIDCLASSIC_MIN_WIDTH_ATR: 3,
  GRIDCLASSIC_MAX_WIDTH_ATR: 30,
  GRIDCLASSIC_MAX_CENTER_SLOPE_ATR_PER_BAR: 0.08,
  GRIDCLASSIC_MAX_BOUNDARY_DIVERGENCE_ATR: 2,
  GRIDCLASSIC_MIN_CONTAINMENT_RATIO: 0.65,
  GRIDCLASSIC_MIN_RANGE_AGE_BARS: 8,
  GRIDCLASSIC_MAX_VOLATILITY_EXPANSION: 0,
  GRIDCLASSIC_EDGE_ZONE_FRACTION: 0.3,
  GRIDCLASSIC_ENTRY_CONFIRMATION: 'either',
  GRIDCLASSIC_MIN_REJECTION_WICK_RATIO: 0.5,
  GRIDCLASSIC_ENTRY_CONFIRMATION_BARS: 0,
  GRIDCLASSIC_MAX_PIVOT_AGE_BARS: 0,
  GRIDCLASSIC_MIN_ALTERNATING_PIVOTS: 0,
  GRIDCLASSIC_RECENT_CONTAINMENT_BARS: 0,
  GRIDCLASSIC_MIN_RECENT_CONTAINMENT_RATIO: 0,
} as GridClassicConfig;

const buildRange = () =>
  Array.from({ length: 6 }, () => rangeCycle)
    .flat()
    .map((close, index) => makeCandle(index, close));

describe('GridClassic engine', () => {
  it('opens LONG and SHORT symmetrically only at confirmed edges', () => {
    const base = buildRange();
    const longEngine = createGridClassicEngine({ config: testConfig });
    const shortEngine = createGridClassicEngine({ config: testConfig });
    base.forEach((candle) => {
      longEngine.next(candle);
      shortEngine.next(candle);
    });
    shortEngine.next(makeCandle(base.length, 100));
    shortEngine.next(makeCandle(base.length + 1, 103));

    const long = longEngine.next(
      makeCandle(base.length, 95.4, {
        open: 96.2,
        high: 96.4,
        low: 94.4,
        close: 95.4,
      }),
    ).snapshot;
    const short = shortEngine.next(
      makeCandle(base.length + 2, 104.6, {
        open: 103.8,
        high: 105.6,
        low: 103.6,
        close: 104.6,
      }),
    ).snapshot;

    expect(long?.geometry.detected).toBe(true);
    expect(long?.entryDirection).toBe('LONG');
    expect(short?.geometry.detected).toBe(true);
    expect(short?.entryDirection).toBe('SHORT');
  });

  it('does not enter in the middle or before the range is confirmed', () => {
    const middleEngine = createGridClassicEngine({ config: testConfig });
    buildRange().forEach((candle) => middleEngine.next(candle));
    const middle = middleEngine.next(makeCandle(48, 100)).snapshot;
    const warmupEngine = createGridClassicEngine({ config: testConfig });
    const warmup = warmupEngine.next(makeCandle(0, 95)).snapshot;

    expect(middle?.entryDirection).toBeNull();
    expect(warmup?.geometry.ready).toBe(false);
    expect(warmup?.entryDirection).toBeNull();
  });

  it('requires a later candle to confirm a failed breakout when configured', () => {
    const engine = createGridClassicEngine({
      config: {
        ...testConfig,
        GRIDCLASSIC_ENTRY_CONFIRMATION_BARS: 1,
      },
    });
    const base = buildRange();
    base.forEach((candle) => engine.next(candle));

    const candidate = engine.next(
      makeCandle(base.length, 95.4, {
        open: 96.2,
        high: 96.4,
        low: 94.4,
        close: 95.4,
      }),
    ).snapshot;
    const confirmed = engine.next(
      makeCandle(base.length + 1, 95.8, {
        open: 95.3,
        high: 96.1,
        low: 95.2,
        close: 95.8,
      }),
    ).snapshot;

    expect(candidate?.entryDirection).toBeNull();
    expect(candidate?.entrySignalStage).toBe('candidate');
    expect(confirmed?.entryDirection).toBe('LONG');
    expect(confirmed?.entrySignalStage).toBe('confirmed');
    expect(confirmed?.entryConfirmationAgeBars).toBe(1);
  });

  it('rejects a range whose opposite pivot has become stale', () => {
    const engine = createGridClassicEngine({
      config: {
        ...testConfig,
        GRIDCLASSIC_MAX_PIVOT_AGE_BARS: 5,
      },
    });
    const base = buildRange();
    base.forEach((candle) => engine.next(candle));
    const stale = engine.next(
      makeCandle(base.length, 95.4, {
        open: 96.2,
        high: 96.4,
        low: 94.4,
        close: 95.4,
      }),
    ).snapshot;

    expect(stale?.geometry.detected).toBe(true);
    expect(stale?.latestHighPivotAgeBars).toBeGreaterThan(5);
    expect(stale?.rangeQualityAccepted).toBe(false);
    expect(stale?.entryDirection).toBeNull();
  });

  it('matches continuous replay with initialCandles plus the last candle', () => {
    const candles = buildRange();
    const continuous = createGridClassicEngine({ config: testConfig });
    const continuousState = candles.reduce(
      (_state, candle) => continuous.next(candle),
      continuous.getState(),
    );
    const resumed = createGridClassicEngine({
      config: testConfig,
      initialCandles: candles.slice(0, -1),
    });
    const resumedState = resumed.next(candles[candles.length - 1]);

    expect(resumedState).toEqual(continuousState);
  });

  it('rebuilds pending two-stage confirmation through the replay path', () => {
    const config = {
      ...testConfig,
      GRIDCLASSIC_ENTRY_CONFIRMATION_BARS: 1,
    };
    const base = buildRange();
    const candles = [
      ...base,
      makeCandle(base.length, 95.4, {
        open: 96.2,
        high: 96.4,
        low: 94.4,
        close: 95.4,
      }),
      makeCandle(base.length + 1, 95.8, {
        open: 95.3,
        high: 96.1,
        low: 95.2,
        close: 95.8,
      }),
    ];
    const continuous = createGridClassicEngine({ config });
    const continuousState = candles.reduce(
      (_state, candle) => continuous.next(candle),
      continuous.getState(),
    );
    const resumed = createGridClassicEngine({
      config,
      initialCandles: candles.slice(0, -1),
    });
    const resumedState = resumed.next(candles.at(-1)!);

    expect(resumedState).toEqual(continuousState);
    expect(resumedState.snapshot?.entryDirection).toBe('LONG');
    expect(resumedState.snapshot?.entrySignalStage).toBe('confirmed');
  });

  it('is idempotent for duplicate timestamps and bounds detector history', () => {
    const engine = createGridClassicEngine({ config: testConfig });
    const candles = Array.from({ length: 20 }, () => rangeCycle)
      .flat()
      .map((close, index) => makeCandle(index, close));
    candles.forEach((candle) => engine.next(candle));
    const before = engine.getState();
    const after = engine.next({
      ...candles[candles.length - 1],
      close: 999,
    });

    expect(after).toEqual(before);
    expect(after.snapshot?.geometry.historySize).toBeLessThanOrEqual(
      testConfig.GRIDCLASSIC_LOOKBACK_BARS,
    );
  });
});
