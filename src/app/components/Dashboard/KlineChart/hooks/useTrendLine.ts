'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import _ from 'lodash';
import { Chart, registerOverlay } from 'klinecharts';
import { getSignal } from '@actions/signal';
import { findTrendlinesByLows, findTrendlinesByHighs } from '@utils/trendLine';
import { Filters, Signal, KlineChartData } from '@types';

type TrendPoint = { timestamp: number; value: number };
type TrendLine = { id: string; points: TrendPoint[] };

/** нормализация таймстампа к ms */
const toMs = (ts: number) => (ts < 1e12 ? ts * 1000 : ts);

/** Максимально отдаляем график и добавляем отступ справа от последней свечи */
const fitKeepRightZoom = (chart: Chart, lastDataTsMs: number) => {
  if (!Number.isFinite(lastDataTsMs)) return;

  const size = chart.getSize?.();
  const width = size?.width ?? 0;
  if (!width) return;

  const MAX_STEPS = 15; // количество шагов отдаления
  const SCALE = 0.85; // коэффициент zoom-out (<1 — отдаляемся)
  const RIGHT_MARGIN_RATIO = 0.1; // 10% ширины экрана справа

  // 1) прокрутка к последней свече (правый край)
  chart.scrollToTimestamp(lastDataTsMs);

  // 2) максимальный zoom-out вокруг правого края
  for (let i = 0; i < MAX_STEPS; i++) {
    chart.zoomAtTimestamp(SCALE, lastDataTsMs);
  }

  // 3) добавляем отступ справа в пикселях
  const rightOffsetPx = width * RIGHT_MARGIN_RATIO;

  // В типах Chart может не быть этого метода, поэтому через any + optional chaining
  (chart as any).setOffsetRightDistance?.(rightOffsetPx);
};

export const useTrendLine = (
  chart: Chart | null,
  enabled: boolean,
  data: KlineChartData | null,
  filters: Filters,
) => {
  const [signal, setSignal] = useState<Signal | null>(null);
  const searchParams = useSearchParams();
  const signalId = searchParams.get('signalId');
  const autoZoom = Boolean(searchParams.get('autoZoom')) ?? false;

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
    if (!chart || !enabled || !data || _.isEmpty(data)) return;

    const lowLines: TrendLine[] = signalId
      ? signal?.trendLine?.direction === 'SHORT'
        ? [signal.trendLine]
        : []
      : findTrendlinesByLows(data, { minTouches: 3 });

    const highLines: TrendLine[] = signalId
      ? signal?.trendLine?.direction === 'LONG'
        ? [signal.trendLine]
        : []
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

    if (autoZoom && Number.isFinite(lastDataTsMs)) {
      fitKeepRightZoom(chart, lastDataTsMs);
    }

    // cleanup
    return () => {
      if (lowLines.length) chart.removeOverlay({ name: 'LowTrendLine' });
      if (highLines.length) chart.removeOverlay({ name: 'HighTrendLine' });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart, enabled, data, signal, lastDataTsMs]);
};
