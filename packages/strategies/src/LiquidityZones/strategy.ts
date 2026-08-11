import type { StrategyRegistryEntry } from '@tradejs/types';
import { config as DEFAULT_CONFIG, LiquidityZonesConfig } from './config';
import { createLiquidityZonesCore } from './core';
import { buildLiquidityZonesDetectorKey } from './engine';
import { liquidityZonesManifest } from './manifest';

export const LiquidityZonesStrategyDefinition: StrategyRegistryEntry<LiquidityZonesConfig> =
  {
    defaults: DEFAULT_CONFIG,
    createCore: createLiquidityZonesCore,
    manifest: liquidityZonesManifest,
    detectorKey: buildLiquidityZonesDetectorKey,
    detectorNoSignalSkipReason: 'NO_LIQUIDITY_ZONE_RETEST',
  };
