import { trendLineAiAdapter } from './adapters/ai';
import { trendLineMlAdapter } from './adapters/ml';
import { StrategyManifest } from '@tradejs/types';

export const trendLineManifest: StrategyManifest = {
  name: 'TrendLine',
  aiAdapter: trendLineAiAdapter,
  mlAdapter: trendLineMlAdapter,
};
