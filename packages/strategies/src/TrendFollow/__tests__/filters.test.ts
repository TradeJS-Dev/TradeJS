/** @jest-environment node */

import { config as DEFAULT_CONFIG } from '../config';
import { getTrendFollowCoreFilterSkipCode } from '../filters';

const makeSignal = (
  direction: 'LONG' | 'SHORT' = 'LONG',
  overrides: Record<string, unknown> = {},
) => ({ direction, breakoutDistancePct: 1, ...overrides }) as any;

const makeConfig = (overrides: Record<string, unknown> = {}) =>
  ({
    ...DEFAULT_CONFIG,
    TRENDFOLLOW_MIN_BREAKOUT_DISTANCE_PCT_LONG: undefined,
    TRENDFOLLOW_MIN_BREAKOUT_DISTANCE_PCT_SHORT: undefined,
    ...overrides,
  }) as any;

describe('getTrendFollowCoreFilterSkipCode', () => {
  it('keeps a neutral directional test config permissive', () => {
    expect(
      getTrendFollowCoreFilterSkipCode({
        signal: makeSignal(),
        config: makeConfig(),
      }),
    ).toBeNull();
  });

  it('requires a directionally aligned local-range breakout when enabled', () => {
    expect(
      getTrendFollowCoreFilterSkipCode({
        signal: makeSignal('SHORT'),
        config: makeConfig({ TRENDFOLLOW_REQUIRE_STRUCTURE_BREAKOUT: true }),
        baseContext: {
          structure: { localRange: { breakoutState: 'above_high_level' } },
        } as any,
      }),
    ).toBe('TRENDFOLLOW_STRUCTURE_BREAKOUT_NOT_CONFIRMED');
  });

  it('supports a causal breakout-distance maturity range', () => {
    expect(
      getTrendFollowCoreFilterSkipCode({
        signal: makeSignal('SHORT', { breakoutDistancePct: 1.5 }),
        config: makeConfig({ TRENDFOLLOW_MIN_BREAKOUT_DISTANCE_PCT: 2 }),
      }),
    ).toBe('TRENDFOLLOW_BREAKOUT_DISTANCE_TOO_SMALL');

    expect(
      getTrendFollowCoreFilterSkipCode({
        signal: makeSignal('SHORT', { breakoutDistancePct: 3.5 }),
        config: makeConfig({ TRENDFOLLOW_MAX_BREAKOUT_DISTANCE_PCT: 3 }),
      }),
    ).toBe('TRENDFOLLOW_BREAKOUT_DISTANCE_TOO_EXTENDED');
  });

  it('applies breakout maturity overrides only to their direction', () => {
    const config = makeConfig({
      TRENDFOLLOW_MIN_BREAKOUT_DISTANCE_PCT: 1,
      TRENDFOLLOW_MIN_BREAKOUT_DISTANCE_PCT_LONG: 3,
      TRENDFOLLOW_MIN_BREAKOUT_DISTANCE_PCT_SHORT: 2,
    });

    expect(
      getTrendFollowCoreFilterSkipCode({
        signal: makeSignal('LONG', { breakoutDistancePct: 2.5 }),
        config,
      }),
    ).toBe('TRENDFOLLOW_BREAKOUT_DISTANCE_TOO_SMALL');
    expect(
      getTrendFollowCoreFilterSkipCode({
        signal: makeSignal('SHORT', { breakoutDistancePct: 2.5 }),
        config,
      }),
    ).toBeNull();
  });

  it('can require independent trend, benchmark, and volume confirmation', () => {
    const config = makeConfig({
      TRENDFOLLOW_REQUIRE_TREND_ALIGNMENT: true,
      TRENDFOLLOW_REQUIRE_BENCHMARK_ALIGNMENT: true,
      TRENDFOLLOW_MIN_VOLUME_REL20: 1,
    });
    const baseContext = {
      regime: { trend: { bias: 'bull' } },
      relative: { benchmark: { trendAlignment: 'aligned_bull' } },
      participation: { volume: { volumeRel20: 1.2 } },
    } as any;

    expect(
      getTrendFollowCoreFilterSkipCode({
        signal: makeSignal('LONG'),
        config,
        baseContext,
      }),
    ).toBeNull();
    expect(
      getTrendFollowCoreFilterSkipCode({
        signal: makeSignal('LONG'),
        config,
        baseContext: {
          ...baseContext,
          participation: { volume: { volumeRel20: 0.9 } },
        },
      }),
    ).toBe('TRENDFOLLOW_VOLUME_TOO_THIN');
  });

  it('can require repeated close acceptance and an ATR-sized breakout body', () => {
    const config = makeConfig({
      TRENDFOLLOW_MIN_STRUCTURE_ACCEPTANCE_CLOSES: 2,
      TRENDFOLLOW_MIN_BREAKOUT_BODY_ATR: 0.5,
    });

    expect(
      getTrendFollowCoreFilterSkipCode({
        signal: makeSignal('LONG'),
        config,
        baseContext: {
          structure: {
            acceptance: {
              closesAboveHighLevel3: 1,
              breakoutBodyAtr: 0.8,
            },
          },
        } as any,
      }),
    ).toBe('TRENDFOLLOW_CLOSE_ACCEPTANCE_TOO_WEAK');

    expect(
      getTrendFollowCoreFilterSkipCode({
        signal: makeSignal('LONG'),
        config,
        baseContext: {
          structure: {
            acceptance: {
              closesAboveHighLevel3: 2,
              breakoutBodyAtr: 0.4,
            },
          },
        } as any,
      }),
    ).toBe('TRENDFOLLOW_BREAKOUT_BODY_TOO_SMALL');
  });
});
