import type { StrategyRegistryEntry } from '@tradejs/types';
import { config as DEFAULT_CONFIG, LiquidityTailsConfig } from './config';
import { createLiquidityTailsCore } from './core';
import { liquidityTailsManifest } from './manifest';

export const LiquidityTailsStrategyDefinition: StrategyRegistryEntry<LiquidityTailsConfig> =
  {
    defaults: DEFAULT_CONFIG,
    createCore: createLiquidityTailsCore,
    manifest: liquidityTailsManifest,
  };
