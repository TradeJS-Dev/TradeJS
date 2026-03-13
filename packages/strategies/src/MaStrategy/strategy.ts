import { createStrategyRuntime } from '@tradejs/node/strategies';
import { config as DEFAULT_CONFIG, MaStrategyConfig } from './config';
import { createMaStrategyCore } from './core';
import { maStrategyManifest } from './manifest';

export const MaStrategyCreator = createStrategyRuntime<MaStrategyConfig>({
  strategyName: 'MaStrategy',
  defaults: DEFAULT_CONFIG as MaStrategyConfig,
  createCore: createMaStrategyCore,
  manifest: maStrategyManifest,
  strategyDirectory: __dirname,
});
