import { createStrategyRuntime } from '@tradejs/node/strategies';
import { RelativeRotationConfig, config as DEFAULT_CONFIG } from './config';
import { createRelativeRotationCore } from './core';
import { relativeRotationManifest } from './manifest';

export const RelativeRotationStrategyCreator =
  createStrategyRuntime<RelativeRotationConfig>({
    strategyName: 'RelativeRotation',
    defaults: DEFAULT_CONFIG as RelativeRotationConfig,
    createCore: createRelativeRotationCore,
    manifest: relativeRotationManifest,
    strategyDirectory: __dirname,
  });
