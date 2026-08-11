/** @jest-environment node */

import { config as DEFAULT_CONFIG } from '../config';
import { getStructureZonesCoreFilterSkipCode } from '../filters';

const makeConfig = (overrides: Record<string, unknown> = {}) =>
  ({ ...DEFAULT_CONFIG, ...overrides }) as any;

const makeSignal = (
  direction: 'LONG' | 'SHORT',
  reactionCloseDistancePct = 1,
) => ({ direction, reactionCloseDistancePct }) as any;

const makeBaseContext = (atrRank = 40, persistence = 0.8) =>
  ({
    regime: {
      trend: { persistence },
      volatility: { percentiles: { atrPctRank100: atrRank } },
    },
  }) as any;

describe('getStructureZonesCoreFilterSkipCode', () => {
  it('rejects signals in the upper half of the volatility distribution', () => {
    expect(
      getStructureZonesCoreFilterSkipCode({
        signal: makeSignal('LONG'),
        config: makeConfig(),
        baseContext: makeBaseContext(51),
      }),
    ).toBe('STRUCTURE_ZONES_VOLATILITY_RANK_TOO_HIGH');
  });

  it('requires deeper long reactions and persistent short trends', () => {
    expect(
      getStructureZonesCoreFilterSkipCode({
        signal: makeSignal('LONG', 0.74),
        config: makeConfig(),
        baseContext: makeBaseContext(),
      }),
    ).toBe('STRUCTURE_ZONES_REACTION_TOO_SHALLOW');

    expect(
      getStructureZonesCoreFilterSkipCode({
        signal: makeSignal('SHORT'),
        config: makeConfig(),
        baseContext: makeBaseContext(40, 0.49),
      }),
    ).toBe('STRUCTURE_ZONES_TREND_NOT_PERSISTENT');
  });

  it('accepts a qualified setup in both directions', () => {
    expect(
      getStructureZonesCoreFilterSkipCode({
        signal: makeSignal('LONG'),
        config: makeConfig(),
        baseContext: makeBaseContext(),
      }),
    ).toBeNull();

    expect(
      getStructureZonesCoreFilterSkipCode({
        signal: makeSignal('SHORT'),
        config: makeConfig(),
        baseContext: makeBaseContext(),
      }),
    ).toBeNull();
  });
});
