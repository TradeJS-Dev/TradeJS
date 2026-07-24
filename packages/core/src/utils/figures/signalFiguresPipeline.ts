import { Chart, registerOverlay } from 'klinecharts';
import {
  OrderLogData,
  Signal,
  StrategyEntryModelFigures,
  StrategyFigureAnnotation,
  StrategyFigureLine,
  StrategyFigurePoints,
  StrategyFigureZone,
  TrendLine,
} from '@tradejs/types';
import { createEntryAnnotationPointFigure } from './entryAnnotationPointFigure';
import { createEntryLinePointFigure } from './entryLinePointFigure';
import { createEntryPointsPointFigure } from './entryPointsPointFigure';
import { createEntryZonePointFigure } from './entryZonePointFigure';

export type FigureOverlayRef = {
  name:
    | 'BacktestEntryLine'
    | 'BacktestEntryPoints'
    | 'BacktestEntryZone'
    | 'BacktestEntryAnnotation';
  id: string;
};

let baseFiguresRegistered = false;

export const ensureBaseFigureOverlaysRegistered = () => {
  if (baseFiguresRegistered) return;

  registerOverlay({
    name: 'BacktestEntryLine',
    totalStep: 2,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: createEntryLinePointFigure,
  });

  registerOverlay({
    name: 'BacktestEntryPoints',
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: createEntryPointsPointFigure,
  });

  registerOverlay({
    name: 'BacktestEntryZone',
    totalStep: 2,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: createEntryZonePointFigure,
  });

  registerOverlay({
    name: 'BacktestEntryAnnotation',
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: createEntryAnnotationPointFigure,
  });

  baseFiguresRegistered = true;
};

const toSortedPoints = <T extends { timestamp: number }>(points: T[] = []) =>
  [...points].sort((left, right) => left.timestamp - right.timestamp);

export const convertTrendLineToFigures = (
  trendLine: TrendLine,
): StrategyEntryModelFigures => ({
  lines: [
    {
      id: trendLine.id,
      kind: 'trendline',
      points: toSortedPoints(trendLine.points ?? []),
      color: trendLine.mode === 'lows' ? '#facc15' : '#fb923c',
      width: 2,
      style: 'solid',
    },
  ],
  points: [
    {
      id: `${trendLine.id}-points`,
      kind: 'trendline_points',
      points: toSortedPoints([
        ...(trendLine.points ?? []),
        ...(trendLine.touches ?? []),
      ]),
      color: '#ef4444',
      radius: 4,
    },
  ],
});

export const normalizeSignalFigures = (
  signal?: Signal | null,
): StrategyEntryModelFigures | undefined => {
  const figures = signal?.figures;
  if (!figures) return undefined;

  const lines = [...(figures.lines ?? [])] as StrategyFigureLine[];
  const points = [...(figures.points ?? [])] as StrategyFigurePoints[];
  const zones = [...(figures.zones ?? [])] as StrategyFigureZone[];
  const annotations = [
    ...(figures.annotations ?? []),
  ] as StrategyFigureAnnotation[];

  let merged: StrategyEntryModelFigures = {
    lines,
    points,
    zones,
    annotations,
  };

  if (figures.trendLine) {
    const fromTrendLine = convertTrendLineToFigures(figures.trendLine);
    merged = {
      lines: [...(merged.lines ?? []), ...(fromTrendLine.lines ?? [])],
      points: [...(merged.points ?? []), ...(fromTrendLine.points ?? [])],
      zones: [...(merged.zones ?? []), ...(fromTrendLine.zones ?? [])],
      annotations: [
        ...(merged.annotations ?? []),
        ...(fromTrendLine.annotations ?? []),
      ],
    };
  }

  if (
    !merged.lines?.length &&
    !merged.points?.length &&
    !merged.zones?.length &&
    !merged.annotations?.length
  ) {
    return undefined;
  }

  return {
    ...(merged.lines?.length ? { lines: merged.lines } : {}),
    ...(merged.points?.length ? { points: merged.points } : {}),
    ...(merged.zones?.length ? { zones: merged.zones } : {}),
    ...(merged.annotations?.length ? { annotations: merged.annotations } : {}),
  };
};

export const collectSignalFiguresFromOrderLog = (
  events: OrderLogData,
): Array<{
  figures: StrategyEntryModelFigures;
  signalId?: string;
  index: number;
}> => {
  const result: Array<{
    figures: StrategyEntryModelFigures;
    signalId?: string;
    index: number;
  }> = [];
  const seenSignalIds = new Set<string>();

  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (!event.type?.startsWith('OPEN_')) continue;
    const signal = event.signal as Signal | undefined;
    if (!signal) continue;

    const figures = normalizeSignalFigures(signal);
    if (!figures) continue;

    const signalId = signal.signalId;
    if (signalId) {
      if (seenSignalIds.has(signalId)) continue;
      seenSignalIds.add(signalId);
    }

    result.push({ figures, signalId, index });
  }

  return result;
};

export const drawSignalFigures = ({
  chart,
  idPrefix,
  figures,
}: {
  chart: Chart;
  idPrefix: string;
  figures: StrategyEntryModelFigures;
}): FigureOverlayRef[] => {
  const created: FigureOverlayRef[] = [];

  const lines = figures.lines ?? [];
  const points = figures.points ?? [];
  const zones = figures.zones ?? [];
  const annotations = figures.annotations ?? [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const linePoints = toSortedPoints(line.points ?? []);
    if (linePoints.length < 2) continue;

    const id = `${idPrefix}-line-${line.id ?? lineIndex}`;
    chart.createOverlay({
      name: 'BacktestEntryLine',
      id,
      points: linePoints,
      zLevel: 10,
      extendData: { line },
    });
    created.push({ name: 'BacktestEntryLine', id });
  }

  for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
    const pointsData = points[pointIndex];
    const pointValues = toSortedPoints(pointsData.points ?? []);
    if (pointValues.length === 0) continue;

    const id = `${idPrefix}-points-${pointsData.id ?? pointIndex}`;
    chart.createOverlay({
      name: 'BacktestEntryPoints',
      id,
      points: pointValues,
      zLevel: 12,
      extendData: { points: pointsData },
    });
    created.push({ name: 'BacktestEntryPoints', id });
  }

  for (let zoneIndex = 0; zoneIndex < zones.length; zoneIndex++) {
    const zone = zones[zoneIndex];
    const id = `${idPrefix}-zone-${zone.id ?? zoneIndex}`;
    chart.createOverlay({
      name: 'BacktestEntryZone',
      id,
      points: [zone.start, zone.end],
      zLevel: 8,
      extendData: { zone },
    });
    created.push({ name: 'BacktestEntryZone', id });
  }

  for (
    let annotationIndex = 0;
    annotationIndex < annotations.length;
    annotationIndex++
  ) {
    const annotation = annotations[annotationIndex];
    if (
      !Number.isFinite(annotation.point?.timestamp) ||
      !Number.isFinite(annotation.point?.value) ||
      !annotation.title.trim()
    ) {
      continue;
    }

    const id = `${idPrefix}-annotation-${annotation.id ?? annotationIndex}`;
    chart.createOverlay({
      name: 'BacktestEntryAnnotation',
      id,
      points: [annotation.point],
      zLevel: 14,
      extendData: { annotation },
    });
    created.push({ name: 'BacktestEntryAnnotation', id });
  }

  return created;
};

export const removeSignalFigures = (
  chart: Chart,
  overlays: FigureOverlayRef[],
) => {
  for (const overlay of overlays) {
    chart.removeOverlay({ name: overlay.name, id: overlay.id });
  }
};
