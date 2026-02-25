import { StrategyManifest } from '@types';
import { trendLineAiAdapter } from './adapters/ai';
import { trendLineMlAdapter } from './adapters/ml';

export const trendLineManifest: StrategyManifest = {
  name: 'TrendLine',
  aiAdapter: trendLineAiAdapter,
  mlAdapter: trendLineMlAdapter,
};
