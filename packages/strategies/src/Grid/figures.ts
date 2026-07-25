import {
  Direction,
  StrategyEntryModelFigures,
  StrategyFigureLine,
  StrategyFigurePoints,
} from '@tradejs/types';
import { GridFigureSeries } from './engine';
import type { GridRangeGeometry } from './rangeGeometry';

export const buildGridFigures = ({
  direction,
  series,
  entryTimestamp,
  entryPrice,
  stepDistance,
  maxLevels,
  stopLossPrice,
  takeProfitPrice,
  rangeGeometry,
}: {
  direction: Direction;
  series: GridFigureSeries;
  entryTimestamp: number;
  entryPrice: number;
  stepDistance: number;
  maxLevels: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  rangeGeometry?: GridRangeGeometry;
}): StrategyEntryModelFigures => {
  const startTimestamp =
    series.emaSlow[0]?.timestamp ??
    series.emaFast[0]?.timestamp ??
    entryTimestamp;
  const directionSign = direction === 'LONG' ? -1 : 1;
  const levelLines: StrategyFigureLine[] = Array.from(
    { length: Math.max(1, Math.floor(maxLevels)) },
    (_, index) => {
      const level = index + 1;
      const value = entryPrice + directionSign * stepDistance * level;
      return {
        id: `grid-level-${entryTimestamp}-${level}`,
        kind: 'grid_entry_level',
        points: [
          { timestamp: startTimestamp, value },
          { timestamp: entryTimestamp, value },
        ],
        color: '#94a3b8',
        width: 1,
        style: 'dashed' as const,
      };
    },
  );
  const lines: StrategyFigureLine[] = [
    {
      id: `grid-ema-fast-${entryTimestamp}`,
      kind: 'grid_ema_fast',
      points: series.emaFast.slice(),
      color: '#38bdf8',
      width: 2,
      style: 'solid' as const,
    },
    {
      id: `grid-ema-slow-${entryTimestamp}`,
      kind: 'grid_ema_slow',
      points: series.emaSlow.slice(),
      color: '#f59e0b',
      width: 2,
      style: 'solid' as const,
    },
    ...(rangeGeometry?.ready &&
    rangeGeometry.startTimestamp != null &&
    rangeGeometry.upperStartPrice != null &&
    rangeGeometry.lowerStartPrice != null &&
    rangeGeometry.upperPrice != null &&
    rangeGeometry.lowerPrice != null
      ? [
          {
            id: `grid-range-upper-${entryTimestamp}`,
            kind: 'grid_range_upper',
            points: [
              {
                timestamp: rangeGeometry.startTimestamp,
                value: rangeGeometry.upperStartPrice,
              },
              { timestamp: entryTimestamp, value: rangeGeometry.upperPrice },
            ],
            color: '#a78bfa',
            width: 1,
            style: 'dashed' as const,
          },
          {
            id: `grid-range-lower-${entryTimestamp}`,
            kind: 'grid_range_lower',
            points: [
              {
                timestamp: rangeGeometry.startTimestamp,
                value: rangeGeometry.lowerStartPrice,
              },
              { timestamp: entryTimestamp, value: rangeGeometry.lowerPrice },
            ],
            color: '#a78bfa',
            width: 1,
            style: 'dashed' as const,
          },
        ]
      : []),
    ...levelLines,
    {
      id: `grid-target-${entryTimestamp}`,
      kind: 'grid_basket_target',
      points: [
        { timestamp: startTimestamp, value: takeProfitPrice },
        { timestamp: entryTimestamp, value: takeProfitPrice },
      ],
      color: '#22c55e',
      width: 2,
      style: 'dashed' as const,
    },
    {
      id: `grid-stop-${entryTimestamp}`,
      kind: 'grid_hard_stop',
      points: [
        { timestamp: startTimestamp, value: stopLossPrice },
        { timestamp: entryTimestamp, value: stopLossPrice },
      ],
      color: '#ef4444',
      width: 2,
      style: 'dashed' as const,
    },
  ].filter((line) => line.points.length > 0);

  const points: StrategyFigurePoints[] = [
    {
      id: `grid-entry-${entryTimestamp}`,
      kind: 'grid_entry',
      points: [{ timestamp: entryTimestamp, value: entryPrice }],
      color: direction === 'LONG' ? '#40d98f' : '#f67171',
      radius: 5,
    },
  ];

  return { lines, points };
};
