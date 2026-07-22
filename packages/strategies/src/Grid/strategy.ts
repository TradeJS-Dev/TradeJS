import { createStrategyRuntime } from '@tradejs/node/strategies';
import { config as DEFAULT_CONFIG, GridConfig } from './config';
import { createGridCore } from './core';
import { gridManifest } from './manifest';

export const GridStrategyCreator = createStrategyRuntime<GridConfig>({
  strategyName: 'Grid',
  defaults: DEFAULT_CONFIG as GridConfig,
  createCore: createGridCore,
  manifest: gridManifest,
  strategyDirectory: __dirname,
});
