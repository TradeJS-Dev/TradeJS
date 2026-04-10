import { volumeDivergenceAiAdapter } from './adapters/ai';
import { volumeDivergenceMlAdapter } from './adapters/ml';
import { volumeDivergenceBeforePlaceOrderHook } from './hooks';
import { StrategyManifest } from '@tradejs/types';

export const volumeDivergenceManifest: StrategyManifest = {
  name: 'VolumeDivergence',
  hooks: {
    beforePlaceOrder: volumeDivergenceBeforePlaceOrderHook,
  },
  aiAdapter: volumeDivergenceAiAdapter,
  mlAdapter: volumeDivergenceMlAdapter,
};
