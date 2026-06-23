import { createStrategyRuntime } from '@tradejs/node/strategies';
import {
  VolatilityCompressionBreakoutConfig,
  config as DEFAULT_CONFIG,
} from './config';
import { createVolatilityCompressionBreakoutCore } from './core';
import { volatilityCompressionBreakoutManifest } from './manifest';

export const VolatilityCompressionBreakoutStrategyCreator =
  createStrategyRuntime<VolatilityCompressionBreakoutConfig>({
    strategyName: 'VolatilityCompressionBreakout',
    defaults: DEFAULT_CONFIG as VolatilityCompressionBreakoutConfig,
    createCore: createVolatilityCompressionBreakoutCore,
    manifest: volatilityCompressionBreakoutManifest,
    strategyDirectory: __dirname,
  });
