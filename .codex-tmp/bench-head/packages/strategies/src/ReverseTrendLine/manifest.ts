import { StrategyManifest } from '@tradejs/types';
import { reverseTrendLineBeforePlaceOrderHook } from './hooks';
import { reverseTrendLineAiAdapter } from './adapters/ai';

export const reverseTrendLineManifest: StrategyManifest = {
  name: 'ReverseTrendLine',
  hooks: {
    beforePlaceOrder: reverseTrendLineBeforePlaceOrderHook,
  },
  aiAdapter: reverseTrendLineAiAdapter,
};
