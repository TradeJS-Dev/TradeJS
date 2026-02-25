import { StrategyManifest } from '@types';
import { closeOppositePositionsBeforeOpen } from '@utils/closeOppositePositionsBeforeOpen';
import { TrendLineConfig } from './config';

type TrendLineBeforePlaceOrderHook = NonNullable<
  NonNullable<StrategyManifest['hooks']>['beforePlaceOrder']
>;

export const trendLineBeforePlaceOrderHook: TrendLineBeforePlaceOrderHook =
  async ({ connector, entryContext, config }) => {
    const trendLineConfig = config as TrendLineConfig;
    if (!trendLineConfig.CLOSE_OPPOSITE_POSITIONS) {
      return;
    }

    await closeOppositePositionsBeforeOpen({
      connector,
      entryContext,
    });
  };
