import { StrategyManifest } from '@tradejs/types';
import { doubleTapAiAdapter } from './adapters/ai';

export const doubleTapManifest: StrategyManifest = {
  name: 'DoubleTap',
  aiAdapter: doubleTapAiAdapter,
};
