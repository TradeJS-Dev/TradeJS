import { round } from '@tradejs/core/math';
import type {
  CreateStrategyCore,
  IndicatorsHistorySnapshot,
  Position,
} from '@tradejs/types';
import { TrendShiftConfig } from './config';
import { buildTrendShiftSignalContext, createTrendShiftEngine } from './engine';
import { buildTrendShiftFigures } from './figures';
import { getTrendShiftCoreFilterSkipCode } from './filters';
import {
  buildTrendShiftGuardrailContext,
  getTrendShiftGuardrailSkipCode,
} from './guardrails';
import {
  buildStructureRiskPlan,
  isStopLossOnCorrectSide,
} from '../shared/structureRisk';
import { resolveDirectionalConfigNumber } from '../shared/directionalConfig';

type TrendShiftOppositeExitPending = {
  positionDirection: Position['direction'];
  oppositeTrendState: 1 | -1;
  armedAtTimestamp: number;
  stableBars: number;
};

type TrendShiftOppositeExitState = {
  pending: TrendShiftOppositeExitPending | null;
};

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

const buildTrendShiftStateKey = (config: TrendShiftConfig) =>
  JSON.stringify({
    detector: {
      mult: config.TRENDSHIFT_MULTIPLICATIVE_FACTOR,
      slope: config.TRENDSHIFT_SLOPE,
      atrLength: config.TRENDSHIFT_ATR_LENGTH,
      widthPct: config.TRENDSHIFT_WIDTH_PCT,
      minFlipAtr: config.TRENDSHIFT_MIN_FLIP_DISTANCE_ATR,
      confirmFlipWithClose: config.TRENDSHIFT_CONFIRM_FLIP_WITH_CLOSE,
      maxFigurePoints: config.TRENDSHIFT_MAX_FIGURE_POINTS,
    },
    entry: {
      minSignalBodyStrength: config.TRENDSHIFT_MIN_SIGNAL_BODY_STRENGTH,
      minAdx: config.TRENDSHIFT_MIN_ADX,
      stopAtrBufferMult: config.TRENDSHIFT_STOP_ATR_BUFFER_MULT,
      stopBufferPct: config.TRENDSHIFT_STOP_BUFFER_PCT,
      targetRMult: config.TRENDSHIFT_TARGET_R_MULT,
      targetRMultLong: config.TRENDSHIFT_TARGET_R_MULT_LONG,
      targetRMultShort: config.TRENDSHIFT_TARGET_R_MULT_SHORT,
      maxLossValue: config.MAX_LOSS_VALUE,
      feePercent: config.FEE_PERCENT,
      slippageBaseBps: config.SLIPPAGE_BASE_BPS,
      slippageMarketImpactBps: config.SLIPPAGE_MARKET_IMPACT_BPS,
      long: config.LONG,
      short: config.SHORT,
    },
    lifecycle: {
      exitOnOppositeFlip: config.TRENDSHIFT_EXIT_ON_OPPOSITE_FLIP,
      oppositeExitConfirmationBars:
        config.TRENDSHIFT_OPPOSITE_EXIT_CONFIRMATION_BARS,
    },
  });

const resolveOppositeExitConfirmationBars = (config: TrendShiftConfig) => {
  const parsed = Number(config.TRENDSHIFT_OPPOSITE_EXIT_CONFIRMATION_BARS ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
};

const trendStateForDirection = (direction: Position['direction']): 1 | -1 =>
  direction === 'LONG' ? 1 : -1;

export const createTrendShiftCore: CreateStrategyCore<
  TrendShiftConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({ config, data: initialData, strategyApi, indicatorsState }) => {
  const detectorState = strategyApi.createStateController<
    { engine: ReturnType<typeof createTrendShiftEngine> },
    ReturnType<ReturnType<typeof createTrendShiftEngine>['next']>,
    ReturnType<ReturnType<typeof createTrendShiftEngine>['getState']>
  >(
    'TrendShift',
    () => ({
      engine: createTrendShiftEngine({
        config,
        initialCandles: initialData,
      }),
    }),
    {
      configKey: buildTrendShiftStateKey(config),
      snapshot: (state) => state.engine.getState(),
    },
  );
  const stateKey = buildTrendShiftStateKey(config);
  const oppositeExitState = strategyApi.createStateController<
    TrendShiftOppositeExitState,
    boolean
  >('TrendShiftOppositeExit', () => ({ pending: null }), {
    configKey: stateKey,
  });
  const lastTradeController = strategyApi.createLastTradeController({
    enabled: true,
  });
  const oppositeExitConfirmationBars =
    resolveOppositeExitConfirmationBars(config);
  const nextDetectorState = (
    candle: Parameters<ReturnType<typeof createTrendShiftEngine>['next']>[0],
  ) =>
    detectorState.oncePerTimestamp(candle.timestamp, (state) =>
      state.engine.next(candle),
    );

  return async (candle) => {
    const runtimeState = nextDetectorState(candle);
    const snapshot = runtimeState.snapshot;

    if (!snapshot) {
      return strategyApi.skip('WAIT_DATA');
    }

    const position = await strategyApi.getCurrentPosition();
    if (isOpenPosition(position)) {
      const oppositeBullExit =
        position.direction === 'SHORT' && snapshot.bullFlip;
      const oppositeBearExit =
        position.direction === 'LONG' && snapshot.bearFlip;
      const confirmedOppositeFlip = oppositeBullExit || oppositeBearExit;

      if (
        Boolean(config.TRENDSHIFT_EXIT_ON_OPPOSITE_FLIP) &&
        oppositeExitConfirmationBars === 0 &&
        confirmedOppositeFlip
      ) {
        return strategyApi.exit({
          code: 'TRENDSHIFT_OPPOSITE_FLIP_EXIT',
          direction: position.direction,
        });
      }

      const delayedOppositeExit =
        Boolean(config.TRENDSHIFT_EXIT_ON_OPPOSITE_FLIP) &&
        oppositeExitConfirmationBars > 0 &&
        oppositeExitState.oncePerTimestamp(candle.timestamp, (state) => {
          const positionTrendState = trendStateForDirection(position.direction);
          const oppositeTrendState = positionTrendState === 1 ? -1 : 1;

          if (snapshot.trendState === positionTrendState) {
            state.pending = null;
            return false;
          }

          if (
            state.pending?.positionDirection !== position.direction ||
            state.pending.oppositeTrendState !== oppositeTrendState
          ) {
            state.pending = null;
          }

          if (!state.pending) {
            if (!confirmedOppositeFlip) {
              return false;
            }
            state.pending = {
              positionDirection: position.direction,
              oppositeTrendState,
              armedAtTimestamp: candle.timestamp,
              stableBars: 0,
            };
            return false;
          }

          state.pending.stableBars += 1;
          if (state.pending.stableBars < oppositeExitConfirmationBars) {
            return false;
          }

          state.pending = null;
          return true;
        });

      if (delayedOppositeExit) {
        return strategyApi.exit({
          code: 'TRENDSHIFT_OPPOSITE_FLIP_EXIT',
          direction: position.direction,
        });
      }

      return strategyApi.skip('POSITION_EXISTS');
    }

    if (oppositeExitConfirmationBars > 0) {
      oppositeExitState.oncePerTimestamp(candle.timestamp, (state) => {
        state.pending = null;
        return false;
      });
    }

    if (lastTradeController.isInCooldown(candle.timestamp)) {
      return strategyApi.skip('DEV_TRADE_COOLDOWN');
    }

    const isBullEntry = snapshot.bullFlip;
    const isBearEntry = snapshot.bearFlip;
    if (!isBullEntry && !isBearEntry) {
      return strategyApi.skip('NO_SIGNAL');
    }

    const modeConfig = isBullEntry ? config.LONG : config.SHORT;
    if (!modeConfig.enable) {
      return strategyApi.skip('STRATEGY_DISABLED');
    }

    const { timestamp, currentPrice } =
      await strategyApi.getDecisionPriceContext();
    const baseContext = strategyApi.getBaseContext();
    const direction = modeConfig.direction;
    const coreFilterSkipCode = getTrendShiftCoreFilterSkipCode({
      config,
      baseContext,
      direction,
    });
    if (coreFilterSkipCode) {
      return strategyApi.skip(coreFilterSkipCode);
    }
    const signalContext = buildTrendShiftSignalContext({
      snapshot: {
        ...snapshot,
        close: currentPrice,
      },
      indicators: { baseContext },
    });
    const guardrailContext = buildTrendShiftGuardrailContext({
      signalContext,
      baseContext,
    });

    if (!guardrailContext.approvalAllowedNow) {
      return strategyApi.skip(getTrendShiftGuardrailSkipCode(guardrailContext));
    }

    const structuralStopBase =
      direction === 'LONG' ? snapshot.lower : snapshot.upper;
    const stopBuffer = Math.max(
      snapshot.adaptiveAtr *
        Math.max(0, Number(config.TRENDSHIFT_STOP_ATR_BUFFER_MULT ?? 0.1)),
      currentPrice *
        (Math.max(0, Number(config.TRENDSHIFT_STOP_BUFFER_PCT ?? 0.03)) / 100),
    );
    const stopLossPrice =
      direction === 'LONG'
        ? structuralStopBase - stopBuffer
        : structuralStopBase + stopBuffer;

    if (
      !Number.isFinite(stopLossPrice) ||
      !isStopLossOnCorrectSide({
        direction,
        currentPrice,
        stopLossPrice,
      })
    ) {
      return strategyApi.skip('INVALID_STOP');
    }

    const { takeProfitPrice, riskRatio, qty } = buildStructureRiskPlan({
      currentPrice,
      direction,
      stopLossPrice,
      targetR: resolveDirectionalConfigNumber({
        config,
        key: 'TRENDSHIFT_TARGET_R_MULT',
        direction,
        fallback: 2.5,
      }),
      maxLossValue: config.MAX_LOSS_VALUE,
      feeRate: Number(config.FEE_PERCENT ?? 0),
      slippageBps:
        Number(config.SLIPPAGE_BASE_BPS ?? 0) +
        Number(config.SLIPPAGE_MARKET_IMPACT_BPS ?? 0),
    });

    if (!qty || !Number.isFinite(qty) || qty <= 0) {
      return strategyApi.skip('INVALID_QTY');
    }

    if (riskRatio <= modeConfig.minRiskRatio) {
      return strategyApi.skip(`RISK_RATIO:${round(riskRatio)}`);
    }

    const indicators = indicatorsState.snapshot();
    lastTradeController.markTrade(timestamp);

    return strategyApi.entry({
      code: isBullEntry ? 'TRENDSHIFT_BULLISH_FLIP' : 'TRENDSHIFT_BEARISH_FLIP',
      direction,
      indicators,
      additionalIndicators: {
        trendShiftContext: signalContext,
      },
      figures: buildTrendShiftFigures({
        series: runtimeState.series,
        direction,
        entryTimestamp: timestamp,
        entryPrice: currentPrice,
      }),
      orderPlan: {
        qty,
        stopLossPrice,
        takeProfits: [{ rate: 1, price: takeProfitPrice }],
      },
    });
  };
};
