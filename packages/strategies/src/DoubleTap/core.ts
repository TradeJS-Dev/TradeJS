import { round } from '@tradejs/core/math';
import type {
  CreateStrategyCore,
  IndicatorsHistorySnapshot,
  Position,
} from '@tradejs/types';
import { DoubleTapConfig } from './config';
import { buildDoubleTapSignalContext, createDoubleTapEngine } from './engine';
import { buildDoubleTapFigures } from './figures';

const isOpenPosition = (position: Position | null): position is Position =>
  Boolean(
    position &&
      typeof position.price === 'number' &&
      Number.isFinite(position.price) &&
      typeof position.qty === 'number' &&
      Number.isFinite(position.qty) &&
      position.qty > 0 &&
      (position.direction === 'LONG' || position.direction === 'SHORT'),
  );

export const createDoubleTapCore: CreateStrategyCore<
  DoubleTapConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({ config, data: initialData, strategyApi, indicatorsState }) => {
  const engine = createDoubleTapEngine({
    config,
    initialCandles: initialData,
  });
  const lastTradeController = strategyApi.createLastTradeController();

  return async (candle) => {
    const runtimeState = engine.next(candle);
    const pattern = runtimeState.pattern;

    if (!pattern) {
      return strategyApi.skip('NO_PATTERN');
    }

    const position = await strategyApi.getCurrentPosition();
    if (isOpenPosition(position)) {
      const oppositePattern =
        position.direction === 'LONG'
          ? pattern.direction === 'SHORT'
          : pattern.direction === 'LONG';

      if (
        Boolean(config.DOUBLETAP_EXIT_ON_OPPOSITE_PATTERN) &&
        oppositePattern
      ) {
        return strategyApi.exit({
          code: 'DOUBLETAP_OPPOSITE_PATTERN_EXIT',
          direction: position.direction,
        });
      }

      return strategyApi.skip('POSITION_EXISTS');
    }

    if (lastTradeController.isInCooldown(candle.timestamp)) {
      return strategyApi.skip('DEV_TRADE_COOLDOWN');
    }

    const modeConfig =
      pattern.direction === 'LONG' ? config.LONG : config.SHORT;
    if (!modeConfig.enable) {
      return strategyApi.skip('STRATEGY_DISABLED');
    }

    const { timestamp, currentPrice } = await strategyApi.getMarketData();
    const indicators = indicatorsState.snapshot();
    const signalContext = buildDoubleTapSignalContext({
      ...pattern,
      close: currentPrice,
    });

    const riskDistance = Math.abs(currentPrice - pattern.stopLossPrice);
    const rawQty =
      riskDistance > 0 ? Number(config.MAX_LOSS_VALUE ?? 0) / riskDistance : 0;
    const feeBuffer = 1 + Math.max(0, Number(config.FEE_PERCENT ?? 0)) / 100;
    const qty = rawQty / feeBuffer;
    const rewardDistance = Math.abs(pattern.targetPrice - currentPrice);
    const riskRatio = riskDistance > 0 ? rewardDistance / riskDistance : 0;

    if (!qty || !Number.isFinite(qty) || qty <= 0) {
      return strategyApi.skip('INVALID_QTY');
    }

    if (riskRatio <= modeConfig.minRiskRatio) {
      return strategyApi.skip(`RISK_RATIO:${round(riskRatio)}`);
    }

    lastTradeController.markTrade(timestamp);

    return strategyApi.entry({
      code:
        pattern.direction === 'LONG'
          ? 'DOUBLETAP_DOUBLE_BOTTOM_BREAKOUT'
          : 'DOUBLETAP_DOUBLE_TOP_BREAKDOWN',
      direction: modeConfig.direction,
      indicators,
      additionalIndicators: {
        doubleTapContext: signalContext,
      },
      figures: buildDoubleTapFigures({
        pattern,
        entryTimestamp: timestamp,
        entryPrice: currentPrice,
      }),
      orderPlan: {
        qty,
        stopLossPrice: pattern.stopLossPrice,
        takeProfits: [{ rate: 1, price: pattern.targetPrice }],
      },
    });
  };
};
