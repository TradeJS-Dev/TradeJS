import type {
  Direction,
  StrategyEntryModelFigures,
  StrategyFigureAnnotation,
  StrategyFigureLine,
  StrategyFigurePoints,
} from '@tradejs/types';
import { isFiniteNumber } from './numbers';

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
