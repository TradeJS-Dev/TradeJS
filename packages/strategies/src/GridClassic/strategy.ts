import { createStrategyRuntime } from '@tradejs/node/strategies';
import { config as DEFAULT_CONFIG, type GridClassicConfig } from './config';
import { createGridClassicCore } from './core';
import { gridClassicManifest } from './manifest';

export const GridClassicStrategyCreator =
  createStrategyRuntime<GridClassicConfig>({
    strategyName: 'GridClassic',
    defaults: DEFAULT_CONFIG as GridClassicConfig,
    createCore: createGridClassicCore,
    manifest: gridClassicManifest,
    strategyDirectory: __dirname,
  });
