import type { StrategyManifest } from '@tradejs/types';
import { gridClassicAiAdapter } from './adapters/ai';

export const gridClassicManifest: StrategyManifest = {
  name: 'GridClassic',
  aiAdapter: gridClassicAiAdapter,
};
