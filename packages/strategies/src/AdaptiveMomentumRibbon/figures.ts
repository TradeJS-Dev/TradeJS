import type {
  AdaptiveMomentumRibbonPlotName,
  AdaptiveMomentumRibbonPlotPoint,
  AdaptiveMomentumRibbonSnapshot,
} from './engine';
import {
  Direction,
  StrategyEntryModelFigures,
  StrategyFigureLine,
  StrategyFigurePoint,
} from '@tradejs/types';
import {
  buildEntryEvidenceAnnotation,
  formatFigureMetric,
} from '../shared/contextStrategy';

interface BuildAdaptiveMomentumRibbonFiguresParams {
  plotSeries: Partial<
    Record<AdaptiveMomentumRibbonPlotName, AdaptiveMomentumRibbonPlotPoint[]>
  >;
  linePlots: string[];
  direction: Direction;
  entryTimestamp: number;
  entryPrice: number;
  snapshot: AdaptiveMomentumRibbonSnapshot;
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
  series: AdaptiveMomentumRibbonPlotPoint[],
  maxPoints: number,
): StrategyFigurePoint[] => {
  const start = Math.max(0, series.length - maxPoints);
  const points: StrategyFigurePoint[] = [];

  for (let i = start; i < series.length; i += 1) {
    const item = series[i];
    if (!Number.isFinite(item?.time) || !Number.isFinite(item?.value)) {
      continue;
    }

    points.push({
      timestamp: item.time,
      value: item.value,
    });
  }

  return points;
};

export const buildAdaptiveMomentumRibbonFigures = ({
  plotSeries,
  linePlots,
  direction,
  entryTimestamp,
  entryPrice,
  snapshot,
  maxPoints = 180,
}: BuildAdaptiveMomentumRibbonFiguresParams): StrategyEntryModelFigures => {
  const lines = linePlots
    .map((plotName, index) => {
      const series =
        plotSeries[plotName as AdaptiveMomentumRibbonPlotName] ?? [];
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
    annotations: [
      buildEntryEvidenceAnnotation({
        idPrefix: 'amr',
        kind: 'adaptive_momentum_ribbon_entry_evidence',
        direction,
        entryTimestamp,
        entryPrice,
        title: `Momentum ribbon ${direction}`,
        items: [
          `Signal oscillator: ${formatFigureMetric(snapshot.signalOsc, 3)}`,
          `Zero cross: ${direction === 'LONG' ? 'above' : 'below'} 0`,
          `Active state: ${snapshot.activeBuy ? 'buy' : snapshot.activeSell ? 'sell' : 'transition'}`,
          `Keltner: ${formatFigureMetric(snapshot.kcLower)} / ${formatFigureMetric(snapshot.kcMidline)} / ${formatFigureMetric(snapshot.kcUpper)}`,
          `Invalidation: ${formatFigureMetric(snapshot.invalidationLevel)}`,
        ],
      }),
    ],
  };
};
