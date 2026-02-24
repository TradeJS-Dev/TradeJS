import { createStrategyRuntime } from '@utils/strategyRuntime';
import { config as DEFAULT_CONFIG } from './config';
import { createTrendLineCore } from './core';

export const TrendlineStrategyCreator = createStrategyRuntime({
  strategyName: 'TrendLine',
  defaults: DEFAULT_CONFIG,
  createCore: createTrendLineCore,
});
