import type {
  CreateStrategyCore,
  Direction,
  IndicatorsHistorySnapshot,
  Position,
} from '@tradejs/types';
import type { CausalRangeGeometry } from '../shared/causalRangeGeometry';
import type { GridClassicConfig } from './config';
import {
  buildGridClassicDetectorKey,
  buildGridClassicSignalContext,
  createGridClassicEngine,
  type GridClassicSnapshot,
} from './engine';
import {
  buildGridClassicFigures,
  type GridClassicExecutedLevel,
} from './figures';
import {
  buildGridClassicGridPlan,
  calculateGridClassicPositionLoss,
  calculateGridClassicUnitLoss,
  type GridClassicGridPlan,
} from './guardrails';

interface PendingGridClassicEntry {
  kind: 'open' | 'increase';
  timestamp: number;
  observedQty: number;
  requestedQty: number;
  price: number;
  level: number;
}

interface GridClassicCycle {
  direction: Direction;
  geometry: CausalRangeGeometry;
  plan: GridClassicGridPlan;
  filledLevels: number;
  executedLevels: GridClassicExecutedLevel[];
  openedTimestamp: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  additionsStopped: boolean;
  recovered: boolean;
  adverseBreakoutBars: number;
  invalidRangeBars: number;
  holdBars: number;
  lastProcessedTimestamp: number | null;
  pending: PendingGridClassicEntry | null;
  exitCode: string | null;
}

interface GridClassicExecutionState {
  cycle: GridClassicCycle | null;
  cooldownUntil: number | null;
}

const finiteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isOpenPosition = (position: Position | null): position is Position =>
  Boolean(
    position &&
      finiteNumber(position.price) != null &&
      finiteNumber(position.qty) != null &&
      position.qty > 0 &&
      (position.direction === 'LONG' || position.direction === 'SHORT'),
  );

const isDirectionalStop = (
  direction: Direction,
  stopLossPrice: number,
  referencePrice: number,
) =>
  direction === 'LONG'
    ? stopLossPrice < referencePrice
    : stopLossPrice > referencePrice;

const isDirectionalTarget = (
  direction: Direction,
  targetPrice: number,
  referencePrice: number,
) =>
  direction === 'LONG'
    ? targetPrice > referencePrice
    : targetPrice < referencePrice;

const intervalMs = (interval: unknown) => {
  const minutes = Number(interval);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 15) * 60_000;
};

const cloneGeometry = (geometry: CausalRangeGeometry): CausalRangeGeometry => ({
  ...geometry,
  pivots: geometry.pivots.map((pivot) => ({ ...pivot })),
  upperLine: geometry.upperLine ? { ...geometry.upperLine } : null,
  lowerLine: geometry.lowerLine ? { ...geometry.lowerLine } : null,
  centerLine: geometry.centerLine ? { ...geometry.centerLine } : null,
});

const getRiskRates = (config: GridClassicConfig) => {
  const configuredSlippageBps = Math.max(
    0,
    Number(config.GRIDCLASSIC_RISK_SLIPPAGE_BPS ?? 0),
  );
  const executionModelBps =
    Math.max(0, Number(config.SLIPPAGE_BASE_BPS ?? 0)) +
    Math.max(0, Number(config.SLIPPAGE_MARKET_IMPACT_BPS ?? 0));
  return {
    feeRate: Math.max(0, Number(config.FEE_PERCENT ?? 0)),
    slippageRate: Math.max(configuredSlippageBps, executionModelBps) / 10_000,
  };
};

const buildExecutionStateKey = (config: GridClassicConfig) =>
  JSON.stringify({
    detector: buildGridClassicDetectorKey(config),
    maxLossValue: config.MAX_LOSS_VALUE,
    levels: config.GRIDCLASSIC_LEVELS,
    stepAtr: config.GRIDCLASSIC_GRID_STEP_ATR,
    stepRangeFraction: config.GRIDCLASSIC_GRID_STEP_RANGE_FRACTION,
    levelSizeDecay: config.GRIDCLASSIC_LEVEL_SIZE_DECAY,
    stopAtrBuffer: config.GRIDCLASSIC_STOP_ATR_BUFFER,
    takeProfitMode: config.GRIDCLASSIC_TP_MODE,
    breakoutConfirmBars: config.GRIDCLASSIC_BREAKOUT_CONFIRM_BARS,
    invalidationBars: config.GRIDCLASSIC_INVALIDATION_BARS,
    maxHoldBars: config.GRIDCLASSIC_MAX_HOLD_BARS,
    cooldownBars: config.GRIDCLASSIC_COOLDOWN_BARS,
    ...getRiskRates(config),
  });

const freezeCycle = ({
  direction,
  snapshot,
  plan,
  timestamp,
}: {
  direction: Direction;
  snapshot: GridClassicSnapshot;
  plan: GridClassicGridPlan;
  timestamp: number;
}): GridClassicCycle => ({
  direction,
  geometry: cloneGeometry(snapshot.geometry),
  plan: {
    ...plan,
    levels: plan.levels.map((level) => ({ ...level })),
  },
  filledLevels: 0,
  executedLevels: [],
  openedTimestamp: timestamp,
  stopLossPrice: plan.stopLossPrice,
  takeProfitPrice: plan.takeProfitPrice,
  additionsStopped: false,
  recovered: false,
  adverseBreakoutBars: 0,
  invalidRangeBars: 0,
  holdBars: 0,
  lastProcessedTimestamp: null,
  pending: null,
  exitCode: null,
});

const recoverCycle = ({
  position,
  snapshot,
  config,
}: {
  position: Position;
  snapshot: GridClassicSnapshot;
  config: GridClassicConfig;
}): GridClassicCycle => {
  const reportedStop = finiteNumber(position.slPrice);
  const fallbackStop =
    position.direction === 'LONG'
      ? (snapshot.geometry.lowerPrice ?? position.price - snapshot.atr) -
        snapshot.atr * Math.max(0, Number(config.GRIDCLASSIC_STOP_ATR_BUFFER))
      : (snapshot.geometry.upperPrice ?? position.price + snapshot.atr) +
        snapshot.atr * Math.max(0, Number(config.GRIDCLASSIC_STOP_ATR_BUFFER));
  const stopLossPrice =
    reportedStop != null &&
    isDirectionalStop(position.direction, reportedStop, position.price)
      ? reportedStop
      : fallbackStop;
  const reportedTarget = finiteNumber(position.tpPrice);
  const fallbackTarget =
    snapshot.geometry.centerPrice != null &&
    isDirectionalTarget(
      position.direction,
      snapshot.geometry.centerPrice,
      position.price,
    )
      ? snapshot.geometry.centerPrice
      : position.direction === 'LONG'
        ? position.price + snapshot.atr
        : position.price - snapshot.atr;
  const takeProfitPrice =
    reportedTarget != null &&
    isDirectionalTarget(position.direction, reportedTarget, position.price)
      ? reportedTarget
      : fallbackTarget;
  const { feeRate, slippageRate } = getRiskRates(config);
  const level = {
    level: 1,
    price: position.price,
    qty: position.qty,
    worstCaseLoss: calculateGridClassicPositionLoss({
      qty: position.qty,
      averagePrice: position.price,
      stopLossPrice,
      feeRate,
      slippageRate,
    }),
  };

  return {
    direction: position.direction,
    geometry: cloneGeometry(snapshot.geometry),
    plan: {
      stopLossPrice,
      takeProfitPrice,
      stepDistance: snapshot.atr,
      levels: [level],
      worstCaseLoss: level.worstCaseLoss,
    },
    filledLevels: 1,
    executedLevels: [
      {
        level: 1,
        timestamp: snapshot.timestamp,
        price: position.price,
        qty: position.qty,
      },
    ],
    openedTimestamp: snapshot.timestamp,
    stopLossPrice,
    takeProfitPrice,
    additionsStopped: true,
    recovered: true,
    adverseBreakoutBars: 0,
    invalidRangeBars: 0,
    holdBars: 0,
    lastProcessedTimestamp: null,
    pending: null,
    exitCode: null,
  };
};

const getFrozenSnapshot = (
  snapshot: GridClassicSnapshot,
  cycle: GridClassicCycle,
): GridClassicSnapshot => ({
  ...snapshot,
  geometry: cycle.geometry,
});

const getExitCooldownTimestamp = ({
  candleTimestamp,
  code,
  cooldownMs,
}: {
  candleTimestamp: number;
  code: string | null;
  cooldownMs: number;
}) =>
  code != null &&
  (code.includes('STOP') || code.includes('BREAKOUT')) &&
  cooldownMs > 0
    ? candleTimestamp + cooldownMs
    : null;

export const createGridClassicCore: CreateStrategyCore<
  GridClassicConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({ config, data: initialData, strategyApi }) => {
  const detectorState = strategyApi.createStateController<
    { engine: ReturnType<typeof createGridClassicEngine> },
    ReturnType<ReturnType<typeof createGridClassicEngine>['next']>,
    ReturnType<ReturnType<typeof createGridClassicEngine>['getState']>
  >(
    'GridClassicDetector',
    () => ({
      engine: createGridClassicEngine({ config, initialCandles: initialData }),
    }),
    {
      configKey: buildGridClassicDetectorKey(config),
      snapshot: (state) => state.engine.getState(),
    },
  );
  const executionState = strategyApi.createStateController<
    GridClassicExecutionState,
    GridClassicExecutionState,
    GridClassicExecutionState
  >('GridClassicExecution', () => ({ cycle: null, cooldownUntil: null }), {
    configKey: buildExecutionStateKey(config),
  });
  const nextDetectorState = (
    candle: Parameters<ReturnType<typeof createGridClassicEngine>['next']>[0],
  ) =>
    detectorState.oncePerTimestamp(candle.timestamp, (state) =>
      state.engine.next(candle),
    );

  const maxLossValue = Math.max(0, Number(config.MAX_LOSS_VALUE ?? 0));
  const levels = Math.max(
    1,
    Math.floor(Number(config.GRIDCLASSIC_LEVELS ?? 1)),
  );
  const breakoutConfirmBars = Math.max(
    1,
    Math.floor(Number(config.GRIDCLASSIC_BREAKOUT_CONFIRM_BARS ?? 1)),
  );
  const invalidationBars = Math.max(
    1,
    Math.floor(Number(config.GRIDCLASSIC_INVALIDATION_BARS ?? 1)),
  );
  const maxHoldBars = Math.max(
    1,
    Math.floor(Number(config.GRIDCLASSIC_MAX_HOLD_BARS ?? 1)),
  );
  const cooldownMs =
    Math.max(0, Number(config.GRIDCLASSIC_COOLDOWN_BARS ?? 0)) *
    intervalMs(config.INTERVAL);
  const edgeZoneFraction = Math.min(
    0.45,
    Math.max(0.01, Number(config.GRIDCLASSIC_EDGE_ZONE_FRACTION ?? 0.22)),
  );
  const { feeRate, slippageRate } = getRiskRates(config);

  return async (candle) => {
    const runtimeState = nextDetectorState(candle);
    const snapshot = runtimeState.snapshot;
    if (!snapshot) return strategyApi.skip('GRIDCLASSIC_WARMUP');

    const position = await strategyApi.getCurrentPosition();
    let state = executionState.get();

    if (isOpenPosition(position)) {
      if (!state.cycle || state.cycle.direction !== position.direction) {
        executionState.update((draft) => {
          draft.cycle = recoverCycle({ position, snapshot, config });
        });
      } else if (state.cycle.pending) {
        const pending = state.cycle.pending;
        if (position.qty > pending.observedQty + Number.EPSILON) {
          executionState.update((draft) => {
            if (!draft.cycle) return;
            const actualQty = Math.min(
              pending.requestedQty,
              position.qty - pending.observedQty,
            );
            draft.cycle.filledLevels = Math.max(
              draft.cycle.filledLevels,
              pending.level,
            );
            draft.cycle.executedLevels.push({
              level: pending.level,
              timestamp: pending.timestamp,
              price: pending.price,
              qty: actualQty,
            });
            draft.cycle.pending = null;
          });
        } else if (candle.timestamp > pending.timestamp) {
          executionState.update((draft) => {
            if (draft.cycle) draft.cycle.pending = null;
          });
        }
      }
    } else if (state.cycle) {
      const pendingOnCurrentBar =
        state.cycle.pending?.timestamp === candle.timestamp;
      if (pendingOnCurrentBar) {
        return strategyApi.skip('GRIDCLASSIC_ORDER_PENDING');
      }
      executionState.update((draft) => {
        if (!draft.cycle) return;
        draft.cooldownUntil = getExitCooldownTimestamp({
          candleTimestamp: candle.timestamp,
          code:
            draft.cycle.exitCode ??
            (draft.cycle.direction === 'LONG'
              ? snapshot.close <= draft.cycle.stopLossPrice
                ? 'GRIDCLASSIC_STOP_EXIT'
                : null
              : snapshot.close >= draft.cycle.stopLossPrice
                ? 'GRIDCLASSIC_STOP_EXIT'
                : null),
          cooldownMs,
        });
        draft.cycle = null;
      });
    }

    state = executionState.get();
    if (isOpenPosition(position)) {
      const cycle = state.cycle;
      if (!cycle) return strategyApi.skip('GRIDCLASSIC_RECOVERY_FAILED');
      if (cycle.pending) {
        return strategyApi.skip('GRIDCLASSIC_ORDER_PENDING');
      }

      const reportedStop = finiteNumber(position.slPrice);
      if (
        reportedStop != null &&
        isDirectionalStop(cycle.direction, reportedStop, position.price)
      ) {
        const tighterStop =
          cycle.direction === 'LONG'
            ? Math.max(cycle.stopLossPrice, reportedStop)
            : Math.min(cycle.stopLossPrice, reportedStop);
        if (tighterStop !== cycle.stopLossPrice) {
          executionState.update((draft) => {
            if (draft.cycle) draft.cycle.stopLossPrice = tighterStop;
          });
        }
      }

      if (cycle.lastProcessedTimestamp !== candle.timestamp) {
        const breakoutBuffer =
          snapshot.atr *
          Math.max(0, Number(config.GRIDCLASSIC_BREAKOUT_TOLERANCE_ATR ?? 0));
        const adverseBreakout =
          cycle.direction === 'LONG'
            ? snapshot.close <
              (cycle.geometry.lowerPrice ?? cycle.stopLossPrice) -
                breakoutBuffer
            : snapshot.close >
              (cycle.geometry.upperPrice ?? cycle.stopLossPrice) +
                breakoutBuffer;
        executionState.update((draft) => {
          if (!draft.cycle) return;
          draft.cycle.lastProcessedTimestamp = candle.timestamp;
          draft.cycle.holdBars += 1;
          draft.cycle.adverseBreakoutBars = adverseBreakout
            ? draft.cycle.adverseBreakoutBars + 1
            : 0;
          draft.cycle.invalidRangeBars = snapshot.geometry.detected
            ? 0
            : draft.cycle.invalidRangeBars + 1;
          if (
            adverseBreakout ||
            !snapshot.geometry.detected ||
            snapshot.volatilityShock
          ) {
            draft.cycle.additionsStopped = true;
          }
        });
      }

      const currentCycle = executionState.get().cycle;
      if (!currentCycle) {
        return strategyApi.skip('GRIDCLASSIC_CYCLE_MISSING');
      }
      const stopBreached =
        currentCycle.direction === 'LONG'
          ? snapshot.close <= currentCycle.stopLossPrice
          : snapshot.close >= currentCycle.stopLossPrice;
      if (stopBreached) {
        executionState.update((draft) => {
          if (draft.cycle) draft.cycle.exitCode = 'GRIDCLASSIC_STOP_EXIT';
        });
        return strategyApi.exit({
          code: 'GRIDCLASSIC_STOP_EXIT',
          direction: currentCycle.direction,
        });
      }
      if (currentCycle.adverseBreakoutBars >= breakoutConfirmBars) {
        executionState.update((draft) => {
          if (draft.cycle) draft.cycle.exitCode = 'GRIDCLASSIC_BREAKOUT_EXIT';
        });
        return strategyApi.exit({
          code: 'GRIDCLASSIC_BREAKOUT_EXIT',
          direction: currentCycle.direction,
        });
      }
      if (snapshot.volatilityShock) {
        executionState.update((draft) => {
          if (draft.cycle) {
            draft.cycle.exitCode = 'GRIDCLASSIC_VOLATILITY_SHOCK_EXIT';
          }
        });
        return strategyApi.exit({
          code: 'GRIDCLASSIC_VOLATILITY_SHOCK_EXIT',
          direction: currentCycle.direction,
        });
      }
      if (currentCycle.invalidRangeBars >= invalidationBars) {
        executionState.update((draft) => {
          if (draft.cycle) {
            draft.cycle.exitCode = 'GRIDCLASSIC_RANGE_INVALID_EXIT';
          }
        });
        return strategyApi.exit({
          code: 'GRIDCLASSIC_RANGE_INVALID_EXIT',
          direction: currentCycle.direction,
        });
      }
      if (currentCycle.holdBars >= maxHoldBars) {
        executionState.update((draft) => {
          if (draft.cycle) draft.cycle.exitCode = 'GRIDCLASSIC_MAX_HOLD_EXIT';
        });
        return strategyApi.exit({
          code: 'GRIDCLASSIC_MAX_HOLD_EXIT',
          direction: currentCycle.direction,
        });
      }

      const targetReached =
        currentCycle.direction === 'LONG'
          ? snapshot.close >= currentCycle.takeProfitPrice
          : snapshot.close <= currentCycle.takeProfitPrice;
      if (targetReached) {
        const targetCode =
          config.GRIDCLASSIC_TP_MODE === 'opposite_edge'
            ? 'GRIDCLASSIC_OPPOSITE_EDGE_TP_EXIT'
            : 'GRIDCLASSIC_CENTER_TP_EXIT';
        executionState.update((draft) => {
          if (draft.cycle) draft.cycle.exitCode = targetCode;
        });
        return strategyApi.exit({
          code: targetCode,
          direction: currentCycle.direction,
        });
      }

      const nextLevel = currentCycle.plan.levels[currentCycle.filledLevels];
      const nextLevelReached =
        nextLevel != null &&
        (currentCycle.direction === 'LONG'
          ? snapshot.close <= nextLevel.price
          : snapshot.close >= nextLevel.price);
      if (
        nextLevel &&
        nextLevelReached &&
        !currentCycle.additionsStopped &&
        !currentCycle.recovered
      ) {
        const { currentPrice } = await strategyApi.getDecisionPriceContext();
        if (
          !isDirectionalStop(
            currentCycle.direction,
            currentCycle.stopLossPrice,
            currentPrice,
          )
        ) {
          executionState.update((draft) => {
            if (draft.cycle) {
              draft.cycle.additionsStopped = true;
              draft.cycle.exitCode = 'GRIDCLASSIC_STOP_EXIT';
            }
          });
          return strategyApi.exit({
            code: 'GRIDCLASSIC_STOP_EXIT',
            direction: currentCycle.direction,
          });
        }

        const lastExecuted =
          currentCycle.executedLevels[currentCycle.executedLevels.length - 1];
        const existingRisk = calculateGridClassicPositionLoss({
          qty: position.qty,
          averagePrice: position.price,
          stopLossPrice: currentCycle.stopLossPrice,
          feeRate,
          slippageRate,
        });
        const remainingRisk = Math.max(0, maxLossValue - existingRisk);
        const nextUnitLoss = calculateGridClassicUnitLoss({
          entryPrice: currentPrice,
          stopLossPrice: currentCycle.stopLossPrice,
          feeRate,
          slippageRate,
        });
        const riskBudgetQty =
          nextUnitLoss > 0 ? remainingRisk / nextUnitLoss : 0;
        const quantityCap = lastExecuted?.qty ?? nextLevel.qty;
        const notionalCap =
          lastExecuted && currentPrice > 0
            ? (lastExecuted.qty * lastExecuted.price) / currentPrice
            : nextLevel.qty;
        const previousLevelRisk =
          lastExecuted == null
            ? Number.POSITIVE_INFINITY
            : lastExecuted.qty *
              calculateGridClassicUnitLoss({
                entryPrice: lastExecuted.price,
                stopLossPrice: currentCycle.stopLossPrice,
                feeRate,
                slippageRate,
              });
        const levelRiskCap =
          nextUnitLoss > 0
            ? previousLevelRisk / nextUnitLoss
            : Number.POSITIVE_INFINITY;
        const qty = Math.min(
          nextLevel.qty,
          quantityCap,
          notionalCap,
          levelRiskCap,
          riskBudgetQty,
        );
        if (!Number.isFinite(qty) || qty <= Number.EPSILON) {
          return strategyApi.skip('GRIDCLASSIC_RISK_BUDGET_EXHAUSTED');
        }

        executionState.update((draft) => {
          if (!draft.cycle) return;
          draft.cycle.pending = {
            kind: 'increase',
            timestamp: candle.timestamp,
            observedQty: position.qty,
            requestedQty: qty,
            price: currentPrice,
            level: nextLevel.level,
          };
        });
        const { indicators } = strategyApi.getCurrentIndicatorsContext();
        const frozenSnapshot = getFrozenSnapshot(snapshot, currentCycle);
        return strategyApi.entry({
          code: `GRIDCLASSIC_SCALE_IN_${nextLevel.level}`,
          direction: currentCycle.direction,
          indicators,
          additionalIndicators: {
            gridClassicContext: buildGridClassicSignalContext({
              snapshot: frozenSnapshot,
              direction: currentCycle.direction,
              gridLevel: nextLevel.level,
              filledLevels: currentCycle.filledLevels,
              remainingLevels:
                currentCycle.plan.levels.length - nextLevel.level,
              stopLossPrice: currentCycle.stopLossPrice,
            }),
          },
          figures: buildGridClassicFigures({
            direction: currentCycle.direction,
            geometry: currentCycle.geometry,
            entryTimestamp: currentCycle.openedTimestamp,
            entryPrice: currentCycle.executedLevels[0]?.price ?? position.price,
            plannedLevels: currentCycle.plan.levels,
            executedLevels: currentCycle.executedLevels,
            stopLossPrice: currentCycle.stopLossPrice,
            takeProfitPrice: currentCycle.takeProfitPrice,
            edgeZoneFraction,
          }),
          orderPlan: {
            qty,
            stopLossPrice: currentCycle.stopLossPrice,
            takeProfits: [{ rate: 1, price: currentCycle.takeProfitPrice }],
            positionIntent: 'increase',
          },
        });
      }

      const reportedTarget = finiteNumber(position.tpPrice);
      const repriceThreshold =
        snapshot.atr *
        Math.max(0, Number(config.GRIDCLASSIC_PROTECTION_REPRICE_ATR ?? 0.15));
      const protectionMissingOrStale =
        reportedStop == null ||
        reportedTarget == null ||
        Math.abs(reportedStop - currentCycle.stopLossPrice) >
          repriceThreshold ||
        Math.abs(reportedTarget - currentCycle.takeProfitPrice) >
          repriceThreshold;
      if (protectionMissingOrStale) {
        return strategyApi.protect({
          code: 'GRIDCLASSIC_REFRESH_PROTECTION',
          protectPlan: {
            direction: currentCycle.direction,
            stopLossPrice: currentCycle.stopLossPrice,
            takeProfits: [{ rate: 1, price: currentCycle.takeProfitPrice }],
          },
        });
      }
      if (currentCycle.additionsStopped) {
        return strategyApi.skip('GRIDCLASSIC_ADDITIONS_STOPPED');
      }
      return strategyApi.skip('GRIDCLASSIC_WAIT_NEXT_LEVEL');
    }

    if (
      state.cooldownUntil != null &&
      candle.timestamp <= state.cooldownUntil
    ) {
      return strategyApi.skip('GRIDCLASSIC_COOLDOWN');
    }
    if (!snapshot.geometry.ready) {
      return strategyApi.skip('GRIDCLASSIC_RANGE_NOT_READY');
    }
    if (!snapshot.geometry.detected) {
      return strategyApi.skip('GRIDCLASSIC_RANGE_NOT_DETECTED');
    }
    if (!snapshot.entryDirection) {
      return strategyApi.skip('GRIDCLASSIC_NO_EDGE_CONFIRMATION');
    }
    if (snapshot.volatilityShock) {
      return strategyApi.skip('GRIDCLASSIC_VOLATILITY_SHOCK');
    }
    if (maxLossValue <= 0) {
      return strategyApi.skip('GRIDCLASSIC_INVALID_MAX_LOSS_VALUE');
    }

    const direction = snapshot.entryDirection;
    const sideConfig = direction === 'LONG' ? config.LONG : config.SHORT;
    if (!sideConfig.enable) return strategyApi.skip('STRATEGY_DISABLED');
    const lowerPrice = snapshot.geometry.lowerPrice;
    const upperPrice = snapshot.geometry.upperPrice;
    if (lowerPrice == null || upperPrice == null) {
      return strategyApi.skip('GRIDCLASSIC_INVALID_GEOMETRY');
    }

    const { timestamp, currentPrice } =
      await strategyApi.getDecisionPriceContext();
    const currentPosition =
      (currentPrice - lowerPrice) / (upperPrice - lowerPrice);
    const stillNearEdge =
      direction === 'LONG'
        ? currentPosition >=
            -Number(config.GRIDCLASSIC_BREAKOUT_TOLERANCE_ATR) /
              Math.max(snapshot.geometry.widthAtr ?? 1, Number.EPSILON) &&
          currentPosition <= edgeZoneFraction
        : currentPosition <=
            1 +
              Number(config.GRIDCLASSIC_BREAKOUT_TOLERANCE_ATR) /
                Math.max(snapshot.geometry.widthAtr ?? 1, Number.EPSILON) &&
          currentPosition >= 1 - edgeZoneFraction;
    if (!stillNearEdge) {
      return strategyApi.skip('GRIDCLASSIC_ENTRY_GAP_OUTSIDE_EDGE');
    }

    const plan = buildGridClassicGridPlan({
      direction,
      entryPrice: currentPrice,
      lowerPrice,
      upperPrice,
      atr: snapshot.atr,
      levels,
      stepAtr: Number(config.GRIDCLASSIC_GRID_STEP_ATR),
      stepRangeFraction: Number(config.GRIDCLASSIC_GRID_STEP_RANGE_FRACTION),
      levelSizeDecay: Number(config.GRIDCLASSIC_LEVEL_SIZE_DECAY),
      stopAtrBuffer: Number(config.GRIDCLASSIC_STOP_ATR_BUFFER),
      takeProfitMode: config.GRIDCLASSIC_TP_MODE,
      maxLossValue,
      feeRate,
      slippageRate,
    });
    const firstLevel = plan?.levels[0];
    if (!plan || !firstLevel || firstLevel.qty <= Number.EPSILON) {
      return strategyApi.skip('GRIDCLASSIC_INVALID_GRID_PLAN');
    }

    const cycle = freezeCycle({ direction, snapshot, plan, timestamp });
    cycle.pending = {
      kind: 'open',
      timestamp: candle.timestamp,
      observedQty: 0,
      requestedQty: firstLevel.qty,
      price: currentPrice,
      level: 1,
    };
    executionState.update((draft) => {
      draft.cycle = cycle;
      draft.cooldownUntil = null;
    });
    const { indicators } = strategyApi.getCurrentIndicatorsContext();

    return strategyApi.entry({
      code:
        direction === 'LONG'
          ? 'GRIDCLASSIC_LOWER_EDGE_LONG'
          : 'GRIDCLASSIC_UPPER_EDGE_SHORT',
      direction: sideConfig.direction,
      indicators,
      additionalIndicators: {
        gridClassicContext: buildGridClassicSignalContext({
          snapshot,
          direction,
          gridLevel: 1,
          filledLevels: 0,
          remainingLevels: plan.levels.length - 1,
          stopLossPrice: plan.stopLossPrice,
        }),
      },
      figures: buildGridClassicFigures({
        direction,
        geometry: snapshot.geometry,
        entryTimestamp: timestamp,
        entryPrice: currentPrice,
        plannedLevels: plan.levels,
        executedLevels: [],
        stopLossPrice: plan.stopLossPrice,
        takeProfitPrice: plan.takeProfitPrice,
        edgeZoneFraction,
      }),
      orderPlan: {
        qty: firstLevel.qty,
        stopLossPrice: plan.stopLossPrice,
        takeProfits: [{ rate: 1, price: plan.takeProfitPrice }],
      },
    });
  };
};
