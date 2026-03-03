import { createStrategyRuntime } from '@utils/strategyRuntime';
import { config as DEFAULT_CONFIG, VolumeDivergenceConfig } from './config';
import { createVolumeDivergenceCore } from './core';

export const VolumeDivergenceStrategyCreator =
  createStrategyRuntime<VolumeDivergenceConfig>({
    strategyName: 'VolumeDivergence',
    defaults: DEFAULT_CONFIG as VolumeDivergenceConfig,
    createCore: createVolumeDivergenceCore,
  });
