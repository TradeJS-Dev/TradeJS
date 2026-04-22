import type { TradejsConfig } from '@tradejs/core/config';
import {
  createCloseOppositeBeforePlaceOrderHook,
  createMoveStopToBreakEvenOnBarHook,
} from '@tradejs/node/strategies';

export const basePreset: TradejsConfig = {
  strategies: ['@tradejs/strategies'],
  indicators: ['@tradejs/indicators'],
  connectors: ['@tradejs/connectors'],
  hooks: {
    beforePlaceOrder: createCloseOppositeBeforePlaceOrderHook({
      isEnabled: (config) =>
        Boolean(
          (config as { CLOSE_OPPOSITE_POSITIONS?: unknown })
            .CLOSE_OPPOSITE_POSITIONS,
        ),
    }),
    onBar: createMoveStopToBreakEvenOnBarHook(),
  },
};

export default basePreset;
