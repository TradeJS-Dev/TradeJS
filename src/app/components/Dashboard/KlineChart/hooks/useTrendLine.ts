'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import _ from 'lodash';
import { Chart, registerOverlay } from 'klinecharts';
import { getSignal } from '@src/actions/signal';
import { useData } from './useData';
import { findTrendlinesByLows, findTrendlinesByHighs } from '@utils/trendLine';
import { Filters, Signal } from '@types';

export const useTrendLine = (
  chart: Chart | null,
  enabled: boolean,
  filters: Filters,
) => {
  const { data, loading } = useData(filters);
  const [signal, setSignal] = useState<Signal | null>(null);
  const searchParams = useSearchParams();
  const signalId = searchParams.get('signalId');

  useEffect(() => {
    if (!signalId) {
      return;
    }

    getSignal(signalId).then((res) => {
      setSignal(res);
    });
  }, []);

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
            attrs: {
              coordinates: [coordinates[0], coordinates[1]],
            },
            styles: {
              color: '#facc15',
              size: 2,
              style: 'solid',
            },
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
            attrs: {
              coordinates: [coordinates[0], coordinates[1]],
            },
            styles: {
              color: '#fb923c',
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
      return;
    }

    const lowsTrendlines = signalId
      ? signal?.trendLines?.lows || []
      : findTrendlinesByLows(data, { minTouches: 3 });

    for (const line of lowsTrendlines) {
      chart.createOverlay({
        name: 'LowTrendLine',
        id: line.id,
        points: line.points,
      });
    }

    const highsTrendlines = signalId
      ? signal?.trendLines?.highs || []
      : findTrendlinesByHighs(data, { minTouches: 3 });

    for (const line of highsTrendlines) {
      chart.createOverlay({
        name: 'HighTrendLine',
        id: line.id,
        points: line.points,
      });
    }

    return () => {
      for (const line of lowsTrendlines) {
        chart.removeOverlay({ name: 'LowTrendLine' });
      }

      for (const line of highsTrendlines) {
        chart.removeOverlay({ name: 'HighTrendLine' });
      }
    };
  }, [chart, enabled, loading, data, signal, signalId]);
};
