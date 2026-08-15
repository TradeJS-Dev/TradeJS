/** @jest-environment node */

import { config as DEFAULT_CONFIG } from '../config';
import { getTrendShiftCoreFilterSkipCode } from '../filters';

const makeBaseContext = ({ bodyStrength = 0.8, adx = 30 } = {}) =>
  ({
    regime: {
      momentum: { bodyStrength },
      trend: { adx: { adx } },
    },
  }) as any;

describe('getTrendShiftCoreFilterSkipCode', () => {
  it('accepts a mature flip with a strong body and trend', () => {
    expect(
      getTrendShiftCoreFilterSkipCode({
        config: DEFAULT_CONFIG as any,
        baseContext: makeBaseContext(),
        direction: 'LONG',
      }),
    ).toBeNull();
  });

  it('rejects weak signal bodies and weak ADX independently', () => {
    expect(
      getTrendShiftCoreFilterSkipCode({
        config: DEFAULT_CONFIG as any,
        baseContext: makeBaseContext({ bodyStrength: 0.69 }),
        direction: 'LONG',
      }),
    ).toBe('TRENDSHIFT_SIGNAL_BODY_TOO_WEAK');
    expect(
      getTrendShiftCoreFilterSkipCode({
        config: DEFAULT_CONFIG as any,
        baseContext: makeBaseContext({ adx: 24.9 }),
        direction: 'LONG',
      }),
    ).toBe('TRENDSHIFT_TREND_STRENGTH_TOO_LOW');
  });

  it('applies directional overrides only to the matching side', () => {
    const config = {
      ...DEFAULT_CONFIG,
      TRENDSHIFT_MIN_ADX_SHORT: 40,
      TRENDSHIFT_MIN_SIGNAL_BODY_STRENGTH_SHORT: 0.9,
    };

    expect(
      getTrendShiftCoreFilterSkipCode({
        config: config as any,
        baseContext: makeBaseContext({ bodyStrength: 0.85, adx: 35 }),
        direction: 'LONG',
      }),
    ).toBeNull();
    expect(
      getTrendShiftCoreFilterSkipCode({
        config: config as any,
        baseContext: makeBaseContext({ bodyStrength: 0.85, adx: 35 }),
        direction: 'SHORT',
      }),
    ).toBe('TRENDSHIFT_SIGNAL_BODY_TOO_WEAK');
  });
});
