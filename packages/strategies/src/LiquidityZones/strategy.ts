import { createStrategyRuntime } from '@tradejs/node/strategies';
import { config as DEFAULT_CONFIG, LiquidityZonesConfig } from './config';
import { createLiquidityZonesCore } from './core';
import { buildLiquidityZonesDetectorKey } from './engine';
import { liquidityZonesManifest } from './manifest';

export const LiquidityZonesStrategyCreator =
  createStrategyRuntime<LiquidityZonesConfig>({
    strategyName: 'LiquidityZones',
    defaults: DEFAULT_CONFIG as LiquidityZonesConfig,
    createCore: createLiquidityZonesCore,
    manifest: liquidityZonesManifest,
    strategyDirectory: __dirname,
    detectorKey: buildLiquidityZonesDetectorKey,
    detectorNoSignalSkipReason: 'NO_LIQUIDITY_ZONE_RETEST',
  });
