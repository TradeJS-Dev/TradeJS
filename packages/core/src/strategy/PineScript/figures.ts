import {
  PineContextLike,
  getPinePlotSeries,
  asFiniteNumber,
} from '@utils/pine';
import {
  StrategyEntryModelFigures,
  StrategyFigurePoint,
  Direction,
} from '@types';

interface BuildPineScriptFiguresParams {
  pineContext: PineContextLike;
  linePlots: string[];
  direction: Direction;
  entryTimestamp: number;
  entryPrice: number;
  maxPoints?: number;
}

const LINE_COLORS = [
  '#22d3ee',
  '#f59e0b',
  '#34d399',
  '#a78bfa',
  '#f43f5e',
  '#facc15',
] as const;

const toFigurePoints = (
  series: ReturnType<typeof getPinePlotSeries>,
  maxPoints: number,
): StrategyFigurePoint[] => {
  const start = Math.max(0, series.length - maxPoints);
  const points: StrategyFigurePoint[] = [];
  for (let i = start; i < series.length; i += 1) {
    const item = series[i];
    const timestamp = asFiniteNumber(item?.time);
    const value = asFiniteNumber(item?.value);
    if (timestamp == null || value == null) continue;
    points.push({
      timestamp,
      value,
    });
  }
  return points;
};

export const buildPineScriptFigures = ({
  pineContext,
  linePlots,
  direction,
  entryTimestamp,
  entryPrice,
  maxPoints = 120,
}: BuildPineScriptFiguresParams): StrategyEntryModelFigures => {
  const lines = linePlots
    .map((plotName, index) => {
      const series = getPinePlotSeries(pineContext, plotName);
      const points = toFigurePoints(series, maxPoints);
      if (!points.length) {
        return null;
      }

      return {
        id: `pine-line-${plotName}`,
        kind: 'pine_plot_line',
        points,
        color: LINE_COLORS[index % LINE_COLORS.length],
        width: 2,
        style: 'solid' as const,
      };
    })
    .filter(Boolean) as NonNullable<StrategyEntryModelFigures['lines']>;

  return {
    lines,
    points: [
      {
        id: `pine-entry-${entryTimestamp}`,
        kind: 'pine_entry',
        points: [{ timestamp: entryTimestamp, value: entryPrice }],
        color: direction === 'LONG' ? '#22c55e' : '#ef4444',
        radius: 4,
      },
    ],
  };
};
