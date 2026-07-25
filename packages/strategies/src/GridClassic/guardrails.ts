import type { Direction } from '@tradejs/types';

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
