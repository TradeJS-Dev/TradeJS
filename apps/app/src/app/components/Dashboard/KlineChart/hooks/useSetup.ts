import { useEffect, useMemo, useState } from 'react';
import { Chart, registerOverlay } from 'klinecharts';
import { toMs } from '@tradejs/core/time';
import type { Signal } from '@tradejs/types';
import { createTradeZonePointFigure } from '../figures/tradeZonePointFigure';

const SETUP = 'Setup';
const SETUP_START = 'Setup-start';

const FALLBACK_WIDTH_MS = 24 * 60 * 60_000;

type Point = { timestamp: number; value: number };

type RenderedTradeSetup = {
  chart: Chart;
  signalId: string;
};

export const useTradeSetup = ({
  chart,
  enabled,
  signal,
}: {
  chart: Chart | null;
  enabled: boolean;
  signal: Signal | null;
}) => {
  const [rendered, setRendered] = useState<RenderedTradeSetup | null>(null);

  useEffect(() => {
    registerOverlay({
      name: SETUP,
      totalStep: 2,
      needDefaultPointFigure: false,
      needDefaultXAxisFigure: false,
      needDefaultYAxisFigure: false,
      createPointFigures: createTradeZonePointFigure,
    });

    registerOverlay({
      name: SETUP_START,
      totalStep: 1,
      needDefaultPointFigure: true,
      needDefaultXAxisFigure: false,
      needDefaultYAxisFigure: false,
      createPointFigures: ({ coordinates }) => {
        const { x, y } = coordinates[0];

        return [
          {
            type: 'circle',
            attrs: { x, y, r: 5 },
            styles: {
              style: 'fill',
              color: '#9333ea',
            },
            ignoreEvent: true,
          },
        ];
      },
    });
  }, []);

  const setupPoints = useMemo(() => {
    if (!signal) return null;

    const { timestamp, prices } = signal;

    const startTsMs = toMs(timestamp);
    const endTsMs = startTsMs + FALLBACK_WIDTH_MS;

    const start: Point = { timestamp: startTsMs, value: prices.currentPrice };
    const tpEnd: Point = { timestamp: endTsMs, value: prices.takeProfitPrice };
    const slEnd: Point = { timestamp: endTsMs, value: prices.stopLossPrice };

    return { start, tpEnd, slEnd };
  }, [signal]);

  useEffect(() => {
    if (!chart || !enabled || !signal || !setupPoints) {
      setRendered(null);
      return;
    }

    const currentSymbol = chart.getSymbol()?.ticker;
    if (signal.symbol !== currentSymbol) {
      setRendered(null);
      return;
    }

    const tpId = `${signal.signalId}-tp`;
    const slId = `${signal.signalId}-sl`;

    chart.createOverlay({
      name: SETUP,
      id: tpId,
      points: [setupPoints.start, setupPoints.tpEnd],
      extendData: {
        mode: 'TP',
      },
    });

    chart.createOverlay({
      name: SETUP,
      id: slId,
      points: [setupPoints.start, setupPoints.slEnd],
      extendData: {
        mode: 'SL',
      },
    });

    chart.createOverlay({
      name: SETUP_START,
      points: [setupPoints.start],
    });

    setRendered((current) =>
      current?.chart === chart && current.signalId === signal.signalId
        ? current
        : { chart, signalId: signal.signalId },
    );

    return () => {
      chart.removeOverlay({ id: tpId, name: SETUP });
      chart.removeOverlay({ id: slId, name: SETUP });
      chart.removeOverlay({ name: SETUP_START });
    };
  }, [chart, enabled, signal, setupPoints]);

  return Boolean(
    enabled &&
      chart &&
      signal &&
      rendered?.chart === chart &&
      rendered.signalId === signal.signalId,
  );
};
