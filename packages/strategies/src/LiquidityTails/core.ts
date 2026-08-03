import { round } from '@tradejs/core/math';
import type {
  CreateStrategyCore,
  Direction,
  IndicatorsHistorySnapshot,
  Position,
} from '@tradejs/types';
import { LiquidityTailsConfig } from './config';
import {
  buildLiquidityTailsSignalContext,
  createLiquidityTailsEngine,
  LiquidityTailsExecutionContext,
} from './engine';
import { buildLiquidityTailsFigures } from './figures';

interface PendingLiquidityTailsEntry {
  timestamp: number;
  observedQty: number;
  level: 1 | 2;
}

interface LiquidityTailsCycle {
  direction: Direction;
  stopLossPrice: number;
  targetR: number;
  entriesFilled: number;
  pending: PendingLiquidityTailsEntry | null;
}

interface LiquidityTailsExecutionState {
  cycle: LiquidityTailsCycle | null;
}

const finiteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

const isDirectionalStopValid = (
  direction: Direction,
  stopLossPrice: number,
  referencePrice: number,
) =>
  direction === 'LONG'
    ? stopLossPrice < referencePrice
    : stopLossPrice > referencePrice;

const isPriceImprovement = (
  direction: Direction,
  currentPrice: number,
  averagePrice: number,
) =>
  direction === 'LONG'
    ? currentPrice < averagePrice
    : currentPrice > averagePrice;

const getDirectionalTarget = ({
  direction,
  averagePrice,
  stopLossPrice,
  targetR,
}: {
  direction: Direction;
  averagePrice: number;
  stopLossPrice: number;
  targetR: number;
}) => {
  const distance = Math.abs(averagePrice - stopLossPrice) * targetR;
  return direction === 'LONG'
    ? averagePrice + distance
    : averagePrice - distance;
};

const getLossPerUnit = ({
  entryPrice,
  stopLossPrice,
  feeRate,
}: {
  entryPrice: number;
  stopLossPrice: number;
  feeRate: number;
}) =>
  Math.abs(entryPrice - stopLossPrice) +
  Math.abs(entryPrice) * feeRate +
  Math.abs(stopLossPrice) * feeRate;

const calculateRiskSizedQty = ({
  riskBudget,
  entryPrice,
  stopLossPrice,
  feeRate,
}: {
  riskBudget: number;
  entryPrice: number;
  stopLossPrice: number;
  feeRate: number;
}) => {
  const lossPerUnit = getLossPerUnit({
    entryPrice,
    stopLossPrice,
    feeRate,
  });
  return lossPerUnit > 0 ? riskBudget / lossPerUnit : 0;
};

const calculateWorstCaseLoss = ({
  qty,
  entryPrice,
  stopLossPrice,
  feeRate,
}: {
  qty: number;
  entryPrice: number;
  stopLossPrice: number;
  feeRate: number;
}) =>
  qty *
  getLossPerUnit({
    entryPrice,
    stopLossPrice,
    feeRate,
  });

const getProjectedAverage = ({
  position,
  entryPrice,
  entryQty,
}: {
  position: Position;
  entryPrice: number;
  entryQty: number;
}) =>
  (position.price * position.qty + entryPrice * entryQty) /
  (position.qty + entryQty);

const buildExecutionStateKey = (config: LiquidityTailsConfig) =>
  JSON.stringify({
    maxLossValue: config.MAX_LOSS_VALUE,
    feePercent: config.FEE_PERCENT,
    targetR: config.LIQUIDITY_TAILS_TARGET_R_MULT,
    scaleInEnabled: config.LIQUIDITY_TAILS_SCALE_IN_ENABLED,
    initialRiskFraction: config.LIQUIDITY_TAILS_INITIAL_RISK_FRACTION,
  });

const buildRecoveredCycle = ({
  position,
  maxLossValue,
  feeRate,
  targetR,
  initialRiskFraction,
}: {
  position: Position;
  maxLossValue: number;
  feeRate: number;
  targetR: number;
  initialRiskFraction: number;
}): LiquidityTailsCycle | null => {
  const stopLossPrice = finiteNumber(position.slPrice);
  if (
    stopLossPrice == null ||
    !isDirectionalStopValid(position.direction, stopLossPrice, position.price)
  ) {
    return null;
  }

  const existingRisk = calculateWorstCaseLoss({
    qty: position.qty,
    entryPrice: position.price,
    stopLossPrice,
    feeRate,
  });
  const increasedRiskThreshold =
    maxLossValue * Math.min(1, initialRiskFraction + 0.02);

  return {
    direction: position.direction,
    stopLossPrice,
    targetR,
    entriesFilled: existingRisk > increasedRiskThreshold ? 2 : 1,
    pending: null,
  };
};

const buildExecutionContext = ({
  action,
  level,
  levelsFilled,
  positionQty,
  projectedQty,
  projectedAveragePrice,
  stopLossPrice,
  takeProfitPrice,
  existingRiskValue,
  remainingRiskValue,
  projectedRiskValue,
  maxLossValue,
  initialRiskFraction,
}: Omit<LiquidityTailsExecutionContext, 'riskBudgetUsedPct'> & {
  maxLossValue: number;
}): LiquidityTailsExecutionContext => ({
  action,
  level,
  levelsFilled,
  positionQty,
  projectedQty,
  projectedAveragePrice,
  stopLossPrice,
  takeProfitPrice,
  existingRiskValue,
  remainingRiskValue,
  projectedRiskValue,
  riskBudgetUsedPct:
    maxLossValue > 0 ? (projectedRiskValue / maxLossValue) * 100 : 0,
  initialRiskFraction,
});

const buildLiquidityTailsStateKey = (config: LiquidityTailsConfig) =>
  JSON.stringify({
    atrLength: config.LIQUIDITY_TAILS_ATR_LENGTH,
    atrMult: config.LIQUIDITY_TAILS_ATR_MULT,
    minWickRatio: config.LIQUIDITY_TAILS_MIN_WICK_RATIO,
    wickDominance: config.LIQUIDITY_TAILS_WICK_DOMINANCE,
    minGap: config.LIQUIDITY_TAILS_MIN_GAP,
    maxAge: config.LIQUIDITY_TAILS_MAX_AGE,
    keepBroken: config.LIQUIDITY_TAILS_KEEP_BROKEN,
    reactionCloseBeyondZone: config.LIQUIDITY_TAILS_REACTION_CLOSE_BEYOND_ZONE,
    requireReactionBody: config.LIQUIDITY_TAILS_REQUIRE_REACTION_BODY,
    maxRetestDistancePct: config.LIQUIDITY_TAILS_MAX_RETEST_DISTANCE_PCT,
  });

export const createLiquidityTailsCore: CreateStrategyCore<
  LiquidityTailsConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({ config, data: initialData, strategyApi, indicatorsState }) => {
  const detectorState = strategyApi.createStateController<
    { engine: ReturnType<typeof createLiquidityTailsEngine> },
    ReturnType<ReturnType<typeof createLiquidityTailsEngine>['next']>,
    ReturnType<ReturnType<typeof createLiquidityTailsEngine>['getState']>
  >(
    'LiquidityTails',
    () => ({
      engine: createLiquidityTailsEngine({
        config,
        initialCandles: initialData,
      }),
    }),
    {
      configKey: buildLiquidityTailsStateKey(config),
      snapshot: (state) => state.engine.getState(),
    },
  );
  const executionState = strategyApi.createStateController<
    LiquidityTailsExecutionState,
    LiquidityTailsExecutionState,
    LiquidityTailsExecutionState
  >('LiquidityTailsExecution', () => ({ cycle: null }), {
    configKey: buildExecutionStateKey(config),
  });
  const lastTradeController = strategyApi.createLastTradeController();
  const nextDetectorState = (
    candle: Parameters<
      ReturnType<typeof createLiquidityTailsEngine>['next']
    >[0],
  ) =>
    detectorState.oncePerTimestamp(candle.timestamp, (state) =>
      state.engine.next(candle),
    );
  const maxLossValue = Math.max(0, Number(config.MAX_LOSS_VALUE ?? 0));
  const feeRate = Math.max(0, Number(config.FEE_PERCENT ?? 0));
  const scaleInEnabled = Boolean(config.LIQUIDITY_TAILS_SCALE_IN_ENABLED);
  const configuredInitialRiskFraction = Number(
    config.LIQUIDITY_TAILS_INITIAL_RISK_FRACTION ?? 0.7,
  );
  const initialRiskFraction = scaleInEnabled
    ? Math.min(
        0.95,
        Math.max(
          0.05,
          Number.isFinite(configuredInitialRiskFraction)
            ? configuredInitialRiskFraction
            : 0.7,
        ),
      )
    : 1;
  const targetR = Math.max(
    0,
    Number(config.LIQUIDITY_TAILS_TARGET_R_MULT ?? 2),
  );

  return async (candle) => {
    const runtimeState = nextDetectorState(candle);
    const signal = runtimeState.signal;
    const position = await strategyApi.getCurrentPosition();
    let state = executionState.get();

    if (isOpenPosition(position)) {
      if (!state.cycle || state.cycle.direction !== position.direction) {
        executionState.update((draft) => {
          draft.cycle = buildRecoveredCycle({
            position,
            maxLossValue,
            feeRate,
            targetR,
            initialRiskFraction,
          });
        });
      } else if (state.cycle.pending) {
        const pending = state.cycle.pending;
        if (position.qty > pending.observedQty + Number.EPSILON) {
          executionState.update((draft) => {
            if (!draft.cycle) return;
            draft.cycle.entriesFilled = Math.max(
              draft.cycle.entriesFilled,
              pending.level,
            );
            draft.cycle.pending = null;
          });
        } else if (candle.timestamp > pending.timestamp) {
          executionState.update((draft) => {
            if (draft.cycle) draft.cycle.pending = null;
          });
        }
      }
    } else if (state.cycle) {
      if (state.cycle.pending?.timestamp === candle.timestamp) {
        return strategyApi.skip('LIQUIDITY_TAILS_ORDER_PENDING');
      }
      executionState.update((draft) => {
        draft.cycle = null;
      });
    }

    state = executionState.get();
    if (isOpenPosition(position)) {
      const cycle = state.cycle;
      const oppositeSignal =
        signal != null && signal.direction !== position.direction;

      if (
        Boolean(config.LIQUIDITY_TAILS_EXIT_ON_OPPOSITE_RETEST) &&
        oppositeSignal
      ) {
        return strategyApi.exit({
          code: 'LIQUIDITY_TAILS_OPPOSITE_RETEST_EXIT',
          direction: position.direction,
        });
      }

      if (!signal || !scaleInEnabled) {
        return strategyApi.skip('POSITION_EXISTS');
      }
      if (oppositeSignal) {
        return strategyApi.skip('LIQUIDITY_TAILS_SCALE_IN_DIRECTION_MISMATCH');
      }
      if (!cycle) {
        return strategyApi.skip('LIQUIDITY_TAILS_SCALE_IN_STATE_UNAVAILABLE');
      }
      if (cycle.pending) {
        return strategyApi.skip('LIQUIDITY_TAILS_ORDER_PENDING');
      }
      if (cycle.entriesFilled >= 2) {
        return strategyApi.skip('LIQUIDITY_TAILS_SCALE_IN_COMPLETE');
      }

      const { currentPrice } = await strategyApi.getDecisionPriceContext();
      if (
        !isPriceImprovement(position.direction, currentPrice, position.price)
      ) {
        return strategyApi.skip('LIQUIDITY_TAILS_SCALE_IN_PRICE_NOT_IMPROVED');
      }
      if (
        !isDirectionalStopValid(
          position.direction,
          cycle.stopLossPrice,
          currentPrice,
        )
      ) {
        return strategyApi.skip('LIQUIDITY_TAILS_SCALE_IN_STOP_REACHED');
      }

      const existingRiskValue = calculateWorstCaseLoss({
        qty: position.qty,
        entryPrice: position.price,
        stopLossPrice: cycle.stopLossPrice,
        feeRate,
      });
      const remainingRiskValue = Math.max(0, maxLossValue - existingRiskValue);
      const qty = calculateRiskSizedQty({
        riskBudget: remainingRiskValue,
        entryPrice: currentPrice,
        stopLossPrice: cycle.stopLossPrice,
        feeRate,
      });
      if (!Number.isFinite(qty) || qty <= Number.EPSILON) {
        return strategyApi.skip(
          'LIQUIDITY_TAILS_SCALE_IN_RISK_BUDGET_EXHAUSTED',
        );
      }

      const projectedAveragePrice = getProjectedAverage({
        position,
        entryPrice: currentPrice,
        entryQty: qty,
      });
      const projectedQty = position.qty + qty;
      const takeProfitPrice = getDirectionalTarget({
        direction: position.direction,
        averagePrice: projectedAveragePrice,
        stopLossPrice: cycle.stopLossPrice,
        targetR: cycle.targetR,
      });
      const projectedRiskValue = calculateWorstCaseLoss({
        qty: projectedQty,
        entryPrice: projectedAveragePrice,
        stopLossPrice: cycle.stopLossPrice,
        feeRate,
      });
      const executionContext = buildExecutionContext({
        action: 'increase',
        level: 2,
        levelsFilled: cycle.entriesFilled,
        positionQty: position.qty,
        projectedQty,
        projectedAveragePrice,
        stopLossPrice: cycle.stopLossPrice,
        takeProfitPrice,
        existingRiskValue,
        remainingRiskValue,
        projectedRiskValue,
        maxLossValue,
        initialRiskFraction,
      });
      executionState.update((draft) => {
        if (!draft.cycle) return;
        draft.cycle.pending = {
          timestamp: candle.timestamp,
          observedQty: position.qty,
          level: 2,
        };
      });
      const indicators = indicatorsState.snapshot();

      return strategyApi.entry({
        code:
          position.direction === 'LONG'
            ? 'LIQUIDITY_TAILS_BUY_PRESSURE_SCALE_IN'
            : 'LIQUIDITY_TAILS_SELL_PRESSURE_SCALE_IN',
        direction: position.direction,
        indicators,
        additionalIndicators: {
          liquidityTailsContext: buildLiquidityTailsSignalContext(
            { ...signal, close: currentPrice },
            executionContext,
          ),
        },
        figures: buildLiquidityTailsFigures({
          signal,
          zones: runtimeState.zones,
          entryTimestamp: candle.timestamp,
          entryPrice: currentPrice,
          stopLossPrice: cycle.stopLossPrice,
          takeProfitPrice,
          maxZones: Math.max(
            1,
            Number(config.LIQUIDITY_TAILS_MAX_FIGURE_ZONES ?? 24),
          ),
        }),
        orderPlan: {
          qty,
          stopLossPrice: cycle.stopLossPrice,
          takeProfits: [{ rate: 1, price: takeProfitPrice }],
          positionIntent: 'increase',
        },
      });
    }

    if (!signal) {
      return strategyApi.skip('NO_LIQUIDITY_TAIL_RETEST');
    }

    if (lastTradeController.isInCooldown(candle.timestamp)) {
      return strategyApi.skip('DEV_TRADE_COOLDOWN');
    }

    const modeConfig = signal.direction === 'LONG' ? config.LONG : config.SHORT;
    if (!modeConfig.enable) {
      return strategyApi.skip('STRATEGY_DISABLED');
    }

    const { timestamp, currentPrice } =
      await strategyApi.getDecisionPriceContext();
    const indicators = indicatorsState.snapshot();
    const buffer = Math.max(
      signal.atr *
        Math.max(0, Number(config.LIQUIDITY_TAILS_STOP_ATR_BUFFER_MULT)),
      currentPrice *
        (Math.max(0, Number(config.LIQUIDITY_TAILS_STOP_BUFFER_PCT)) / 100),
    );
    const stopLossPrice =
      signal.direction === 'LONG'
        ? signal.zone.bottom - buffer
        : signal.zone.top + buffer;
    const riskDistance = Math.abs(currentPrice - stopLossPrice);
    const takeProfitPrice =
      signal.direction === 'LONG'
        ? currentPrice + riskDistance * targetR
        : currentPrice - riskDistance * targetR;
    const riskRatio = riskDistance > 0 ? targetR : 0;
    const initialRiskValue = maxLossValue * initialRiskFraction;
    const qty = scaleInEnabled
      ? calculateRiskSizedQty({
          riskBudget: initialRiskValue,
          entryPrice: currentPrice,
          stopLossPrice,
          feeRate,
        })
      : riskDistance > 0
        ? maxLossValue /
          riskDistance /
          (1 + Math.max(0, Number(config.FEE_PERCENT ?? 0)) / 100)
        : 0;

    if (
      (signal.direction === 'LONG' && stopLossPrice >= currentPrice) ||
      (signal.direction === 'SHORT' && stopLossPrice <= currentPrice)
    ) {
      return strategyApi.skip('INVALID_STOP');
    }

    if (!qty || !Number.isFinite(qty) || qty <= 0) {
      return strategyApi.skip('INVALID_QTY');
    }

    if (riskRatio <= modeConfig.minRiskRatio) {
      return strategyApi.skip(`RISK_RATIO:${round(riskRatio)}`);
    }

    const projectedRiskValue = calculateWorstCaseLoss({
      qty,
      entryPrice: currentPrice,
      stopLossPrice,
      feeRate,
    });
    const executionContext = buildExecutionContext({
      action: 'open',
      level: 1,
      levelsFilled: 0,
      positionQty: 0,
      projectedQty: qty,
      projectedAveragePrice: currentPrice,
      stopLossPrice,
      takeProfitPrice,
      existingRiskValue: 0,
      remainingRiskValue: Math.max(0, maxLossValue - projectedRiskValue),
      projectedRiskValue,
      maxLossValue,
      initialRiskFraction,
    });
    if (scaleInEnabled) {
      executionState.update((draft) => {
        draft.cycle = {
          direction: signal.direction,
          stopLossPrice,
          targetR,
          entriesFilled: 0,
          pending: {
            timestamp: candle.timestamp,
            observedQty: 0,
            level: 1,
          },
        };
      });
    }
    lastTradeController.markTrade(timestamp);

    return strategyApi.entry({
      code:
        signal.direction === 'LONG'
          ? 'LIQUIDITY_TAILS_BUY_PRESSURE_RETEST'
          : 'LIQUIDITY_TAILS_SELL_PRESSURE_RETEST',
      direction: modeConfig.direction,
      indicators,
      additionalIndicators: {
        liquidityTailsContext: buildLiquidityTailsSignalContext(
          {
            ...signal,
            close: currentPrice,
          },
          executionContext,
        ),
      },
      figures: buildLiquidityTailsFigures({
        signal,
        zones: runtimeState.zones,
        entryTimestamp: timestamp,
        entryPrice: currentPrice,
        stopLossPrice,
        takeProfitPrice,
        maxZones: Math.max(
          1,
          Number(config.LIQUIDITY_TAILS_MAX_FIGURE_ZONES ?? 24),
        ),
      }),
      orderPlan: {
        qty,
        stopLossPrice,
        takeProfits: [{ rate: 1, price: takeProfitPrice }],
      },
    });
  };
};
