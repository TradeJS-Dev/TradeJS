import { round } from '@tradejs/core/math';

import {
  buildTrendlineStructuralContext,
  buildTrendlineTimingContext,
} from './guardrails';
import { TrendLineConfig } from './config';
import { Direction } from '@tradejs/types';
import {
  clampNumber,
  normalizePositiveNumber,
} from '@tradejs/strategy-kit/numbers';

type TrendlineStructuralContext = ReturnType<
  typeof buildTrendlineStructuralContext
>;
type TrendlineTimingContext = ReturnType<typeof buildTrendlineTimingContext>;

const MIN_STOP_BUFFER_PCT = 0.15;
const LINE_BUFFER_ATR_FACTOR = 0.35;
const LINE_BUFFER_BASE_SL_FACTOR = 0.15;
const ATR_STOP_FLOOR_FACTOR = 0.8;
const MIN_STOP_LOSS_FACTOR = 0.75;
const MAX_STOP_LOSS_FACTOR = 2.25;

const getTimingStopFactor = (
  entryTiming: TrendlineTimingContext['entryTiming'],
) => {
  if (entryTiming === 'ready_retest') {
    return 0.9;
  }

  if (entryTiming === 'ready_follow_through') {
    return 1.05;
  }

  return 1;
};

const getTimingTargetRiskRatio = ({
  direction,
  entryTiming,
}: {
  direction: Direction;
  entryTiming: TrendlineTimingContext['entryTiming'];
}) => {
  if (direction === 'LONG') {
    if (entryTiming === 'ready_retest') {
      return 2.45;
    }

    if (entryTiming === 'ready_follow_through') {
      return 2.3;
    }

    return 2.6;
  }

  if (entryTiming === 'ready_retest') {
    return 2.3;
  }

  if (entryTiming === 'ready_follow_through') {
    return 2.15;
  }

  return 2.45;
};

export interface TrendlineRiskPlan {
  stopLossDelta: number;
  takeProfitDelta: number;
  targetRiskRatio: number;
}

export const buildTrendlineRiskPlan = ({
  direction,
  modeConfig,
  baseStopLossDelta,
  baseTargetRiskRatio,
  structuralContext,
  timingContext,
}: {
  direction: Direction;
  modeConfig: TrendLineConfig['HIGHS'];
  baseStopLossDelta: number;
  baseTargetRiskRatio: number;
  structuralContext: TrendlineStructuralContext;
  timingContext: TrendlineTimingContext;
}): TrendlineRiskPlan => {
  const normalizedBaseStopLossDelta = normalizePositiveNumber(
    baseStopLossDelta,
    1,
  );
  const normalizedBaseTargetRiskRatio = normalizePositiveNumber(
    baseTargetRiskRatio,
    modeConfig.minRiskRatio + 0.5,
  );
  const atrPct = structuralContext.atrPct ?? normalizedBaseStopLossDelta;
  const priceVsLinePctAbs = structuralContext.priceVsLinePctAbs ?? 0;
  const breakVsAtrRatio = structuralContext.breakVsAtrRatio ?? 0;
  const touches = structuralContext.touches ?? 0;
  const distance = structuralContext.distance ?? null;

  const lineBufferPct = Math.max(
    atrPct * LINE_BUFFER_ATR_FACTOR,
    normalizedBaseStopLossDelta * LINE_BUFFER_BASE_SL_FACTOR,
    MIN_STOP_BUFFER_PCT,
  );
  const lineInvalidationPct = priceVsLinePctAbs + lineBufferPct;
  const volatilityFloorPct = Math.max(
    atrPct * ATR_STOP_FLOOR_FACTOR,
    normalizedBaseStopLossDelta * MIN_STOP_LOSS_FACTOR,
  );

  let stopLossDelta = Math.max(lineInvalidationPct, volatilityFloorPct);

  if (touches >= 6) {
    stopLossDelta *= 0.95;
  } else if (touches > 0 && touches <= 4) {
    stopLossDelta *= 1.05;
  }

  if (distance != null && distance >= 250) {
    stopLossDelta *= 1.08;
  } else if (distance != null && distance <= 120) {
    stopLossDelta *= 0.95;
  }

  stopLossDelta *= getTimingStopFactor(timingContext.entryTiming);

  if (direction === 'SHORT') {
    stopLossDelta *= 1.08;
  }

  if (breakVsAtrRatio >= 1.5) {
    stopLossDelta *= 0.95;
  }

  stopLossDelta = clampNumber(
    stopLossDelta,
    normalizedBaseStopLossDelta * MIN_STOP_LOSS_FACTOR,
    normalizedBaseStopLossDelta * MAX_STOP_LOSS_FACTOR,
  );

  const timingBaseRiskRatio = getTimingTargetRiskRatio({
    direction,
    entryTiming: timingContext.entryTiming,
  });
  let targetRiskRatio =
    timingBaseRiskRatio + (normalizedBaseTargetRiskRatio - 2.6);

  if (breakVsAtrRatio >= 1.25) {
    targetRiskRatio += 0.2;
  } else if (breakVsAtrRatio > 0 && breakVsAtrRatio < 0.75) {
    targetRiskRatio -= 0.15;
  }

  if (touches >= 6) {
    targetRiskRatio += 0.1;
  }

  if (distance != null && distance >= 120 && distance <= 350) {
    targetRiskRatio += 0.1;
  }

  if (direction === 'SHORT' && distance != null && distance > 450) {
    targetRiskRatio -= 0.25;
  }

  if (direction === 'LONG' && distance != null && distance > 500) {
    targetRiskRatio -= 0.15;
  }

  const minTargetRiskRatio = modeConfig.minRiskRatio + 0.05;
  const maxTargetRiskRatio =
    Math.max(normalizedBaseTargetRiskRatio, minTargetRiskRatio) + 0.4;

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
