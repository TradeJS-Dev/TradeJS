import type { StrategyRegistryEntry } from '@tradejs/types';
import { config as DEFAULT_CONFIG, VolumeDivergenceConfig } from './config';
import { createVolumeDivergenceCore } from './core';
import { volumeDivergenceManifest } from './manifest';

export const VolumeDivergenceStrategyDefinition: StrategyRegistryEntry<VolumeDivergenceConfig> =
  {
    defaults: DEFAULT_CONFIG,
    createCore: createVolumeDivergenceCore,
    manifest: volumeDivergenceManifest,
  };
