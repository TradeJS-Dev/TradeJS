import type {
  Candle,
  CreateStrategyCore,
  Direction,
  IndicatorsHistorySnapshot,
  Position,
} from '@tradejs/types';
import { GridConfig, GridContinuationRiskMode } from './config';
import {
  buildGridDetectorKey,
  buildGridSignalContext,
  createGridEngine,
  GridSnapshot,
} from './engine';
import { buildGridFigures } from './figures';
import type { GridRangeFilterMode, GridRangeGeometry } from './rangeGeometry';
import { resolveDirectionalConfigNumber } from '../shared/directionalConfig';
import { buildTradeEconomics } from '@tradejs/strategy-kit/risk';

interface PendingGridEntry {
  timestamp: number;
  observedQty: number;
}

interface GridCycle {
  direction: Direction;
  stopLossPrice: number;
  takeProfitPrice: number | null;
  levelQty: number;
  levelsFilled: number;
  levelReferencePrice: number;
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

const getTakeProfitDistance = ({
  config,
  direction,
  stepDistance,
}: {
  config: GridConfig;
  direction: Direction;
  stepDistance: number;
}) =>
  stepDistance *
  Math.max(
    0.1,
    resolveDirectionalConfigNumber({
      config,
      key: 'GRID_TAKE_PROFIT_STEP_MULT',
      direction,
      fallback: 1,
    }),
  );

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
  (Math.abs(entryPrice - stopLossPrice) +
    Math.abs(entryPrice) * feeRate +
    Math.abs(stopLossPrice) * feeRate);

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

const isDirectionalTargetValid = (
  direction: Direction,
  takeProfitPrice: number,
  referencePrice: number,
) =>
  takeProfitPrice > 0 &&
  (direction === 'LONG'
    ? takeProfitPrice > referencePrice
    : takeProfitPrice < referencePrice);

interface ContinuationStructureRiskPlan {
  stopLossPrice: number;
  takeProfitPrice: number;
  takeProfitDistance: number;
}

const buildContinuationStructureRiskPlan = ({
  candle,
  direction,
  entryPrice,
  breakoutLevel,
  atr,
  stopBufferAtr,
  minStopDistanceAtr,
  targetR,
}: {
  candle: Candle;
  direction: Direction;
  entryPrice: number;
  breakoutLevel: number | null;
  atr: number;
  stopBufferAtr: number;
  minStopDistanceAtr: number;
  targetR: number;
}): ContinuationStructureRiskPlan | null => {
  const high = Number(candle.high);
  const low = Number(candle.low);
  const level = Number(breakoutLevel);
  if (
    ![entryPrice, high, low, level, atr].every(Number.isFinite) ||
    entryPrice <= 0 ||
    high < entryPrice ||
    low > entryPrice ||
    high < low ||
    level <= 0 ||
    atr <= 0 ||
    !Number.isFinite(targetR) ||
    targetR <= 0
  ) {
    return null;
  }

  const stopBuffer = atr * Math.max(0, stopBufferAtr);
  const minStopDistance = atr * Math.max(0, minStopDistanceAtr);
  const structureStop =
    direction === 'LONG'
      ? Math.min(low, level) - stopBuffer
      : Math.max(high, level) + stopBuffer;
  const stopLossPrice =
    direction === 'LONG'
      ? Math.min(structureStop, entryPrice - minStopDistance)
      : Math.max(structureStop, entryPrice + minStopDistance);
  const initialRisk = Math.abs(entryPrice - stopLossPrice);
  const takeProfitDistance = initialRisk * targetR;
  const takeProfitPrice = getDirectionalPrice(
    direction,
    entryPrice,
    takeProfitDistance,
    'target',
  );

  return stopLossPrice > 0 &&
    Number.isFinite(takeProfitPrice) &&
    isDirectionalStopValid(direction, stopLossPrice, entryPrice) &&
    isDirectionalTargetValid(direction, takeProfitPrice, entryPrice)
    ? { stopLossPrice, takeProfitPrice, takeProfitDistance }
    : null;
};

const isRangeActionBlocked = ({
  direction,
  geometry,
  mode,
  action,
  edgeFraction,
}: {
  direction: Direction;
  geometry: GridRangeGeometry;
  mode: GridRangeFilterMode;
  action: 'open' | 'increase';
  edgeFraction: number;
}) => {
  if (mode === 'off' || !geometry.detected) return false;
  if (mode === 'block_entries') return action === 'open';
  if (mode === 'block_all') return true;

  const position = geometry.position;
  if (position == null || !Number.isFinite(position)) return true;
  return direction === 'LONG'
    ? position < 0 || position > edgeFraction
    : position < 1 - edgeFraction || position > 1;
};

const buildExecutionStateKey = (config: GridConfig) =>
  JSON.stringify({
    detector: buildGridDetectorKey(config),
    maxLossValue: config.MAX_LOSS_VALUE,
    maxLevels: config.GRID_MAX_LEVELS,
    feePercent: config.FEE_PERCENT,
    slippageBaseBps: config.SLIPPAGE_BASE_BPS,
    slippageMarketImpactBps: config.SLIPPAGE_MARKET_IMPACT_BPS,
    entryMode: config.GRID_ENTRY_MODE,
    continuationAllowScaleIn: config.GRID_CONTINUATION_ALLOW_SCALE_IN,
    continuationRiskMode: config.GRID_CONTINUATION_RISK_MODE,
    continuationStopBufferAtr: config.GRID_CONTINUATION_STOP_BUFFER_ATR,
    continuationMinStopDistanceAtr:
      config.GRID_CONTINUATION_MIN_STOP_DISTANCE_ATR,
    continuationTargetR: config.GRID_CONTINUATION_TARGET_R,
    takeProfitStepMultLong: config.GRID_TAKE_PROFIT_STEP_MULT_LONG,
    takeProfitStepMultShort: config.GRID_TAKE_PROFIT_STEP_MULT_SHORT,
    rangeFilterMode: config.GRID_RANGE_FILTER_MODE,
    rangeEdgeFraction: config.GRID_RANGE_EDGE_FRACTION,
  });

const buildRecoveredCycle = ({
  position,
  snapshot,
  maxLossValue,
  maxLevels,
  feeRate,
  freezeContinuationProtection,
  continuationTargetR,
}: {
  position: Position;
  snapshot: GridSnapshot;
  maxLossValue: number;
  maxLevels: number;
  feeRate: number;
  freezeContinuationProtection: boolean;
  continuationTargetR: number;
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
  const reportedTarget = getPositionTakeProfit(position);
  const fallbackTarget = getDirectionalPrice(
    position.direction,
    position.price,
    Math.abs(position.price - stopLossPrice) * continuationTargetR,
    'target',
  );
  const takeProfitPrice = freezeContinuationProtection
    ? reportedTarget != null &&
      isDirectionalTargetValid(
        position.direction,
        reportedTarget,
        position.price,
      )
      ? reportedTarget
      : isDirectionalTargetValid(
            position.direction,
            fallbackTarget,
            position.price,
          )
        ? fallbackTarget
        : null
    : null;

  return {
    direction: position.direction,
    stopLossPrice,
    takeProfitPrice,
    levelQty,
    levelsFilled: Math.min(
      maxLevels,
      Math.max(1, Math.round(position.qty / levelQty)),
    ),
    levelReferencePrice: position.price,
    pending: null,
  };
};

const synchronizeCycleWithPosition = ({
  cycle,
  position,
  maxLossValue,
  maxLevels,
  feeRate,
}: {
  cycle: GridCycle;
  position: Position;
  maxLossValue: number;
  maxLevels: number;
  feeRate: number;
}) => {
  const calculatedLevelQty = calculateLevelQty({
    maxLossValue,
    maxLevels,
    entryPrice: position.price,
    stopLossPrice: cycle.stopLossPrice,
    feeRate,
  });
  const levelQty = Math.max(
    Number.EPSILON,
    Math.min(position.qty, calculatedLevelQty || position.qty),
  );

  cycle.levelQty = levelQty;
  cycle.levelsFilled = Math.min(
    maxLevels,
    Math.max(1, Math.round(position.qty / levelQty)),
  );
  cycle.levelReferencePrice = position.price;
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

  const configuredMaxLevels = Math.max(
    1,
    Math.floor(Number(config.GRID_MAX_LEVELS ?? 4)),
  );
  const maxLevels =
    config.GRID_ENTRY_MODE === 'breakout_retest' &&
    !Boolean(config.GRID_CONTINUATION_ALLOW_SCALE_IN)
      ? 1
      : configuredMaxLevels;
  const continuationRiskMode = (
    config.GRID_CONTINUATION_RISK_MODE === 'retest_structure'
      ? 'retest_structure'
      : 'legacy_step'
  ) as GridContinuationRiskMode;
  const freezeContinuationProtection =
    config.GRID_ENTRY_MODE === 'breakout_retest' &&
    continuationRiskMode === 'retest_structure';
  const continuationStopBufferAtr = Math.max(
    0,
    Number(config.GRID_CONTINUATION_STOP_BUFFER_ATR ?? 0.1),
  );
  const continuationMinStopDistanceAtr = Math.max(
    0,
    Number(config.GRID_CONTINUATION_MIN_STOP_DISTANCE_ATR ?? 0.35),
  );
  const continuationTargetR = Number(config.GRID_CONTINUATION_TARGET_R ?? 1);
  const maxLossValue = Math.max(0, Number(config.MAX_LOSS_VALUE ?? 0));
  const feeRate = Math.max(0, Number(config.FEE_PERCENT ?? 0));
  const slippageBps = Math.max(
    0,
    Number(config.SLIPPAGE_BASE_BPS ?? 0) +
      Number(config.SLIPPAGE_MARKET_IMPACT_BPS ?? 0),
  );
  const executionCostRate = feeRate + slippageBps / 10_000;
  const minNetRiskRatio = Math.max(
    0,
    Number(config.GRID_MIN_NET_RISK_RATIO ?? 0),
  );
  const cooldownMs =
    Math.max(0, Number(config.GRID_ENTRY_COOLDOWN_BARS ?? 0)) *
    getIntervalMs(config.INTERVAL);
  const rangeFilterMode = (
    ['off', 'block_entries', 'block_all', 'edge_all'].includes(
      String(config.GRID_RANGE_FILTER_MODE),
    )
      ? config.GRID_RANGE_FILTER_MODE
      : 'off'
  ) as GridRangeFilterMode;
  const rangeEdgeFraction = Math.min(
    0.5,
    Math.max(0, Number(config.GRID_RANGE_EDGE_FRACTION ?? 0.35)),
  );

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
            feeRate: executionCostRate,
            freezeContinuationProtection,
            continuationTargetR,
          });
        });
      } else if (state.cycle.pending) {
        const pending = state.cycle.pending;
        const increaseConfirmed =
          position.qty > pending.observedQty + Number.EPSILON;
        if (increaseConfirmed) {
          executionState.update((draft) => {
            if (!draft.cycle) return;
            synchronizeCycleWithPosition({
              cycle: draft.cycle,
              position,
              maxLossValue,
              maxLevels,
              feeRate: executionCostRate,
            });
            draft.cycle.pending = null;
          });
        } else if (candle.timestamp > pending.timestamp) {
          executionState.update((draft) => {
            if (draft.cycle) draft.cycle.pending = null;
          });
        }
      } else {
        executionState.update((draft) => {
          if (!draft.cycle) return;
          synchronizeCycleWithPosition({
            cycle: draft.cycle,
            position,
            maxLossValue,
            maxLevels,
            feeRate: executionCostRate,
          });
        });
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

      const legacyTakeProfitDistance = getTakeProfitDistance({
        config,
        direction,
        stepDistance: snapshot.stepDistance,
      });
      const targetPrice =
        cycle.takeProfitPrice ??
        getDirectionalPrice(
          direction,
          position.price,
          legacyTakeProfitDistance,
          'target',
        );
      const takeProfitDistance = Math.abs(targetPrice - position.price);
      const adverseLevelReached =
        direction === 'LONG'
          ? snapshot.close <= cycle.levelReferencePrice - snapshot.stepDistance
          : snapshot.close >= cycle.levelReferencePrice + snapshot.stepDistance;
      const existingRisk = calculateWorstCaseLoss({
        qty: position.qty,
        entryPrice: position.price,
        stopLossPrice,
        feeRate: executionCostRate,
      });
      const remainingRisk = Math.max(0, maxLossValue - existingRisk);
      if (
        adverseLevelReached &&
        snapshot.regimeDirection === direction &&
        remainingRisk <= Number.EPSILON
      ) {
        return strategyApi.skip('GRID_RISK_BUDGET_EXHAUSTED');
      }
      const canIncrease =
        adverseLevelReached &&
        cycle.levelsFilled < maxLevels &&
        snapshot.regimeDirection === direction;
      const rangeBlocksIncrease =
        canIncrease &&
        isRangeActionBlocked({
          direction,
          geometry: snapshot.rangeGeometry,
          mode: rangeFilterMode,
          action: 'increase',
          edgeFraction: rangeEdgeFraction,
        });

      if (canIncrease && !rangeBlocksIncrease) {
        const nextUnitRisk =
          Math.abs(snapshot.close - stopLossPrice) +
          Math.abs(snapshot.close) * executionCostRate +
          Math.abs(stopLossPrice) * executionCostRate;
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
        const projectedTargetPrice =
          cycle.takeProfitPrice ??
          getDirectionalPrice(
            direction,
            projectedAveragePrice,
            legacyTakeProfitDistance,
            'target',
          );
        const projectedEconomics = buildTradeEconomics({
          entryPrice: projectedAveragePrice,
          stopLossPrice,
          takeProfitPrice: projectedTargetPrice,
          feeRate,
          slippageBps,
        });
        if (
          freezeContinuationProtection &&
          (!Number.isFinite(projectedEconomics.netRiskRatio) ||
            projectedEconomics.rewardPerUnit <= Number.EPSILON)
        ) {
          return strategyApi.skip('GRID_INVALID_CONTINUATION_ECONOMICS');
        }
        if (projectedEconomics.netRiskRatio < minNetRiskRatio) {
          return strategyApi.skip(
            `GRID_NET_RISK_RATIO:${projectedEconomics.netRiskRatio.toFixed(2)}`,
          );
        }
        const level = cycle.levelsFilled + 1;
        executionState.update((draft) => {
          if (!draft.cycle) return;
          draft.cycle.pending = {
            timestamp: candle.timestamp,
            observedQty: position.qty,
          };
        });
        const { indicators } = strategyApi.getCurrentIndicatorsContext();

        return strategyApi.entry({
          code: `GRID_SCALE_IN_${level}`,
          direction,
          indicators,
          additionalIndicators: {
            gridContext: buildGridSignalContext({
              snapshot: { ...snapshot, takeProfitDistance },
              action: 'increase',
              level,
              levelsFilled: cycle.levelsFilled,
              positionQty: position.qty,
              projectedQty,
              projectedAveragePrice,
              stopLossPrice,
              takeProfitPrice: projectedTargetPrice,
              grossRiskRatio: projectedEconomics.grossRiskRatio,
              netRiskRatio: projectedEconomics.netRiskRatio,
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
            rangeGeometry: snapshot.rangeGeometry,
            breakoutLevel: snapshot.breakoutLevel,
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
      if (rangeBlocksIncrease) {
        return strategyApi.skip('GRID_RANGE_SCALE_IN_BLOCKED');
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
      return strategyApi.skip(
        config.GRID_ENTRY_MODE === 'breakout_retest'
          ? 'GRID_NO_BREAKOUT_RETEST'
          : 'GRID_NO_DIRECTIONAL_PULLBACK',
      );
    }

    const direction = snapshot.entryDirection;
    const sideConfig = direction === 'LONG' ? config.LONG : config.SHORT;
    if (!sideConfig.enable) {
      return strategyApi.skip('STRATEGY_DISABLED');
    }
    if (maxLossValue <= 0) {
      return strategyApi.skip('GRID_INVALID_MAX_LOSS_VALUE');
    }
    if (
      isRangeActionBlocked({
        direction,
        geometry: snapshot.rangeGeometry,
        mode: rangeFilterMode,
        action: 'open',
        edgeFraction: rangeEdgeFraction,
      })
    ) {
      return strategyApi.skip('GRID_RANGE_ENTRY_BLOCKED');
    }

    const structureRiskPlan = freezeContinuationProtection
      ? buildContinuationStructureRiskPlan({
          candle,
          direction,
          entryPrice: snapshot.close,
          breakoutLevel: snapshot.breakoutLevel,
          atr: snapshot.atr,
          stopBufferAtr: continuationStopBufferAtr,
          minStopDistanceAtr: continuationMinStopDistanceAtr,
          targetR: continuationTargetR,
        })
      : null;
    if (freezeContinuationProtection && !structureRiskPlan) {
      return strategyApi.skip('GRID_INVALID_CONTINUATION_GEOMETRY');
    }
    const stopLossPrice =
      structureRiskPlan?.stopLossPrice ??
      getDirectionalPrice(
        direction,
        snapshot.close,
        snapshot.stopDistance,
        'stop',
      );
    const takeProfitDistance =
      structureRiskPlan?.takeProfitDistance ??
      getTakeProfitDistance({
        config,
        direction,
        stepDistance: snapshot.stepDistance,
      });
    const takeProfitPrice =
      structureRiskPlan?.takeProfitPrice ??
      getDirectionalPrice(
        direction,
        snapshot.close,
        takeProfitDistance,
        'target',
      );
    const economics = buildTradeEconomics({
      entryPrice: snapshot.close,
      stopLossPrice,
      takeProfitPrice,
      feeRate,
      slippageBps,
    });
    if (
      freezeContinuationProtection &&
      (!Number.isFinite(economics.netRiskRatio) ||
        economics.lossPerUnit <= Number.EPSILON ||
        economics.rewardPerUnit <= Number.EPSILON)
    ) {
      return strategyApi.skip('GRID_INVALID_CONTINUATION_ECONOMICS');
    }
    if (economics.netRiskRatio < minNetRiskRatio) {
      return strategyApi.skip(
        `GRID_NET_RISK_RATIO:${economics.netRiskRatio.toFixed(2)}`,
      );
    }
    const qty = calculateLevelQty({
      maxLossValue,
      maxLevels,
      entryPrice: snapshot.close,
      stopLossPrice,
      feeRate: executionCostRate,
    });
    if (!Number.isFinite(qty) || qty <= Number.EPSILON) {
      return strategyApi.skip('GRID_INVALID_QTY');
    }

    executionState.update((draft) => {
      draft.cycle = {
        direction,
        stopLossPrice,
        takeProfitPrice: structureRiskPlan?.takeProfitPrice ?? null,
        levelQty: qty,
        levelsFilled: 0,
        levelReferencePrice: snapshot.close,
        pending: {
          timestamp: candle.timestamp,
          observedQty: 0,
        },
      };
    });
    const { indicators } = strategyApi.getCurrentIndicatorsContext();

    return strategyApi.entry({
      code:
        snapshot.entryStage === 'breakout_retest_held'
          ? 'GRID_BREAKOUT_RETEST_ENTRY'
          : 'GRID_DIRECTIONAL_PULLBACK_ENTRY',
      direction: sideConfig.direction,
      indicators,
      additionalIndicators: {
        gridContext: buildGridSignalContext({
          snapshot: { ...snapshot, takeProfitDistance },
          action: 'open',
          level: 1,
          levelsFilled: 0,
          positionQty: 0,
          projectedQty: qty,
          projectedAveragePrice: snapshot.close,
          stopLossPrice,
          takeProfitPrice,
          grossRiskRatio: economics.grossRiskRatio,
          netRiskRatio: economics.netRiskRatio,
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
        rangeGeometry: snapshot.rangeGeometry,
        breakoutLevel: snapshot.breakoutLevel,
      }),
      orderPlan: {
        qty,
        stopLossPrice,
        takeProfits: [{ rate: 1, price: takeProfitPrice }],
      },
    });
  };
};
