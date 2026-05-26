import { createStrategyRuntime } from '@tradejs/node/strategies';
import { config as DEFAULT_CONFIG, StructureZonesConfig } from './config';
import { createStructureZonesCore } from './core';
import { structureZonesManifest } from './manifest';

export const StructureZonesStrategyCreator =
  createStrategyRuntime<StructureZonesConfig>({
    strategyName: 'StructureZones',
    defaults: DEFAULT_CONFIG as StructureZonesConfig,
    createCore: createStructureZonesCore,
    manifest: structureZonesManifest,
    strategyDirectory: __dirname,
  });
