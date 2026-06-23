import type { StrategyManifest } from '@tradejs/types';
import { volatilityCompressionBreakoutAiAdapter } from './adapters/ai';

export const volatilityCompressionBreakoutManifest: StrategyManifest = {
  name: 'VolatilityCompressionBreakout',
  aiAdapter: volatilityCompressionBreakoutAiAdapter,
};
