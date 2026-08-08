/** @jest-environment node */

import { config as DEFAULT_CONFIG } from '../config';
import { getTrendLineCoreFilterSkipCode } from '../filters';

const makeConfig = (overrides: Record<string, unknown> = {}) =>
  ({ ...DEFAULT_CONFIG, ...overrides }) as any;

const makeStructural = (overrides: Record<string, unknown> = {}) => ({
  breakVsAtrRatio: 1.2,
  btcBiasAligned: true,
  ...overrides,
});

const makeTiming = (overrides: Record<string, unknown> = {}) => ({
  entryTiming: 'ready_breakout',
  lineSlopeAligned: true,
  ...overrides,
});

describe('getTrendLineCoreFilterSkipCode', () => {
  it('keeps default filters permissive', () => {
    expect(
      getTrendLineCoreFilterSkipCode({
        config: makeConfig(),
        structuralContext: makeStructural(),
        timingContext: makeTiming(),
      }),
    ).toBeNull();
  });

  it('supports a causal ATR-normalized breakout range', () => {
    expect(
      getTrendLineCoreFilterSkipCode({
        config: makeConfig({ TRENDLINE_MIN_BREAK_ATR_RATIO: 1.5 }),
        structuralContext: makeStructural(),
        timingContext: makeTiming(),
      }),
    ).toBe('TRENDLINE_BREAK_TOO_WEAK_VS_ATR');

    expect(
      getTrendLineCoreFilterSkipCode({
        config: makeConfig({ TRENDLINE_MAX_BREAK_ATR_RATIO: 1 }),
        structuralContext: makeStructural(),
        timingContext: makeTiming(),
      }),
    ).toBe('TRENDLINE_BREAK_TOO_EXTENDED_VS_ATR');
  });

  it('can require slope, benchmark, and timing alignment', () => {
    expect(
      getTrendLineCoreFilterSkipCode({
        config: makeConfig({ TRENDLINE_REQUIRE_SLOPE_ALIGNMENT: true }),
        structuralContext: makeStructural(),
        timingContext: makeTiming({ lineSlopeAligned: false }),
      }),
    ).toBe('TRENDLINE_SLOPE_NOT_ALIGNED');

    expect(
      getTrendLineCoreFilterSkipCode({
        config: makeConfig({ TRENDLINE_REQUIRE_BTC_BIAS_ALIGNMENT: true }),
        structuralContext: makeStructural({ btcBiasAligned: false }),
        timingContext: makeTiming(),
      }),
    ).toBe('TRENDLINE_BTC_BIAS_NOT_ALIGNED');

    expect(
      getTrendLineCoreFilterSkipCode({
        config: makeConfig({
          TRENDLINE_ALLOWED_ENTRY_TIMINGS: ['ready_retest'],
        }),
        structuralContext: makeStructural(),
        timingContext: makeTiming(),
      }),
    ).toBe('TRENDLINE_ENTRY_TIMING_NOT_ALLOWED');
  });
});
