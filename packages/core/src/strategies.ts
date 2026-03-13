import type { StrategyConfig, StrategyManifest } from '@tradejs/types';
import { closeOppositePositionsBeforeOpen } from './utils/closeOppositePositionsBeforeOpen';

export {
  buildDefaultIndicatorPeriods,
  createStrategyIndicatorsState,
} from './utils/strategyHelpers/indicators';
export {
  calculateRiskRatio,
  getDirectionalTpSlPrices,
  getStrategyMarketSnapshot,
} from './utils/strategyHelpers/market';
export {
  buildEntrySignalDecision,
  buildStrategySignal,
  createStrategyAPI,
  mapAiRuntimeFromConfig,
  mapMlRuntimeFromConfig,
} from './utils/strategyHelpers/signalBuilders';
export { createLastTradeController } from './utils/strategyHelpers/state';
export * from './utils/ai';
export {
  ensureIndicatorPluginsLoaded,
  ensureStrategyPluginsLoaded,
  getAvailableStrategyNames,
  getRegisteredStrategies,
  getRegisteredManifests,
  registerStrategyEntries,
  getStrategyCreator,
  resetStrategyRegistryCache,
  strategies,
  getStrategyManifest,
  isKnownStrategy,
} from './strategy';
export { createStrategyRuntime } from './utils/strategyRuntime';
export { resolveStrategyConfig } from './utils/strategyHelpers/config';
export {
  enrichSignalWithAi,
  enrichSignalWithMl,
  enrichSignalWithMlAi,
  executeEntryOrder,
} from './utils/strategyHelpers/runtime';
export { closeOppositePositionsBeforeOpen };

type BeforePlaceOrderHook = NonNullable<
  NonNullable<StrategyManifest['hooks']>['beforePlaceOrder']
>;

interface CreateCloseOppositeBeforePlaceOrderHookParams {
  isEnabled: (config: StrategyConfig) => boolean;
}

export const createCloseOppositeBeforePlaceOrderHook = ({
  isEnabled,
}: CreateCloseOppositeBeforePlaceOrderHookParams): BeforePlaceOrderHook => {
  return async ({ connector, entryContext, config }) => {
    if (!isEnabled(config)) {
      return;
    }

    await closeOppositePositionsBeforeOpen({
      connector,
      entryContext,
    });
  };
};
