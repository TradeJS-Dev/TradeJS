import { createCloseOppositeBeforePlaceOrderHook } from '@tradejs/node/strategies';
import { ReverseTrendLineConfig } from './config';

export const reverseTrendLineBeforePlaceOrderHook =
  createCloseOppositeBeforePlaceOrderHook({
    isEnabled: (config) =>
      Boolean((config as ReverseTrendLineConfig).CLOSE_OPPOSITE_POSITIONS),
  });
