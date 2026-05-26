import { createStrategyRuntime } from '@tradejs/node/strategies';
import { AdaptiveTrendChannelConfig, config as DEFAULT_CONFIG } from './config';
import { createAdaptiveTrendChannelCore } from './core';
import { adaptiveTrendChannelManifest } from './manifest';

export const AdaptiveTrendChannelStrategyCreator =
  createStrategyRuntime<AdaptiveTrendChannelConfig>({
    strategyName: 'AdaptiveTrendChannel',
    defaults: DEFAULT_CONFIG as AdaptiveTrendChannelConfig,
    createCore: createAdaptiveTrendChannelCore,
    manifest: adaptiveTrendChannelManifest,
    strategyDirectory: __dirname,
  });
