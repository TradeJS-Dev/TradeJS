/** @jest-environment node */

import { config as DEFAULT_CONFIG } from '../config';
import { getDoubleTapCoreFilterSkipCode } from '../filters';

const makePattern = (direction: 'LONG' | 'SHORT', confirmationBars: number) =>
  ({ direction, confirmationBars }) as any;

describe('getDoubleTapCoreFilterSkipCode', () => {
  it('rejects late long acceptance but keeps the short lifetime independent', () => {
    expect(
      getDoubleTapCoreFilterSkipCode({
        config: DEFAULT_CONFIG as any,
        pattern: makePattern('LONG', 2),
      }),
    ).toBe('DOUBLETAP_CONFIRMATION_TOO_LATE');
    expect(
      getDoubleTapCoreFilterSkipCode({
        config: DEFAULT_CONFIG as any,
        pattern: makePattern('SHORT', 2),
        baseContext: {
          raw: { volatility: { bbWidthPct: 5 } },
        } as any,
      }),
    ).toBeNull();
  });

  it('rejects short entries after excessive volatility expansion', () => {
    expect(
      getDoubleTapCoreFilterSkipCode({
        config: DEFAULT_CONFIG as any,
        pattern: makePattern('SHORT', 1),
        baseContext: {
          raw: { volatility: { bbWidthPct: 6.01 } },
        } as any,
      }),
    ).toBe('DOUBLETAP_VOLATILITY_TOO_WIDE');
  });
});
