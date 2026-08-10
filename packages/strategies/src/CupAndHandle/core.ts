import { round } from '@tradejs/core/math';
import type {
  CreateStrategyCore,
  IndicatorsHistorySnapshot,
  Position,
} from '@tradejs/types';
import { CupAndHandleConfig } from './config';
import {
  buildCupAndHandleSignalContext,
  createCupAndHandleEngine,
} from './engine';
import { buildCupAndHandleFigures } from './figures';
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

const buildCupAndHandleStateKey = (config: CupAndHandleConfig) =>
  JSON.stringify({
    pivotLookback: config.CUPHANDLE_PIVOT_LOOKBACK,
    rimTolerancePct: config.CUPHANDLE_RIM_TOLERANCE_PCT,
    targetDepthPct: config.CUPHANDLE_TARGET_DEPTH_PCT,
    stopBufferDepthPct: config.CUPHANDLE_STOP_BUFFER_DEPTH_PCT,
    minCupDepthPct: config.CUPHANDLE_MIN_CUP_DEPTH_PCT,
    minCupDepthAtr: config.CUPHANDLE_MIN_CUP_DEPTH_ATR,
    atrPeriod: config.CUPHANDLE_ATR_PERIOD,
    minCupBars: config.CUPHANDLE_MIN_CUP_BARS,
    maxCupBars: config.CUPHANDLE_MAX_CUP_BARS,
    minCupSymmetryRatio: config.CUPHANDLE_MIN_CUP_SYMMETRY_RATIO,
    minHandleBars: config.CUPHANDLE_MIN_HANDLE_BARS,
    maxHandleBars: config.CUPHANDLE_MAX_HANDLE_BARS,
    minHandleDepthRatio: config.CUPHANDLE_MIN_HANDLE_DEPTH_RATIO,
    maxHandleDepthRatio: config.CUPHANDLE_MAX_HANDLE_DEPTH_RATIO,
    maxPatternAgeBars: config.CUPHANDLE_MAX_PATTERN_AGE_BARS,
    minBreakoutDistanceAtr: config.CUPHANDLE_MIN_BREAKOUT_DISTANCE_ATR,
    maxBreakoutDistanceDepthRatio:
      config.CUPHANDLE_MAX_BREAKOUT_DISTANCE_DEPTH_RATIO,
    maxBreakoutDistancePct: config.CUPHANDLE_MAX_BREAKOUT_DISTANCE_PCT,
    requireBreakoutCross: config.CUPHANDLE_REQUIRE_BREAKOUT_CROSS,
    entryMode: config.CUPHANDLE_ENTRY_MODE,
    confirmationMaxBars: config.CUPHANDLE_CONFIRMATION_MAX_BARS,
    retestMaxBars: config.CUPHANDLE_RETEST_MAX_BARS,
    retestToleranceAtr: config.CUPHANDLE_RETEST_TOLERANCE_ATR,
  });

export const createCupAndHandleCore: CreateStrategyCore<
  CupAndHandleConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({ config, data: initialData, strategyApi, indicatorsState }) => {
  const detectorState = strategyApi.createStateController<
    { engine: ReturnType<typeof createCupAndHandleEngine> },
    ReturnType<ReturnType<typeof createCupAndHandleEngine>['next']>,
    ReturnType<ReturnType<typeof createCupAndHandleEngine>['getState']>
  >(
    'CupAndHandle',
    () => ({
      engine: createCupAndHandleEngine({
        config,
        initialCandles: initialData,
      }),
    }),
    {
      configKey: buildCupAndHandleStateKey(config),
      snapshot: (state) => state.engine.getState(),
    },
  );
  const lastTradeController = strategyApi.createLastTradeController();
  const nextDetectorState = (
    candle: Parameters<ReturnType<typeof createCupAndHandleEngine>['next']>[0],
  ) =>
    detectorState.oncePerTimestamp(candle.timestamp, (state) =>
      state.engine.next(candle),
    );

  return async (candle) => {
    const runtimeState = nextDetectorState(candle);
    const pattern = runtimeState.pattern;
    if (!pattern) return strategyApi.skip('NO_PATTERN');

    const position = await strategyApi.getCurrentPosition();
    if (isOpenPosition(position)) {
      const oppositePattern = position.direction !== pattern.direction;
      if (
        Boolean(config.CUPHANDLE_EXIT_ON_OPPOSITE_PATTERN) &&
        oppositePattern
      ) {
        return strategyApi.exit({
          code: 'CUPHANDLE_OPPOSITE_PATTERN_EXIT',
          direction: position.direction,
        });
      }
      return strategyApi.skip('POSITION_EXISTS');
    }

    if (lastTradeController.isInCooldown(candle.timestamp)) {
      return strategyApi.skip('DEV_TRADE_COOLDOWN');
    }

    const sideConfig =
      pattern.direction === 'LONG' ? config.LONG : config.SHORT;
    if (!sideConfig.enable) return strategyApi.skip('STRATEGY_DISABLED');

    const { timestamp, currentPrice } =
      await strategyApi.getDecisionPriceContext();
    const baseContext = strategyApi.getBaseContext();
    const minimumBreakoutVolumeRel20 = Math.max(
      0,
      Number(config.CUPHANDLE_MIN_BREAKOUT_VOLUME_REL20 ?? 0),
    );
    const breakoutVolumeRel20 = Number(
      baseContext?.participation?.volume?.volumeRel20,
    );
    if (
      minimumBreakoutVolumeRel20 > 0 &&
      (!Number.isFinite(breakoutVolumeRel20) ||
        breakoutVolumeRel20 < minimumBreakoutVolumeRel20)
    ) {
      return strategyApi.skip('BREAKOUT_VOLUME_NOT_CONFIRMED');
    }
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
    if (!targetIsValid) return strategyApi.skip('TARGET_ALREADY_PASSED');

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
      ...buildCupAndHandleSignalContext({ ...pattern, close: currentPrice }),
      breakoutVolumeRel20: Number.isFinite(breakoutVolumeRel20)
        ? breakoutVolumeRel20
        : null,
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
    if (riskRatio <= sideConfig.minRiskRatio) {
      return strategyApi.skip(`RISK_RATIO:${round(riskRatio)}`);
    }

    const indicators = indicatorsState.snapshot();
    lastTradeController.markTrade(timestamp);
    return strategyApi.entry({
      code:
        pattern.direction === 'LONG'
          ? `CUPHANDLE_CUP_AND_HANDLE_${pattern.entryStage.toUpperCase()}`
          : `CUPHANDLE_INVERTED_CUP_AND_HANDLE_${pattern.entryStage.toUpperCase()}`,
      direction: sideConfig.direction,
      indicators,
      additionalIndicators: {
        cupAndHandleContext: signalContext,
      },
      figures: buildCupAndHandleFigures({
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
