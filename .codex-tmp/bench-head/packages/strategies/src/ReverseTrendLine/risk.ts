import { round } from '@tradejs/core/math';
import { Direction } from '@tradejs/types';
import { ReverseTrendLineConfig } from './config';
import {
  buildReverseTrendlineStructuralContext,
  buildReverseTrendlineTimingContext,
} from './guardrails';

type ReverseStructuralContext = ReturnType<
  typeof buildReverseTrendlineStructuralContext
>;
type ReverseTimingContext = ReturnType<
  typeof buildReverseTrendlineTimingContext
>;

const MIN_STOP_BUFFER_PCT = 0.1;
const LINE_BUFFER_ATR_FACTOR = 0.25;
const LINE_BUFFER_BASE_SL_FACTOR = 0.1;
const ATR_STOP_FLOOR_FACTOR = 0.65;
const MIN_STOP_LOSS_FACTOR = 0.8;
const MAX_STOP_LOSS_FACTOR = 2.0;

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const getTimingStopFactor = (
  entryTiming: ReverseTimingContext['entryTiming'],
) => {
  if (entryTiming === 'ready_follow_through') {
    return 0.95;
  }

  return 1;
};

const getTimingTargetRiskRatio = ({
  direction,
  entryTiming,
}: {
  direction: Direction;
  entryTiming: ReverseTimingContext['entryTiming'];
}) => {
  if (direction === 'LONG') {
    return entryTiming === 'ready_follow_through' ? 2.15 : 1.95;
  }

  return entryTiming === 'ready_follow_through' ? 2.2 : 2.0;
};

export interface ReverseTrendlineRiskPlan {
  stopLossDelta: number;
  takeProfitDelta: number;
  targetRiskRatio: number;
}

export const buildReverseTrendlineRiskPlan = ({
  direction,
  modeConfig,
  structuralContext,
  timingContext,
}: {
  direction: Direction;
  modeConfig: ReverseTrendLineConfig['HIGHS'];
  structuralContext: ReverseStructuralContext;
  timingContext: ReverseTimingContext;
}): ReverseTrendlineRiskPlan => {
  const baseStopLossDelta = modeConfig.SL;
  const atrPct = structuralContext.atrPct ?? baseStopLossDelta;
  const priceVsLinePctAbs = structuralContext.priceVsLinePctAbs ?? 0;
  const rejectionStrengthPct = structuralContext.rejectionStrengthPct ?? 0;
  const touches = structuralContext.touches ?? 0;
  const distance = structuralContext.distance ?? null;

  const lineBufferPct = Math.max(
    atrPct * LINE_BUFFER_ATR_FACTOR,
    baseStopLossDelta * LINE_BUFFER_BASE_SL_FACTOR,
    MIN_STOP_BUFFER_PCT,
  );
  const lineInvalidationPct = priceVsLinePctAbs + lineBufferPct;
  const volatilityFloorPct = Math.max(
    atrPct * ATR_STOP_FLOOR_FACTOR,
    baseStopLossDelta * MIN_STOP_LOSS_FACTOR,
  );

  let stopLossDelta = Math.max(lineInvalidationPct, volatilityFloorPct);

  if (touches >= 6) {
    stopLossDelta *= 0.95;
  } else if (touches > 0 && touches <= 4) {
    stopLossDelta *= 1.03;
  }

  if (distance != null && distance >= 400) {
    stopLossDelta *= 1.05;
  } else if (distance != null && distance <= 120) {
    stopLossDelta *= 0.95;
  }

  if (rejectionStrengthPct >= 0.2) {
    stopLossDelta *= 0.95;
  }

  stopLossDelta *= getTimingStopFactor(timingContext.entryTiming);

  stopLossDelta = clampNumber(
    stopLossDelta,
    baseStopLossDelta * MIN_STOP_LOSS_FACTOR,
    baseStopLossDelta * MAX_STOP_LOSS_FACTOR,
  );

  let targetRiskRatio = getTimingTargetRiskRatio({
    direction,
    entryTiming: timingContext.entryTiming,
  });

  if (touches >= 6) {
    targetRiskRatio += 0.1;
  }

  if (distance != null && distance >= 120 && distance <= 350) {
    targetRiskRatio += 0.05;
  }

  if (direction === 'SHORT' && distance != null && distance > 500) {
    targetRiskRatio -= 0.15;
  }

  if (direction === 'LONG' && distance != null && distance > 500) {
    targetRiskRatio -= 0.1;
  }

  const minTargetRiskRatio = modeConfig.minRiskRatio + 0.05;
  const maxTargetRiskRatio =
    Math.max(modeConfig.TP / modeConfig.SL, minTargetRiskRatio) + 0.3;

  targetRiskRatio = clampNumber(
    targetRiskRatio,
    minTargetRiskRatio,
    maxTargetRiskRatio,
  );

  return {
    stopLossDelta: round(stopLossDelta, 3),
    targetRiskRatio: round(targetRiskRatio, 2),
    takeProfitDelta: round(stopLossDelta * targetRiskRatio, 3),
  };
};
