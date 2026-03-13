import { StrategyConfig, StrategyManifest } from '@tradejs/types';
import { closeOppositePositionsBeforeOpen } from './closeOppositePositionsBeforeOpen';

type BeforePlaceOrderHook = NonNullable<
  NonNullable<StrategyManifest['hooks']>['beforePlaceOrder']
>;

interface CreateCloseOppositeBeforePlaceOrderHookParams {
  isEnabled: (config: StrategyConfig) => boolean;
}

/**
 * Reusable before-place-order hook:
 * closes opposite positions only when strategy config enables it.
 */
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
