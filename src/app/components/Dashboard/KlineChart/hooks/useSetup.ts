'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import _ from 'lodash';
import { Chart, registerOverlay } from 'klinecharts';
import { getSignal } from '@actions/signal';
import { toMs } from '@utils/timestamp';
import { Signal } from '@types';

const SETUP = 'Setup';
const SETUP_START = 'Setup-start';

const FALLBACK_WIDTH_MS = 24 * 60 * 60_000;

interface ExtendData {
  mode: 'TP' | 'SL';
}

type Point = { timestamp: number; value: number };

export const useSetup = (chart: Chart | null, enabled: boolean) => {
  const [signal, setSignal] = useState<Signal | null>(null);
  const searchParams = useSearchParams();
  const signalId = searchParams.get('signalId');

  const data = chart?.getDataList() || [];
  const symbol = chart?.getSymbol()?.ticker || '';

  useEffect(() => {
    if (!signalId || !symbol) {
      setSignal(null);
      return;
    }
    getSignal(symbol, signalId).then(setSignal);
  }, [symbol, signalId]);

  useEffect(() => {
    registerOverlay({
      name: SETUP,
      totalStep: 2,
      needDefaultPointFigure: false,
      needDefaultXAxisFigure: false,
      needDefaultYAxisFigure: false,
      createPointFigures: ({ coordinates, overlay }) => {
        const { mode } = overlay.extendData as ExtendData;

        const color = mode === 'TP' ? 'rgba(34,197,94,0.22)' : 'rgba(239,68,68,0.22)';
        const borderColor = mode === 'TP' ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)';

        if (coordinates.length < 2) return [];
        const [p1, p2] = coordinates;

        const x = Math.min(p1.x, p2.x);
        const y = Math.min(p1.y, p2.y);
        const w = Math.abs(p2.x - p1.x);
        const h = Math.abs(p2.y - p1.y);

        return [
          {
            type: 'rect',
            attrs: { x, y, width: w, height: h },
            styles: { color, borderColor, size: 1 },
          },
        ];
      },
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

    const startTsMs = toMs(signal.timestamp);
    const endTsMs = startTsMs + FALLBACK_WIDTH_MS;

    const start: Point = { timestamp: startTsMs, value: signal.currentPrice };
    const tpEnd: Point = { timestamp: endTsMs, value: signal.takeProfitPrice };
    const slEnd: Point = { timestamp: endTsMs, value: signal.stopLossPrice };

    return { start, tpEnd, slEnd };
  }, [signal, data.length]);

  useEffect(() => {
    if (!chart || !enabled || !signalId || !signal || !setupPoints) return;

    const currentSymbol = chart.getSymbol()?.ticker;
    if (signal.symbol !== currentSymbol) return;

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

    return () => {
      chart.removeOverlay({ id: tpId, name: SETUP });
      chart.removeOverlay({ id: slId, name: SETUP });
      chart.removeOverlay({ name: SETUP_START });
    };
  }, [chart, enabled, signalId, signal, setupPoints]);

  return { signal };
};
