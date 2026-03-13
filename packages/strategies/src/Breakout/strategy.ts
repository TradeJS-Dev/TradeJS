import { createStrategyRuntime } from '@tradejs/core/strategies';
import { config as DEFAULT_CONFIG } from './config';
import { createBreakoutCore } from './core';
import { breakoutManifest } from './manifest';

export const BreakoutStrategyCreator = createStrategyRuntime({
  strategyName: 'Breakout',
  defaults: DEFAULT_CONFIG,
  createCore: createBreakoutCore,
  manifest: breakoutManifest,
  strategyDirectory: __dirname,
});
