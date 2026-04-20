import { StrategyManifest } from '@tradejs/types';
import { reverseTrendLineAiAdapter } from './adapters/ai';

export const reverseTrendLineManifest: StrategyManifest = {
  name: 'ReverseTrendLine',
  aiAdapter: reverseTrendLineAiAdapter,
};
