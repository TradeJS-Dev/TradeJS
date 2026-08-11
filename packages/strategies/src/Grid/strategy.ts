import type { StrategyRegistryEntry } from '@tradejs/types';
import { config as DEFAULT_CONFIG, GridConfig } from './config';
import { createGridCore } from './core';
import { gridManifest } from './manifest';

export const GridStrategyDefinition: StrategyRegistryEntry<GridConfig> = {
  defaults: DEFAULT_CONFIG,
  createCore: createGridCore,
  manifest: gridManifest,
};
