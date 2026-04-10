import { createStrategyRuntime } from '@tradejs/node/strategies';
import { config as DEFAULT_CONFIG, VolumeDivergenceConfig } from './config';
import { createVolumeDivergenceCore } from './core';
import { volumeDivergenceManifest } from './manifest';

export const VolumeDivergenceStrategyCreator =
  createStrategyRuntime<VolumeDivergenceConfig>({
    strategyName: 'VolumeDivergence',
    defaults: DEFAULT_CONFIG as VolumeDivergenceConfig,
    createCore: createVolumeDivergenceCore,
    manifest: volumeDivergenceManifest,
    strategyDirectory: __dirname,
  });
