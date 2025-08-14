'use client';

import React from 'react';
import _ from 'lodash';
import { useFilters, useIndicators } from '@store';
import { KlineChart } from '../KlineChart';

export const MainChart = () => {
  const { filters } = useFilters();
  const { indicatorsByKey } = useIndicators();

  return (
    <KlineChart
      id="main-chart"
      filters={filters}
      indicators={indicatorsByKey}
    />
  );
};
