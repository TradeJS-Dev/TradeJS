import { createStrategyRuntime } from '@tradejs/node/strategies';
import { MarketFlushReversalConfig, config as DEFAULT_CONFIG } from './config';
import { createMarketFlushReversalCore } from './core';
import { marketFlushReversalManifest } from './manifest';

export const MarketFlushReversalStrategyCreator =
  createStrategyRuntime<MarketFlushReversalConfig>({
    strategyName: 'MarketFlushReversal',
    defaults: DEFAULT_CONFIG as MarketFlushReversalConfig,
    createCore: createMarketFlushReversalCore,
    manifest: marketFlushReversalManifest,
    strategyDirectory: __dirname,
  });
