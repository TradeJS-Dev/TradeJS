import { createStrategyRuntime } from '@tradejs/node/strategies';
import { config as DEFAULT_CONFIG, MSLLiquidityZonesConfig } from './config';
import { createMSLLiquidityZonesCore } from './core';
import { mslLiquidityZonesManifest } from './manifest';

export const MSLLiquidityZonesStrategyCreator =
  createStrategyRuntime<MSLLiquidityZonesConfig>({
    strategyName: 'LiquidityZones',
    defaults: DEFAULT_CONFIG as MSLLiquidityZonesConfig,
    createCore: createMSLLiquidityZonesCore,
    manifest: mslLiquidityZonesManifest,
    strategyDirectory: __dirname,
  });
