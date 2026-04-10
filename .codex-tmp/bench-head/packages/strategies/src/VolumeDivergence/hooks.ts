import { createCloseOppositeBeforePlaceOrderHook } from '@tradejs/node/strategies';
import { VolumeDivergenceConfig } from './config';

export const volumeDivergenceBeforePlaceOrderHook =
  createCloseOppositeBeforePlaceOrderHook({
    isEnabled: (config) =>
      Boolean((config as VolumeDivergenceConfig).CLOSE_OPPOSITE_POSITIONS),
  });
