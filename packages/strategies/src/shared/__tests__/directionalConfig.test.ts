/** @jest-environment node */

import { resolveDirectionalConfigNumber } from '../directionalConfig';

describe('resolveDirectionalConfigNumber', () => {
  it('uses direction overrides without changing the opposite side', () => {
    const config = {
      SETUP_THRESHOLD: 1,
      SETUP_THRESHOLD_LONG: 2,
      SETUP_THRESHOLD_SHORT: 3,
    };

    expect(
      resolveDirectionalConfigNumber({
        config,
        key: 'SETUP_THRESHOLD',
        direction: 'LONG',
        fallback: 0,
      }),
    ).toBe(2);
    expect(
      resolveDirectionalConfigNumber({
        config,
        key: 'SETUP_THRESHOLD',
        direction: 'SHORT',
        fallback: 0,
      }),
    ).toBe(3);
  });

  it('falls back to the shared value and then to the explicit default', () => {
    expect(
      resolveDirectionalConfigNumber({
        config: { SETUP_THRESHOLD: 1.5 },
        key: 'SETUP_THRESHOLD',
        direction: 'LONG',
        fallback: 0,
      }),
    ).toBe(1.5);
    expect(
      resolveDirectionalConfigNumber({
        config: { SETUP_THRESHOLD_SHORT: 'invalid' },
        key: 'SETUP_THRESHOLD',
        direction: 'SHORT',
        fallback: 0.75,
      }),
    ).toBe(0.75);
  });
});
