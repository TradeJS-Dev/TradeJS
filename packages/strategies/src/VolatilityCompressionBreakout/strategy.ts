import type { StrategyRegistryEntry } from '@tradejs/types';
import {
  VolatilityCompressionBreakoutConfig,
  config as DEFAULT_CONFIG,
} from './config';
import { createVolatilityCompressionBreakoutCore } from './core';
import { volatilityCompressionBreakoutManifest } from './manifest';

export const VolatilityCompressionBreakoutStrategyDefinition: StrategyRegistryEntry<VolatilityCompressionBreakoutConfig> =
  {
    defaults: DEFAULT_CONFIG,
    createCore: createVolatilityCompressionBreakoutCore,
    manifest: volatilityCompressionBreakoutManifest,
  };
