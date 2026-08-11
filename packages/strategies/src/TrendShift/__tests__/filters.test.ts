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
      }),
    ).toBeNull();
  });

  it('rejects weak signal bodies and weak ADX independently', () => {
    expect(
      getTrendShiftCoreFilterSkipCode({
        config: DEFAULT_CONFIG as any,
        baseContext: makeBaseContext({ bodyStrength: 0.69 }),
      }),
    ).toBe('TRENDSHIFT_SIGNAL_BODY_TOO_WEAK');
    expect(
      getTrendShiftCoreFilterSkipCode({
        config: DEFAULT_CONFIG as any,
        baseContext: makeBaseContext({ adx: 24.9 }),
      }),
    ).toBe('TRENDSHIFT_TREND_STRENGTH_TOO_LOW');
  });
});
