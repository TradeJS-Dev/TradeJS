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
import { buildTradeEconomics } from '@tradejs/strategy-kit/risk';
import {
  resolveDirectionalConfigBoolean,
  resolveDirectionalConfigNumber,
} from '@tradejs/strategy-kit/config';

interface PendingLiquidityTailsEntry {
  timestamp: number;
  observedQty: number;
  level: number;
}

interface LiquidityTailsCycle {
  setupId: string | null;
  direction: Direction;
  stopLossPrice: number;
  invalidationPrice: number | null;
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
    slippageBaseBps: config.SLIPPAGE_BASE_BPS,
    slippageMarketImpactBps: config.SLIPPAGE_MARKET_IMPACT_BPS,
    targetR: config.LIQUIDITY_TAILS_TARGET_R_MULT,
    targetRLong: config.LIQUIDITY_TAILS_TARGET_R_MULT_LONG,
    targetRShort: config.LIQUIDITY_TAILS_TARGET_R_MULT_SHORT,
    scaleInEnabled: config.LIQUIDITY_TAILS_SCALE_IN_ENABLED,
    scaleInCount: config.LIQUIDITY_TAILS_SCALE_IN_COUNT,
    initialRiskFraction: config.LIQUIDITY_TAILS_INITIAL_RISK_FRACTION,
    scaleInMinImprovementAtr:
      config.LIQUIDITY_TAILS_SCALE_IN_MIN_IMPROVEMENT_ATR,
    exitOnInvalidation: config.LIQUIDITY_TAILS_EXIT_ON_INVALIDATION,
    exitOnInvalidationLong: config.LIQUIDITY_TAILS_EXIT_ON_INVALIDATION_LONG,
    exitOnInvalidationShort: config.LIQUIDITY_TAILS_EXIT_ON_INVALIDATION_SHORT,
    exitOnScaleInRetest: config.LIQUIDITY_TAILS_EXIT_ON_SCALE_IN_RETEST,
  });

const buildRecoveredCycle = ({
  position,
  maxLossValue,
  feeRate,
  targetR,
  initialRiskFraction,
  maxLevels,
}: {
  position: Position;
  maxLossValue: number;
  feeRate: number;
  targetR: number;
  initialRiskFraction: number;
  maxLevels: number;
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
  const existingRiskFraction =
    maxLossValue > 0 ? existingRisk / maxLossValue : 1;
  const scaleInCount = Math.max(0, maxLevels - 1);
  const scaleInRiskFraction =
    scaleInCount > 0 ? (1 - initialRiskFraction) / scaleInCount : 0;
  let entriesFilled = 1;
  for (let level = 2; level <= maxLevels; level += 1) {
    const targetRiskFraction =
      initialRiskFraction + scaleInRiskFraction * (level - 1);
    if (existingRiskFraction >= targetRiskFraction - 0.02) {
      entriesFilled = level;
    }
  }

  return {
    setupId: null,
    direction: position.direction,
    stopLossPrice,
    invalidationPrice: null,
    targetR,
    entriesFilled,
    pending: null,
  };
};

const buildExecutionContext = ({
  action,
  level,
  levelsFilled,
  maxLevels,
  targetRiskBudgetPct,
  positionQty,
  positionAveragePrice,
  priceImprovementAtr,
  projectedQty,
  projectedAveragePrice,
  stopLossPrice,
  takeProfitPrice,
  existingRiskValue,
  remainingRiskValue,
  projectedRiskValue,
  maxLossValue,
  initialRiskFraction,
  grossRiskRatio,
  netRiskRatio,
}: Omit<LiquidityTailsExecutionContext, 'riskBudgetUsedPct'> & {
  maxLossValue: number;
}): LiquidityTailsExecutionContext => ({
  action,
  level,
  levelsFilled,
  maxLevels,
  targetRiskBudgetPct,
  positionQty,
  positionAveragePrice,
  priceImprovementAtr,
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
  grossRiskRatio,
  netRiskRatio,
});

const buildLiquidityTailsStateKey = (config: LiquidityTailsConfig) =>
  JSON.stringify({
    atrLength: config.LIQUIDITY_TAILS_ATR_LENGTH,
    atrMult: config.LIQUIDITY_TAILS_ATR_MULT,
    minWickRatio: config.LIQUIDITY_TAILS_MIN_WICK_RATIO,
    minWickRatioLong: config.LIQUIDITY_TAILS_MIN_WICK_RATIO_LONG,
    minWickRatioShort: config.LIQUIDITY_TAILS_MIN_WICK_RATIO_SHORT,
    wickDominance: config.LIQUIDITY_TAILS_WICK_DOMINANCE,
    wickDominanceLong: config.LIQUIDITY_TAILS_WICK_DOMINANCE_LONG,
    wickDominanceShort: config.LIQUIDITY_TAILS_WICK_DOMINANCE_SHORT,
    minGap: config.LIQUIDITY_TAILS_MIN_GAP,
    maxAge: config.LIQUIDITY_TAILS_MAX_AGE,
    keepBroken: config.LIQUIDITY_TAILS_KEEP_BROKEN,
    reactionCloseBeyondZone: config.LIQUIDITY_TAILS_REACTION_CLOSE_BEYOND_ZONE,
    requireReactionBody: config.LIQUIDITY_TAILS_REQUIRE_REACTION_BODY,
    maxRetestDistancePct: config.LIQUIDITY_TAILS_MAX_RETEST_DISTANCE_PCT,
    maxRetestDistancePctLong:
      config.LIQUIDITY_TAILS_MAX_RETEST_DISTANCE_PCT_LONG,
    maxRetestDistancePctShort:
      config.LIQUIDITY_TAILS_MAX_RETEST_DISTANCE_PCT_SHORT,
    minRetestAgeBars: config.LIQUIDITY_TAILS_MIN_RETEST_AGE_BARS,
    minRetestAgeBarsLong: config.LIQUIDITY_TAILS_MIN_RETEST_AGE_BARS_LONG,
    minRetestAgeBarsShort: config.LIQUIDITY_TAILS_MIN_RETEST_AGE_BARS_SHORT,
    minZoneTouches: config.LIQUIDITY_TAILS_MIN_ZONE_TOUCHES,
    minZoneTouchesLong: config.LIQUIDITY_TAILS_MIN_ZONE_TOUCHES_LONG,
    minZoneTouchesShort: config.LIQUIDITY_TAILS_MIN_ZONE_TOUCHES_SHORT,
    maxEntryRetestOrdinal: config.LIQUIDITY_TAILS_MAX_ENTRY_RETEST_ORDINAL,
    maxEntryRetestOrdinalLong:
      config.LIQUIDITY_TAILS_MAX_ENTRY_RETEST_ORDINAL_LONG,
    maxEntryRetestOrdinalShort:
      config.LIQUIDITY_TAILS_MAX_ENTRY_RETEST_ORDINAL_SHORT,
    maxEntryZoneAgeBars: config.LIQUIDITY_TAILS_MAX_ENTRY_ZONE_AGE_BARS,
    maxEntryZoneAgeBarsLong:
      config.LIQUIDITY_TAILS_MAX_ENTRY_ZONE_AGE_BARS_LONG,
    maxEntryZoneAgeBarsShort:
      config.LIQUIDITY_TAILS_MAX_ENTRY_ZONE_AGE_BARS_SHORT,
    minRejectionEfficiencyRatio:
      config.LIQUIDITY_TAILS_MIN_REJECTION_EFFICIENCY_RATIO,
    minRejectionEfficiencyRatioLong:
      config.LIQUIDITY_TAILS_MIN_REJECTION_EFFICIENCY_RATIO_LONG,
    minRejectionEfficiencyRatioShort:
      config.LIQUIDITY_TAILS_MIN_REJECTION_EFFICIENCY_RATIO_SHORT,
    closeHoldBars: config.LIQUIDITY_TAILS_CLOSE_HOLD_BARS,
    closeHoldBarsLong: config.LIQUIDITY_TAILS_CLOSE_HOLD_BARS_LONG,
    closeHoldBarsShort: config.LIQUIDITY_TAILS_CLOSE_HOLD_BARS_SHORT,
    scaleInEnabled: config.LIQUIDITY_TAILS_SCALE_IN_ENABLED,
    scaleInCount: config.LIQUIDITY_TAILS_SCALE_IN_COUNT,
    exitOnScaleInRetest: config.LIQUIDITY_TAILS_EXIT_ON_SCALE_IN_RETEST,
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
  const lastTradeController = strategyApi.createLastTradeController({
    enabled: true,
  });
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
  const slippageBps = Math.max(
    0,
    Number(config.SLIPPAGE_BASE_BPS ?? 0) +
      Number(config.SLIPPAGE_MARKET_IMPACT_BPS ?? 0),
  );
  const executionCostRate = feeRate + slippageBps / 10_000;
  const scaleInEnabled = Boolean(config.LIQUIDITY_TAILS_SCALE_IN_ENABLED);
  const configuredScaleInCount = Number(
    config.LIQUIDITY_TAILS_SCALE_IN_COUNT ?? 1,
  );
  const scaleInCount = scaleInEnabled
    ? Math.max(
        0,
        Number.isFinite(configuredScaleInCount)
          ? Math.floor(configuredScaleInCount)
          : 1,
      )
    : 0;
  const maxLevels = 1 + scaleInCount;
  const exitOnScaleInRetest = Boolean(
    config.LIQUIDITY_TAILS_EXIT_ON_SCALE_IN_RETEST,
  );
  const configuredInitialRiskFraction = Number(
    config.LIQUIDITY_TAILS_INITIAL_RISK_FRACTION ?? 0.7,
  );
  const initialRiskFraction = Math.min(
    1,
    Math.max(
      0.05,
      Number.isFinite(configuredInitialRiskFraction)
        ? configuredInitialRiskFraction
        : 0.7,
    ),
  );
  const scaleInMinImprovementAtr = Math.max(
    0,
    Number(config.LIQUIDITY_TAILS_SCALE_IN_MIN_IMPROVEMENT_ATR ?? 1),
  );
  const getTargetR = (direction: Direction) =>
    Math.max(
      0,
      resolveDirectionalConfigNumber({
        config,
        key: 'LIQUIDITY_TAILS_TARGET_R_MULT',
        direction,
        fallback: 2,
      }),
    );
  const exitsOnInvalidation = (direction: Direction) =>
    resolveDirectionalConfigBoolean({
      config,
      key: 'LIQUIDITY_TAILS_EXIT_ON_INVALIDATION',
      direction,
      fallback: false,
    });

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
            feeRate: executionCostRate,
            targetR: getTargetR(position.direction),
            initialRiskFraction,
            maxLevels,
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
        exitsOnInvalidation(position.direction) &&
        cycle?.invalidationPrice != null &&
        (position.direction === 'LONG'
          ? Number(candle.close) < cycle.invalidationPrice
          : Number(candle.close) > cycle.invalidationPrice)
      ) {
        return strategyApi.exit({
          code: 'LIQUIDITY_TAILS_INVALIDATION_EXIT',
          direction: position.direction,
        });
      }

      if (
        Boolean(config.LIQUIDITY_TAILS_EXIT_ON_OPPOSITE_RETEST) &&
        oppositeSignal
      ) {
        return strategyApi.exit({
          code: 'LIQUIDITY_TAILS_OPPOSITE_RETEST_EXIT',
          direction: position.direction,
        });
      }

      if (!signal || (!scaleInEnabled && !exitOnScaleInRetest)) {
        return strategyApi.skip('POSITION_EXISTS');
      }
      if (oppositeSignal) {
        return strategyApi.skip('LIQUIDITY_TAILS_SCALE_IN_DIRECTION_MISMATCH');
      }
      if (!cycle) {
        return strategyApi.skip('LIQUIDITY_TAILS_SCALE_IN_STATE_UNAVAILABLE');
      }
      if (signal.candidateAction !== 'scale_in') {
        return strategyApi.skip('LIQUIDITY_TAILS_INITIAL_ENTRY_ALREADY_OPEN');
      }
      if (cycle.setupId != null && signal.setupId !== cycle.setupId) {
        return strategyApi.skip('LIQUIDITY_TAILS_SCALE_IN_SETUP_MISMATCH');
      }
      if (cycle.pending) {
        return strategyApi.skip('LIQUIDITY_TAILS_ORDER_PENDING');
      }
      if (scaleInEnabled && cycle.entriesFilled >= maxLevels) {
        return strategyApi.skip('LIQUIDITY_TAILS_SCALE_IN_COMPLETE');
      }

      const { currentPrice } = await strategyApi.getDecisionPriceContext();
      const improvement =
        position.direction === 'LONG'
          ? position.price - currentPrice
          : currentPrice - position.price;
      if (
        !isPriceImprovement(position.direction, currentPrice, position.price)
      ) {
        return strategyApi.skip('LIQUIDITY_TAILS_SCALE_IN_PRICE_NOT_IMPROVED');
      }
      if (improvement < signal.atr * scaleInMinImprovementAtr) {
        return strategyApi.skip(
          'LIQUIDITY_TAILS_SCALE_IN_MIN_IMPROVEMENT_NOT_MET',
        );
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

      if (exitOnScaleInRetest) {
        return strategyApi.exit({
          code: 'LIQUIDITY_TAILS_SCALE_IN_RETEST_EXIT',
          direction: position.direction,
        });
      }

      const existingRiskValue = calculateWorstCaseLoss({
        qty: position.qty,
        entryPrice: position.price,
        stopLossPrice: cycle.stopLossPrice,
        feeRate: executionCostRate,
      });
      const remainingRiskValue = Math.max(0, maxLossValue - existingRiskValue);
      const nextLevel = cycle.entriesFilled + 1;
      const scaleInRiskFraction =
        scaleInCount > 0 ? (1 - initialRiskFraction) / scaleInCount : 0;
      const targetRiskFraction = Math.min(
        1,
        initialRiskFraction + scaleInRiskFraction * (nextLevel - 1),
      );
      const targetRiskValue = maxLossValue * targetRiskFraction;
      const levelRiskBudget = Math.max(0, targetRiskValue - existingRiskValue);
      const qty = calculateRiskSizedQty({
        riskBudget: levelRiskBudget,
        entryPrice: currentPrice,
        stopLossPrice: cycle.stopLossPrice,
        feeRate: executionCostRate,
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
      const projectedEconomics = buildTradeEconomics({
        entryPrice: projectedAveragePrice,
        stopLossPrice: cycle.stopLossPrice,
        takeProfitPrice,
        feeRate,
        slippageBps,
      });
      const scaleModeConfig =
        position.direction === 'LONG' ? config.LONG : config.SHORT;
      if (projectedEconomics.netRiskRatio <= scaleModeConfig.minRiskRatio) {
        return strategyApi.skip(
          `RISK_RATIO:${round(projectedEconomics.netRiskRatio)}`,
        );
      }
      const projectedRiskValue = calculateWorstCaseLoss({
        qty: projectedQty,
        entryPrice: projectedAveragePrice,
        stopLossPrice: cycle.stopLossPrice,
        feeRate: executionCostRate,
      });
      const executionContext = buildExecutionContext({
        action: 'increase',
        level: nextLevel,
        levelsFilled: cycle.entriesFilled,
        maxLevels,
        targetRiskBudgetPct: targetRiskFraction * 100,
        positionQty: position.qty,
        positionAveragePrice: position.price,
        priceImprovementAtr: signal.atr > 0 ? improvement / signal.atr : null,
        projectedQty,
        projectedAveragePrice,
        stopLossPrice: cycle.stopLossPrice,
        takeProfitPrice,
        existingRiskValue,
        remainingRiskValue,
        projectedRiskValue,
        maxLossValue,
        initialRiskFraction,
        grossRiskRatio: projectedEconomics.grossRiskRatio,
        netRiskRatio: projectedEconomics.netRiskRatio,
      });
      executionState.update((draft) => {
        if (!draft.cycle) return;
        draft.cycle.setupId ??= signal.setupId;
        draft.cycle.pending = {
          timestamp: candle.timestamp,
          observedQty: position.qty,
          level: nextLevel,
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
    if (signal.candidateAction !== 'initial_entry') {
      return strategyApi.skip(
        'LIQUIDITY_TAILS_SCALE_IN_RETEST_WITHOUT_POSITION',
      );
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
    const targetR = getTargetR(signal.direction);
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
    const economics = buildTradeEconomics({
      entryPrice: currentPrice,
      stopLossPrice,
      takeProfitPrice,
      feeRate,
      slippageBps,
    });
    const riskRatio = economics.netRiskRatio;
    const initialRiskValue = maxLossValue * initialRiskFraction;
    const qty = calculateRiskSizedQty({
      riskBudget: initialRiskValue,
      entryPrice: currentPrice,
      stopLossPrice,
      feeRate: executionCostRate,
    });

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
      feeRate: executionCostRate,
    });
    const executionContext = buildExecutionContext({
      action: 'open',
      level: 1,
      levelsFilled: 0,
      maxLevels,
      targetRiskBudgetPct: initialRiskFraction * 100,
      positionQty: 0,
      positionAveragePrice: null,
      priceImprovementAtr: null,
      projectedQty: qty,
      projectedAveragePrice: currentPrice,
      stopLossPrice,
      takeProfitPrice,
      existingRiskValue: 0,
      remainingRiskValue: Math.max(0, maxLossValue - projectedRiskValue),
      projectedRiskValue,
      maxLossValue,
      initialRiskFraction,
      grossRiskRatio: economics.grossRiskRatio,
      netRiskRatio: economics.netRiskRatio,
    });
    executionState.update((draft) => {
      draft.cycle = {
        setupId: signal.setupId,
        direction: signal.direction,
        stopLossPrice,
        invalidationPrice:
          signal.direction === 'LONG' ? signal.zone.bottom : signal.zone.top,
        targetR,
        entriesFilled: scaleInEnabled ? 0 : 1,
        pending: scaleInEnabled
          ? {
              timestamp: candle.timestamp,
              observedQty: 0,
              level: 1,
            }
          : null,
      };
    });
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
