'use client';

import _ from 'lodash';
import { useEffect } from 'react';
import { useFilters, useIndicators } from '@store';
import { getTimestamp } from '@tradejs/core/time';
import { KlineChart } from '../KlineChart';

const DASHBOARD_REFRESH_DELAY = 10_000;

export const MainChart = () => {
  const { filters, setFilters } = useFilters();
  const { indicatorsByKey, indicatorRenderers } = useIndicators();

  useEffect(() => {
    const intervalId = setInterval(() => {
      setFilters({
        end: getTimestamp(),
      });
    }, DASHBOARD_REFRESH_DELAY);

    return () => {
      clearInterval(intervalId);
    };
  }, [setFilters]);

  return (
    <KlineChart
      id="main-chart"
      filters={filters}
      indicators={indicatorsByKey}
      indicatorRenderers={indicatorRenderers}
    />
  );
};
