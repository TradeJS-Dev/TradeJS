import { resolveStrategyPolicyProfile } from '../policyProfiles';

describe('strategy policy profiles', () => {
  it('infers a separate TradFi ML model without duplicating strategy core', () => {
    const profile = resolveStrategyPolicyProfile(
      { name: 'TrendLine', mlAdapter: {} },
      { universe: 'tradfi' },
    );

    expect(profile).toEqual(
      expect.objectContaining({
        id: 'tradfi',
        marketDataRequirements: [],
        entryRuntimeDefaults: {
          ml: { modelKey: 'TrendLine:tradfi' },
        },
      }),
    );
  });

  it('selects a declared profile and rejects universe mismatches', () => {
    const manifest = {
      name: 'SharedCore',
      policyProfiles: [
        { id: 'crypto-ai', appliesTo: { universes: ['crypto'] as const } },
        { id: 'tradfi-ai', appliesTo: { universes: ['tradfi'] as const } },
      ],
    };

    expect(
      resolveStrategyPolicyProfile(manifest, {
        profileId: 'tradfi-ai',
        universe: 'tradfi',
      })?.id,
    ).toBe('tradfi-ai');
    expect(() =>
      resolveStrategyPolicyProfile(manifest, {
        profileId: 'crypto-ai',
        universe: 'tradfi',
      }),
    ).toThrow('not compatible');
  });
});
