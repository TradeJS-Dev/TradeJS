import { createStrategyRuntime } from '@tradejs/node/strategies';
import { config as DEFAULT_CONFIG, LiquidityTailsConfig } from './config';
import { createLiquidityTailsCore } from './core';
import { liquidityTailsManifest } from './manifest';

export const LiquidityTailsStrategyCreator =
  createStrategyRuntime<LiquidityTailsConfig>({
    strategyName: 'LiquidityTails',
    defaults: DEFAULT_CONFIG as LiquidityTailsConfig,
    createCore: createLiquidityTailsCore,
    manifest: liquidityTailsManifest,
    strategyDirectory: __dirname,
  });
