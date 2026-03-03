import { StrategyManifest } from '@types';
import { maStrategyAiAdapter } from './adapters/ai';
import { maStrategyMlAdapter } from './adapters/ml';

export const maStrategyManifest: StrategyManifest = {
  name: 'MaStrategy',
  aiAdapter: maStrategyAiAdapter,
  mlAdapter: maStrategyMlAdapter,
};
