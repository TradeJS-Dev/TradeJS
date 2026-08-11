import type { StrategyRegistryEntry } from '@tradejs/types';
import { config as DEFAULT_CONFIG, CupAndHandleConfig } from './config';
import { createCupAndHandleCore } from './core';
import { cupAndHandleManifest } from './manifest';

export const CupAndHandleStrategyDefinition: StrategyRegistryEntry<CupAndHandleConfig> =
  {
    defaults: DEFAULT_CONFIG,
    createCore: createCupAndHandleCore,
    manifest: cupAndHandleManifest,
  };
