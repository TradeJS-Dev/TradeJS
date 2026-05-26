import { createStrategyRuntime } from '@tradejs/node/strategies';
import { config as DEFAULT_CONFIG, MSLLiquidityTailsConfig } from './config';
import { createMSLLiquidityTailsCore } from './core';
import { mslLiquidityTailsManifest } from './manifest';

export const MSLLiquidityTailsStrategyCreator =
  createStrategyRuntime<MSLLiquidityTailsConfig>({
    strategyName: 'LiquidityTails',
    defaults: DEFAULT_CONFIG as MSLLiquidityTailsConfig,
    createCore: createMSLLiquidityTailsCore,
    manifest: mslLiquidityTailsManifest,
    strategyDirectory: __dirname,
  });
