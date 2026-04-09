import { createStrategyRuntime } from '@tradejs/node/strategies';
import { config as DEFAULT_CONFIG, ReverseTrendLineConfig } from './config';
import { createReverseTrendLineCore } from './core';
import { reverseTrendLineManifest } from './manifest';

export const ReverseTrendLineStrategyCreator =
  createStrategyRuntime<ReverseTrendLineConfig>({
    strategyName: 'ReverseTrendLine',
    defaults: DEFAULT_CONFIG as ReverseTrendLineConfig,
    createCore: createReverseTrendLineCore,
    manifest: reverseTrendLineManifest,
    strategyDirectory: __dirname,
  });
