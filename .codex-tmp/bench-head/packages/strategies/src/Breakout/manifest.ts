import { breakoutAiAdapter } from './adapters/ai';
import { breakoutMlAdapter } from './adapters/ml';
import { StrategyManifest } from '@tradejs/types';

export const breakoutManifest: StrategyManifest = {
  name: 'Breakout',
  entryRuntimeDefaults: {
    ai: {
      enabled: false,
    },
    ml: {
      enabled: false,
    },
  },
  aiAdapter: breakoutAiAdapter,
  mlAdapter: breakoutMlAdapter,
};
