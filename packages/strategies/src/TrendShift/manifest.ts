import { StrategyManifest } from '@tradejs/types';
import { trendShiftAiAdapter } from './adapters/ai';

export const trendShiftManifest: StrategyManifest = {
  name: 'TrendShift',
  aiAdapter: trendShiftAiAdapter,
};
