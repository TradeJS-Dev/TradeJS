import { createStrategyRuntime } from '@tradejs/node/strategies';
import { HyperliquidConsensusConfig, config as DEFAULT_CONFIG } from './config';
import { createHyperliquidConsensusCore } from './core';
import { hyperliquidConsensusManifest } from './manifest';

export const HyperliquidConsensusStrategyCreator =
  createStrategyRuntime<HyperliquidConsensusConfig>({
    strategyName: 'HyperliquidConsensus',
    defaults: DEFAULT_CONFIG as HyperliquidConsensusConfig,
    createCore: createHyperliquidConsensusCore,
    manifest: hyperliquidConsensusManifest,
    strategyDirectory: __dirname,
  });
