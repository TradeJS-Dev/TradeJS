import { volumeDivergenceAiAdapter } from './adapters/ai';
import { volumeDivergenceMlAdapter } from './adapters/ml';
import { StrategyManifest } from '@tradejs/types';

export const volumeDivergenceManifest: StrategyManifest = {
  name: 'VolumeDivergence',
  aiAdapter: volumeDivergenceAiAdapter,
  mlAdapter: volumeDivergenceMlAdapter,
};
