import type {
  CreateStrategyCore,
  IndicatorsHistorySnapshot,
} from '@tradejs/types';
import type { HyperliquidConsensusConfig } from './config';
import {
  evaluateHyperliquidConsensus,
  evaluateHyperliquidConsensusExit,
} from './engine';
import { buildHyperliquidConsensusFigures } from './figures';
import {
  buildAtrFallbackStop,
  buildContextRiskOrder,
  isOpenPosition,
} from '../shared/contextStrategy';

export const createHyperliquidConsensusCore: CreateStrategyCore<
  HyperliquidConsensusConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({ config, strategyApi }) => {
  const lastTradeController = strategyApi.createLastTradeController();

  return async () => {
    const { indicators } = strategyApi.getCurrentIndicatorsContext();
    const baseContext = await strategyApi.getDecisionBaseContext();
    if (!baseContext) {
      return strategyApi.skip('HLC_NO_BASE_CONTEXT');
    }

    const evaluation = evaluateHyperliquidConsensus({
      flow: baseContext.participation?.hyperliquidWhales,
      config,
    });
    const position = await strategyApi.getCurrentPosition();

    if (isOpenPosition(position)) {
      const exitEvaluation = evaluateHyperliquidConsensusExit({
        flow: baseContext.participation?.hyperliquidWhales,
        positionDirection: position.direction,
        config,
      });
      if (
        Boolean(config.HLC_EXIT_ON_POSITION_REDUCTION) &&
        exitEvaluation.kind === 'exit'
      ) {
        return strategyApi.exit({
          code: exitEvaluation.code,
          direction: position.direction,
        });
      }
      if (
        Boolean(config.HLC_EXIT_ON_OPPOSITE_CONSENSUS) &&
        evaluation.kind === 'signal' &&
        evaluation.context.signalDirection !== position.direction
      ) {
        return strategyApi.exit({
          code: 'HLC_OPPOSITE_CONSENSUS_EXIT',
          direction: position.direction,
        });
      }

      return strategyApi.skip('POSITION_EXISTS');
    }

    if (evaluation.kind === 'skip') {
      return strategyApi.skip(evaluation.code);
    }

    const signalContext = evaluation.context;
    const modeConfig =
      signalContext.signalDirection === 'LONG' ? config.LONG : config.SHORT;
    if (!modeConfig.enable) {
      return strategyApi.skip('STRATEGY_DISABLED');
    }

    const { timestamp, currentPrice } =
      await strategyApi.getDecisionPriceContext();
    if (lastTradeController.isInCooldown(timestamp)) {
      return strategyApi.skip('DEV_TRADE_COOLDOWN');
    }

    const stopLossPrice = buildAtrFallbackStop({
      direction: modeConfig.direction,
      currentPrice,
      atr: baseContext.raw?.volatility?.atr ?? null,
      atrMult: Number(config.HLC_STOP_ATR_MULT),
      bufferPct: Number(config.HLC_STOP_BUFFER_PCT),
    });
    const riskOrder = buildContextRiskOrder({
      currentPrice,
      direction: modeConfig.direction,
      stopLossPrice,
      targetR: Number(config.HLC_TARGET_R_MULT),
      maxLossValue: Number(config.MAX_LOSS_VALUE),
      feePercent: Number(config.FEE_PERCENT),
      minRiskRatio: modeConfig.minRiskRatio,
    });
    if (riskOrder.skipCode || !riskOrder.plan) {
      return strategyApi.skip(riskOrder.skipCode ?? 'INVALID_RISK_PLAN');
    }

    const riskPlan = riskOrder.plan;
    lastTradeController.markTrade(timestamp);

    return strategyApi.entry({
      code:
        modeConfig.direction === 'LONG'
          ? 'HLC_LONG_CONSENSUS'
          : 'HLC_SHORT_CONSENSUS',
      direction: modeConfig.direction,
      indicators: indicators ?? {},
      additionalIndicators: {
        baseContext,
        hyperliquidConsensusContext: signalContext,
      },
      figures: buildHyperliquidConsensusFigures({
        direction: modeConfig.direction,
        entryTimestamp: timestamp,
        entryPrice: currentPrice,
        stopLossPrice,
        takeProfitPrice: riskPlan.takeProfitPrice,
        context: signalContext,
      }),
      orderPlan: {
        qty: riskPlan.qty,
        stopLossPrice,
        takeProfits: [{ rate: 1, price: riskPlan.takeProfitPrice }],
      },
    });
  };
};
