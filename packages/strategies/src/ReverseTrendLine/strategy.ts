import type { StrategyRegistryEntry } from '@tradejs/types';
import { config as DEFAULT_CONFIG, ReverseTrendLineConfig } from './config';
import { createReverseTrendLineCore } from './core';
import { reverseTrendLineManifest } from './manifest';

export const ReverseTrendLineStrategyDefinition: StrategyRegistryEntry<ReverseTrendLineConfig> =
  {
    defaults: DEFAULT_CONFIG,
    createCore: createReverseTrendLineCore,
    manifest: reverseTrendLineManifest,
  };
