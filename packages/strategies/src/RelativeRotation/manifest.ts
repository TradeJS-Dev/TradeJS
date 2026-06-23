import type { StrategyManifest } from '@tradejs/types';
import { relativeRotationAiAdapter } from './adapters/ai';

export const relativeRotationManifest: StrategyManifest = {
  name: 'RelativeRotation',
  aiAdapter: relativeRotationAiAdapter,
};
