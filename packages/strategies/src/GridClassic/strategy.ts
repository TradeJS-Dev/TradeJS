import type { StrategyRegistryEntry } from '@tradejs/types';
import { config as DEFAULT_CONFIG, type GridClassicConfig } from './config';
import { createGridClassicCore } from './core';
import { gridClassicManifest } from './manifest';

export const GridClassicStrategyDefinition: StrategyRegistryEntry<GridClassicConfig> =
  {
    defaults: DEFAULT_CONFIG,
    createCore: createGridClassicCore,
    manifest: gridClassicManifest,
  };
