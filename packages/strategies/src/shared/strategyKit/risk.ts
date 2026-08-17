import { round } from '@tradejs/core/math';
import type { Direction } from '@tradejs/types';
import {
  buildStructureRiskPlan,
  isStopLossOnCorrectSide,
} from '../structureRisk';
import { isFiniteNumber } from './numbers';

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
