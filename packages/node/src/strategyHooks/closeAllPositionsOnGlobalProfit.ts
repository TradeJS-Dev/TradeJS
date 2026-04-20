import type { TradejsConfigOnBarHook } from '@tradejs/core/config';
import { logger } from '@tradejs/infra/logger';
import type { StrategyConfig } from '@tradejs/types';
import { getAvailableStrategyNames as getAvailableStrategyNamesFromRegistry } from '../strategy';
import { resolveStrategyConfig as resolveStrategyConfigRuntime } from '../strategyHelpers/config';
import {
  DEFAULT_GLOBAL_UNREALIZED_PNL_TRIGGER_RISK_MULTIPLIER,
  GLOBAL_UNREALIZED_PNL_CLOSE_ALL_CODE,
  getStrategyMaxLossValue,
  isOpenPositionPnlSnapshot,
} from './shared';

interface CreateCloseAllPositionsOnGlobalProfitHookParams {
  getStrategyDefaultConfig?: (
    strategyName: string,
  ) => StrategyConfig | undefined;
  getActiveStrategyNames?: () => Promise<string[]>;
  resolveStrategyConfigFn?: typeof resolveStrategyConfigRuntime;
  profitRiskMultiplier?: number;
}

export const createCloseAllPositionsOnGlobalProfitHook = ({
  getStrategyDefaultConfig = () => undefined,
  getActiveStrategyNames = () => getAvailableStrategyNamesFromRegistry(),
  resolveStrategyConfigFn = resolveStrategyConfigRuntime,
  profitRiskMultiplier = DEFAULT_GLOBAL_UNREALIZED_PNL_TRIGGER_RISK_MULTIPLIER,
}: CreateCloseAllPositionsOnGlobalProfitHookParams = {}): TradejsConfigOnBarHook => {
  let cachedActiveStrategyNames: string[] | null = null;

  const resolveActiveStrategyNames = async (currentStrategyName: string) => {
    if (!cachedActiveStrategyNames) {
      const names = await getActiveStrategyNames();
      cachedActiveStrategyNames = [
        ...new Set(
          names
            .map((name) => String(name ?? '').trim())
            .filter((name) => name.length > 0),
        ),
      ];
    }

    return [...new Set([...cachedActiveStrategyNames, currentStrategyName])];
  };

  return async ({ ctx, market }) => {
    if (ctx.env === 'BACKTEST' || ctx.strategyConfig.MAKE_ORDERS === false) {
      return;
    }

    if (typeof ctx.connector.getOpenPositionPnl !== 'function') {
      return;
    }

    const openPositions = (await ctx.connector.getOpenPositionPnl()).filter(
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

    const strategyNames = await resolveActiveStrategyNames(ctx.strategyName);
    const maxLossValues: number[] = [];
    const currentStrategyMaxLossValue = getStrategyMaxLossValue(
      ctx.strategyConfig,
    );

    if (currentStrategyMaxLossValue != null) {
      maxLossValues.push(currentStrategyMaxLossValue);
    }

    for (const strategyName of strategyNames) {
      if (strategyName === ctx.strategyName) {
        continue;
      }

      const { config } = await resolveStrategyConfigFn({
        strategyName,
        userName: ctx.userName,
        symbol: ctx.symbol,
        baseConfig: {
          ENV: ctx.env,
        },
        defaults: (getStrategyDefaultConfig(strategyName) ??
          {}) as StrategyConfig,
      });

      const maxLossValue = getStrategyMaxLossValue(config);
      if (maxLossValue != null) {
        maxLossValues.push(maxLossValue);
      }
    }

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
      'closing all positions by global unrealized pnl threshold: strategy=%s totalPnl=%s threshold=%s positions=%s',
      ctx.strategyName,
      totalUnrealizedPnl,
      unrealizedPnlThreshold,
      openPositions.length,
    );

    const closeTimestamp = Number(
      market.candle?.timestamp ?? market.btcCandle?.timestamp ?? Date.now(),
    );
    const closeResults = await Promise.allSettled(
      openPositions.map((position) =>
        ctx.connector.closePosition({
          symbol: position.symbol,
          direction: position.direction,
          price: position.currentPrice,
          timestamp: Number.isFinite(closeTimestamp)
            ? closeTimestamp
            : Date.now(),
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
        'close-all hook could not confirm closures for %s',
        failedClosures.join(', '),
      );
    }

    return {
      kind: 'skip',
      code: GLOBAL_UNREALIZED_PNL_CLOSE_ALL_CODE,
    };
  };
};
