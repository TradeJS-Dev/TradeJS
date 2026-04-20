import type { StrategyConfig, StrategyManifest } from '@tradejs/types';
import { closeOppositePositionsBeforeOpen } from '../closeOppositePositionsBeforeOpen';

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
    if (ctx.env === 'BACKTEST') {
      return;
    }

    if (!isEnabled(ctx.strategyConfig)) {
      return;
    }

    await closeOppositePositionsBeforeOpen({
      connector: ctx.connector,
      entryContext: entry.context,
    });
  };
};
