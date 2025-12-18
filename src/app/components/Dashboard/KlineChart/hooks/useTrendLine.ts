'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import _ from 'lodash';
import { Chart, registerOverlay } from 'klinecharts';
import { getSignal } from '@actions/signal';
import { findTrendlinesByLows, findTrendlinesByHighs } from '@utils/trendLine';
import { toMs } from '@utils/timestamp';
import { Signal, TrendLine } from '@types';

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

export const useTrendLine = (chart: Chart | null, enabled: boolean) => {
  const [signal, setSignal] = useState<Signal | null>(null);
  const searchParams = useSearchParams();
  const signalId = searchParams.get('signalId');
  const autoZoom = Boolean(searchParams.get('autoZoom')) ?? false;

  const data = chart?.getDataList() || [];
  const symbol = chart?.getSymbol()?.ticker || '';

  useEffect(() => {
    if (!signalId) return;
    getSignal(symbol, signalId).then(setSignal);
  }, [signalId, symbol]);

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

  useEffect(() => {
    if (!chart || !enabled || !data || _.isEmpty(data)) return;

    const lastDataTsMs = toMs(data[data.length - 1].timestamp);

    const currentSymbol = chart.getSymbol()?.ticker;

    const lowLines: TrendLine[] =
      signalId && signal?.symbol === currentSymbol
        ? signal?.trendLine?.mode === 'lows'
          ? [signal.trendLine]
          : []
        : findTrendlinesByLows(data, { minTouches: 3 });

    const highLines: TrendLine[] =
      signalId && signal?.symbol === currentSymbol
        ? signal?.trendLine?.mode === 'highs'
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
  }, [chart, enabled, data.length, signal]);
};
