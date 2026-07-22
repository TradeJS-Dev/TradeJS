import { StrategyManifest } from '@tradejs/types';
import { gridAiAdapter } from './adapters/ai';

export const gridManifest: StrategyManifest = {
  name: 'Grid',
  aiAdapter: gridAiAdapter,
};
