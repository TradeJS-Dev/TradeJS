import type { StrategyRegistryEntry } from '@tradejs/types';
import { config as DEFAULT_CONFIG, TrendShiftConfig } from './config';
import { createTrendShiftCore } from './core';
import { trendShiftManifest } from './manifest';

export const TrendShiftStrategyDefinition: StrategyRegistryEntry<TrendShiftConfig> =
  {
    defaults: DEFAULT_CONFIG,
    createCore: createTrendShiftCore,
    manifest: trendShiftManifest,
  };
