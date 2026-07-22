import type {
  CreateStrategyCore,
  Direction,
  IndicatorsHistorySnapshot,
  Position,
} from '@tradejs/types';
import { GridConfig } from './config';
import {
  buildGridDetectorKey,
  buildGridSignalContext,
  createGridEngine,
  GridSnapshot,
} from './engine';
import { buildGridFigures } from './figures';

interface PendingGridEntry {
  kind: 'open' | 'increase';
  timestamp: number;
  observedQty: number;
  requestedQty: number;
  price: number;
}

interface GridCycle {
  direction: Direction;
  anchorPrice: number;
  stopLossPrice: number;
  levelQty: number;
  levelsFilled: number;
  lastEntryPrice: number;
  pending: PendingGridEntry | null;
}

interface GridExecutionState {
  cycle: GridCycle | null;
  lastClosedTimestamp: number | null;
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

const getPositionStopLoss = (position: Position) =>
  finiteNumber(position.slPrice);

const getPositionTakeProfit = (position: Position) =>
  finiteNumber(position.tpPrice);

const getDirectionalPrice = (
  direction: Direction,
  anchor: number,
  distance: number,
  kind: 'stop' | 'target',
) => {
  const sign = direction === 'LONG' ? 1 : -1;
  return kind === 'target'
    ? anchor + sign * distance
    : anchor - sign * distance;
};

const calculateLevelQty = ({
  maxLossValue,
  maxLevels,
  entryPrice,
  stopLossPrice,
  feeRate,
}: {
  maxLossValue: number;
  maxLevels: number;
  entryPrice: number;
  stopLossPrice: number;
  feeRate: number;
}) => {
  const riskBudget = maxLossValue / Math.max(1, maxLevels);
  const lossPerUnit =
    Math.abs(entryPrice - stopLossPrice) +
    Math.abs(entryPrice) * feeRate +
    Math.abs(stopLossPrice) * feeRate;
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
  (Math.abs(entryPrice - stopLossPrice) + Math.abs(stopLossPrice) * feeRate);

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

const getIntervalMs = (interval: unknown) => {
  const minutes = Number(interval);
  return Number.isFinite(minutes) && minutes > 0
    ? minutes * 60_000
    : 15 * 60_000;
};

const isDirectionalStopValid = (
  direction: Direction,
  stopLossPrice: number,
  referencePrice: number,
) =>
  direction === 'LONG'
    ? stopLossPrice < referencePrice
    : stopLossPrice > referencePrice;

const buildExecutionStateKey = (config: GridConfig) =>
  JSON.stringify({
    detector: buildGridDetectorKey(config),
    maxLossValue: config.MAX_LOSS_VALUE,
    maxLevels: config.GRID_MAX_LEVELS,
    feePercent: config.FEE_PERCENT,
  });

const buildRecoveredCycle = ({
  position,
  snapshot,
  maxLossValue,
  maxLevels,
  feeRate,
}: {
  position: Position;
  snapshot: GridSnapshot;
  maxLossValue: number;
  maxLevels: number;
  feeRate: number;
}): GridCycle => {
  const reportedStop = getPositionStopLoss(position);
  const stopLossPrice =
    reportedStop != null &&
    isDirectionalStopValid(position.direction, reportedStop, position.price)
      ? reportedStop
      : getDirectionalPrice(
          position.direction,
          position.price,
          snapshot.stopDistance,
          'stop',
        );
  const calculatedLevelQty = calculateLevelQty({
    maxLossValue,
    maxLevels,
    entryPrice: position.price,
    stopLossPrice,
    feeRate,
  });
  const levelQty = Math.max(
    Number.EPSILON,
    Math.min(position.qty, calculatedLevelQty || position.qty),
  );

  return {
    direction: position.direction,
    anchorPrice: position.price,
    stopLossPrice,
    levelQty,
    levelsFilled: Math.min(
      maxLevels,
      Math.max(1, Math.round(position.qty / levelQty)),
    ),
    lastEntryPrice: position.price,
    pending: null,
  };
};

export const createGridCore: CreateStrategyCore<
  GridConfig,
  IndicatorsHistorySnapshot | undefined
> = async ({ config, data: initialData, strategyApi }) => {
  const detectorState = strategyApi.createStateController<
    { engine: ReturnType<typeof createGridEngine> },
    ReturnType<ReturnType<typeof createGridEngine>['next']>,
    ReturnType<ReturnType<typeof createGridEngine>['getState']>
  >(
    'GridDetector',
    () => ({
      engine: createGridEngine({ config, initialCandles: initialData }),
    }),
    {
      configKey: buildGridDetectorKey(config),
      snapshot: (state) => state.engine.getState(),
    },
  );
  const executionState = strategyApi.createStateController<
    GridExecutionState,
    GridExecutionState,
    GridExecutionState
  >('GridExecution', () => ({ cycle: null, lastClosedTimestamp: null }), {
    configKey: buildExecutionStateKey(config),
  });
  const nextDetectorState = (
    candle: Parameters<ReturnType<typeof createGridEngine>['next']>[0],
  ) =>
    detectorState.oncePerTimestamp(candle.timestamp, (state) =>
      state.engine.next(candle),
    );

  const maxLevels = Math.max(
    1,
    Math.floor(Number(config.GRID_MAX_LEVELS ?? 4)),
  );
  const maxLossValue = Math.max(0, Number(config.MAX_LOSS_VALUE ?? 0));
  const feeRate = Math.max(0, Number(config.FEE_PERCENT ?? 0));
  const cooldownMs =
    Math.max(0, Number(config.GRID_ENTRY_COOLDOWN_BARS ?? 0)) *
    getIntervalMs(config.INTERVAL);

  return async (candle) => {
    const runtimeState = nextDetectorState(candle);
    const snapshot = runtimeState.snapshot;
    if (!snapshot) {
      return strategyApi.skip('GRID_WARMUP');
    }

    const position = await strategyApi.getCurrentPosition();
    let state = executionState.get();

    if (isOpenPosition(position)) {
      if (!state.cycle || state.cycle.direction !== position.direction) {
        executionState.update((draft) => {
          draft.cycle = buildRecoveredCycle({
            position,
            snapshot,
            maxLossValue,
            maxLevels,
            feeRate,
          });
        });
      } else if (state.cycle.pending) {
        const pending = state.cycle.pending;
        const increaseConfirmed =
          position.qty > pending.observedQty + Number.EPSILON;
        if (increaseConfirmed) {
          executionState.update((draft) => {
            if (!draft.cycle) return;
            draft.cycle.levelsFilled = Math.min(
              maxLevels,
              pending.kind === 'open' ? 1 : draft.cycle.levelsFilled + 1,
            );
            draft.cycle.lastEntryPrice = pending.price;
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
        return strategyApi.skip('GRID_ORDER_PENDING');
      }
      executionState.update((draft) => {
        if ((draft.cycle?.levelsFilled ?? 0) > 0) {
          draft.lastClosedTimestamp = candle.timestamp;
        }
        draft.cycle = null;
      });
    }

    state = executionState.get();

    if (isOpenPosition(position)) {
      const cycle = state.cycle;
      if (!cycle) {
        return strategyApi.skip('GRID_CYCLE_RECOVERY_FAILED');
      }
      if (cycle.pending) {
        return strategyApi.skip('GRID_ORDER_PENDING');
      }

      const direction = position.direction;
      const stopLossPrice = cycle.stopLossPrice;
      const stopBreached =
        direction === 'LONG'
          ? snapshot.close <= stopLossPrice
          : snapshot.close >= stopLossPrice;
      if (stopBreached) {
        return strategyApi.exit({
          code: 'GRID_HARD_STOP_EXIT',
          direction,
        });
      }

      const oppositeRegime =
        snapshot.regimeDirection != null &&
        snapshot.regimeDirection !== direction;
      if (Boolean(config.GRID_EXIT_ON_REGIME_FLIP) && oppositeRegime) {
        return strategyApi.exit({
          code: 'GRID_REGIME_FLIP_EXIT',
          direction,
        });
      }
      if (
        Boolean(config.GRID_EXIT_ON_VOLATILITY_SHOCK) &&
        snapshot.volatilityShock
      ) {
        return strategyApi.exit({
          code: 'GRID_VOLATILITY_SHOCK_EXIT',
          direction,
        });
      }

      const targetPrice = getDirectionalPrice(
        direction,
        position.price,
        snapshot.takeProfitDistance,
        'target',
      );
      const adverseLevelReached =
        direction === 'LONG'
          ? snapshot.close <= cycle.lastEntryPrice - snapshot.stepDistance
          : snapshot.close >= cycle.lastEntryPrice + snapshot.stepDistance;
      const canIncrease =
        adverseLevelReached &&
        cycle.levelsFilled < maxLevels &&
        snapshot.regimeDirection === direction;

      if (canIncrease) {
        const existingRisk = calculateWorstCaseLoss({
          qty: position.qty,
          entryPrice: position.price,
          stopLossPrice,
          feeRate,
        });
        const remainingRisk = Math.max(0, maxLossValue - existingRisk);
        const nextUnitRisk =
          Math.abs(snapshot.close - stopLossPrice) +
          Math.abs(snapshot.close) * feeRate +
          Math.abs(stopLossPrice) * feeRate;
        const riskLimitedQty =
          nextUnitRisk > 0 ? remainingRisk / nextUnitRisk : 0;
        const qty = Math.min(cycle.levelQty, riskLimitedQty);
        if (!Number.isFinite(qty) || qty <= Number.EPSILON) {
          return strategyApi.skip('GRID_RISK_BUDGET_EXHAUSTED');
        }

        const projectedAveragePrice = getProjectedAverage({
          position,
          entryPrice: snapshot.close,
          entryQty: qty,
        });
        const projectedQty = position.qty + qty;
        const projectedTargetPrice = getDirectionalPrice(
          direction,
          projectedAveragePrice,
          snapshot.takeProfitDistance,
          'target',
        );
        const level = cycle.levelsFilled + 1;
        executionState.update((draft) => {
          if (!draft.cycle) return;
          draft.cycle.pending = {
            kind: 'increase',
            timestamp: candle.timestamp,
            observedQty: position.qty,
            requestedQty: qty,
            price: snapshot.close,
          };
        });
        const { indicators } = strategyApi.getCurrentIndicatorsContext();

        return strategyApi.entry({
          code: `GRID_SCALE_IN_${level}`,
          direction,
          indicators,
          additionalIndicators: {
            gridContext: buildGridSignalContext({
              snapshot,
              action: 'increase',
              level,
              levelsFilled: cycle.levelsFilled,
              positionQty: position.qty,
              projectedQty,
              projectedAveragePrice,
              stopLossPrice,
              takeProfitPrice: projectedTargetPrice,
            }),
          },
          figures: buildGridFigures({
            direction,
            series: runtimeState.series,
            entryTimestamp: candle.timestamp,
            entryPrice: snapshot.close,
            stepDistance: snapshot.stepDistance,
            maxLevels,
            stopLossPrice,
            takeProfitPrice: projectedTargetPrice,
          }),
          orderPlan: {
            qty,
            stopLossPrice,
            takeProfits: [{ rate: 1, price: projectedTargetPrice }],
            positionIntent: 'increase',
          },
        });
      }

      const reportedStop = getPositionStopLoss(position);
      const reportedTarget = getPositionTakeProfit(position);
      const repriceThreshold =
        snapshot.atr *
        Math.max(0, Number(config.GRID_PROTECTION_REPRICE_ATR ?? 0.15));
      const protectionMissingOrStale =
        reportedStop == null ||
        reportedTarget == null ||
        Math.abs(reportedStop - stopLossPrice) > repriceThreshold ||
        Math.abs(reportedTarget - targetPrice) > repriceThreshold;
      if (protectionMissingOrStale) {
        return strategyApi.protect({
          code: 'GRID_REFRESH_BASKET_PROTECTION',
          protectPlan: {
            direction,
            stopLossPrice,
            takeProfits: [{ rate: 1, price: targetPrice }],
          },
        });
      }

      return strategyApi.skip('GRID_WAIT_NEXT_LEVEL');
    }

    if (
      state.lastClosedTimestamp != null &&
      candle.timestamp <= state.lastClosedTimestamp + cooldownMs
    ) {
      return strategyApi.skip('GRID_ENTRY_COOLDOWN');
    }
    if (!snapshot.entryDirection) {
      return strategyApi.skip('GRID_NO_DIRECTIONAL_PULLBACK');
    }

    const direction = snapshot.entryDirection;
    const sideConfig = direction === 'LONG' ? config.LONG : config.SHORT;
    if (!sideConfig.enable) {
      return strategyApi.skip('STRATEGY_DISABLED');
    }
    if (maxLossValue <= 0) {
      return strategyApi.skip('GRID_INVALID_MAX_LOSS_VALUE');
    }

    const stopLossPrice = getDirectionalPrice(
      direction,
      snapshot.close,
      snapshot.stopDistance,
      'stop',
    );
    const takeProfitPrice = getDirectionalPrice(
      direction,
      snapshot.close,
      snapshot.takeProfitDistance,
      'target',
    );
    const qty = calculateLevelQty({
      maxLossValue,
      maxLevels,
      entryPrice: snapshot.close,
      stopLossPrice,
      feeRate,
    });
    if (!Number.isFinite(qty) || qty <= Number.EPSILON) {
      return strategyApi.skip('GRID_INVALID_QTY');
    }

    executionState.update((draft) => {
      draft.cycle = {
        direction,
        anchorPrice: snapshot.close,
        stopLossPrice,
        levelQty: qty,
        levelsFilled: 0,
        lastEntryPrice: snapshot.close,
        pending: {
          kind: 'open',
          timestamp: candle.timestamp,
          observedQty: 0,
          requestedQty: qty,
          price: snapshot.close,
        },
      };
    });
    const { indicators } = strategyApi.getCurrentIndicatorsContext();

    return strategyApi.entry({
      code: 'GRID_DIRECTIONAL_PULLBACK_ENTRY',
      direction: sideConfig.direction,
      indicators,
      additionalIndicators: {
        gridContext: buildGridSignalContext({
          snapshot,
          action: 'open',
          level: 1,
          levelsFilled: 0,
          positionQty: 0,
          projectedQty: qty,
          projectedAveragePrice: snapshot.close,
          stopLossPrice,
          takeProfitPrice,
        }),
      },
      figures: buildGridFigures({
        direction,
        series: runtimeState.series,
        entryTimestamp: candle.timestamp,
        entryPrice: snapshot.close,
        stepDistance: snapshot.stepDistance,
        maxLevels,
        stopLossPrice,
        takeProfitPrice,
      }),
      orderPlan: {
        qty,
        stopLossPrice,
        takeProfits: [{ rate: 1, price: takeProfitPrice }],
      },
    });
  };
};
