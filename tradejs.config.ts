import { defineConfig } from '@tradejs/core/config';
import { basePreset } from '@tradejs/base';
import { getBuiltInStrategyDefaultConfig } from '@tradejs/strategies';
import {
  createCloseAllOnGlobalProfitBeforeSignalsHook,
  createMoveStopToBreakEvenOnBarHook,
} from '@tradejs/node/strategies';

export default defineConfig(basePreset, {
  hooks: {
    beforeSignals: createCloseAllOnGlobalProfitBeforeSignalsHook({
      getStrategyDefaultConfig: getBuiltInStrategyDefaultConfig,
      profitRiskMultiplier: 5,
    }),
    onBar: createMoveStopToBreakEvenOnBarHook(),
  },
});
