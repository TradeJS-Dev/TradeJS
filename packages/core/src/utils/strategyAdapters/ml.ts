import { StrategyMlAdapter } from '@tradejs/types';
import { getStrategyManifest } from '../../strategy/manifests';

const defaultMlAdapter: StrategyMlAdapter = {
  normalizeStrategyConfig: (strategyConfig) => strategyConfig,
};

export const getStrategyMlAdapter = (strategy?: string): StrategyMlAdapter => {
  const strategyAdapter = getStrategyManifest(strategy)?.mlAdapter;
  if (!strategyAdapter) return defaultMlAdapter;

  return {
    ...defaultMlAdapter,
    ...strategyAdapter,
  };
};
