/** @jest-environment node */

import { config as DEFAULT_CONFIG } from '../config';
import { createHeadAndShouldersEngine } from '../engine';

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
    HEADSHOULDERS_PIVOT_LOOKBACK: 1,
    HEADSHOULDERS_SHOULDER_TOLERANCE_PCT: 50,
    HEADSHOULDERS_MIN_HEAD_PROMINENCE_RATIO: 0.1,
    HEADSHOULDERS_MIN_HEAD_HEIGHT_PCT: 0,
    HEADSHOULDERS_MIN_HEAD_HEIGHT_ATR: 0,
    HEADSHOULDERS_MIN_PATTERN_BARS: 4,
    HEADSHOULDERS_MIN_PATTERN_SYMMETRY_RATIO: 0,
    HEADSHOULDERS_MAX_NECKLINE_SLOPE_RATIO: 1,
    HEADSHOULDERS_MAX_PRIOR_MOVE_ATR: 0,
    HEADSHOULDERS_MIN_BREAKOUT_DISTANCE_ATR: 0,
    HEADSHOULDERS_MAX_BREAKOUT_DISTANCE_HEIGHT_RATIO: 0,
    HEADSHOULDERS_MAX_BREAKOUT_DISTANCE_PCT: 5,
    HEADSHOULDERS_ENTRY_MODE: 'breakout',
    ...overrides,
  }) as any;

const makeClassicCandles = () => [
  makeCandle(0, 100, 102, 98, 100),
  makeCandle(1, 100, 110, 99, 105),
  makeCandle(2, 105, 105, 98, 104),
  makeCandle(3, 104, 104, 95, 97),
  makeCandle(4, 97, 108, 98, 105),
  makeCandle(5, 105, 120, 103, 117),
  makeCandle(6, 117, 110, 99, 103),
  makeCandle(7, 103, 106, 96, 98),
  makeCandle(8, 98, 109, 100, 106),
  makeCandle(9, 106, 111, 102, 109),
  makeCandle(10, 109, 105, 97, 99),
  makeCandle(11, 99, 101, 92, 94),
];

const makeInverseCandles = () => [
  makeCandle(0, 100, 102, 98, 100),
  makeCandle(1, 100, 101, 90, 94),
  makeCandle(2, 94, 102, 95, 99),
  makeCandle(3, 99, 105, 96, 103),
  makeCandle(4, 103, 102, 92, 96),
  makeCandle(5, 96, 97, 80, 83),
  makeCandle(6, 83, 103, 91, 100),
  makeCandle(7, 100, 104, 95, 102),
  makeCandle(8, 102, 101, 92, 96),
  makeCandle(9, 96, 100, 89, 92),
  makeCandle(10, 92, 103, 94, 101),
  makeCandle(11, 101, 108, 100, 107),
];

describe('HeadAndShoulders engine', () => {
  it('detects a classic head-and-shoulders neckline breakdown', () => {
    const engine = createHeadAndShouldersEngine({ config: makeConfig() });
    const states = makeClassicCandles().map((candle) =>
      engine.next(candle as any),
    );
    const pattern = states[states.length - 1].pattern;

    expect(pattern?.kind).toBe('head_and_shoulders');
    expect(pattern?.direction).toBe('SHORT');
    expect(pattern?.pivots.map((pivot) => pivot.value)).toEqual([
      110, 95, 120, 96, 111,
    ]);
    expect(pattern?.neckline).toBe(97);
    expect(pattern?.breakoutDelayBars).toBe(2);
    expect(pattern?.targetPrice).toBeLessThan(pattern?.neckline ?? 0);
    expect(pattern?.stopLossPrice).toBeGreaterThan(120);
  });

  it('detects an inverse head-and-shoulders neckline breakout', () => {
    const engine = createHeadAndShouldersEngine({ config: makeConfig() });
    const states = makeInverseCandles().map((candle) =>
      engine.next(candle as any),
    );
    const pattern = states[states.length - 1].pattern;

    expect(pattern?.kind).toBe('inverse_head_and_shoulders');
    expect(pattern?.direction).toBe('LONG');
    expect(pattern?.pivots.map((pivot) => pivot.value)).toEqual([
      90, 105, 80, 104, 89,
    ]);
    expect(pattern?.neckline).toBe(103);
    expect(pattern?.targetPrice).toBeGreaterThan(pattern?.neckline ?? Infinity);
    expect(pattern?.stopLossPrice).toBeLessThan(80);
  });

  it('waits for close acceptance and emits a setup once per timestamp', () => {
    const engine = createHeadAndShouldersEngine({
      config: makeConfig({
        HEADSHOULDERS_ENTRY_MODE: 'close_acceptance',
      }),
    });
    const breakout = makeClassicCandles().reduce(
      (_, candle) => engine.next(candle as any),
      engine.getState(),
    );

    expect(breakout.pattern).toBeNull();
    expect(breakout.pending?.stage).toBe('neckline_crossed');

    const confirmation = makeCandle(12, 94, 98, 91, 93);
    const accepted = engine.next(confirmation as any);
    expect(accepted.pattern?.entryStage).toBe('close_accepted');
    expect(accepted.pattern?.confirmationBars).toBe(1);
    expect(accepted.pattern?.confirmationBodyAtr).toBeGreaterThan(0);
    expect(accepted.pattern?.confirmationCloseLocation).toBeCloseTo(2 / 7);
    expect(engine.next(confirmation as any)).toEqual(accepted);
    expect(
      engine.next(makeCandle(13, 93, 96, 90, 92) as any).pattern,
    ).toBeNull();
  });

  it('accepts a neckline retest that closes on the breakdown side', () => {
    const engine = createHeadAndShouldersEngine({
      config: makeConfig({
        HEADSHOULDERS_ENTRY_MODE: 'retest',
        HEADSHOULDERS_RETEST_TOLERANCE_ATR: 0.25,
      }),
    });
    for (const candle of makeClassicCandles()) engine.next(candle as any);

    const held = engine.next(makeCandle(12, 94, 98, 91, 93) as any);

    expect(held.pattern?.entryStage).toBe('retest_held');
    expect(held.pending).toBeNull();
  });

  it('rejects a weak confirmation close while the setup is pending', () => {
    const engine = createHeadAndShouldersEngine({
      config: makeConfig({
        HEADSHOULDERS_ENTRY_MODE: 'close_acceptance',
        HEADSHOULDERS_MAX_CONFIRMATION_CLOSE_LOCATION: 0.25,
      }),
    });
    for (const candle of makeClassicCandles()) engine.next(candle as any);

    const weakConfirmation = engine.next(makeCandle(12, 93, 98, 91, 94) as any);

    expect(weakConfirmation.pattern).toBeNull();
    expect(weakConfirmation.pending?.stage).toBe('neckline_crossed');
  });

  it('rejects a breakout that is stale relative to the right shoulder', () => {
    const engine = createHeadAndShouldersEngine({
      config: makeConfig({
        HEADSHOULDERS_MAX_BREAKOUT_DELAY_BARS: 1,
      }),
    });
    const states = makeClassicCandles().map((candle) =>
      engine.next(candle as any),
    );

    expect(states[states.length - 1].pattern).toBeNull();
  });

  it('rejects a pattern after an excessive move into the left shoulder', () => {
    const engine = createHeadAndShouldersEngine({
      config: makeConfig({
        HEADSHOULDERS_PRIOR_TREND_LOOKBACK: 1,
        HEADSHOULDERS_MAX_PRIOR_MOVE_ATR: 0.1,
      }),
    });
    const states = makeClassicCandles().map((candle) =>
      engine.next(candle as any),
    );

    expect(states[states.length - 1].pattern).toBeNull();
  });

  it('rebuilds pending state by replaying initial candles', () => {
    const config = makeConfig({
      HEADSHOULDERS_ENTRY_MODE: 'close_acceptance',
    });
    const history = makeClassicCandles();
    const confirmation = makeCandle(12, 94, 98, 91, 93);
    const continuous = createHeadAndShouldersEngine({ config });
    for (const candle of history) continuous.next(candle as any);
    const continuousState = continuous.next(confirmation as any);

    const restored = createHeadAndShouldersEngine({
      config,
      initialCandles: history as any,
    });
    expect(restored.next(confirmation as any)).toEqual(continuousState);
  });
});
