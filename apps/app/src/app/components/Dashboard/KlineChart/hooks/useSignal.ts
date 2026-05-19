'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import _ from 'lodash';
import { Chart } from 'klinecharts';
import { getSignal } from '#actions/signal';
import { Signal } from '@tradejs/types';
import {
  drawSignalFigures,
  ensureBaseFigureOverlaysRegistered,
  normalizeSignalFigures,
  removeSignalFigures,
} from '@tradejs/core/figures';
import { toMs } from '@tradejs/core/time';

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

export const useSignal = (chart: Chart | null, enabled: boolean) => {
  const [signal, setSignal] = useState<Signal | null>(null);
  const searchParams = useSearchParams();
  const signalId = searchParams.get('signalId');
  const autoZoom = Boolean(searchParams.get('autoZoom')) ?? false;

  const data = chart?.getDataList();
  const symbol = chart?.getSymbol()?.ticker || '';

  useEffect(() => {
    if (!signalId || !symbol) {
      setSignal(null);
      return;
    }
    getSignal(symbol, signalId).then(setSignal);
  }, [signalId, symbol]);

  useEffect(() => {
    if (!chart || !enabled || !data || _.isEmpty(data) || !signal) return;

    const currentSymbol = chart.getSymbol()?.ticker;
    if (signal.symbol !== currentSymbol) return;

    const normalized = normalizeSignalFigures(signal);
    if (!normalized) return;

    ensureBaseFigureOverlaysRegistered();

    const overlays = drawSignalFigures({
      chart,
      idPrefix: `signal-${signal.signalId}`,
      figures: normalized,
    });

    if (autoZoom) {
      const lastDataTsMs = toMs(data[data.length - 1].timestamp);
      if (Number.isFinite(lastDataTsMs)) {
        fitKeepRightZoom(chart, lastDataTsMs);
      }
    }

    return () => {
      removeSignalFigures(chart, overlays);
    };
  }, [autoZoom, chart, data, enabled, signal]);
};
