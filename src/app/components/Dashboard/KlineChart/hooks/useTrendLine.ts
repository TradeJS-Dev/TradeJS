import { useEffect } from 'react';
import _ from 'lodash';
import { Chart, registerOverlay } from 'klinecharts';
import { Filters } from '@types';
import { useData } from './useData';
import { findTrendlinesByLows, findTrendlinesByHighs } from '@utils/trendLine';

export const useTrendLine = (
  chart: Chart | null,
  enabled: boolean,
  filters: Filters,
) => {
  const { data, loading } = useData(filters);

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

    const lowsTrendlines = findTrendlinesByLows(data, { minTouches: 3 });

    for (const line of lowsTrendlines) {
      chart.createOverlay({
        name: 'LowTrendLine',
        id: line.id,
        points: line.points,
      });
    }

    const highsTrendlines = findTrendlinesByHighs(data, { minTouches: 3 });

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
    }
  }, [chart, enabled, loading, data]);
};
