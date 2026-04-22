import { defineConfig } from '@tradejs/core/config';
import { basePreset } from '@tradejs/base';
import { getBuiltInStrategyDefaultConfig } from '@tradejs/strategies';
import { createCloseAllPositionsOnGlobalProfitBeforeSignalsHook } from '@tradejs/node/strategies';

export default defineConfig(basePreset, {
  hooks: {
    beforeSignals: createCloseAllPositionsOnGlobalProfitBeforeSignalsHook({
      getStrategyDefaultConfig: getBuiltInStrategyDefaultConfig,
      profitRiskMultiplier: 5,
    }),
  },
});
