import { useEffect } from 'react';
import _ from 'lodash';
import { Chart, registerOverlay } from 'klinecharts';
import { Filters } from '@types';
import { useData } from './useData';
import { findTrendlinesByLows } from '@utils/trendLine';

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
