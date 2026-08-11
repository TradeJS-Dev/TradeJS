import type { StrategyRegistryEntry } from '@tradejs/types';
import { config as DEFAULT_CONFIG, HeadAndShouldersConfig } from './config';
import { createHeadAndShouldersCore } from './core';
import { headAndShouldersManifest } from './manifest';

export const HeadAndShouldersStrategyDefinition: StrategyRegistryEntry<HeadAndShouldersConfig> =
  {
    defaults: DEFAULT_CONFIG,
    createCore: createHeadAndShouldersCore,
    manifest: headAndShouldersManifest,
  };
