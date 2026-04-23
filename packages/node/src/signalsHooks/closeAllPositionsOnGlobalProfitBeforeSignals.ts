import type { TradejsConfigBeforeSignalsHook } from '@tradejs/core/config';
import { logger } from '@tradejs/infra/logger';
import type { StrategyConfig } from '@tradejs/types';
import {
  DEFAULT_GLOBAL_UNREALIZED_PNL_TRIGGER_RISK_MULTIPLIER,
  GLOBAL_UNREALIZED_PNL_CLOSE_ALL_CODE,
  getStrategyMaxLossValue,
  isOpenPositionPnlSnapshot,
} from '../strategyHooks/shared';

interface CreateCloseAllOnGlobalProfitBeforeSignalsHookParams {
  getStrategyDefaultConfig?: (
    strategyName: string,
  ) => StrategyConfig | undefined;
  profitRiskMultiplier?: number;
}

export const createCloseAllOnGlobalProfitBeforeSignalsHook = ({
  getStrategyDefaultConfig = () => undefined,
  profitRiskMultiplier = DEFAULT_GLOBAL_UNREALIZED_PNL_TRIGGER_RISK_MULTIPLIER,
}: CreateCloseAllOnGlobalProfitBeforeSignalsHookParams = {}): TradejsConfigBeforeSignalsHook => {
  return async ({ connector, runtimeStrategies }) => {
    if (typeof connector.getOpenPositionPnl !== 'function') {
      return;
    }

    const openPositions = (await connector.getOpenPositionPnl()).filter(
      isOpenPositionPnlSnapshot,
    );
    if (!openPositions.length) {
      return;
    }

    const totalUnrealizedPnl = openPositions.reduce(
      (sum, position) => sum + position.unrealizedPnl,
      0,
    );

    if (!Number.isFinite(totalUnrealizedPnl) || totalUnrealizedPnl <= 0) {
      return;
    }

    const maxLossValues = runtimeStrategies.flatMap(
      ({ strategyName, strategyConfig }) => {
        const maxLossValue = getStrategyMaxLossValue({
          ...(getStrategyDefaultConfig(strategyName) ?? {}),
          ...(strategyConfig ?? {}),
        } as StrategyConfig);

        return maxLossValue == null ? [] : [maxLossValue];
      },
    );

    if (!maxLossValues.length) {
      return;
    }

    const averageMaxLossValue =
      maxLossValues.reduce((sum, value) => sum + value, 0) /
      maxLossValues.length;
    const unrealizedPnlThreshold = averageMaxLossValue * profitRiskMultiplier;

    if (
      !Number.isFinite(unrealizedPnlThreshold) ||
      unrealizedPnlThreshold <= 0 ||
      totalUnrealizedPnl < unrealizedPnlThreshold
    ) {
      return;
    }

    logger.info(
      'closing all positions before signals by global unrealized pnl threshold: totalPnl=%s threshold=%s positions=%s',
      totalUnrealizedPnl,
      unrealizedPnlThreshold,
      openPositions.length,
    );

    const closeTimestamp = Date.now();
    const closeResults = await Promise.allSettled(
      openPositions.map((position) =>
        connector.closePosition({
          symbol: position.symbol,
          direction: position.direction,
          price: position.currentPrice,
          timestamp: closeTimestamp,
        }),
      ),
    );

    const failedClosures = closeResults.flatMap((result, index) => {
      if (result.status === 'fulfilled' && result.value === true) {
        return [];
      }

      return [
        `${openPositions[index]?.symbol}:${openPositions[index]?.direction ?? 'UNKNOWN'}`,
      ];
    });

    if (failedClosures.length) {
      logger.warn(
        'close-all before signals hook could not confirm closures for %s',
        failedClosures.join(', '),
      );
    }

    return {
      abort: true,
      reason: GLOBAL_UNREALIZED_PNL_CLOSE_ALL_CODE,
    };
  };
};
