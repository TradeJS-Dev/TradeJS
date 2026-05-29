import {
  Direction,
  StrategyEntryModelFigures,
  StrategyFigureLine,
  StrategyFigurePoints,
} from '@tradejs/types';
import { TrendShiftFigureSeries } from './engine';

export const buildTrendShiftFigures = ({
  series,
  direction,
  entryTimestamp,
  entryPrice,
}: {
  series: TrendShiftFigureSeries;
  direction: Direction;
  entryTimestamp: number;
  entryPrice: number;
}): StrategyEntryModelFigures => {
  const trendColor = direction === 'LONG' ? '#00b894' : '#d63031';

  const lines: StrategyFigureLine[] = [
    {
      id: 'trendshift-upper',
      kind: 'trendshift_upper',
      points: series.upper.slice(),
      color: trendColor,
      width: 1,
      style: 'dashed' as const,
    },
    {
      id: 'trendshift-avg',
      kind: 'trendshift_avg',
      points: series.avg.slice(),
      color: trendColor,
      width: 2,
      style: 'solid' as const,
    },
    {
      id: 'trendshift-lower',
      kind: 'trendshift_lower',
      points: series.lower.slice(),
      color: trendColor,
      width: 1,
      style: 'dashed' as const,
    },
  ].filter((line) => Array.isArray(line.points) && line.points.length > 0);

  const points: StrategyFigurePoints[] = [
    {
      id: `trendshift-entry-${entryTimestamp}`,
      kind: 'trendshift_entry',
      points: [{ timestamp: entryTimestamp, value: entryPrice }],
      color: trendColor,
      radius: 4,
    },
  ];

  return { lines, points };
};
