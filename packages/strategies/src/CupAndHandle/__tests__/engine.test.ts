/** @jest-environment node */

import { config as DEFAULT_CONFIG } from '../config';
import { createCupAndHandleEngine } from '../engine';

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
  volume: 1_000,
  turnover: close * 1_000,
});

const makeConfig = (overrides: Record<string, unknown> = {}) =>
  ({
    ...DEFAULT_CONFIG,
    CUPHANDLE_PIVOT_LOOKBACK: 1,
    CUPHANDLE_RIM_TOLERANCE_PCT: 20,
    CUPHANDLE_MIN_CUP_DEPTH_PCT: 0,
    CUPHANDLE_MIN_CUP_DEPTH_ATR: 0,
    CUPHANDLE_MIN_CUP_BARS: 2,
    CUPHANDLE_MIN_CUP_SYMMETRY_RATIO: 0,
    CUPHANDLE_MIN_HANDLE_BARS: 1,
    CUPHANDLE_MIN_HANDLE_DEPTH_RATIO: 0.01,
    CUPHANDLE_MAX_HANDLE_DEPTH_RATIO: 0.6,
    CUPHANDLE_MIN_BREAKOUT_DISTANCE_ATR: 0,
    CUPHANDLE_MAX_BREAKOUT_DISTANCE_DEPTH_RATIO: 1,
    CUPHANDLE_MAX_BREAKOUT_DISTANCE_PCT: 5,
    CUPHANDLE_ENTRY_MODE: 'breakout',
    ...overrides,
  }) as any;

const makeCupAndHandleCandles = () => [
  makeCandle(0, 100, 101, 99, 100),
  makeCandle(1, 100, 110, 100, 108),
  makeCandle(2, 106, 106, 96, 99),
  makeCandle(3, 98, 99, 80, 82),
  makeCandle(4, 84, 100, 88, 98),
  makeCandle(5, 100, 109, 98, 107),
  makeCandle(6, 105, 105, 98, 99),
  makeCandle(7, 99, 101, 96, 97),
  makeCandle(8, 98, 106, 98, 104),
  makeCandle(9, 105, 113, 103, 112),
];

const makeInvertedCupAndHandleCandles = () => [
  makeCandle(0, 100, 101, 99, 100),
  makeCandle(1, 100, 100, 90, 92),
  makeCandle(2, 94, 104, 94, 101),
  makeCandle(3, 103, 120, 101, 118),
  makeCandle(4, 116, 112, 100, 103),
  makeCandle(5, 102, 100, 91, 93),
  makeCandle(6, 95, 102, 95, 101),
  makeCandle(7, 102, 104, 97, 103),
  makeCandle(8, 101, 102, 94, 96),
  makeCandle(9, 95, 97, 87, 88),
];

describe('CupAndHandle engine', () => {
  it('detects a cup-and-handle neckline breakout', () => {
    const engine = createCupAndHandleEngine({ config: makeConfig() });
    const states = makeCupAndHandleCandles().map((candle) =>
      engine.next(candle as any),
    );
    const pattern = states[states.length - 1].pattern;

    expect(pattern?.kind).toBe('cup_and_handle');
    expect(pattern?.direction).toBe('LONG');
    expect(pattern?.neckline).toBe(110);
    expect(pattern?.targetPrice).toBeGreaterThan(110);
    expect(pattern?.stopLossPrice).toBeLessThan(96);
    expect(pattern?.handleDepthRatio).toBeLessThan(0.6);
    expect(pattern?.breakoutCrossedOnSignalBar).toBe(true);
  });

  it('detects an inverted cup-and-handle neckline breakdown', () => {
    const engine = createCupAndHandleEngine({ config: makeConfig() });
    const states = makeInvertedCupAndHandleCandles().map((candle) =>
      engine.next(candle as any),
    );
    const pattern = states[states.length - 1].pattern;

    expect(pattern?.kind).toBe('inverted_cup_and_handle');
    expect(pattern?.direction).toBe('SHORT');
    expect(pattern?.neckline).toBe(90);
    expect(pattern?.targetPrice).toBeLessThan(90);
    expect(pattern?.stopLossPrice).toBeGreaterThan(104);
  });

  it('rejects a handle that retraces too deeply into the cup', () => {
    const candles = makeCupAndHandleCandles();
    candles[7] = makeCandle(7, 96, 101, 84, 86);
    candles[8] = makeCandle(8, 88, 106, 87, 104);
    const engine = createCupAndHandleEngine({
      config: makeConfig({ CUPHANDLE_MAX_HANDLE_DEPTH_RATIO: 0.5 }),
    });

    const state = candles.reduce(
      (_, candle) => engine.next(candle as any),
      engine.getState(),
    );

    expect(state.pattern).toBeNull();
  });

  it('waits for close acceptance and emits a setup once', () => {
    const engine = createCupAndHandleEngine({
      config: makeConfig({
        CUPHANDLE_ENTRY_MODE: 'close_acceptance',
        CUPHANDLE_CONFIRMATION_MAX_BARS: 2,
      }),
    });
    const breakoutState = makeCupAndHandleCandles().reduce(
      (_, candle) => engine.next(candle as any),
      engine.getState(),
    );

    expect(breakoutState.pattern).toBeNull();
    expect(breakoutState.pending?.stage).toBe('neckline_crossed');

    const confirmation = makeCandle(10, 112, 114, 110.5, 113);
    const accepted = engine.next(confirmation as any);
    expect(accepted.pattern?.entryStage).toBe('close_accepted');
    expect(accepted.pattern?.confirmationBars).toBe(1);
    expect(accepted.pattern?.setupId).toBe(breakoutState.pending?.setupId);

    expect(engine.next(confirmation as any)).toEqual(accepted);
    expect(
      engine.next(makeCandle(11, 113, 115, 111, 114) as any).pattern,
    ).toBeNull();
  });

  it('accepts a neckline retest that closes on the breakout side', () => {
    const engine = createCupAndHandleEngine({
      config: makeConfig({
        CUPHANDLE_ENTRY_MODE: 'retest',
        CUPHANDLE_RETEST_TOLERANCE_ATR: 0.5,
      }),
    });
    for (const candle of makeCupAndHandleCandles()) {
      engine.next(candle as any);
    }

    const held = engine.next(makeCandle(10, 112, 113, 109.5, 111) as any);
    expect(held.pattern?.entryStage).toBe('retest_held');
    expect(held.pending).toBeNull();
  });

  it('rebuilds pending state identically from initial candles', () => {
    const config = makeConfig({ CUPHANDLE_ENTRY_MODE: 'close_acceptance' });
    const history = makeCupAndHandleCandles();
    const confirmation = makeCandle(10, 112, 114, 110.5, 113);
    const continuous = createCupAndHandleEngine({ config });
    for (const candle of history) continuous.next(candle as any);
    const continuousState = continuous.next(confirmation as any);

    const restored = createCupAndHandleEngine({
      config,
      initialCandles: history as any,
    });
    expect(restored.next(confirmation as any)).toEqual(continuousState);
  });
});
