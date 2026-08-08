/** @jest-environment node */

import { config as DEFAULT_CONFIG } from '../config';
import { createDoubleTapEngine } from '../engine';

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
    DOUBLETAP_PIVOT_LENGTH: 2,
    DOUBLETAP_MIN_PATTERN_HEIGHT_PCT: 0,
    DOUBLETAP_MIN_PATTERN_HEIGHT_ATR: 0,
    DOUBLETAP_MIN_TAP_SPACING_BARS: 1,
    DOUBLETAP_MIN_LEG_SYMMETRY_RATIO: 0,
    DOUBLETAP_MIN_BREAKOUT_DISTANCE_ATR: 0,
    DOUBLETAP_MAX_BREAKOUT_DISTANCE_HEIGHT_RATIO: 0,
    DOUBLETAP_MAX_BREAKOUT_DISTANCE_PCT: 5,
    DOUBLETAP_ENTRY_MODE: 'breakout',
    ...overrides,
  }) as any;

const makeDoubleBottomCandles = () => [
  makeCandle(0, 100, 101, 95, 100),
  makeCandle(1, 100, 100, 88, 90),
  makeCandle(2, 90, 111, 89, 110),
  makeCandle(3, 110, 99, 85, 90),
  makeCandle(4, 92, 106, 86, 104),
  makeCandle(5, 104, 104, 86, 100),
  makeCandle(6, 100, 105, 86, 104),
  makeCandle(7, 104, 104, 86, 104),
  makeCandle(8, 104, 108, 90, 107),
];

describe('DoubleTap engine', () => {
  it('detects double bottom neckline breakout', () => {
    const engine = createDoubleTapEngine({ config: makeConfig() });
    const candles = makeDoubleBottomCandles();

    const states = candles.map((candle) => engine.next(candle as any));
    const pattern = states[states.length - 1].pattern;

    expect(pattern?.kind).toBe('double_bottom');
    expect(pattern?.direction).toBe('LONG');
    expect(pattern?.neckline).toBe(105);
    expect(pattern?.targetPrice).toBeGreaterThan(105);
    expect(pattern?.stopLossPrice).toBeLessThan(92);
  });

  it('detects double top neckline breakdown', () => {
    const engine = createDoubleTapEngine({ config: makeConfig() });
    const candles = [
      makeCandle(0, 100, 105, 99, 100),
      makeCandle(1, 100, 104, 90, 91),
      makeCandle(2, 91, 112, 99, 111),
      makeCandle(3, 111, 111, 94, 96),
      makeCandle(4, 96, 107, 95, 100),
      makeCandle(5, 100, 110, 96, 109),
      makeCandle(6, 109, 109, 93, 93),
    ];

    const states = candles.map((candle) => engine.next(candle as any));
    const pattern = states[states.length - 1].pattern;

    expect(pattern?.kind).toBe('double_top');
    expect(pattern?.direction).toBe('SHORT');
    expect(pattern?.neckline).toBe(94);
    expect(pattern?.targetPrice).toBeLessThan(94);
    expect(pattern?.stopLossPrice).toBeGreaterThan(107);
  });

  it('keeps absolute pivot indexes after the rolling candle buffer trims history', () => {
    const engine = createDoubleTapEngine({ config: makeConfig() });
    for (let index = 0; index < 30; index += 1) {
      engine.next(makeCandle(index, 100, 101, 99, 100) as any);
    }

    const base = 30;
    const candles = [
      makeCandle(base, 100, 101, 95, 100),
      makeCandle(base + 1, 100, 100, 88, 90),
      makeCandle(base + 2, 90, 111, 89, 110),
      makeCandle(base + 3, 110, 99, 85, 90),
      makeCandle(base + 4, 92, 106, 86, 104),
      makeCandle(base + 5, 104, 104, 86, 100),
      makeCandle(base + 6, 100, 105, 86, 104),
      makeCandle(base + 7, 104, 104, 86, 104),
      makeCandle(base + 8, 104, 108, 90, 107),
    ];

    const states = candles.map((candle) => engine.next(candle as any));
    const pattern = states[states.length - 1].pattern;

    expect(pattern?.kind).toBe('double_bottom');
    expect(pattern?.pivots.every((pivot) => pivot.index >= base)).toBe(true);
  });

  it('waits for a later close acceptance and emits the setup once', () => {
    const engine = createDoubleTapEngine({
      config: makeConfig({
        DOUBLETAP_ENTRY_MODE: 'close_acceptance',
        DOUBLETAP_CONFIRMATION_MAX_BARS: 2,
      }),
    });
    const candles = makeDoubleBottomCandles();
    const breakoutState = candles.reduce(
      (_, candle) => engine.next(candle as any),
      engine.getState(),
    );

    expect(breakoutState.pattern).toBeNull();
    expect(breakoutState.pending?.stage).toBe('neckline_crossed');

    const confirmation = makeCandle(9, 107, 109, 105.5, 108);
    const accepted = engine.next(confirmation as any);
    expect(accepted.pattern?.entryStage).toBe('close_accepted');
    expect(accepted.pattern?.confirmationBars).toBe(1);
    expect(accepted.pattern?.setupId).toBe(breakoutState.pending?.setupId);

    const duplicate = engine.next(confirmation as any);
    expect(duplicate).toEqual(accepted);
    expect(
      engine.next(makeCandle(10, 108, 110, 106, 109) as any).pattern,
    ).toBeNull();
  });

  it('requires a neckline retest that closes back on the breakout side', () => {
    const engine = createDoubleTapEngine({
      config: makeConfig({
        DOUBLETAP_ENTRY_MODE: 'retest',
        DOUBLETAP_RETEST_TOLERANCE_ATR: 0.25,
      }),
    });
    for (const candle of makeDoubleBottomCandles()) engine.next(candle as any);

    const held = engine.next(makeCandle(9, 107, 108, 105, 107) as any);
    expect(held.pattern?.entryStage).toBe('retest_held');
    expect(held.pending).toBeNull();
  });

  it('rebuilds a pending confirmation identically from initial candles', () => {
    const config = makeConfig({
      DOUBLETAP_ENTRY_MODE: 'close_acceptance',
    });
    const history = makeDoubleBottomCandles();
    const confirmation = makeCandle(9, 107, 109, 105.5, 108);
    const continuous = createDoubleTapEngine({ config });
    for (const candle of history) continuous.next(candle as any);
    const continuousState = continuous.next(confirmation as any);

    const restored = createDoubleTapEngine({
      config,
      initialCandles: history as any,
    });
    expect(restored.next(confirmation as any)).toEqual(continuousState);
  });
});
