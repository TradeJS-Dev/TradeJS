import { StrategyManifest } from '@tradejs/types';
import { cupAndHandleAiAdapter } from './adapters/ai';

export const cupAndHandleManifest: StrategyManifest = {
  name: 'CupAndHandle',
  aiAdapter: cupAndHandleAiAdapter,
};
