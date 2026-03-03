import { createStrategyRuntime } from '@utils/strategyRuntime';
import { config as DEFAULT_CONFIG } from './config';
import { createBreakoutCore } from './core';

export const BreakoutStrategyCreator = createStrategyRuntime({
  strategyName: 'Breakout',
  defaults: DEFAULT_CONFIG,
  createCore: createBreakoutCore,
});
