import { createStrategyRuntime } from '@utils/strategyRuntime';
import { config as DEFAULT_CONFIG, TrendLineConfig } from './config';
import { createTrendLineCore } from './core';

export const TrendlineStrategyCreator = createStrategyRuntime<TrendLineConfig>({
  strategyName: 'TrendLine',
  defaults: DEFAULT_CONFIG as TrendLineConfig,
  createCore: createTrendLineCore,
});
