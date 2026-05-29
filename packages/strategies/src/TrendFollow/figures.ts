import {
  StrategyEntryModelFigures,
  StrategyFigureLine,
  StrategyFigurePoints,
} from '@tradejs/types';
import { TrendFollowFigureSeries, TrendFollowSignal } from './engine';

export const buildTrendFollowFigures = ({
  signal,
  series,
  entryTimestamp,
  entryPrice,
  stopLossPrice,
  takeProfitPrice,
}: {
  signal: TrendFollowSignal;
  series: TrendFollowFigureSeries;
  entryTimestamp: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
}): StrategyEntryModelFigures => {
  const color = signal.direction === 'LONG' ? '#00c853' : '#ef5350';

  const lines: StrategyFigureLine[] = [
    {
      id: `trendfollow-trail-${entryTimestamp}`,
      kind: 'trendfollow_trailing_stop',
      points: series.trailStop.slice(),
      color,
      width: 2,
      style: 'solid' as const,
    },
    {
      id: `trendfollow-entry-level-${entryTimestamp}`,
      kind: 'trendfollow_entry_level',
      points: [
        { timestamp: signal.pivot.timestamp, value: signal.entryLevel },
        { timestamp: entryTimestamp, value: signal.entryLevel },
      ],
      color: '#f59e0b',
      width: 2,
      style: 'dashed' as const,
    },
    {
      id: `trendfollow-target-${entryTimestamp}`,
      kind: 'trendfollow_target',
      points: [
        { timestamp: signal.pivot.timestamp, value: takeProfitPrice },
        { timestamp: entryTimestamp, value: takeProfitPrice },
      ],
      color: '#22c55e',
      width: 1,
      style: 'dashed' as const,
    },
    {
      id: `trendfollow-stop-${entryTimestamp}`,
      kind: 'trendfollow_stop',
      points: [
        { timestamp: signal.pivot.timestamp, value: stopLossPrice },
        { timestamp: entryTimestamp, value: stopLossPrice },
      ],
      color: '#ef4444',
      width: 1,
      style: 'dashed' as const,
    },
  ].filter((line) => line.points.length > 0);

  const points: StrategyFigurePoints[] = [
    {
      id: `trendfollow-pivot-${entryTimestamp}`,
      kind: `trendfollow_${signal.pivot.kind}_pivot`,
      points: [
        { timestamp: signal.pivot.timestamp, value: signal.pivot.value },
      ],
      color: '#f59e0b',
      radius: 4,
    },
    {
      id: `trendfollow-entry-${entryTimestamp}`,
      kind: 'trendfollow_entry',
      points: [{ timestamp: entryTimestamp, value: entryPrice }],
      color,
      radius: 5,
    },
  ];

  return { lines, points };
};
