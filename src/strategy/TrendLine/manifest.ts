import { StrategyManifest } from '@types';
import { trendLineAiAdapter } from './adapters/ai';
import { trendLineMlAdapter } from './adapters/ml';
import { trendLineBeforePlaceOrderHook } from './hooks';

export const trendLineManifest: StrategyManifest = {
  name: 'TrendLine',
  hooks: {
    beforePlaceOrder: trendLineBeforePlaceOrderHook,
  },
  aiAdapter: trendLineAiAdapter,
  mlAdapter: trendLineMlAdapter,
};
