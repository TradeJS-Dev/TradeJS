import { round } from '@tradejs/core/math';
import type {
  CreateStrategyCore,
  IndicatorsHistorySnapshot,
  Position,
} from '@tradejs/types';
import { HeadAndShouldersConfig } from './config';
import {
  buildHeadAndShouldersSignalContext,
  createHeadAndShouldersEngine,
} from './engine';
import { buildHeadAndShouldersFigures } from './figures';
import { getHeadAndShouldersCoreFilterSkipCode } from './filters';
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

const buildHeadAndShouldersStateKey = (config: HeadAndShouldersConfig) =>
  JSON.stringify({
    pivotLookback: config.HEADSHOULDERS_PIVOT_LOOKBACK,
    shoulderTolerancePct: config.HEADSHOULDERS_SHOULDER_TOLERANCE_PCT,
    minHeadProminenceRatio: config.HEADSHOULDERS_MIN_HEAD_PROMINENCE_RATIO,
    targetHeightPct: config.HEADSHOULDERS_TARGET_HEIGHT_PCT,
    targetHeightPctLong: config.HEADSHOULDERS_TARGET_HEIGHT_PCT_LONG,
    targetHeightPctShort: config.HEADSHOULDERS_TARGET_HEIGHT_PCT_SHORT,
    stopBufferHeightPct: config.HEADSHOULDERS_STOP_BUFFER_HEIGHT_PCT,
    minHeadHeightPct: config.HEADSHOULDERS_MIN_HEAD_HEIGHT_PCT,
    minHeadHeightAtr: config.HEADSHOULDERS_MIN_HEAD_HEIGHT_ATR,
    atrPeriod: config.HEADSHOULDERS_ATR_PERIOD,
    minPatternBars: config.HEADSHOULDERS_MIN_PATTERN_BARS,
    maxPatternBars: config.HEADSHOULDERS_MAX_PATTERN_BARS,
    minPatternSymmetryRatio: config.HEADSHOULDERS_MIN_PATTERN_SYMMETRY_RATIO,
    maxNecklineSlopeRatio: config.HEADSHOULDERS_MAX_NECKLINE_SLOPE_RATIO,
    maxPatternAgeBars: config.HEADSHOULDERS_MAX_PATTERN_AGE_BARS,
    priorTrendLookback: config.HEADSHOULDERS_PRIOR_TREND_LOOKBACK,
    maxPriorMoveAtr: config.HEADSHOULDERS_MAX_PRIOR_MOVE_ATR,
    minBreakoutDistanceAtr: config.HEADSHOULDERS_MIN_BREAKOUT_DISTANCE_ATR,
    maxBreakoutDistanceHeightRatio:
      config.HEADSHOULDERS_MAX_BREAKOUT_DISTANCE_HEIGHT_RATIO,
    maxBreakoutDistancePct: config.HEADSHOULDERS_MAX_BREAKOUT_DISTANCE_PCT,
    maxBreakoutDelayBars: config.HEADSHOULDERS_MAX_BREAKOUT_DELAY_BARS,
    requireBreakoutCross: config.HEADSHOULDERS_REQUIRE_BREAKOUT_CROSS,
    entryMode: config.HEADSHOULDERS_ENTRY_MODE,
    confirmationMaxBars: config.HEADSHOULDERS_CONFIRMATION_MAX_BARS,
    minConfirmationBodyAtr: config.HEADSHOULDERS_MIN_CONFIRMATION_BODY_ATR,
    maxConfirmationCloseLocation:
      config.HEADSHOULDERS_MAX_CONFIRMATION_CLOSE_LOCATION,
    confirmationVolumePeriod: config.HEADSHOULDERS_CONFIRMATION_VOLUME_PERIOD,
    minConfirmationVolumeRel: config.HEADSHOULDERS_MIN_CONFIRMATION_VOLUME_REL,
    retestMaxBars: config.HEADSHOULDERS_RETEST_MAX_BARS,
    retestToleranceAtr: config.HEADSHOULDERS_RETEST_TOLERANCE_ATR,
  });

export const createHeadAndShouldersCore: CreateStrategyCore<
  HeadAndShouldersConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({ config, data: initialData, strategyApi, indicatorsState }) => {
  const detectorState = strategyApi.createStateController<
    { engine: ReturnType<typeof createHeadAndShouldersEngine> },
    ReturnType<ReturnType<typeof createHeadAndShouldersEngine>['next']>,
    ReturnType<ReturnType<typeof createHeadAndShouldersEngine>['getState']>
  >(
    'HeadAndShoulders',
    () => ({
      engine: createHeadAndShouldersEngine({
        config,
        initialCandles: initialData,
      }),
    }),
    {
      configKey: buildHeadAndShouldersStateKey(config),
      snapshot: (state) => state.engine.getState(),
    },
  );
  const lastTradeController = strategyApi.createLastTradeController({
    enabled: true,
  });
  const nextDetectorState = (
    candle: Parameters<
      ReturnType<typeof createHeadAndShouldersEngine>['next']
    >[0],
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
        Boolean(config.HEADSHOULDERS_EXIT_ON_OPPOSITE_PATTERN) &&
        oppositePattern
      ) {
        return strategyApi.exit({
          code: 'HEADSHOULDERS_OPPOSITE_PATTERN_EXIT',
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

    const filterSkipCode = getHeadAndShouldersCoreFilterSkipCode({
      pattern,
      config,
      baseContext: strategyApi.getBaseContext(),
    });
    if (filterSkipCode) return strategyApi.skip(filterSkipCode);

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
      ...buildHeadAndShouldersSignalContext({
        ...pattern,
        close: currentPrice,
      }),
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
          ? `HEADSHOULDERS_INVERSE_${pattern.entryStage.toUpperCase()}`
          : `HEADSHOULDERS_CLASSIC_${pattern.entryStage.toUpperCase()}`,
      direction: sideConfig.direction,
      indicators,
      additionalIndicators: {
        headAndShouldersContext: signalContext,
      },
      figures: buildHeadAndShouldersFigures({
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
