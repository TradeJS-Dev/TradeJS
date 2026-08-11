import type { StrategyRegistryEntry } from '@tradejs/types';
import { RelativeRotationConfig, config as DEFAULT_CONFIG } from './config';
import { createRelativeRotationCore } from './core';
import { relativeRotationManifest } from './manifest';

export const RelativeRotationStrategyDefinition: StrategyRegistryEntry<RelativeRotationConfig> =
  {
    defaults: DEFAULT_CONFIG,
    createCore: createRelativeRotationCore,
    manifest: relativeRotationManifest,
  };
