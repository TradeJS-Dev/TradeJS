import { round } from '@tradejs/core/math';
import type {
  Direction,
  Position,
  StrategyEntryModelFigures,
  StrategyFigureAnnotation,
  StrategyFigureLine,
  StrategyFigurePoints,
} from '@tradejs/types';
import {
  buildStructureRiskPlan,
  isStopLossOnCorrectSide,
} from './structureRisk';

export interface ContextStrategySideConfig {
  enable: boolean;
  direction: Direction;
  minRiskRatio: number;
}

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const toFiniteNumberOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const formatFigureMetric = (
  value: number | null | undefined,
  digits = 2,
  suffix = '',
) => (isFiniteNumber(value) ? `${value.toFixed(digits)}${suffix}` : 'n/a');

export const formatFigureRatioAsPercent = (
  value: number | null | undefined,
  digits = 0,
) => (isFiniteNumber(value) ? `${(value * 100).toFixed(digits)}%` : 'n/a');

export const buildEntryEvidenceAnnotation = ({
  idPrefix,
  kind,
  direction,
  entryTimestamp,
  entryPrice,
  title,
  items,
}: {
  idPrefix: string;
  kind: string;
  direction: Direction;
  entryTimestamp: number;
  entryPrice: number;
  title: string;
  items: Array<string | null | undefined>;
}): StrategyFigureAnnotation => ({
  id: `${idPrefix}-evidence-${entryTimestamp}`,
  kind,
  point: {
    timestamp: entryTimestamp,
    value: entryPrice,
  },
  title,
  items: items
    .filter((item): item is string => Boolean(item?.trim()))
    .slice(0, 6),
  color: direction === 'LONG' ? '#4ade80' : '#f87171',
});

export const isOpenPosition = (
  position: Position | null,
): position is Position =>
  Boolean(
    position &&
      isFiniteNumber(position.price) &&
      isFiniteNumber(position.qty) &&
      position.qty > 0 &&
      (position.direction === 'LONG' || position.direction === 'SHORT'),
  );

export const isDirectionAligned = ({
  direction,
  bullValue,
  bearValue,
  value,
}: {
  direction: Direction;
  bullValue: string;
  bearValue: string;
  value: string | null | undefined;
}) => (direction === 'LONG' ? value === bullValue : value === bearValue);

export const isPressureAligned = ({
  direction,
  buyPressurePct,
  bullishMin = 0.55,
  bearishMax = 0.45,
}: {
  direction: Direction;
  buyPressurePct: number | null | undefined;
  bullishMin?: number;
  bearishMax?: number;
}) =>
  buyPressurePct == null
    ? null
    : direction === 'LONG'
      ? buyPressurePct >= bullishMin
      : buyPressurePct <= bearishMax;

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
  feePercent,
  minRiskRatio,
}: {
  currentPrice: number;
  direction: Direction;
  stopLossPrice: number;
  targetR: number;
  maxLossValue: number;
  feePercent: number;
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
    feePercent,
  });

  if (!plan.qty || !Number.isFinite(plan.qty) || plan.qty <= 0) {
    return { skipCode: 'INVALID_QTY' };
  }

  if (plan.riskRatio <= minRiskRatio) {
    return { skipCode: `RISK_RATIO:${round(plan.riskRatio)}` };
  }

  return { plan };
};

export const buildEntryStopTargetFigures = ({
  idPrefix,
  direction,
  entryTimestamp,
  entryPrice,
  stopLossPrice,
  takeProfitPrice,
  referenceTimestamp,
  referencePrice,
  referenceKind = 'reference',
}: {
  idPrefix: string;
  direction: Direction;
  entryTimestamp: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  referenceTimestamp?: number | null;
  referencePrice?: number | null;
  referenceKind?: string;
}): StrategyEntryModelFigures => {
  const color = direction === 'LONG' ? '#22c55e' : '#ef4444';
  const startTimestamp = referenceTimestamp ?? entryTimestamp;
  const lines: StrategyFigureLine[] = [
    {
      id: `${idPrefix}-target-${entryTimestamp}`,
      kind: `${idPrefix}_target`,
      points: [
        { timestamp: startTimestamp, value: takeProfitPrice },
        { timestamp: entryTimestamp, value: takeProfitPrice },
      ],
      color: '#22c55e',
      width: 1,
      style: 'dashed',
    },
    {
      id: `${idPrefix}-stop-${entryTimestamp}`,
      kind: `${idPrefix}_stop`,
      points: [
        { timestamp: startTimestamp, value: stopLossPrice },
        { timestamp: entryTimestamp, value: stopLossPrice },
      ],
      color: '#ef4444',
      width: 1,
      style: 'dashed',
    },
  ];

  if (referencePrice != null && Number.isFinite(referencePrice)) {
    lines.push({
      id: `${idPrefix}-${referenceKind}-${entryTimestamp}`,
      kind: `${idPrefix}_${referenceKind}`,
      points: [
        { timestamp: startTimestamp, value: referencePrice },
        { timestamp: entryTimestamp, value: referencePrice },
      ],
      color,
      width: 1,
      style: 'dashed',
    });
  }

  const points: StrategyFigurePoints[] = [
    {
      id: `${idPrefix}-entry-${entryTimestamp}`,
      kind: `${idPrefix}_entry`,
      points: [{ timestamp: entryTimestamp, value: entryPrice }],
      color,
      radius: 5,
    },
  ];

  return { lines, points };
};
