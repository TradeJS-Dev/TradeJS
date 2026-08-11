import type { StrategyRegistryEntry } from '@tradejs/types';
import { config as DEFAULT_CONFIG } from './config';
import { createBreakoutCore } from './core';
import { breakoutManifest } from './manifest';

export const BreakoutStrategyDefinition: StrategyRegistryEntry = {
  defaults: DEFAULT_CONFIG,
  createCore: createBreakoutCore,
  manifest: breakoutManifest,
};
