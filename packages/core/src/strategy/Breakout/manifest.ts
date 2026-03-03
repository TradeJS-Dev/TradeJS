import { StrategyManifest } from '@types';
import { breakoutAiAdapter } from './adapters/ai';
import { breakoutMlAdapter } from './adapters/ml';

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
