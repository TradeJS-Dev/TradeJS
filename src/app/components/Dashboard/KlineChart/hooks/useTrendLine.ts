'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import _ from 'lodash';
import { Chart, registerOverlay } from 'klinecharts';
import { getSignal } from '@src/actions/signal';
import { useData } from './useData';
import { findTrendlinesByLows, findTrendlinesByHighs } from '@utils/trendLine';
import { Filters, Signal } from '@types';

type TrendPoint = { timestamp: number; value: number };
type TrendLine = { id: string; points: TrendPoint[] };

/** нормализация таймстампа к ms */
const toMs = (ts: number) => (ts < 1e12 ? ts * 1000 : ts);

/** Держим правый край, добавляем отступ справа и слева, подбираем зум так, чтобы было видно начало линий */
const fitKeepRightZoom = (
  chart: Chart,
  lines: TrendLine[],
  lastDataTsMs: number,
) => {
  if (!lines.length) return;

  // 1) самый ранний ts точек линий
  let minStartTsMs = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    for (const pt of line.points) {
      const t = toMs(pt.timestamp);
      if (t < minStartTsMs) minStartTsMs = t;
    }
  }
  if (!isFinite(minStartTsMs)) return;

  const size = chart.getSize?.();
  const width = size?.width ?? 0;

  const MAX_STEPS = 20;
  const SCALE = 0.85; // < 1 => zoom-out
  const LEFT_MARGIN_RATIO = 0.05; // 5% слева
  const RIGHT_MARGIN_RATIO = 0.05; // 5% справа

  // начально прокручиваемся к концу
  chart.scrollToTimestamp(lastDataTsMs);

  for (let i = 0; i < MAX_STEPS; i++) {
    const edges = chart.convertFromPixel([
      { x: 0 },
      { x: width },
    ]) as Array<any>;
    const leftTsRaw = edges?.[0]?.timestamp;
    const rightTsRaw = edges?.[1]?.timestamp;

    const leftTsMs = typeof leftTsRaw === 'number' ? toMs(leftTsRaw) : NaN;
    const rightTsMs = typeof rightTsRaw === 'number' ? toMs(rightTsRaw) : NaN;

    if (Number.isNaN(leftTsMs) || Number.isNaN(rightTsMs) || !width) {
      // fallback: чуть отдалимся вокруг конца и попробуем ещё раз
      chart.zoomAtTimestamp(SCALE, lastDataTsMs);
      continue;
    }

    const visibleSpan = rightTsMs - leftTsMs;
    const leftMargin = visibleSpan * LEFT_MARGIN_RATIO;
    const rightMargin = visibleSpan * RIGHT_MARGIN_RATIO;

    const desiredLeftTs = minStartTsMs - leftMargin;
    const desiredRightTs = lastDataTsMs + rightMargin;

    // 1) если правого отступа нет — сначала создаём его, прокрутив правый край правее последней свечи
    if (rightTsMs < desiredRightTs) {
      chart.scrollToTimestamp(desiredRightTs);
      continue; // пересчитать края на следующей итерации
    }

    // 2) если левый край ещё не «накрыл» начало линий с запасом — отдаляем вокруг правого края
    if (leftTsMs > desiredLeftTs) {
      chart.zoomAtTimestamp(SCALE, desiredRightTs);
      chart.scrollToTimestamp(desiredRightTs);
      continue;
    }

    // 3) оба условия выполнены — готово
    break;
  }
};

export const useTrendLine = (
  chart: Chart | null,
  enabled: boolean,
  filters: Filters,
) => {
  const { data, loading } = useData(filters);
  const [signal, setSignal] = useState<Signal | null>(null);
  const searchParams = useSearchParams();
  const signalId = searchParams.get('signalId');

  useEffect(() => {
    if (!signalId) return;
    getSignal(filters.symbol, signalId).then(setSignal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signalId]);

  useEffect(() => {
    registerOverlay({
      name: 'LowTrendLine',
      totalStep: 2,
      needDefaultPointFigure: false,
      needDefaultXAxisFigure: false,
      needDefaultYAxisFigure: false,
      createPointFigures: ({ coordinates }) => {
        if (coordinates.length < 2) return [];
        return [
          {
            type: 'line',
            attrs: { coordinates: [coordinates[0], coordinates[1]] },
            styles: { color: '#facc15', size: 2, style: 'solid' },
          },
        ];
      },
    });

    registerOverlay({
      name: 'HighTrendLine',
      totalStep: 2,
      needDefaultPointFigure: false,
      needDefaultXAxisFigure: false,
      needDefaultYAxisFigure: false,
      createPointFigures: ({ coordinates }) => {
        if (coordinates.length < 2) return [];
        return [
          {
            type: 'line',
            attrs: { coordinates: [coordinates[0], coordinates[1]] },
            styles: { color: '#fb923c', size: 2, style: 'solid' },
          },
        ];
      },
    });
  }, []);

  // последний ts данных в ms (для привязки к правому краю)
  const lastDataTsMs = useMemo(() => {
    if (!data?.length) return NaN;
    const lastTs = data[data.length - 1].timestamp;
    return toMs(lastTs);
  }, [data]);

  useEffect(() => {
    if (!chart || !enabled || loading || !data || _.isEmpty(data)) return;

    const lowLines: TrendLine[] = signalId
      ? signal?.trendLines?.lows || []
      : findTrendlinesByLows(data, { minTouches: 3 });

    const highLines: TrendLine[] = signalId
      ? signal?.trendLines?.highs || []
      : findTrendlinesByHighs(data, { minTouches: 3 });

    // отрисовываем
    for (const line of lowLines) {
      chart.createOverlay({
        name: 'LowTrendLine',
        id: line.id,
        points: line.points,
      });
    }
    for (const line of highLines) {
      chart.createOverlay({
        name: 'HighTrendLine',
        id: line.id,
        points: line.points,
      });
    }

    // держим скролл в конце, затем зумим так, чтобы был виден старт линий
    const allLines = [...lowLines, ...highLines];
    if (allLines.length > 0 && Number.isFinite(lastDataTsMs)) {
      // сначала гарантированно прокручиваемся к концу
      chart.scrollToTimestamp(lastDataTsMs);
      // затем подбираем зум, сохраняя правую привязку
      fitKeepRightZoom(chart, allLines, lastDataTsMs);
    }

    // cleanup
    return () => {
      if (lowLines.length) chart.removeOverlay({ name: 'LowTrendLine' });
      if (highLines.length) chart.removeOverlay({ name: 'HighTrendLine' });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart, enabled, loading, data, signal, signalId, lastDataTsMs]);
};
