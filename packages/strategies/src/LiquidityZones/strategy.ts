import { createStrategyRuntime } from '@tradejs/node/strategies';
import { config as DEFAULT_CONFIG, LiquidityZonesConfig } from './config';
import { createLiquidityZonesCore } from './core';
import { liquidityZonesManifest } from './manifest';

export const LiquidityZonesStrategyCreator =
  createStrategyRuntime<LiquidityZonesConfig>({
    strategyName: 'LiquidityZones',
    defaults: DEFAULT_CONFIG as LiquidityZonesConfig,
    createCore: createLiquidityZonesCore,
    manifest: liquidityZonesManifest,
    strategyDirectory: __dirname,
  });
