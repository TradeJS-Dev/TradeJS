import type {
  Direction,
  StrategyEntryModelFigures,
  StrategyFigureLine,
  StrategyFigurePoints,
} from '@tradejs/types';
import type { CausalRangeGeometry } from '@tradejs/indicators/range-geometry';
import type { GridClassicPlannedLevel } from './guardrails';

export interface GridClassicExecutedLevel {
  level: number;
  timestamp: number;
  price: number;
  qty: number;
}

const horizontalLine = ({
  id,
  kind,
  value,
  startTimestamp,
  endTimestamp,
  color,
  style = 'dashed',
}: {
  id: string;
  kind: string;
  value: number;
  startTimestamp: number;
  endTimestamp: number;
  color: string;
  style?: 'solid' | 'dashed';
}): StrategyFigureLine => ({
  id,
  kind,
  points: [
    { timestamp: startTimestamp, value },
    { timestamp: endTimestamp, value },
  ],
  color,
  width: 1,
  style,
});

export const buildGridClassicFigures = ({
  direction,
  geometry,
  entryTimestamp,
  entryPrice,
  plannedLevels,
  executedLevels,
  stopLossPrice,
  takeProfitPrice,
  edgeZoneFraction,
  breakoutPoint = null,
}: {
  direction: Direction;
  geometry: CausalRangeGeometry;
  entryTimestamp: number;
  entryPrice: number;
  plannedLevels: GridClassicPlannedLevel[];
  executedLevels: GridClassicExecutedLevel[];
  stopLossPrice: number;
  takeProfitPrice: number;
  edgeZoneFraction: number;
  breakoutPoint?: { timestamp: number; value: number } | null;
}): StrategyEntryModelFigures => {
  const startTimestamp =
    geometry.upperLine?.startTimestamp ??
    geometry.lowerLine?.startTimestamp ??
    entryTimestamp;
  const lines: StrategyFigureLine[] = [];

  if (geometry.upperLine) {
    lines.push({
      id: `gridclassic-upper-${entryTimestamp}`,
      kind: 'gridclassic_upper_boundary',
      points: [
        {
          timestamp: geometry.upperLine.startTimestamp,
          value: geometry.upperLine.startPrice,
        },
        { timestamp: entryTimestamp, value: geometry.upperPrice ?? entryPrice },
      ],
      color: '#a78bfa',
      width: 2,
      style: 'solid',
    });
  }
  if (geometry.lowerLine) {
    lines.push({
      id: `gridclassic-lower-${entryTimestamp}`,
      kind: 'gridclassic_lower_boundary',
      points: [
        {
          timestamp: geometry.lowerLine.startTimestamp,
          value: geometry.lowerLine.startPrice,
        },
        { timestamp: entryTimestamp, value: geometry.lowerPrice ?? entryPrice },
      ],
      color: '#a78bfa',
      width: 2,
      style: 'solid',
    });
  }
  if (geometry.centerLine) {
    lines.push({
      id: `gridclassic-center-${entryTimestamp}`,
      kind: 'gridclassic_center',
      points: [
        {
          timestamp: geometry.centerLine.startTimestamp,
          value: geometry.centerLine.startPrice,
        },
        {
          timestamp: entryTimestamp,
          value: geometry.centerPrice ?? entryPrice,
        },
      ],
      color: '#94a3b8',
      width: 1,
      style: 'dashed',
    });
  }

  if (
    geometry.lowerPrice != null &&
    geometry.upperPrice != null &&
    geometry.upperPrice > geometry.lowerPrice
  ) {
    const width = geometry.upperPrice - geometry.lowerPrice;
    lines.push(
      horizontalLine({
        id: `gridclassic-lower-edge-${entryTimestamp}`,
        kind: 'gridclassic_lower_edge_zone',
        value: geometry.lowerPrice + width * edgeZoneFraction,
        startTimestamp,
        endTimestamp: entryTimestamp,
        color: '#38bdf8',
        style: 'dashed',
      }),
      horizontalLine({
        id: `gridclassic-upper-edge-${entryTimestamp}`,
        kind: 'gridclassic_upper_edge_zone',
        value: geometry.upperPrice - width * edgeZoneFraction,
        startTimestamp,
        endTimestamp: entryTimestamp,
        color: '#f59e0b',
        style: 'dashed',
      }),
    );
  }

  plannedLevels.forEach((level) => {
    lines.push(
      horizontalLine({
        id: `gridclassic-level-${entryTimestamp}-${level.level}`,
        kind: 'gridclassic_virtual_level',
        value: level.price,
        startTimestamp,
        endTimestamp: entryTimestamp,
        color: '#60a5fa',
        style: 'dashed',
      }),
    );
  });
  lines.push(
    horizontalLine({
      id: `gridclassic-stop-${entryTimestamp}`,
      kind: 'gridclassic_stop',
      value: stopLossPrice,
      startTimestamp,
      endTimestamp: entryTimestamp,
      color: '#ef4444',
    }),
    horizontalLine({
      id: `gridclassic-target-${entryTimestamp}`,
      kind: 'gridclassic_take_profit',
      value: takeProfitPrice,
      startTimestamp,
      endTimestamp: entryTimestamp,
      color: '#22c55e',
    }),
  );

  const pivotPoints: StrategyFigurePoints = {
    id: `gridclassic-pivots-${entryTimestamp}`,
    kind: 'gridclassic_confirmed_pivots',
    points: geometry.pivots.map((pivot) => ({
      timestamp: pivot.timestamp,
      value: pivot.price,
    })),
    color: '#c084fc',
    radius: 3,
  };
  const executedPoints: StrategyFigurePoints = {
    id: `gridclassic-executed-${entryTimestamp}`,
    kind: 'gridclassic_executed_levels',
    points: executedLevels.map((level) => ({
      timestamp: level.timestamp,
      value: level.price,
    })),
    color: direction === 'LONG' ? '#22c55e' : '#ef4444',
    radius: 4,
  };
  const points: StrategyFigurePoints[] = [
    pivotPoints,
    executedPoints,
    {
      id: `gridclassic-entry-${entryTimestamp}`,
      kind: 'gridclassic_entry',
      points: [{ timestamp: entryTimestamp, value: entryPrice }],
      color: direction === 'LONG' ? '#22c55e' : '#ef4444',
      radius: 5,
    },
  ];
  if (breakoutPoint) {
    points.push({
      id: `gridclassic-breakout-${entryTimestamp}`,
      kind: 'gridclassic_breakout_or_invalidation',
      points: [breakoutPoint],
      color: '#f97316',
      radius: 5,
    });
  }

  return { lines, points };
};
