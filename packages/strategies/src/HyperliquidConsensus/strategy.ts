import type { StrategyRegistryEntry } from '@tradejs/types';
import { HyperliquidConsensusConfig, config as DEFAULT_CONFIG } from './config';
import { createHyperliquidConsensusCore } from './core';
import { hyperliquidConsensusManifest } from './manifest';

export const HyperliquidConsensusStrategyDefinition: StrategyRegistryEntry<HyperliquidConsensusConfig> =
  {
    defaults: DEFAULT_CONFIG,
    createCore: createHyperliquidConsensusCore,
    manifest: hyperliquidConsensusManifest,
  };
