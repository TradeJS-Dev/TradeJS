/** @jest-environment node */

import { config as DEFAULT_CONFIG } from '../config';
import { getHeadAndShouldersCoreFilterSkipCode } from '../filters';

const makeConfig = (overrides: Record<string, unknown> = {}) =>
  ({ ...DEFAULT_CONFIG, ...overrides }) as any;

const makePattern = (direction: 'LONG' | 'SHORT', headHeightAtr: number) =>
  ({ direction, headHeightAtr }) as any;

describe('getHeadAndShouldersCoreFilterSkipCode', () => {
  it('requires mature inverse patterns with a decisive entry candle', () => {
    expect(
      getHeadAndShouldersCoreFilterSkipCode({
        pattern: makePattern('LONG', 5),
        config: makeConfig(),
        baseContext: {
          regime: { momentum: { bodyStrength: 0.4 } },
        } as any,
      }),
    ).toBe('HEADSHOULDERS_SIGNAL_BODY_TOO_WEAK');

    expect(
      getHeadAndShouldersCoreFilterSkipCode({
        pattern: makePattern('LONG', 3.9),
        config: makeConfig(),
        baseContext: {
          regime: { momentum: { bodyStrength: 0.8 } },
        } as any,
      }),
    ).toBe('HEADSHOULDERS_HEAD_TOO_SHALLOW_AT_ENTRY');
  });

  it('keeps the classic short side unchanged by default', () => {
    expect(
      getHeadAndShouldersCoreFilterSkipCode({
        pattern: makePattern('SHORT', 1),
        config: makeConfig(),
      }),
    ).toBeNull();
  });
});
