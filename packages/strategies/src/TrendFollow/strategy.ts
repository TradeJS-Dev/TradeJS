import { createStrategyRuntime } from '@tradejs/node/strategies';
import { config as DEFAULT_CONFIG, TrendFollowConfig } from './config';
import { createTrendFollowCore } from './core';
import { trendFollowManifest } from './manifest';

export const TrendFollowStrategyCreator =
  createStrategyRuntime<TrendFollowConfig>({
    strategyName: 'TrendFollow',
    defaults: DEFAULT_CONFIG as TrendFollowConfig,
    createCore: createTrendFollowCore,
    manifest: trendFollowManifest,
    strategyDirectory: __dirname,
  });
