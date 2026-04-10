import type { StrategyConfig, StrategyManifest } from '@tradejs/types';
import { closeOppositePositionsBeforeOpen } from './closeOppositePositionsBeforeOpen';

export * from '@tradejs/core/strategies';
export * from './ai';
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
export { createStrategyRuntime } from './strategyRuntime';
export { resolveStrategyConfig } from './strategyHelpers/config';
export {
  enrichSignalWithAi,
  enrichSignalWithMl,
  enrichSignalWithMlAi,
  executeEntryOrder,
} from './strategyHelpers/runtime';
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
  return async ({ ctx, entry }) => {
    if (!isEnabled(ctx.strategyConfig)) {
      return;
    }

    await closeOppositePositionsBeforeOpen({
      connector: ctx.connector,
      entryContext: entry.context,
    });
  };
};
