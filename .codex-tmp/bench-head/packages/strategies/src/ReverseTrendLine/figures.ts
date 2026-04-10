import { TrendLine } from '@tradejs/types';

export const buildReverseTrendLineFigures = (bestLine: TrendLine) => ({
  lines: [
    {
      id: bestLine.id,
      kind: 'trendline',
      points: [...(bestLine.points ?? [])].sort(
        (left, right) => left.timestamp - right.timestamp,
      ),
      color: bestLine.mode === 'lows' ? '#22c55e' : '#f97316',
      width: 2,
      style: 'solid' as const,
    },
  ],
  points: [
    {
      id: `${bestLine.id}-points`,
      kind: 'trendline_points',
      points: [...(bestLine.points ?? []), ...(bestLine.touches ?? [])].sort(
        (left, right) => left.timestamp - right.timestamp,
      ),
      color: '#ef4444',
      radius: 4,
    },
  ],
});
