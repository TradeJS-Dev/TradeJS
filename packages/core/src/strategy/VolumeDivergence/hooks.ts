import { StrategyManifest } from '@types';
import { closeOppositePositionsBeforeOpen } from '@utils/closeOppositePositionsBeforeOpen';
import { VolumeDivergenceConfig } from './config';

type VolumeDivergenceBeforePlaceOrderHook = NonNullable<
  NonNullable<StrategyManifest['hooks']>['beforePlaceOrder']
>;

export const volumeDivergenceBeforePlaceOrderHook: VolumeDivergenceBeforePlaceOrderHook =
  async ({ connector, entryContext, config }) => {
    const strategyConfig = config as VolumeDivergenceConfig;
    if (!strategyConfig.CLOSE_OPPOSITE_POSITIONS) {
      return;
    }

    await closeOppositePositionsBeforeOpen({
      connector,
      entryContext,
    });
  };
