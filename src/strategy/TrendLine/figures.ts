import { TrendLine } from '@types';

export const buildTrendLineFigures = (bestLine: TrendLine) => ({
  lines: [
    {
      id: bestLine.id,
      kind: 'trendline',
      points: [...(bestLine.points ?? [])].sort(
        (left, right) => left.timestamp - right.timestamp,
      ),
      color: bestLine.mode === 'lows' ? '#facc15' : '#fb923c',
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
