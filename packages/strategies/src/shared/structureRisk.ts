import type { Direction } from '@tradejs/types';

export interface StructureRiskPlanParams {
  currentPrice: number;
  direction: Direction;
  stopLossPrice: number;
  targetR: number;
  maxLossValue: number;
  feePercent: number;
}

export interface StructureRiskPlan {
  stopLossPrice: number;
  takeProfitPrice: number;
  riskRatio: number;
  qty: number;
}

export const buildStructureRiskPlan = ({
  currentPrice,
  direction,
  stopLossPrice,
  targetR,
  maxLossValue,
  feePercent,
}: StructureRiskPlanParams): StructureRiskPlan => {
  const riskDistance = Math.abs(currentPrice - stopLossPrice);
  const normalizedTargetR = Math.max(0, Number(targetR));
  const takeProfitPrice =
    direction === 'LONG'
      ? currentPrice + riskDistance * normalizedTargetR
      : currentPrice - riskDistance * normalizedTargetR;
  const riskRatio = riskDistance > 0 ? normalizedTargetR : 0;
  const rawQty =
    riskDistance > 0 ? Number(maxLossValue ?? 0) / riskDistance : 0;
  const feeBuffer = 1 + Math.max(0, Number(feePercent ?? 0)) / 100;
  const qty = rawQty / feeBuffer;

  return {
    stopLossPrice,
    takeProfitPrice,
    riskRatio,
    qty,
  };
};

export const isStopLossOnCorrectSide = ({
  direction,
  currentPrice,
  stopLossPrice,
}: {
  direction: Direction;
  currentPrice: number;
  stopLossPrice: number;
}) =>
  direction === 'LONG'
    ? stopLossPrice < currentPrice
    : stopLossPrice > currentPrice;
