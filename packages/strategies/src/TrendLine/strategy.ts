import { createStrategyRuntime } from '@tradejs/node/strategies';
import { config as DEFAULT_CONFIG, TrendLineConfig } from './config';
import { createTrendLineCore } from './core';
import { trendLineManifest } from './manifest';

export const TrendlineStrategyCreator = createStrategyRuntime<TrendLineConfig>({
  strategyName: 'TrendLine',
  defaults: DEFAULT_CONFIG as TrendLineConfig,
  createCore: createTrendLineCore,
  manifest: trendLineManifest,
  strategyDirectory: __dirname,
});
