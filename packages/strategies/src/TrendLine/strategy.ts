import type { StrategyRegistryEntry } from '@tradejs/types';
import { config as DEFAULT_CONFIG, TrendLineConfig } from './config';
import { createTrendLineCore } from './core';
import { trendLineManifest } from './manifest';

export const TrendlineStrategyDefinition: StrategyRegistryEntry<TrendLineConfig> =
  {
    defaults: DEFAULT_CONFIG,
    createCore: createTrendLineCore,
    manifest: trendLineManifest,
  };
