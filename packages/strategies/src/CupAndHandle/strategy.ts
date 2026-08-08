import { createStrategyRuntime } from '@tradejs/node/strategies';
import { config as DEFAULT_CONFIG, CupAndHandleConfig } from './config';
import { createCupAndHandleCore } from './core';
import { cupAndHandleManifest } from './manifest';

export const CupAndHandleStrategyCreator =
  createStrategyRuntime<CupAndHandleConfig>({
    strategyName: 'CupAndHandle',
    defaults: DEFAULT_CONFIG as CupAndHandleConfig,
    createCore: createCupAndHandleCore,
    manifest: cupAndHandleManifest,
    strategyDirectory: __dirname,
  });
