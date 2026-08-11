import type { StrategyRegistryEntry } from '@tradejs/types';
import { config as DEFAULT_CONFIG, DoubleTapConfig } from './config';
import { createDoubleTapCore } from './core';
import { doubleTapManifest } from './manifest';

export const DoubleTapStrategyDefinition: StrategyRegistryEntry<DoubleTapConfig> =
  {
    defaults: DEFAULT_CONFIG,
    createCore: createDoubleTapCore,
    manifest: doubleTapManifest,
  };
