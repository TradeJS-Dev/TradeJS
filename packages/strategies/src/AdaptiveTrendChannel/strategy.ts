import type { StrategyRegistryEntry } from '@tradejs/types';
import { AdaptiveTrendChannelConfig, config as DEFAULT_CONFIG } from './config';
import { createAdaptiveTrendChannelCore } from './core';
import { adaptiveTrendChannelManifest } from './manifest';

export const AdaptiveTrendChannelStrategyDefinition: StrategyRegistryEntry<AdaptiveTrendChannelConfig> =
  {
    defaults: DEFAULT_CONFIG,
    createCore: createAdaptiveTrendChannelCore,
    manifest: adaptiveTrendChannelManifest,
  };
