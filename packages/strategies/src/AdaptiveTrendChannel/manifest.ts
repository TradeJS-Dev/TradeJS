import { StrategyManifest } from '@tradejs/types';
import { adaptiveTrendChannelAiAdapter } from './adapters/ai';

export const adaptiveTrendChannelManifest: StrategyManifest = {
  name: 'AdaptiveTrendChannel',
  aiAdapter: adaptiveTrendChannelAiAdapter,
};
