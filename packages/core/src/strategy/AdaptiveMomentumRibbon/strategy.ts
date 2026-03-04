import { createStrategyRuntime } from '@utils/strategyRuntime';
import {
  AdaptiveMomentumRibbonConfig,
  config as DEFAULT_CONFIG,
} from './config';
import { createAdaptiveMomentumRibbonCore } from './core';

export const AdaptiveMomentumRibbonStrategyCreator =
  createStrategyRuntime<AdaptiveMomentumRibbonConfig>({
    strategyName: 'AdaptiveMomentumRibbon',
    defaults: DEFAULT_CONFIG as AdaptiveMomentumRibbonConfig,
    createCore: createAdaptiveMomentumRibbonCore,
  });
