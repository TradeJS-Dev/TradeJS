import { createStrategyRuntime } from '@utils/strategyRuntime';
import { config as DEFAULT_CONFIG, MaStrategyConfig } from './config';
import { createMaStrategyCore } from './core';

export const MaStrategyCreator = createStrategyRuntime<MaStrategyConfig>({
  strategyName: 'MaStrategy',
  defaults: DEFAULT_CONFIG as MaStrategyConfig,
  createCore: createMaStrategyCore,
});
