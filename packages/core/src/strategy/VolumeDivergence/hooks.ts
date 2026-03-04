import { createCloseOppositeBeforePlaceOrderHook } from '@utils/strategyHooks';
import { VolumeDivergenceConfig } from './config';

export const volumeDivergenceBeforePlaceOrderHook =
  createCloseOppositeBeforePlaceOrderHook({
    isEnabled: (config) =>
      Boolean((config as VolumeDivergenceConfig).CLOSE_OPPOSITE_POSITIONS),
  });
