'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import _ from 'lodash';
import { Chart, registerOverlay, KLineData } from 'klinecharts';
import { getSignal } from '@actions/signal';
import { toMs } from '@utils/timestamp';
import { Signal } from '@types';

const SETUP_TP = 'SetupTPRect';
const SETUP_SL = 'SetupSLRect';
const SETUP_BARS_WIDTH = 100;

type Point = { timestamp: number; value: number };

const getEndTimestampByBars = (
  data: KLineData[],
  startTsMs: number,
  bars: number,
) => {
  if (!data?.length) return startTsMs;

  const startIdx = _.findIndex(data, (c) => toMs(c.timestamp) >= startTsMs);
  const safeStartIdx = startIdx === -1 ? data.length - 1 : startIdx;

  const endIdx = Math.min(data.length - 1, safeStartIdx + bars);
  return toMs(data[endIdx].timestamp);
};

export const useSetup = (chart: Chart | null, enabled: boolean) => {
  const [signal, setSignal] = useState<Signal | null>(null);
  const searchParams = useSearchParams();
  const signalId = searchParams.get('signalId');

  const data = chart?.getDataList() || [];
  const symbol = chart?.getSymbol()?.ticker || '';

  useEffect(() => {
    if (!signalId) {
      setSignal(null);
      return;
    }
    getSignal(symbol, signalId).then(setSignal);
  }, [symbol, signalId]);

  useEffect(() => {
    const makeRectOverlay = (name: string, fill: string, stroke: string) =>
      registerOverlay({
        name,
        totalStep: 2,
        needDefaultPointFigure: false,
        needDefaultXAxisFigure: false,
        needDefaultYAxisFigure: false,
        createPointFigures: ({ coordinates }) => {
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
              styles: {
                color: fill, // fill
                borderColor: stroke,
                size: 1,
              },
            },
          ];
        },
      });

    makeRectOverlay(SETUP_TP, 'rgba(34,197,94,0.22)', 'rgba(34,197,94,0.7)'); // green
    makeRectOverlay(SETUP_SL, 'rgba(239,68,68,0.22)', 'rgba(239,68,68,0.7)'); // red
  }, []);

  const setupPoints = useMemo(() => {
    if (!signal || !data?.length) return null;

    const startTsMs = toMs(signal.timestamp);
    const endTsMs = getEndTimestampByBars(data, startTsMs, SETUP_BARS_WIDTH);

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
      name: SETUP_TP,
      id: tpId,
      points: [setupPoints.start, setupPoints.tpEnd],
    });

    chart.createOverlay({
      name: SETUP_SL,
      id: slId,
      points: [setupPoints.start, setupPoints.slEnd],
    });

    return () => {
      chart.removeOverlay({ id: tpId, name: SETUP_TP });
      chart.removeOverlay({ id: slId, name: SETUP_SL });
    };
  }, [chart, enabled, signalId, signal, setupPoints]);

  return { signal };
};
