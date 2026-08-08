import type { Direction } from '@tradejs/types';

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
