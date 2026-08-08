/** @jest-environment node */

import { config as DEFAULT_CONFIG } from '../config';
import { getReverseTrendLineCoreFilterSkipCode } from '../filters';

const makeConfig = (overrides: Record<string, unknown> = {}) =>
  ({ ...DEFAULT_CONFIG, ...overrides }) as any;

const makeStructural = (overrides: Record<string, unknown> = {}) => ({
  coinBiasAligned: true,
  btcBiasAligned: true,
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
  it('keeps default filters permissive', () => {
    expect(
      getReverseTrendLineCoreFilterSkipCode({
        config: makeConfig(),
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
        structuralContext: makeStructural(),
        timingContext: makeTiming(),
      }),
    ).toBe('REVERSE_TRENDLINE_REJECTION_STRENGTH_TOO_WEAK');

    expect(
      getReverseTrendLineCoreFilterSkipCode({
        config: makeConfig({
          REVERSE_TRENDLINE_REQUIRE_COIN_BIAS_ALIGNMENT: true,
        }),
        structuralContext: makeStructural({ coinBiasAligned: false }),
        timingContext: makeTiming(),
      }),
    ).toBe('REVERSE_TRENDLINE_COIN_BIAS_NOT_ALIGNED');

    expect(
      getReverseTrendLineCoreFilterSkipCode({
        config: makeConfig({
          REVERSE_TRENDLINE_ALLOWED_ENTRY_TIMINGS: ['ready_follow_through'],
        }),
        structuralContext: makeStructural(),
        timingContext: makeTiming(),
      }),
    ).toBe('REVERSE_TRENDLINE_ENTRY_TIMING_NOT_ALLOWED');
  });
});
