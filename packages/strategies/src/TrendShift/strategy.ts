import { createStrategyRuntime } from '@tradejs/node/strategies';
import { config as DEFAULT_CONFIG, TrendShiftConfig } from './config';
import { createTrendShiftCore } from './core';
import { trendShiftManifest } from './manifest';

export const TrendShiftStrategyCreator =
  createStrategyRuntime<TrendShiftConfig>({
    strategyName: 'TrendShift',
    defaults: DEFAULT_CONFIG as TrendShiftConfig,
    createCore: createTrendShiftCore,
    manifest: trendShiftManifest,
    strategyDirectory: __dirname,
  });
