import { round } from '@tradejs/core/math';
import type {
  CreateStrategyCore,
  IndicatorsHistorySnapshot,
  Position,
} from '@tradejs/types';
import { DoubleTapConfig } from './config';
import { buildDoubleTapSignalContext, createDoubleTapEngine } from './engine';
import { buildDoubleTapFigures } from './figures';
import {
  buildTradeEconomics,
  isStopLossOnCorrectSide,
} from '../shared/structureRisk';

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

const buildDoubleTapStateKey = (config: DoubleTapConfig) =>
  JSON.stringify({
    pivotLength: config.DOUBLETAP_PIVOT_LENGTH,
    pivotTolerancePct: config.DOUBLETAP_PIVOT_TOLERANCE_PCT,
    targetFibPct: config.DOUBLETAP_TARGET_FIB_PCT,
    stopFibPct: config.DOUBLETAP_STOP_FIB_PCT,
    minPatternHeightPct: config.DOUBLETAP_MIN_PATTERN_HEIGHT_PCT,
    minPatternHeightAtr: config.DOUBLETAP_MIN_PATTERN_HEIGHT_ATR,
    atrPeriod: config.DOUBLETAP_ATR_PERIOD,
    minTapSpacingBars: config.DOUBLETAP_MIN_TAP_SPACING_BARS,
    maxPatternAgeBars: config.DOUBLETAP_MAX_PATTERN_AGE_BARS,
    minLegSymmetryRatio: config.DOUBLETAP_MIN_LEG_SYMMETRY_RATIO,
    minBreakoutDistanceAtr: config.DOUBLETAP_MIN_BREAKOUT_DISTANCE_ATR,
    maxBreakoutDistanceHeightRatio:
      config.DOUBLETAP_MAX_BREAKOUT_DISTANCE_HEIGHT_RATIO,
    maxBreakoutDistancePct: config.DOUBLETAP_MAX_BREAKOUT_DISTANCE_PCT,
    entryMode: config.DOUBLETAP_ENTRY_MODE,
    confirmationMaxBars: config.DOUBLETAP_CONFIRMATION_MAX_BARS,
    retestMaxBars: config.DOUBLETAP_RETEST_MAX_BARS,
    retestToleranceAtr: config.DOUBLETAP_RETEST_TOLERANCE_ATR,
  });

export const createDoubleTapCore: CreateStrategyCore<
  DoubleTapConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({ config, data: initialData, strategyApi, indicatorsState }) => {
  const detectorState = strategyApi.createStateController<
    { engine: ReturnType<typeof createDoubleTapEngine> },
    ReturnType<ReturnType<typeof createDoubleTapEngine>['next']>,
    ReturnType<ReturnType<typeof createDoubleTapEngine>['getState']>
  >(
    'DoubleTap',
    () => ({
      engine: createDoubleTapEngine({
        config,
        initialCandles: initialData,
      }),
    }),
    {
      configKey: buildDoubleTapStateKey(config),
      snapshot: (state) => state.engine.getState(),
    },
  );
  const lastTradeController = strategyApi.createLastTradeController();
  const nextDetectorState = (
    candle: Parameters<ReturnType<typeof createDoubleTapEngine>['next']>[0],
  ) =>
    detectorState.oncePerTimestamp(candle.timestamp, (state) =>
      state.engine.next(candle),
    );

  return async (candle) => {
    const runtimeState = nextDetectorState(candle);
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

    const { timestamp, currentPrice } =
      await strategyApi.getDecisionPriceContext();
    if (
      !isStopLossOnCorrectSide({
        direction: pattern.direction,
        currentPrice,
        stopLossPrice: pattern.stopLossPrice,
      })
    ) {
      return strategyApi.skip('INVALID_STOP');
    }
    const targetIsValid =
      pattern.direction === 'LONG'
        ? pattern.targetPrice > currentPrice
        : pattern.targetPrice < currentPrice;
    if (!targetIsValid) {
      return strategyApi.skip('TARGET_ALREADY_PASSED');
    }

    const economics = buildTradeEconomics({
      entryPrice: currentPrice,
      stopLossPrice: pattern.stopLossPrice,
      takeProfitPrice: pattern.targetPrice,
      feeRate: Number(config.FEE_PERCENT ?? 0),
      slippageBps:
        Number(config.SLIPPAGE_BASE_BPS ?? 0) +
        Number(config.SLIPPAGE_MARKET_IMPACT_BPS ?? 0),
    });
    const qty =
      economics.lossPerUnit > 0
        ? Number(config.MAX_LOSS_VALUE ?? 0) / economics.lossPerUnit
        : 0;
    const riskRatio = economics.netRiskRatio;
    const signalContext = {
      ...buildDoubleTapSignalContext({ ...pattern, close: currentPrice }),
      executionEconomics: {
        grossRiskRatio: economics.grossRiskRatio,
        netRiskRatio: economics.netRiskRatio,
        lossPerUnit: economics.lossPerUnit,
        rewardPerUnit: economics.rewardPerUnit,
      },
    };

    if (!qty || !Number.isFinite(qty) || qty <= 0) {
      return strategyApi.skip('INVALID_QTY');
    }

    if (riskRatio <= modeConfig.minRiskRatio) {
      return strategyApi.skip(`RISK_RATIO:${round(riskRatio)}`);
    }

    const indicators = indicatorsState.snapshot();
    lastTradeController.markTrade(timestamp);

    return strategyApi.entry({
      code:
        pattern.direction === 'LONG'
          ? `DOUBLETAP_DOUBLE_BOTTOM_${pattern.entryStage.toUpperCase()}`
          : `DOUBLETAP_DOUBLE_TOP_${pattern.entryStage.toUpperCase()}`,
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
