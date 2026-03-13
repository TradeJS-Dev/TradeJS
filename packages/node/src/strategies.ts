import type { StrategyConfig, StrategyManifest } from '@tradejs/types';
import { closeOppositePositionsBeforeOpen } from '../../core/src/utils/closeOppositePositionsBeforeOpen';

export * from '@tradejs/core/strategies';
export * from '../../core/src/utils/ai';
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
} from '../../core/src/strategy';
export { createStrategyRuntime } from '../../core/src/utils/strategyRuntime';
export { resolveStrategyConfig } from '../../core/src/utils/strategyHelpers/config';
export {
  enrichSignalWithAi,
  enrichSignalWithMl,
  enrichSignalWithMlAi,
  executeEntryOrder,
} from '../../core/src/utils/strategyHelpers/runtime';
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
