import type { StrategyRegistryEntry } from '@tradejs/types';
import { config as DEFAULT_CONFIG, StructureZonesConfig } from './config';
import { createStructureZonesCore } from './core';
import { structureZonesManifest } from './manifest';

export const StructureZonesStrategyDefinition: StrategyRegistryEntry<StructureZonesConfig> =
  {
    defaults: DEFAULT_CONFIG,
    createCore: createStructureZonesCore,
    manifest: structureZonesManifest,
  };
