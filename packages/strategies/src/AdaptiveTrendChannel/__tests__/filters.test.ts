/** @jest-environment node */

import { config as DEFAULT_CONFIG } from '../config';
import { getAdaptiveTrendChannelFilterSkipCode } from '../filters';

const makeSignal = (overrides: Record<string, unknown> = {}) =>
  ({
    direction: 'LONG',
    regime: 1,
    centerline: 100,
    roof: 103,
    floor: 97,
    halfChannel: 3,
    atr: 3,
    breakoutDistancePct: 0.6,
    breakoutDistanceAtr: 0.2,
    channelWidthPct: 6,
    timestamp: 1_700_000_000_000,
    close: 100.6,
    ...overrides,
  }) as any;

const makeConfig = (overrides: Record<string, unknown> = {}) =>
  ({
    ...DEFAULT_CONFIG,
    ADAPTIVE_TREND_CHANNEL_MIN_BREAKOUT_DISTANCE_ATR_LONG: undefined,
    ADAPTIVE_TREND_CHANNEL_MIN_BREAKOUT_DISTANCE_ATR_SHORT: undefined,
    ...overrides,
  }) as any;

describe('getAdaptiveTrendChannelFilterSkipCode', () => {
  it('keeps a neutral directional test config permissive', () => {
    expect(
      getAdaptiveTrendChannelFilterSkipCode({
        signal: makeSignal(),
        config: makeConfig(),
      }),
    ).toBeNull();
  });

  it('rejects flips that are too close to the centerline', () => {
    expect(
      getAdaptiveTrendChannelFilterSkipCode({
        signal: makeSignal({ breakoutDistancePct: 0.04 }),
        config: makeConfig({
          ADAPTIVE_TREND_CHANNEL_MIN_BREAKOUT_DISTANCE_PCT: 0.12,
        }),
      }),
    ).toBe('ADAPTIVE_TREND_CHANNEL_BREAKOUT_TOO_SMALL');
  });

  it('rejects overextended flips', () => {
    expect(
      getAdaptiveTrendChannelFilterSkipCode({
        signal: makeSignal({ breakoutDistancePct: 2.8 }),
        config: makeConfig({
          ADAPTIVE_TREND_CHANNEL_MAX_BREAKOUT_DISTANCE_PCT: 2,
        }),
      }),
    ).toBe('ADAPTIVE_TREND_CHANNEL_BREAKOUT_TOO_EXTENDED');
  });

  it('supports ATR-normalized breakout maturity bounds', () => {
    expect(
      getAdaptiveTrendChannelFilterSkipCode({
        signal: makeSignal({ breakoutDistanceAtr: 0.2 }),
        config: makeConfig({
          ADAPTIVE_TREND_CHANNEL_MIN_BREAKOUT_DISTANCE_ATR: 0.4,
        }),
      }),
    ).toBe('ADAPTIVE_TREND_CHANNEL_BREAKOUT_ATR_TOO_SMALL');

    expect(
      getAdaptiveTrendChannelFilterSkipCode({
        signal: makeSignal({ breakoutDistanceAtr: 2.5 }),
        config: makeConfig({
          ADAPTIVE_TREND_CHANNEL_MAX_BREAKOUT_DISTANCE_ATR: 2,
        }),
      }),
    ).toBe('ADAPTIVE_TREND_CHANNEL_BREAKOUT_ATR_TOO_EXTENDED');
  });

  it('keeps ATR maturity overrides direction-specific', () => {
    const config = makeConfig({
      ADAPTIVE_TREND_CHANNEL_MIN_BREAKOUT_DISTANCE_ATR_LONG: 1.2,
      ADAPTIVE_TREND_CHANNEL_MIN_BREAKOUT_DISTANCE_ATR_SHORT: 0.8,
    });

    expect(
      getAdaptiveTrendChannelFilterSkipCode({
        signal: makeSignal({ direction: 'LONG', breakoutDistanceAtr: 1 }),
        config,
      }),
    ).toBe('ADAPTIVE_TREND_CHANNEL_BREAKOUT_ATR_TOO_SMALL');
    expect(
      getAdaptiveTrendChannelFilterSkipCode({
        signal: makeSignal({ direction: 'SHORT', breakoutDistanceAtr: 1 }),
        config,
      }),
    ).toBeNull();
  });

  it('rejects thin-volume flips when volume context is available', () => {
    expect(
      getAdaptiveTrendChannelFilterSkipCode({
        signal: makeSignal(),
        config: makeConfig({
          ADAPTIVE_TREND_CHANNEL_MIN_VOLUME_REL20: 1,
        }),
        baseContext: {
          participation: {
            volume: { volumeRel20: 0.7 },
          },
        } as any,
      }),
    ).toBe('ADAPTIVE_TREND_CHANNEL_VOLUME_TOO_THIN');
  });

  it('can require external context alignment', () => {
    expect(
      getAdaptiveTrendChannelFilterSkipCode({
        signal: makeSignal({ direction: 'SHORT', regime: -1 }),
        config: makeConfig({
          ADAPTIVE_TREND_CHANNEL_REQUIRE_CONTEXT_ALIGNMENT: true,
        }),
        baseContext: {
          regime: { trend: { bias: 'bull' } },
          relative: { benchmark: { trendAlignment: 'aligned_bull' } },
          structure: { localRange: { breakoutState: 'above_high_level' } },
        } as any,
      }),
    ).toBe('ADAPTIVE_TREND_CHANNEL_CONTEXT_NOT_ALIGNED');

    expect(
      getAdaptiveTrendChannelFilterSkipCode({
        signal: makeSignal({ direction: 'SHORT', regime: -1 }),
        config: makeConfig({
          ADAPTIVE_TREND_CHANNEL_REQUIRE_CONTEXT_ALIGNMENT: true,
        }),
        baseContext: {
          relative: { benchmark: { trendAlignment: 'aligned_bear' } },
        } as any,
      }),
    ).toBeNull();
  });

  it('can require more than one independent context alignment', () => {
    expect(
      getAdaptiveTrendChannelFilterSkipCode({
        signal: makeSignal({ direction: 'SHORT', regime: -1 }),
        config: makeConfig({
          ADAPTIVE_TREND_CHANNEL_REQUIRE_CONTEXT_ALIGNMENT: true,
          ADAPTIVE_TREND_CHANNEL_MIN_CONTEXT_ALIGNMENTS: 2,
        }),
        baseContext: {
          relative: { benchmark: { trendAlignment: 'aligned_bear' } },
        } as any,
      }),
    ).toBe('ADAPTIVE_TREND_CHANNEL_CONTEXT_NOT_ALIGNED');
  });
});
