import { createCloseOppositeBeforePlaceOrderHook } from '@tradejs/core/strategies';
import { TrendLineConfig } from './config';

export const trendLineBeforePlaceOrderHook =
  createCloseOppositeBeforePlaceOrderHook({
    isEnabled: (config) =>
      Boolean((config as TrendLineConfig).CLOSE_OPPOSITE_POSITIONS),
  });
