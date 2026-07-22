import { useEffect, useState } from 'react';
import { Chart } from 'klinecharts';
import type { Signal } from '@tradejs/types';
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

type RenderedSignalFigures = {
  chart: Chart;
  signalId: string;
};

export const useSignalFigures = ({
  chart,
  lastDataTimestamp,
  enabled,
  signal,
  autoZoom,
}: {
  chart: Chart | null;
  lastDataTimestamp: number | null;
  enabled: boolean;
  signal: Signal | null;
  autoZoom: boolean;
}) => {
  const [rendered, setRendered] = useState<RenderedSignalFigures | null>(null);

  useEffect(() => {
    if (!chart || !enabled || lastDataTimestamp == null || !signal) {
      setRendered(null);
      return;
    }

    const currentSymbol = chart.getSymbol()?.ticker;
    if (signal.symbol !== currentSymbol) {
      setRendered(null);
      return;
    }

    const normalized = normalizeSignalFigures(signal);
    const overlays = normalized
      ? (() => {
          ensureBaseFigureOverlaysRegistered();

          return drawSignalFigures({
            chart,
            idPrefix: `signal-${signal.signalId}`,
            figures: normalized,
          });
        })()
      : [];

    if (autoZoom) {
      const lastDataTsMs = toMs(lastDataTimestamp);
      if (Number.isFinite(lastDataTsMs)) {
        fitKeepRightZoom(chart, lastDataTsMs);
      }
    }

    setRendered((current) =>
      current?.chart === chart && current.signalId === signal.signalId
        ? current
        : { chart, signalId: signal.signalId },
    );

    return () => {
      removeSignalFigures(chart, overlays);
    };
  }, [autoZoom, chart, enabled, lastDataTimestamp, signal]);

  return Boolean(
    enabled &&
      chart &&
      signal &&
      rendered?.chart === chart &&
      rendered.signalId === signal.signalId,
  );
};
