import type { BaseStrategyContextSnapshot, Direction } from '@tradejs/types';
import type { GridClassicSignalContext } from './engine';
import type { GridClassicEntryEconomics } from './contracts';
export type {
  GridClassicEconomicsRejectReason,
  GridClassicEntryEconomics,
} from './contracts';

export type GridClassicGateFeatures = {
  signalDirection: Direction | null;
  action: 'open' | 'increase' | null;
  gridLevel: number | null;
  filledLevels: number | null;
  remainingLevels: number | null;
  rangeReady: boolean | null;
  rangeDetected: boolean | null;
  rangeQualityAccepted: boolean | null;
  breakoutDirection: Direction | null;
  volatilityShock: boolean | null;
  entrySignalStage: string | null;
  rejectionConfirmed: boolean;
  targetDistanceBps: number | null;
  netRiskRatio: number | null;
  widthAtr: number | null;
  containmentRatio: number | null;
};

export type GridClassicGuardrailContext = Partial<GridClassicSignalContext> & {
  signalDirection: Direction | null;
  baseContextAvailable: boolean;
  gridClassicGateFeatures: GridClassicGateFeatures;
  approvalBlockReasons: string[];
  structuralHardBlockReasons: string[];
  riskAnnotations: string[];
  deterministicQuality: number;
  approvalAllowedNow: boolean;
};

const toFiniteNumberOrNull = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toDirectionOrNull = (value: unknown): Direction | null =>
  value === 'LONG' || value === 'SHORT' ? value : null;

const toBooleanOrNull = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null;

export const buildGridClassicGuardrailContext = ({
  signalContext,
  baseContext,
}: {
  signalContext: Partial<GridClassicSignalContext>;
  baseContext?: BaseStrategyContextSnapshot | null;
}): GridClassicGuardrailContext => {
  const signalDirection = toDirectionOrNull(signalContext.direction);
  const gridLevel = toFiniteNumberOrNull(signalContext.gridLevel);
  const filledLevels = toFiniteNumberOrNull(signalContext.filledLevels);
  const remainingLevels = toFiniteNumberOrNull(signalContext.remainingLevels);
  const action =
    gridLevel === 1
      ? 'open'
      : gridLevel != null && gridLevel > 1
        ? 'increase'
        : null;
  const breakoutDirection = toDirectionOrNull(signalContext.breakoutDirection);
  const entrySignalStage =
    typeof signalContext.entrySignalStage === 'string'
      ? signalContext.entrySignalStage
      : null;
  const rejectionConfirmed =
    signalDirection === 'LONG'
      ? signalContext.longRejection === true ||
        signalContext.longCloseInside === true
      : signalDirection === 'SHORT'
        ? signalContext.shortRejection === true ||
          signalContext.shortCloseInside === true
        : false;
  const structuralHardBlockReasons: string[] = [];

  if (signalDirection == null) {
    structuralHardBlockReasons.push('missing_signal_direction');
  }
  if (
    action == null ||
    gridLevel == null ||
    !Number.isInteger(gridLevel) ||
    filledLevels == null ||
    !Number.isInteger(filledLevels) ||
    filledLevels !== gridLevel - 1 ||
    remainingLevels == null ||
    !Number.isInteger(remainingLevels) ||
    remainingLevels < 0
  ) {
    structuralHardBlockReasons.push('invalid_grid_level_state');
  }
  if (
    signalContext.rangeReady !== true ||
    signalContext.rangeDetected !== true
  ) {
    structuralHardBlockReasons.push('range_not_ready');
  }
  if (signalContext.rangeQualityAccepted !== true) {
    structuralHardBlockReasons.push('range_quality_rejected');
  }
  if (breakoutDirection != null) {
    structuralHardBlockReasons.push('range_breakout');
  }
  if (signalContext.volatilityShock === true) {
    structuralHardBlockReasons.push('volatility_shock');
  }
  if (action === 'open') {
    if (entrySignalStage !== 'confirmed' && entrySignalStage !== 'immediate') {
      structuralHardBlockReasons.push('entry_not_confirmed');
    }
  }

  const targetDistanceBps = toFiniteNumberOrNull(
    signalContext.targetDistanceBps,
  );
  const netRiskRatio = toFiniteNumberOrNull(signalContext.netRiskRatio);
  if (
    targetDistanceBps == null ||
    targetDistanceBps <= 0 ||
    netRiskRatio == null ||
    netRiskRatio <= 0
  ) {
    structuralHardBlockReasons.push('invalid_entry_economics');
  }

  const riskAnnotations: string[] = [];
  if (baseContext == null) riskAnnotations.push('missing_base_context');

  const deterministicQuality = structuralHardBlockReasons.length === 0 ? 3 : 2;
  const approvalBlockReasons = [...structuralHardBlockReasons];
  if (structuralHardBlockReasons.length === 0) {
    approvalBlockReasons.push('validated_market_pocket_missing');
  }
  const approvalAllowedNow =
    deterministicQuality >= 4 && structuralHardBlockReasons.length === 0;
  const gridClassicGateFeatures: GridClassicGateFeatures = {
    signalDirection,
    action,
    gridLevel,
    filledLevels,
    remainingLevels,
    rangeReady: toBooleanOrNull(signalContext.rangeReady),
    rangeDetected: toBooleanOrNull(signalContext.rangeDetected),
    rangeQualityAccepted: toBooleanOrNull(signalContext.rangeQualityAccepted),
    breakoutDirection,
    volatilityShock: toBooleanOrNull(signalContext.volatilityShock),
    entrySignalStage,
    rejectionConfirmed,
    targetDistanceBps,
    netRiskRatio,
    widthAtr: toFiniteNumberOrNull(signalContext.widthAtr),
    containmentRatio: toFiniteNumberOrNull(signalContext.containmentRatio),
  };

  return {
    ...signalContext,
    signalDirection,
    baseContextAvailable: baseContext != null,
    gridClassicGateFeatures,
    approvalBlockReasons,
    structuralHardBlockReasons,
    riskAnnotations,
    deterministicQuality,
    approvalAllowedNow,
  };
};

export interface GridClassicPlannedLevel {
  level: number;
  price: number;
  qty: number;
  worstCaseLoss: number;
}

export interface GridClassicGridPlan {
  stopLossPrice: number;
  takeProfitPrice: number;
  stepDistance: number;
  levels: GridClassicPlannedLevel[];
  worstCaseLoss: number;
}

export const calculateGridClassicUnitLoss = ({
  entryPrice,
  stopLossPrice,
  feeRate,
  slippageRate,
}: {
  entryPrice: number;
  stopLossPrice: number;
  feeRate: number;
  slippageRate: number;
}) => {
  const executionCostRate = Math.max(0, feeRate) + Math.max(0, slippageRate);
  return (
    Math.abs(entryPrice - stopLossPrice) +
    Math.abs(entryPrice) * executionCostRate +
    Math.abs(stopLossPrice) * executionCostRate
  );
};

export const calculateGridClassicPositionLoss = ({
  qty,
  averagePrice,
  stopLossPrice,
  feeRate,
  slippageRate,
}: {
  qty: number;
  averagePrice: number;
  stopLossPrice: number;
  feeRate: number;
  slippageRate: number;
}) =>
  Math.max(0, qty) *
  calculateGridClassicUnitLoss({
    entryPrice: averagePrice,
    stopLossPrice,
    feeRate,
    slippageRate,
  });

export const calculateGridClassicBreakEvenPrice = ({
  direction,
  entryPrice,
  feeRate,
  slippageRate,
  offsetBps,
}: {
  direction: Direction;
  entryPrice: number;
  feeRate: number;
  slippageRate: number;
  offsetBps: number;
}) => {
  const executionCostRate = Math.min(
    0.49,
    Math.max(0, feeRate) + Math.max(0, slippageRate),
  );
  const offsetRate = Math.max(0, Number(offsetBps) || 0) / 10_000;
  return direction === 'LONG'
    ? ((entryPrice * (1 + executionCostRate)) / (1 - executionCostRate)) *
        (1 + offsetRate)
    : Math.max(
        Number.EPSILON,
        ((entryPrice * (1 - executionCostRate)) / (1 + executionCostRate)) *
          (1 - offsetRate),
      );
};

export const evaluateGridClassicEntryEconomics = ({
  entryPrice,
  plan,
  feeRate,
  slippageRate,
  minTargetDistanceBps,
  minNetRiskRatio,
}: {
  entryPrice: number;
  plan: GridClassicGridPlan;
  feeRate: number;
  slippageRate: number;
  minTargetDistanceBps: number;
  minNetRiskRatio: number;
}): GridClassicEntryEconomics => {
  const targetDistanceBps =
    entryPrice > 0
      ? (Math.abs(plan.takeProfitPrice - entryPrice) / entryPrice) * 10_000
      : 0;
  const executionCostRate = Math.max(0, feeRate) + Math.max(0, slippageRate);
  const grossReward = plan.levels.reduce(
    (sum, level) =>
      sum + level.qty * Math.abs(plan.takeProfitPrice - level.price),
    0,
  );
  const executionCosts = plan.levels.reduce(
    (sum, level) =>
      sum +
      level.qty *
        (Math.abs(level.price) + Math.abs(plan.takeProfitPrice)) *
        executionCostRate,
    0,
  );
  const netReward = Math.max(0, grossReward - executionCosts);
  const netRisk = Math.max(0, plan.worstCaseLoss);
  const netRiskRatio =
    netRisk > Number.EPSILON ? netReward / netRisk : Number.POSITIVE_INFINITY;
  const normalizedMinTargetDistanceBps = Math.max(
    0,
    Number(minTargetDistanceBps) || 0,
  );
  const normalizedMinNetRiskRatio = Math.max(0, Number(minNetRiskRatio) || 0);
  const rejectReason =
    targetDistanceBps < normalizedMinTargetDistanceBps
      ? 'target_distance'
      : netRiskRatio < normalizedMinNetRiskRatio
        ? 'net_risk_ratio'
        : null;

  return {
    accepted: rejectReason == null,
    rejectReason,
    targetDistanceBps,
    grossReward,
    executionCosts,
    netReward,
    netRisk,
    netRiskRatio,
  };
};

export const buildGridClassicGridPlan = ({
  direction,
  entryPrice,
  lowerPrice,
  upperPrice,
  atr,
  levels,
  stepAtr,
  stepRangeFraction,
  levelSizeDecay,
  stopAtrBuffer,
  takeProfitMode,
  maxLossValue,
  feeRate,
  slippageRate,
}: {
  direction: Direction;
  entryPrice: number;
  lowerPrice: number;
  upperPrice: number;
  atr: number;
  levels: number;
  stepAtr: number;
  stepRangeFraction: number;
  levelSizeDecay: number;
  stopAtrBuffer: number;
  takeProfitMode: 'center' | 'opposite_edge';
  maxLossValue: number;
  feeRate: number;
  slippageRate: number;
}): GridClassicGridPlan | null => {
  if (
    ![entryPrice, lowerPrice, upperPrice, atr, maxLossValue].every(
      Number.isFinite,
    ) ||
    upperPrice <= lowerPrice ||
    atr <= 0 ||
    maxLossValue <= 0
  ) {
    return null;
  }

  const levelCount = Math.max(1, Math.floor(levels));
  const rangeWidth = upperPrice - lowerPrice;
  const stopLossPrice =
    direction === 'LONG'
      ? lowerPrice - atr * Math.max(0, stopAtrBuffer)
      : upperPrice + atr * Math.max(0, stopAtrBuffer);
  const centerPrice = (lowerPrice + upperPrice) / 2;
  const takeProfitPrice =
    takeProfitMode === 'opposite_edge'
      ? direction === 'LONG'
        ? upperPrice
        : lowerPrice
      : centerPrice;
  const stopDistance = Math.abs(entryPrice - stopLossPrice);
  if (
    stopDistance <= Number.EPSILON ||
    (direction === 'LONG' &&
      (stopLossPrice >= entryPrice || takeProfitPrice <= entryPrice)) ||
    (direction === 'SHORT' &&
      (stopLossPrice <= entryPrice || takeProfitPrice >= entryPrice))
  ) {
    return null;
  }

  const rawStep = Math.max(
    atr * Math.max(0.01, stepAtr),
    rangeWidth * Math.max(0.001, stepRangeFraction),
  );
  const maxStep =
    levelCount > 1 ? stopDistance / Math.max(1.5, levelCount - 0.5) : rawStep;
  const stepDistance = Math.min(rawStep, maxStep);
  const levelPrices = Array.from({ length: levelCount }, (_, index) =>
    direction === 'LONG'
      ? entryPrice - stepDistance * index
      : entryPrice + stepDistance * index,
  );
  const decay = Math.min(1, Math.max(0.01, levelSizeDecay));
  const weights: number[] = [1];
  for (let index = 1; index < levelPrices.length; index += 1) {
    const previousWeight = weights[index - 1];
    const previousPrice = levelPrices[index - 1];
    const price = levelPrices[index];
    const quantityCap = previousWeight * decay;
    const notionalCap =
      price > 0 ? (previousWeight * previousPrice) / price : 0;
    weights.push(Math.max(0, Math.min(quantityCap, notionalCap)));
  }

  const weightedRisk = levelPrices.reduce(
    (sum, price, index) =>
      sum +
      weights[index] *
        calculateGridClassicUnitLoss({
          entryPrice: price,
          stopLossPrice,
          feeRate,
          slippageRate,
        }),
    0,
  );
  if (!Number.isFinite(weightedRisk) || weightedRisk <= Number.EPSILON) {
    return null;
  }

  const baseQty = maxLossValue / weightedRisk;
  const plannedLevels = levelPrices.map((price, index) => {
    const qty = baseQty * weights[index];
    return {
      level: index + 1,
      price,
      qty,
      worstCaseLoss:
        qty *
        calculateGridClassicUnitLoss({
          entryPrice: price,
          stopLossPrice,
          feeRate,
          slippageRate,
        }),
    };
  });

  return {
    stopLossPrice,
    takeProfitPrice,
    stepDistance,
    levels: plannedLevels,
    worstCaseLoss: plannedLevels.reduce(
      (sum, level) => sum + level.worstCaseLoss,
      0,
    ),
  };
};
