import { useEffect, useMemo, useState } from 'react';
import _ from 'lodash';
import { registerIndicator, Chart, registerOverlay } from 'klinecharts';
import { Filters, KlineChartData } from '@types';
import { useData } from './useData';

type Point = { x: number; y: number; timestamp: number };

export function findTrendlinesByLows(
  candles: KlineChartData,
  maxLines = 10,
  range = 10,
  epsilon = 0.0001,
  minTouches = 3,
): Array<{ id: string; points: { timestamp: number; value: number }[] }> {
  const lows: Point[] = [];

  for (let i = range; i < candles.length - range; i++) {
    const segment = candles.slice(i - range, i + range + 1);
    const minLow = Math.min(...segment.map((c) => c.close));
    if (candles[i].close === minLow) {
      lows.push({ x: i, y: candles[i].close, timestamp: candles[i].timestamp });
    }
  }

  const used = new Set<number>();
  const foundLines: Array<{
    id: string;
    points: { timestamp: number; value: number }[];
  }> = [];

  for (let i = lows.length - 1; i >= 0; i--) {
    for (let j = i - 1; j >= 0; j--) {
      if (used.has(i) || used.has(j)) continue;

      const p1 = lows[j];
      const p2 = lows[i];

      const dx = p2.x - p1.x;
      if (dx === 0) continue;

      const dy = p2.y - p1.y;
      const slope = dy / dx;
      if (slope <= 0) continue; // Только восходящие

      const intercept = p1.y - slope * p1.x;

      const touches = lows.filter((p) => {
        const expectedY = slope * p.x + intercept;
        return Math.abs(p.y - expectedY) <= epsilon;
      });

      if (touches.length >= minTouches) {
        const first = touches[0];
        const last = touches[touches.length - 1];
        const id = `TrendLine-${foundLines.length + 1}`;

        foundLines.push({
          id,
          points: [
            { timestamp: first.timestamp, value: first.y },
            { timestamp: last.timestamp, value: last.y },
          ],
        });

        // Запоминаем, какие индексы были использованы
        used.add(i);
        used.add(j);
        break;
      }

      if (foundLines.length >= maxLines) return foundLines;
    }

    if (foundLines.length >= maxLines) break;
  }

  return foundLines;
}

export const useTrendLine = (
  chart: Chart | null,
  enabled: boolean,
  filters: Filters,
) => {
  const { data, loading } = useData(filters);

  useEffect(() => {
    registerOverlay({
      name: 'TrendLine',
      totalStep: 2,
      needDefaultPointFigure: false,
      needDefaultXAxisFigure: false,
      needDefaultYAxisFigure: false,
      createPointFigures: ({ coordinates }) => {
        if (coordinates.length < 2) return [];

        return [
          {
            type: 'line',
            attrs: {
              coordinates: [coordinates[0], coordinates[1]],
            },
            styles: {
              color: '#FFA500',
              size: 2,
              style: 'solid',
            },
          },
        ];
      },
    });
  }, []);

  useEffect(() => {
    if (!chart || !enabled || loading || !data || _.isEmpty(data)) {
      return () => null;
    }

    const trendlines = findTrendlinesByLows(data, 3);

    for (const line of trendlines) {
      chart.createOverlay({
        name: 'TrendLine',
        id: line.id,
        points: line.points,
      });
    }

    return () => {
      for (const line of trendlines) {
        chart.removeOverlay({ name: 'TrendLine' });
      }
    };
  }, [chart, enabled, loading, data]);
};
