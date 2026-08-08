/** @jest-environment node */

import { Candle } from '@tradejs/types';
import { config as DEFAULT_CONFIG, GridConfig } from '../config';
import { createGridEngine } from '../engine';

const makeCandle = (
  index: number,
  open: number,
  high: number,
  low: number,
  close: number,
): Candle => ({
  timestamp: 1_700_000_000_000 + index * 900_000,
  open,
  high,
  low,
  close,
  volume: 1_000,
  turnover: close * 1_000,
});

const makeConfig = (overrides: Record<string, unknown> = {}): GridConfig =>
  ({
    ...DEFAULT_CONFIG,
    GRID_FAST_EMA: 3,
    GRID_SLOW_EMA: 6,
    GRID_ATR_PERIOD: 3,
    GRID_TREND_SLOPE_BARS: 2,
    GRID_MIN_TREND_STRENGTH_ATR: 0.01,
    GRID_MAX_TREND_STRENGTH_ATR: 0,
    GRID_MIN_SLOW_SLOPE_ATR: 0,
    GRID_MIN_ATR_PCT: 0,
    GRID_MAX_ATR_PCT: 0,
    GRID_MAX_CANDLE_RANGE_ATR: 10,
    GRID_MAX_FIGURE_POINTS: 8,
    ...overrides,
  }) as unknown as GridConfig;

const buildBullishPullback = () => {
  const candles = Array.from({ length: 12 }, (_, index) => {
    const open = 100 + index;
    return makeCandle(index, open, open + 1.4, open - 0.4, open + 1);
  });
  const probe = createGridEngine({ config: makeConfig() });
  let lastState = probe.getState();
  for (const candle of candles) lastState = probe.next(candle);
  const fast = lastState.snapshot?.emaFast ?? 112;
  candles.push(makeCandle(12, fast - 0.8, fast + 0.8, fast - 1.2, fast + 0.5));
  return candles;
};

const buildBearishPullback = () => {
  const candles = Array.from({ length: 12 }, (_, index) => {
    const open = 120 - index;
    return makeCandle(index, open, open + 0.4, open - 1.4, open - 1);
  });
  const probe = createGridEngine({ config: makeConfig() });
  let lastState = probe.getState();
  for (const candle of candles) lastState = probe.next(candle);
  const fast = lastState.snapshot?.emaFast ?? 108;
  candles.push(makeCandle(12, fast + 0.8, fast + 1.2, fast - 0.8, fast - 0.5));
  return candles;
};

describe('Grid engine', () => {
  it('detects a causal bullish pullback recovery in an established trend', () => {
    const engine = createGridEngine({ config: makeConfig() });
    const candles = buildBullishPullback();
    const result = candles.reduce(
      (_state, candle) => engine.next(candle),
      engine.getState(),
    );

    expect(result.snapshot).toEqual(
      expect.objectContaining({
        regimeDirection: 'LONG',
        entryDirection: 'LONG',
        volatilityShock: false,
      }),
    );
    expect(result.snapshot?.stepDistance).toBeGreaterThan(0);
    expect(result.snapshot?.stopDistance).toBeGreaterThan(
      result.snapshot?.stepDistance ?? 0,
    );
  });

  it('rebuilds identical state from initial candles plus the last candle', () => {
    const candles = buildBullishPullback();
    const continuous = createGridEngine({ config: makeConfig() });
    let continuousState = continuous.getState();
    for (const candle of candles) continuousState = continuous.next(candle);

    const replayed = createGridEngine({
      config: makeConfig(),
      initialCandles: candles.slice(0, -1),
    }).next(candles[candles.length - 1]);

    expect(replayed).toEqual(continuousState);
    expect(replayed.series.emaFast).toHaveLength(8);
    expect(replayed.series.emaSlow).toHaveLength(8);
  });

  it('blocks entries during a volatility shock', () => {
    const candles = buildBullishPullback();
    const engine = createGridEngine({
      config: makeConfig({ GRID_MAX_CANDLE_RANGE_ATR: 1 }),
      initialCandles: candles.slice(0, -1),
    });
    const last = candles[candles.length - 1];
    const result = engine.next({
      ...last,
      high: last.close + 10,
      low: last.close - 10,
    });

    expect(result.snapshot?.volatilityShock).toBe(true);
    expect(result.snapshot?.entryDirection).toBeNull();
    expect(result.snapshot?.regimeDirection).toBeNull();
  });

  it('detects a causal bearish pullback recovery', () => {
    const engine = createGridEngine({ config: makeConfig() });
    const result = buildBearishPullback().reduce(
      (_state, candle) => engine.next(candle),
      engine.getState(),
    );

    expect(result.snapshot).toEqual(
      expect.objectContaining({
        regimeDirection: 'SHORT',
        entryDirection: 'SHORT',
        volatilityShock: false,
      }),
    );
    expect(result.snapshot?.slowSlopeAtr).toBeLessThanOrEqual(0);
  });

  it('ignores malformed candles without mutating replayable state', () => {
    const engine = createGridEngine({ config: makeConfig() });
    engine.next(makeCandle(0, 100, 101, 99, 100.5));
    const before = engine.getState();

    const malformed = engine.next({
      ...makeCandle(1, 101, 102, 100, 101.5),
      close: Number.NaN,
    });

    expect(malformed).toEqual(before);
    malformed.series.emaFast.push({ timestamp: 0, value: 0 });
    expect(engine.getState()).toEqual(before);
  });

  it('uses the percentage floor for grid spacing and covers every level before the stop', () => {
    const config = makeConfig({
      GRID_STEP_ATR_MULT: 0.01,
      GRID_MIN_STEP_PCT: 2,
      GRID_STOP_ATR_MULT: 0.1,
      GRID_TAKE_PROFIT_STEP_MULT: 2,
      GRID_MAX_LEVELS: 3,
    });
    const engine = createGridEngine({ config });
    const result = buildBullishPullback().reduce(
      (_state, candle) => engine.next(candle),
      engine.getState(),
    );
    const snapshot = result.snapshot!;

    expect(snapshot.stepDistance).toBeCloseTo(snapshot.close * 0.02);
    expect(snapshot.stopDistance).toBeCloseTo(snapshot.stepDistance * 4);
    expect(snapshot.takeProfitDistance).toBeCloseTo(snapshot.stepDistance * 2);
  });

  it('emits a one-shot continuation entry only after breakout acceptance and retest', () => {
    const config = makeConfig({
      GRID_ENTRY_MODE: 'breakout_retest',
      GRID_BREAKOUT_LOOKBACK_BARS: 6,
      GRID_BREAKOUT_MIN_DISTANCE_ATR: 0,
      GRID_BREAKOUT_ACCEPTANCE_BARS: 1,
      GRID_BREAKOUT_RETEST_MAX_BARS: 4,
      GRID_BREAKOUT_RETEST_TOLERANCE_ATR: 0.5,
    });
    const trend = Array.from({ length: 12 }, (_, index) => {
      const open = 100 + index;
      return makeCandle(index, open, open + 1.4, open - 0.4, open + 1);
    });
    const breakout = makeCandle(12, 112, 116, 111.8, 115);
    const acceptance = makeCandle(13, 115, 116.5, 114.5, 116);
    const retest = makeCandle(14, 114, 114.5, 112.3, 113);
    const engine = createGridEngine({ config });
    for (const candle of trend) engine.next(candle);

    const breakoutState = engine.next(breakout);
    expect(breakoutState.snapshot).toEqual(
      expect.objectContaining({
        entryDirection: null,
        setupId: expect.stringMatching(/^grid-breakout:LONG:/),
        breakoutAgeBars: expect.any(Number),
      }),
    );
    expect(engine.next(acceptance).snapshot?.entryDirection).toBeNull();

    const ready = engine.next(retest);
    expect(ready.snapshot).toEqual(
      expect.objectContaining({
        entryDirection: 'LONG',
        entryStage: 'breakout_retest_held',
        breakoutLevel: breakoutState.snapshot?.breakoutLevel,
        setupId: breakoutState.snapshot?.setupId,
        breakoutRetestCloseDistanceAtr: expect.any(Number),
      }),
    );
    expect(engine.next(retest)).toEqual(ready);
    expect(
      engine.next(makeCandle(15, 113, 114, 112.8, 113.5)).snapshot
        ?.entryDirection,
    ).toBeNull();
  });

  it('does not chase a retest close that is too far beyond the breakout level', () => {
    const config = makeConfig({
      GRID_ENTRY_MODE: 'breakout_retest',
      GRID_BREAKOUT_LOOKBACK_BARS: 6,
      GRID_BREAKOUT_MIN_DISTANCE_ATR: 0,
      GRID_BREAKOUT_ACCEPTANCE_BARS: 1,
      GRID_BREAKOUT_RETEST_MAX_BARS: 4,
      GRID_BREAKOUT_RETEST_TOLERANCE_ATR: 0.5,
      GRID_BREAKOUT_RETEST_MAX_CLOSE_DISTANCE_ATR: 0.05,
    });
    const trend = Array.from({ length: 12 }, (_, index) => {
      const open = 100 + index;
      return makeCandle(index, open, open + 1.4, open - 0.4, open + 1);
    });
    const engine = createGridEngine({ config });
    for (const candle of trend) engine.next(candle);

    engine.next(makeCandle(12, 112, 116, 111.8, 115));
    engine.next(makeCandle(13, 115, 116.5, 114.5, 116));
    const rejected = engine.next(makeCandle(14, 114, 114.5, 112.3, 113));

    expect(rejected.snapshot?.entryDirection).toBeNull();
    expect(rejected.snapshot?.entryStage).toBeNull();
  });

  it('replays a pending breakout lifecycle identically', () => {
    const config = makeConfig({
      GRID_ENTRY_MODE: 'breakout_retest',
      GRID_BREAKOUT_LOOKBACK_BARS: 6,
      GRID_BREAKOUT_MIN_DISTANCE_ATR: 0,
      GRID_BREAKOUT_ACCEPTANCE_BARS: 1,
      GRID_BREAKOUT_RETEST_TOLERANCE_ATR: 0.5,
    });
    const history = [
      ...Array.from({ length: 12 }, (_, index) => {
        const open = 100 + index;
        return makeCandle(index, open, open + 1.4, open - 0.4, open + 1);
      }),
      makeCandle(12, 112, 116, 111.8, 115),
      makeCandle(13, 115, 116.5, 114.5, 116),
    ];
    const retest = makeCandle(14, 114, 114.5, 112.3, 113);
    const continuous = createGridEngine({ config });
    for (const candle of history) continuous.next(candle);
    const expected = continuous.next(retest);
    const restored = createGridEngine({ config, initialCandles: history });

    expect(restored.next(retest)).toEqual(expected);
  });
});
