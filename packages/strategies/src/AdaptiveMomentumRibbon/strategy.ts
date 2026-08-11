import type { StrategyRegistryEntry } from '@tradejs/types';
import {
  AdaptiveMomentumRibbonConfig,
  config as DEFAULT_CONFIG,
} from './config';
import { createAdaptiveMomentumRibbonCore } from './core';
import { adaptiveMomentumRibbonManifest } from './manifest';

export const AdaptiveMomentumRibbonStrategyDefinition: StrategyRegistryEntry<AdaptiveMomentumRibbonConfig> =
  {
    defaults: DEFAULT_CONFIG,
    createCore: createAdaptiveMomentumRibbonCore,
    manifest: adaptiveMomentumRibbonManifest,
  };
