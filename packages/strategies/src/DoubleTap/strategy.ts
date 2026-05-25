import { createStrategyRuntime } from '@tradejs/node/strategies';
import { config as DEFAULT_CONFIG, DoubleTapConfig } from './config';
import { createDoubleTapCore } from './core';
import { doubleTapManifest } from './manifest';

export const DoubleTapStrategyCreator = createStrategyRuntime<DoubleTapConfig>({
  strategyName: 'DoubleTap',
  defaults: DEFAULT_CONFIG as DoubleTapConfig,
  createCore: createDoubleTapCore,
  manifest: doubleTapManifest,
  strategyDirectory: __dirname,
});
