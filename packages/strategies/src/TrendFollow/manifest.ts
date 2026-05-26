import { StrategyManifest } from '@tradejs/types';
import { trendFollowAiAdapter } from './adapters/ai';

export const trendFollowManifest: StrategyManifest = {
  name: 'TrendFollow',
  aiAdapter: trendFollowAiAdapter,
};
