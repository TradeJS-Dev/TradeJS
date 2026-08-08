import { StrategyManifest } from '@tradejs/types';
import { headAndShouldersAiAdapter } from './adapters/ai';

export const headAndShouldersManifest: StrategyManifest = {
  name: 'HeadAndShoulders',
  aiAdapter: headAndShouldersAiAdapter,
};
