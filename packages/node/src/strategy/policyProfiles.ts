import type {
  AssetClass,
  MarketUniverse,
  StrategyManifest,
  StrategyPolicyProfile,
} from '@tradejs/types';

const profileMatches = (
  profile: StrategyPolicyProfile,
  universe?: MarketUniverse,
  assetClass?: AssetClass,
) => {
  const { appliesTo } = profile;
  if (!appliesTo) return true;
  if (
    appliesTo.universes?.length &&
    (!universe || !appliesTo.universes.includes(universe))
  ) {
    return false;
  }
  if (
    appliesTo.assetClasses?.length &&
    (!assetClass || !appliesTo.assetClasses.includes(assetClass))
  ) {
    return false;
  }
  return true;
};

export const resolveStrategyPolicyProfile = (
  manifest: StrategyManifest | undefined,
  params: {
    profileId?: string;
    universe?: MarketUniverse;
    assetClass?: AssetClass;
  },
): StrategyPolicyProfile | undefined => {
  const profiles = manifest?.policyProfiles ?? [];
  if (!profiles.length) {
    const inferredId =
      params.profileId ?? (params.universe === 'tradfi' ? 'tradfi' : undefined);
    if (!inferredId) return undefined;
    if (inferredId !== 'crypto' && inferredId !== 'tradfi') {
      throw new Error(
        `Unknown policy profile "${inferredId}" for strategy "${manifest?.name}"`,
      );
    }
    if (params.universe && inferredId !== params.universe) {
      throw new Error(
        `Policy profile "${inferredId}" is not compatible with ${params.universe}`,
      );
    }
    return {
      id: inferredId,
      appliesTo: { universes: [inferredId] },
      marketDataRequirements:
        inferredId === 'crypto' ? ['crypto.btcReference'] : [],
      ...(manifest?.mlAdapter
        ? {
            entryRuntimeDefaults: {
              ml: {
                modelKey:
                  inferredId === 'crypto'
                    ? manifest.name
                    : `${manifest.name}:tradfi`,
              },
            },
          }
        : {}),
    };
  }

  if (params.profileId) {
    const profile = profiles.find(({ id }) => id === params.profileId);
    if (!profile) {
      throw new Error(
        `Unknown policy profile "${params.profileId}" for strategy "${manifest?.name}"`,
      );
    }
    if (!profileMatches(profile, params.universe, params.assetClass)) {
      throw new Error(
        `Policy profile "${params.profileId}" is not compatible with ${params.universe ?? 'unknown'}:${params.assetClass ?? 'unknown'}`,
      );
    }
    return profile;
  }

  const matching = profiles.filter((profile) =>
    profileMatches(profile, params.universe, params.assetClass),
  );
  const defaultProfile = matching.find(
    ({ id }) => id === manifest?.defaultPolicyProfileId,
  );
  return defaultProfile ?? matching[0];
};

export const getStrategyProfileAiAdapter = (
  manifest: StrategyManifest | undefined,
  profileId?: string,
) =>
  manifest?.policyProfiles?.find(({ id }) => id === profileId)?.aiAdapter ??
  manifest?.aiAdapter;

export const getStrategyProfileMlAdapter = (
  manifest: StrategyManifest | undefined,
  profileId?: string,
) =>
  manifest?.policyProfiles?.find(({ id }) => id === profileId)?.mlAdapter ??
  manifest?.mlAdapter;
