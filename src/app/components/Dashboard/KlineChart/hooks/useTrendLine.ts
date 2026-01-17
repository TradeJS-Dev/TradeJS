'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import _ from 'lodash';
import { Chart, registerOverlay } from 'klinecharts';
import { getSignal } from '@actions/signal';
import { findTrendlinesByLows, findTrendlinesByHighs } from '@utils/trendLine';
import { toMs } from '@utils/timestamp';
import { Signal, TrendLine } from '@types';

interface ExtendData {
  mode: TrendLine['mode'];
}

const fitKeepRightZoom = (chart: Chart, lastDataTsMs: number) => {
  if (!Number.isFinite(lastDataTsMs)) return;

  const size = chart.getSize?.();
  const width = size?.width ?? 0;

  if (!width) return;

  const MAX_STEPS = 15;
  const SCALE = 0.85;
  const RIGHT_MARGIN_RATIO = 0.1;

  chart.scrollToTimestamp(lastDataTsMs);

  for (let i = 0; i < MAX_STEPS; i++) {
    chart.zoomAtTimestamp(SCALE, lastDataTsMs);
  }

  const rightOffsetPx = width * RIGHT_MARGIN_RATIO;

  chart.setOffsetRightDistance?.(rightOffsetPx);
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
      name: 'TrendLine',
      totalStep: 2,
      needDefaultPointFigure: false,
      needDefaultXAxisFigure: false,
      needDefaultYAxisFigure: false,
      createPointFigures: ({ coordinates, overlay }) => {
        const { mode } = overlay.extendData as ExtendData;
        const figures: any[] = [];
        const color = mode === 'lows' ? '#facc15' : '#fb923c';

        if (coordinates.length === 2) {
          figures.push({
            type: 'line',
            attrs: { coordinates: [coordinates[0], coordinates[1]] },
            styles: { color, size: 2, style: 'solid' },
          });
        }

        return figures;
      },
    });

    registerOverlay({
      name: 'TrendLinePoints',
      needDefaultPointFigure: true,
      needDefaultXAxisFigure: false,
      needDefaultYAxisFigure: false,
      createPointFigures: ({ coordinates }) => {
        const figures: any[] = [];

        coordinates.forEach(({ x, y }, i) => {
          figures.push({
            type: 'circle',
            key: `pt_${i}`,
            attrs: { x, y, r: 4 },
            styles: {
              style: 'fill',
              color: '#ef4444',
            },
            ignoreEvent: true,
          });
        });

        return figures;
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
        : findTrendlinesByLows(data, { minTouches: 4 });

    const highLines: TrendLine[] =
      signalId && signal?.symbol === currentSymbol
        ? signal?.trendLine?.mode === 'highs'
          ? [signal.trendLine]
          : []
        : findTrendlinesByHighs(data, { minTouches: 4 });

    const lines = [...lowLines, ...highLines];

    if (!lines) {
      return;
    }

    for (const line of lines) {
      const points = [...line.points, ...line.touches];

      const extendData: ExtendData = {
        mode: line.mode,
      };

      chart.createOverlay({
        name: 'TrendLine',
        id: line.id,
        points: line.points,
        zLevel: 10,
        extendData,
      });

      chart.createOverlay({
        name: 'TrendLinePoints',
        id: `${line.id}-points`,
        points: points,
        zLevel: 12,
      });
    }

    if (autoZoom && Number.isFinite(lastDataTsMs)) {
      fitKeepRightZoom(chart, lastDataTsMs);
    }

    return () => {
      chart.removeOverlay({ name: 'TrendLine' });
      chart.removeOverlay({ name: 'TrendLinePoints' });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart, enabled, data.length, signal]);
};
