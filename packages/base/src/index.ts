import type { TradejsConfig } from '@tradejs/core/config';
import { getBuiltInStrategyDefaultConfig } from '@tradejs/strategies';
import {
  createCloseOppositeBeforePlaceOrderHook,
  createCloseAllPositionsOnGlobalProfitHook,
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
    onBar: [
      createCloseAllPositionsOnGlobalProfitHook({
        getStrategyDefaultConfig: getBuiltInStrategyDefaultConfig,
      }),
      createMoveStopToBreakEvenOnBarHook(),
    ],
  },
};

export default basePreset;
