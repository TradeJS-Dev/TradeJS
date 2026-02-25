import { StrategyMlAdapter } from '@types';
import { getStrategyManifest } from '../../strategy/manifests';

const defaultMlAdapter: StrategyMlAdapter = {
  normalizeStrategyConfig: (strategyConfig) => strategyConfig,
};

export const getStrategyMlAdapter = (strategy?: string): StrategyMlAdapter =>
  getStrategyManifest(strategy)?.mlAdapter ?? defaultMlAdapter;
