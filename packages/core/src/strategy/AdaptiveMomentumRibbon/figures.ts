import {
  PineContextLike,
  asFiniteNumber,
  getPinePlotSeries,
} from '@utils/pine';
import {
  Direction,
  StrategyEntryModelFigures,
  StrategyFigureLine,
  StrategyFigurePoint,
} from '@types';

interface BuildAdaptiveMomentumRibbonFiguresParams {
  pineContext: PineContextLike;
  linePlots: string[];
  direction: Direction;
  entryTimestamp: number;
  entryPrice: number;
  maxPoints?: number;
}

type LineStyleDescriptor = Pick<
  StrategyFigureLine,
  'color' | 'width' | 'style'
>;

const DEFAULT_COLORS = ['#2962ff', '#f23645', '#089981', '#f59e0b'] as const;

const LINE_STYLE_BY_PLOT: Record<string, LineStyleDescriptor> = {
  kcMidline: {
    color: '#2962ff',
    width: 2,
    style: 'solid',
  },
  kcUpper: {
    color: '#f23645',
    width: 2,
    style: 'solid',
  },
  kcLower: {
    color: '#089981',
    width: 2,
    style: 'solid',
  },
  invalidationLevel: {
    color: '#f59e0b',
    width: 1,
    style: 'dashed',
  },
};

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

export const buildAdaptiveMomentumRibbonFigures = ({
  pineContext,
  linePlots,
  direction,
  entryTimestamp,
  entryPrice,
  maxPoints = 180,
}: BuildAdaptiveMomentumRibbonFiguresParams): StrategyEntryModelFigures => {
  const lines = linePlots
    .map((plotName, index) => {
      const series = getPinePlotSeries(pineContext, plotName);
      const points = toFigurePoints(series, maxPoints);
      if (!points.length) {
        return null;
      }

      const fallbackStyle: LineStyleDescriptor = {
        color: DEFAULT_COLORS[index % DEFAULT_COLORS.length],
        width: 2,
        style: 'solid',
      };

      const style = LINE_STYLE_BY_PLOT[plotName] || fallbackStyle;

      return {
        id: `amr-line-${plotName}`,
        kind: 'amr_plot_line',
        points,
        ...style,
      } as StrategyFigureLine;
    })
    .filter(Boolean) as NonNullable<StrategyEntryModelFigures['lines']>;

  return {
    lines,
    points: [
      {
        id: `amr-entry-${entryTimestamp}`,
        kind: 'amr_entry',
        points: [{ timestamp: entryTimestamp, value: entryPrice }],
        color: direction === 'LONG' ? '#22c55e' : '#ef4444',
        radius: 4,
      },
    ],
  };
};
