import { createStrategyRuntime } from '@tradejs/node/strategies';
import { config as DEFAULT_CONFIG, HeadAndShouldersConfig } from './config';
import { createHeadAndShouldersCore } from './core';
import { headAndShouldersManifest } from './manifest';

export const HeadAndShouldersStrategyCreator =
  createStrategyRuntime<HeadAndShouldersConfig>({
    strategyName: 'HeadAndShoulders',
    defaults: DEFAULT_CONFIG as HeadAndShouldersConfig,
    createCore: createHeadAndShouldersCore,
    manifest: headAndShouldersManifest,
    strategyDirectory: __dirname,
  });
