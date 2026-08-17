import { round } from '@tradejs/core/math';
import type { Direction } from '@tradejs/types';
import { isFiniteNumber } from './numbers';

export interface StructureRiskPlanParams {
  currentPrice: number;
  direction: Direction;
  stopLossPrice: number;
  targetR: number;
  maxLossValue: number;
  /** Decimal rate: 0.001 means 0.1%. */
  feeRate: number;
  /** One-way adverse execution cost in basis points. */
  slippageBps?: number;
}

export interface StructureRiskPlan {
  stopLossPrice: number;
  takeProfitPrice: number;
  grossRiskRatio: number;
  /** Reward/risk after entry and exit fees and adverse slippage. */
  riskRatio: number;
  qty: number;
  lossPerUnit: number;
  rewardPerUnit: number;
}

export interface TradeEconomicsParams {
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  feeRate: number;
  slippageBps?: number;
}

export interface TradeEconomics {
  grossRiskPerUnit: number;
  grossRewardPerUnit: number;
  lossPerUnit: number;
  rewardPerUnit: number;
  grossRiskRatio: number;
  netRiskRatio: number;
  roundTripEntryStopCostPerUnit: number;
  roundTripEntryTargetCostPerUnit: number;
}

const normalizeRate = (value: unknown) =>
  Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);

export const buildTradeEconomics = ({
  entryPrice,
  stopLossPrice,
  takeProfitPrice,
  feeRate,
  slippageBps = 0,
}: TradeEconomicsParams): TradeEconomics => {
  const normalizedFeeRate = normalizeRate(feeRate);
  const slippageRate = normalizeRate(slippageBps) / 10_000;
  const executionCostRate = normalizedFeeRate + slippageRate;
  const entryCost = Math.abs(entryPrice) * executionCostRate;
  const stopCost = Math.abs(stopLossPrice) * executionCostRate;
  const targetCost = Math.abs(takeProfitPrice) * executionCostRate;
  const grossRiskPerUnit = Math.abs(entryPrice - stopLossPrice);
  const grossRewardPerUnit = Math.abs(takeProfitPrice - entryPrice);
  const roundTripEntryStopCostPerUnit = entryCost + stopCost;
  const roundTripEntryTargetCostPerUnit = entryCost + targetCost;
  const lossPerUnit = grossRiskPerUnit + roundTripEntryStopCostPerUnit;
  const rewardPerUnit = Math.max(
    0,
    grossRewardPerUnit - roundTripEntryTargetCostPerUnit,
  );

  return {
    grossRiskPerUnit,
    grossRewardPerUnit,
    lossPerUnit,
    rewardPerUnit,
    grossRiskRatio:
      grossRiskPerUnit > 0 ? grossRewardPerUnit / grossRiskPerUnit : 0,
    netRiskRatio: lossPerUnit > 0 ? rewardPerUnit / lossPerUnit : 0,
    roundTripEntryStopCostPerUnit,
    roundTripEntryTargetCostPerUnit,
  };
};

export const buildStructureRiskPlan = ({
  currentPrice,
  direction,
  stopLossPrice,
  targetR,
  maxLossValue,
  feeRate,
  slippageBps,
}: StructureRiskPlanParams): StructureRiskPlan => {
  const riskDistance = Math.abs(currentPrice - stopLossPrice);
  const normalizedTargetR = Math.max(0, Number(targetR));
  const takeProfitPrice =
    direction === 'LONG'
      ? currentPrice + riskDistance * normalizedTargetR
      : currentPrice - riskDistance * normalizedTargetR;
  const economics = buildTradeEconomics({
    entryPrice: currentPrice,
    stopLossPrice,
    takeProfitPrice,
    feeRate,
    slippageBps,
  });
  const qty =
    riskDistance > 0 && economics.lossPerUnit > 0
      ? Math.max(0, Number(maxLossValue ?? 0)) / economics.lossPerUnit
      : 0;

  return {
    stopLossPrice,
    takeProfitPrice,
    grossRiskRatio: economics.grossRiskRatio,
    riskRatio: economics.netRiskRatio,
    qty,
    lossPerUnit: economics.lossPerUnit,
    rewardPerUnit: economics.rewardPerUnit,
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

export const resolveAtrBuffer = ({
  atr,
  currentPrice,
  atrMult,
  bufferPct,
}: {
  atr: number | null | undefined;
  currentPrice: number;
  atrMult: number;
  bufferPct: number;
}) =>
  Math.max(
    Math.max(0, atr ?? 0) * Math.max(0, atrMult),
    currentPrice * (Math.max(0, bufferPct) / 100),
  );

export const buildAtrFallbackStop = ({
  direction,
  currentPrice,
  atr,
  atrMult,
  bufferPct,
}: {
  direction: Direction;
  currentPrice: number;
  atr: number | null | undefined;
  atrMult: number;
  bufferPct: number;
}) => {
  const distance = resolveAtrBuffer({
    atr,
    currentPrice,
    atrMult,
    bufferPct,
  });
  return direction === 'LONG'
    ? currentPrice - distance
    : currentPrice + distance;
};

export const buildContextRiskOrder = ({
  currentPrice,
  direction,
  stopLossPrice,
  targetR,
  maxLossValue,
  feeRate,
  slippageBps = 0,
  minRiskRatio,
}: {
  currentPrice: number;
  direction: Direction;
  stopLossPrice: number;
  targetR: number;
  maxLossValue: number;
  feeRate: number;
  slippageBps?: number;
  minRiskRatio: number;
}):
  | {
      skipCode: string;
      plan?: never;
    }
  | {
      skipCode?: never;
      plan: {
        qty: number;
        stopLossPrice: number;
        takeProfitPrice: number;
        riskRatio: number;
      };
    } => {
  if (
    !isFiniteNumber(stopLossPrice) ||
    !isStopLossOnCorrectSide({
      direction,
      currentPrice,
      stopLossPrice,
    })
  ) {
    return { skipCode: 'INVALID_STOP' };
  }

  const plan = buildStructureRiskPlan({
    currentPrice,
    direction,
    stopLossPrice,
    targetR,
    maxLossValue,
    feeRate,
    slippageBps,
  });

  if (!plan.qty || !Number.isFinite(plan.qty) || plan.qty <= 0) {
    return { skipCode: 'INVALID_QTY' };
  }

  if (plan.riskRatio <= minRiskRatio) {
    return { skipCode: `RISK_RATIO:${round(plan.riskRatio)}` };
  }

  return { plan };
};
