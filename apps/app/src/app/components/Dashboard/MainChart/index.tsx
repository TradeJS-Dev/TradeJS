'use client';

import _ from 'lodash';
import { useEffect } from 'react';
import { useFilters, useIndicators } from '#store';
import { getTimestamp } from '@tradejs/core/time';
import { KlineChart } from '../KlineChart';

const DASHBOARD_REFRESH_DELAY = 10_000;

interface MainChartProps {
  screenshotMode?: boolean;
}

export const MainChart = ({ screenshotMode = false }: MainChartProps) => {
  const { filters, setFilters } = useFilters();
  const { indicatorsByKey, indicatorRenderers } = useIndicators();

  useEffect(() => {
    if (screenshotMode) {
      return;
    }

    const intervalId = setInterval(() => {
      setFilters({
        end: getTimestamp(),
      });
    }, DASHBOARD_REFRESH_DELAY);

    return () => {
      clearInterval(intervalId);
    };
  }, [screenshotMode, setFilters]);

  return (
    <KlineChart
      id="main-chart"
      filters={filters}
      indicators={indicatorsByKey}
      indicatorRenderers={indicatorRenderers}
    />
  );
};
