'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import _ from 'lodash';
import { Chart, registerOverlay } from 'klinecharts';
import { getSignal } from '@actions/signal';
import { createTrendlineEngine } from '@utils/trendLine/engine';
import { toMs } from '@utils/timestamp';
import { Signal, TrendLine } from '@types';
import { createTrendLinePointFigure } from '../figures/trendLinePointFigure';
import { createTrendLinePointsPointFigure } from '../figures/trendLinePointsPointFigure';

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
      createPointFigures: createTrendLinePointFigure,
    });

    registerOverlay({
      name: 'TrendLinePoints',
      needDefaultPointFigure: true,
      needDefaultXAxisFigure: false,
      needDefaultYAxisFigure: false,
      createPointFigures: createTrendLinePointsPointFigure,
    });
  }, []);

  useEffect(() => {
    if (!chart || !enabled || !data || _.isEmpty(data)) return;

    const lastDataTsMs = toMs(data[data.length - 1].timestamp);

    const currentSymbol = chart.getSymbol()?.ticker;

    const buildLinesForMode = (mode: TrendLine['mode']) =>
      createTrendlineEngine(data, { mode, minTouches: 4 }).getLines();

    const trendLine = signal?.figures?.trendLine;

    if (!trendLine) {
      return;
    }

    const lowLines: TrendLine[] =
      signalId && signal?.symbol === currentSymbol
        ? trendLine?.mode === 'lows'
          ? [trendLine]
          : []
        : buildLinesForMode('lows');

    const highLines: TrendLine[] =
      signalId && signal?.symbol === currentSymbol
        ? trendLine?.mode === 'highs'
          ? [trendLine]
          : []
        : buildLinesForMode('highs');

    const lines = [...lowLines, ...highLines];

    if (!lines) {
      return;
    }

    for (const line of lines) {
      const points = [...line.points, ...line.touches];

      const extendData = {
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
