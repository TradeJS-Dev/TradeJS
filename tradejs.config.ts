import { defineConfig } from '@tradejs/core/config';
import { basePreset } from '@tradejs/base';
import { createMoveStopToBreakEvenOnBarHook } from '@tradejs/node/strategies';

export default defineConfig(basePreset, {
  hooks: {
    onBar: createMoveStopToBreakEvenOnBarHook({
      triggerRiskMultiplier: 0.8,
      stopProfitMultiplier: 0.2,
    }),
  },
});
