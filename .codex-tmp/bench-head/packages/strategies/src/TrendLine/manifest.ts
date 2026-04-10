import { trendLineAiAdapter } from './adapters/ai';
import { trendLineMlAdapter } from './adapters/ml';
import { trendLineBeforePlaceOrderHook } from './hooks';
import { StrategyManifest } from '@tradejs/types';

export const trendLineManifest: StrategyManifest = {
  name: 'TrendLine',
  hooks: {
    beforePlaceOrder: trendLineBeforePlaceOrderHook,
  },
  aiAdapter: trendLineAiAdapter,
  mlAdapter: trendLineMlAdapter,
};
