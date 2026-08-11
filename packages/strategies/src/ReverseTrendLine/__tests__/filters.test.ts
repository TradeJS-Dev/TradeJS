/** @jest-environment node */

import { config as DEFAULT_CONFIG } from '../config';
import { getReverseTrendLineCoreFilterSkipCode } from '../filters';

const makeConfig = (overrides: Record<string, unknown> = {}) =>
  ({
    ...DEFAULT_CONFIG,
    REVERSE_TRENDLINE_MIN_REJECTION_STRENGTH_PCT_LONG: undefined,
    REVERSE_TRENDLINE_MIN_REJECTION_STRENGTH_PCT_SHORT: undefined,
    ...overrides,
  }) as any;

const makeStructural = (overrides: Record<string, unknown> = {}) => ({
  coinBiasAligned: true,
  btcBiasAligned: true,
  breakVsAtrRatio: 0.2,
  btcMaSpreadPct: 0,
  ...overrides,
});

const makeTiming = (overrides: Record<string, unknown> = {}) => ({
  entryTiming: 'ready_rejection',
  currentRejectionStrengthPct: 0.25,
  previousRejectionStrengthPct: 0.2,
  currentRejectionWickPct: 0.35,
  previousRejectionWickPct: 0.3,
  ...overrides,
});

describe('getReverseTrendLineCoreFilterSkipCode', () => {
  it('keeps a neutral directional test config permissive', () => {
    expect(
      getReverseTrendLineCoreFilterSkipCode({
        config: makeConfig(),
        direction: 'LONG',
        structuralContext: makeStructural(),
        timingContext: makeTiming(),
      }),
    ).toBeNull();
  });

  it('uses the originating rejection candle for follow-through entries', () => {
    expect(
      getReverseTrendLineCoreFilterSkipCode({
        config: makeConfig({
          REVERSE_TRENDLINE_MIN_REJECTION_WICK_PCT: 0.4,
        }),
        direction: 'LONG',
        structuralContext: makeStructural(),
        timingContext: makeTiming({
          entryTiming: 'ready_follow_through',
          currentRejectionWickPct: 0.8,
          previousRejectionWickPct: 0.3,
        }),
      }),
    ).toBe('REVERSE_TRENDLINE_REJECTION_WICK_TOO_WEAK');
  });

  it('supports strength, trend, and timing confirmation', () => {
    expect(
      getReverseTrendLineCoreFilterSkipCode({
        config: makeConfig({
          REVERSE_TRENDLINE_MIN_REJECTION_STRENGTH_PCT: 0.3,
        }),
        direction: 'LONG',
        structuralContext: makeStructural(),
        timingContext: makeTiming(),
      }),
    ).toBe('REVERSE_TRENDLINE_REJECTION_STRENGTH_TOO_WEAK');

    expect(
      getReverseTrendLineCoreFilterSkipCode({
        config: makeConfig({
          REVERSE_TRENDLINE_REQUIRE_COIN_BIAS_ALIGNMENT: true,
        }),
        direction: 'LONG',
        structuralContext: makeStructural({ coinBiasAligned: false }),
        timingContext: makeTiming(),
      }),
    ).toBe('REVERSE_TRENDLINE_COIN_BIAS_NOT_ALIGNED');

    expect(
      getReverseTrendLineCoreFilterSkipCode({
        config: makeConfig({
          REVERSE_TRENDLINE_ALLOWED_ENTRY_TIMINGS: ['ready_follow_through'],
        }),
        direction: 'LONG',
        structuralContext: makeStructural(),
        timingContext: makeTiming(),
      }),
    ).toBe('REVERSE_TRENDLINE_ENTRY_TIMING_NOT_ALLOWED');
  });

  it('uses independent rejection-strength thresholds by direction', () => {
    const config = makeConfig({
      REVERSE_TRENDLINE_MIN_REJECTION_STRENGTH_PCT_LONG: 0.3,
      REVERSE_TRENDLINE_MIN_REJECTION_STRENGTH_PCT_SHORT: 0.1,
    });

    expect(
      getReverseTrendLineCoreFilterSkipCode({
        config,
        direction: 'LONG',
        structuralContext: makeStructural(),
        timingContext: makeTiming({ currentRejectionStrengthPct: 0.2 }),
      }),
    ).toBe('REVERSE_TRENDLINE_REJECTION_STRENGTH_TOO_WEAK');
    expect(
      getReverseTrendLineCoreFilterSkipCode({
        config,
        direction: 'SHORT',
        structuralContext: makeStructural(),
        timingContext: makeTiming({ currentRejectionStrengthPct: 0.2 }),
      }),
    ).toBeNull();
  });

  it('uses direction-specific normalized break and BTC regime caps', () => {
    const config = makeConfig({
      REVERSE_TRENDLINE_MAX_BREAK_ATR_RATIO_LONG: 0.3,
      REVERSE_TRENDLINE_MAX_BREAK_ATR_RATIO_SHORT: 0,
      REVERSE_TRENDLINE_MAX_BTC_MA_SPREAD_PCT_LONG: 0,
      REVERSE_TRENDLINE_MAX_BTC_MA_SPREAD_PCT_SHORT: 0.2,
    });

    expect(
      getReverseTrendLineCoreFilterSkipCode({
        config,
        direction: 'LONG',
        structuralContext: makeStructural({ breakVsAtrRatio: 0.31 }),
        timingContext: makeTiming(),
      }),
    ).toBe('REVERSE_TRENDLINE_BREAK_TOO_EXTENDED_VS_ATR');
    expect(
      getReverseTrendLineCoreFilterSkipCode({
        config,
        direction: 'SHORT',
        structuralContext: makeStructural({ btcMaSpreadPct: 0.21 }),
        timingContext: makeTiming(),
      }),
    ).toBe('REVERSE_TRENDLINE_BTC_UPTREND_TOO_STRONG');
  });
});
