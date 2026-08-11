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
    mult: config.TRENDSHIFT_MULTIPLICATIVE_FACTOR,
    slope: config.TRENDSHIFT_SLOPE,
    atrLength: config.TRENDSHIFT_ATR_LENGTH,
    widthPct: config.TRENDSHIFT_WIDTH_PCT,
    minFlipAtr: config.TRENDSHIFT_MIN_FLIP_DISTANCE_ATR,
    confirmFlipWithClose: config.TRENDSHIFT_CONFIRM_FLIP_WITH_CLOSE,
    maxFigurePoints: config.TRENDSHIFT_MAX_FIGURE_POINTS,
  });

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
  const lastTradeController = strategyApi.createLastTradeController();
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

      if (
        Boolean(config.TRENDSHIFT_EXIT_ON_OPPOSITE_FLIP) &&
        (oppositeBullExit || oppositeBearExit)
      ) {
        return strategyApi.exit({
          code: 'TRENDSHIFT_OPPOSITE_FLIP_EXIT',
          direction: position.direction,
        });
      }

      return strategyApi.skip('POSITION_EXISTS');
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
