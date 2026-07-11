'use client';

import _ from 'lodash';
import { useFilters, useIndicators } from '#store';
import { KlineChart } from '../KlineChart';

interface MainChartProps {
  screenshotMode?: boolean;
}

export const MainChart = ({ screenshotMode = false }: MainChartProps) => {
  const { filters } = useFilters();
  const { indicatorsByKey, indicatorRenderers } = useIndicators();

  return (
    <KlineChart
      id="main-chart"
      filters={filters}
      indicators={indicatorsByKey}
      indicatorRenderers={indicatorRenderers}
      live={!screenshotMode && !filters.backtestId}
    />
  );
};
