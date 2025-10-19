'use client';

import _ from 'lodash';
import { useEffect } from 'react';
import { useFilters, useIndicators } from '@store';
import { getTimestamp } from '@utils/timestamp';
import { KlineChart } from '../KlineChart';

export const MainChart = () => {
  const { filters, setFilters } = useFilters();
  const { indicatorsByKey } = useIndicators();

  useEffect(() => {
    const intervalId = setInterval(() => {
      setFilters({
        end: getTimestamp(),
      });
    }, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, []);

  return (
    <KlineChart
      id="main-chart"
      filters={filters}
      indicators={indicatorsByKey}
    />
  );
};
