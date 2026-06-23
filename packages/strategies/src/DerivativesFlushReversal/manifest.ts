import type { StrategyManifest } from '@tradejs/types';
import { derivativesFlushReversalAiAdapter } from './adapters/ai';

export const derivativesFlushReversalManifest: StrategyManifest = {
  name: 'DerivativesFlushReversal',
  aiAdapter: derivativesFlushReversalAiAdapter,
};
