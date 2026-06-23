import { createStrategyRuntime } from '@tradejs/node/strategies';
import {
  DerivativesFlushReversalConfig,
  config as DEFAULT_CONFIG,
} from './config';
import { createDerivativesFlushReversalCore } from './core';
import { derivativesFlushReversalManifest } from './manifest';

export const DerivativesFlushReversalStrategyCreator =
  createStrategyRuntime<DerivativesFlushReversalConfig>({
    strategyName: 'DerivativesFlushReversal',
    defaults: DEFAULT_CONFIG as DerivativesFlushReversalConfig,
    createCore: createDerivativesFlushReversalCore,
    manifest: derivativesFlushReversalManifest,
    strategyDirectory: __dirname,
  });
