import type { StrategyManifest } from '@tradejs/types';
import { marketFlushReversalAiAdapter } from './adapters/ai';

export const marketFlushReversalManifest: StrategyManifest = {
  name: 'MarketFlushReversal',
  aiAdapter: marketFlushReversalAiAdapter,
};
