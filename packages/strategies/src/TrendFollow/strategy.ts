import type { StrategyRegistryEntry } from '@tradejs/types';
import { config as DEFAULT_CONFIG, TrendFollowConfig } from './config';
import { createTrendFollowCore } from './core';
import { trendFollowManifest } from './manifest';

export const TrendFollowStrategyDefinition: StrategyRegistryEntry<TrendFollowConfig> =
  {
    defaults: DEFAULT_CONFIG,
    createCore: createTrendFollowCore,
    manifest: trendFollowManifest,
  };
