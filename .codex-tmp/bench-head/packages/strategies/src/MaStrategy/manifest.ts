import { maStrategyAiAdapter } from './adapters/ai';
import { maStrategyMlAdapter } from './adapters/ml';
import { StrategyManifest } from '@tradejs/types';

export const maStrategyManifest: StrategyManifest = {
  name: 'MaStrategy',
  aiAdapter: maStrategyAiAdapter,
  mlAdapter: maStrategyMlAdapter,
};
