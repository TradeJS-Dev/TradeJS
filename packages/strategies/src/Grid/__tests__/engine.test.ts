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
});
