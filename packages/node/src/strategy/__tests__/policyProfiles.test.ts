import {
  getStrategyProfileAiAdapter,
  getStrategyProfileMlAdapter,
  resolveStrategyPolicyProfile,
} from '../policyProfiles';

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

  it('selects the compatible default profile by universe and asset class', () => {
    const manifest = {
      name: 'SharedCore',
      defaultPolicyProfileId: 'tradfi-equity',
      policyProfiles: [
        {
          id: 'tradfi-forex',
          appliesTo: {
            universes: ['tradfi'] as const,
            assetClasses: ['forex'] as const,
          },
        },
        {
          id: 'tradfi-equity',
          appliesTo: {
            universes: ['tradfi'] as const,
            assetClasses: ['equity'] as const,
          },
        },
      ],
    };

    expect(
      resolveStrategyPolicyProfile(manifest, {
        universe: 'tradfi',
        assetClass: 'equity',
      })?.id,
    ).toBe('tradfi-equity');
    expect(
      resolveStrategyPolicyProfile(manifest, {
        universe: 'tradfi',
        assetClass: 'commodity',
      }),
    ).toBeUndefined();
  });

  it('uses profile adapters with manifest adapters as fallback', () => {
    const manifestAi = { id: 'manifest-ai' } as any;
    const manifestMl = { id: 'manifest-ml' } as any;
    const profileAi = { id: 'profile-ai' } as any;
    const profileMl = { id: 'profile-ml' } as any;
    const manifest = {
      name: 'SharedCore',
      aiAdapter: manifestAi,
      mlAdapter: manifestMl,
      policyProfiles: [
        { id: 'tradfi', aiAdapter: profileAi, mlAdapter: profileMl },
        { id: 'crypto' },
      ],
    };

    expect(getStrategyProfileAiAdapter(manifest, 'tradfi')).toBe(profileAi);
    expect(getStrategyProfileMlAdapter(manifest, 'tradfi')).toBe(profileMl);
    expect(getStrategyProfileAiAdapter(manifest, 'crypto')).toBe(manifestAi);
    expect(getStrategyProfileMlAdapter(manifest, 'missing')).toBe(manifestMl);
  });

  it('rejects unknown inferred and declared profile ids', () => {
    expect(() =>
      resolveStrategyPolicyProfile(
        { name: 'SharedCore' },
        {
          profileId: 'custom',
          universe: 'tradfi',
        },
      ),
    ).toThrow('Unknown policy profile');
    expect(() =>
      resolveStrategyPolicyProfile(
        { name: 'SharedCore', policyProfiles: [{ id: 'crypto' }] },
        { profileId: 'tradfi', universe: 'tradfi' },
      ),
    ).toThrow('Unknown policy profile');
  });
});
