import { createStrategyRuntime } from '@utils/strategyRuntime';
import { config as DEFAULT_CONFIG, PineScriptConfig } from './config';
import { createPineScriptCore } from './core';

export const PineScriptStrategyCreator =
  createStrategyRuntime<PineScriptConfig>({
    strategyName: 'PineScript',
    defaults: DEFAULT_CONFIG as PineScriptConfig,
    createCore: createPineScriptCore,
  });
