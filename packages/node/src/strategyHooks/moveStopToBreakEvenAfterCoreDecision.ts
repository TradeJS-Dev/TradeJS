import type { TradejsConfigOnBarHook } from '@tradejs/core/config';
import type { StrategyConfig } from '@tradejs/types';
import {
  DEFAULT_BREAK_EVEN_TRIGGER_RISK_MULTIPLIER,
  getConfiguredDirectionRiskPct,
  getFavorableMovePct,
  getPositionRiskPct,
  getPositionStopLossPrice,
  isBreakEvenStopAlreadyApplied,
  isOpenPosition,
  toStrategyCodePrefix,
} from './shared';

interface CreateMoveStopToBreakEvenOnBarHookParams {
  isEnabled?: (config: StrategyConfig) => boolean;
  triggerRiskMultiplier?: number;
}

export const createMoveStopToBreakEvenOnBarHook = ({
  isEnabled = () => true,
  triggerRiskMultiplier = DEFAULT_BREAK_EVEN_TRIGGER_RISK_MULTIPLIER,
}: CreateMoveStopToBreakEvenOnBarHookParams = {}): TradejsConfigOnBarHook => {
  return async ({ ctx, market }) => {
    if (!isEnabled(ctx.strategyConfig)) {
      return;
    }

    const currentPosition = await ctx.connector.getPosition(ctx.symbol);
    if (!isOpenPosition(currentPosition)) {
      return;
    }

    const currentPrice = Number(market.candle.close ?? Number.NaN);
    if (!Number.isFinite(currentPrice)) {
      return;
    }

    const currentStopLossPrice = getPositionStopLossPrice(currentPosition);
    if (
      isBreakEvenStopAlreadyApplied({
        direction: currentPosition.direction,
        entryPrice: currentPosition.price,
        stopLossPrice: currentStopLossPrice,
      })
    ) {
      return;
    }

    const favorableMovePct = getFavorableMovePct({
      direction: currentPosition.direction,
      entryPrice: currentPosition.price,
      currentPrice,
    });
    const currentPositionRiskPct = getPositionRiskPct({
      direction: currentPosition.direction,
      entryPrice: currentPosition.price,
      stopLossPrice: currentStopLossPrice,
    });
    const configuredRiskPct = getConfiguredDirectionRiskPct({
      strategyConfig: ctx.strategyConfig,
      direction: currentPosition.direction,
    });
    const triggerRiskPct = currentPositionRiskPct ?? configuredRiskPct;

    if (
      favorableMovePct == null ||
      triggerRiskPct == null ||
      favorableMovePct < triggerRiskPct * triggerRiskMultiplier
    ) {
      return;
    }

    return {
      kind: 'protect',
      code: `${toStrategyCodePrefix(ctx.strategyName)}_MOVE_STOP_TO_BREAK_EVEN`,
      protectPlan: {
        direction: currentPosition.direction,
        stopLossPrice: currentPosition.price,
      },
    };
  };
};

export const createMoveStopToBreakEvenAfterCoreDecisionHook =
  createMoveStopToBreakEvenOnBarHook;
