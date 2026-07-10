import { StrategyMlAdapter } from '@tradejs/types';
import { getStrategyManifest } from '../strategy/manifests';
import { getStrategyProfileMlAdapter } from '../strategy/policyProfiles';

const defaultMlAdapter: StrategyMlAdapter = {
  normalizeStrategyConfig: (strategyConfig) => strategyConfig,
};

export const getStrategyMlAdapter = (
  strategy?: string,
  profileId?: string,
): StrategyMlAdapter => {
  const strategyAdapter = getStrategyProfileMlAdapter(
    getStrategyManifest(strategy),
    profileId,
  );
  if (!strategyAdapter) return defaultMlAdapter;

  return {
    ...defaultMlAdapter,
    ...strategyAdapter,
  };
};
