import { createStrategyRuntime } from '@tradejs/node/strategies';
import {
  AdaptiveMomentumRibbonConfig,
  config as DEFAULT_CONFIG,
} from './config';
import { createAdaptiveMomentumRibbonCore } from './core';
import { adaptiveMomentumRibbonManifest } from './manifest';

export const AdaptiveMomentumRibbonStrategyCreator =
  createStrategyRuntime<AdaptiveMomentumRibbonConfig>({
    strategyName: 'AdaptiveMomentumRibbon',
    defaults: DEFAULT_CONFIG as AdaptiveMomentumRibbonConfig,
    createCore: createAdaptiveMomentumRibbonCore,
    manifest: adaptiveMomentumRibbonManifest,
    strategyDirectory: __dirname,
  });
