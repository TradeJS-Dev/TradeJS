import type { StrategyRegistryEntry } from '@tradejs/types';
import { config as DEFAULT_CONFIG, MaStrategyConfig } from './config';
import { createMaStrategyCore } from './core';
import { maStrategyManifest } from './manifest';

export const MaStrategyDefinition: StrategyRegistryEntry<MaStrategyConfig> = {
  defaults: DEFAULT_CONFIG,
  createCore: createMaStrategyCore,
  manifest: maStrategyManifest,
};
