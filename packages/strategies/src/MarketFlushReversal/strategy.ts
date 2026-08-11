import type { StrategyRegistryEntry } from '@tradejs/types';
import { MarketFlushReversalConfig, config as DEFAULT_CONFIG } from './config';
import { createMarketFlushReversalCore } from './core';
import { marketFlushReversalManifest } from './manifest';

export const MarketFlushReversalStrategyDefinition: StrategyRegistryEntry<MarketFlushReversalConfig> =
  {
    defaults: DEFAULT_CONFIG,
    createCore: createMarketFlushReversalCore,
    manifest: marketFlushReversalManifest,
  };
