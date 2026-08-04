import type { StrategyManifest } from '@tradejs/types';
import { hyperliquidConsensusAiAdapter } from './adapters/ai';

export const hyperliquidConsensusManifest: StrategyManifest = {
  name: 'HyperliquidConsensus',
  aiAdapter: hyperliquidConsensusAiAdapter,
};
