'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import _ from 'lodash';
import { Chart, registerOverlay } from 'klinecharts';
import { getSignal } from '@actions/signal';
import { toMs } from '@utils/timestamp';
import { Signal } from '@types';
import { createTradeZonePointFigure } from '../figures/tradeZonePointFigure';

const SETUP = 'Setup';
const SETUP_START = 'Setup-start';

const FALLBACK_WIDTH_MS = 24 * 60 * 60_000;

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
