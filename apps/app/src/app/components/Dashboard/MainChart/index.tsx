'use client';

import type { Items } from '#app/types/ui';
import { useFilters, useIndicators } from '#store';
import { KlineChart } from '../KlineChart';

interface MainChartProps {
  screenshotMode?: boolean;
  backtestFiles?: Items;
}

export const MainChart = ({
  screenshotMode = false,
  backtestFiles,
}: MainChartProps) => {
  const { filters } = useFilters();
  const { indicatorsByKey, indicatorRenderers } = useIndicators();

  return (
    <KlineChart
      key={`${filters.provider}:${filters.universe}:${filters.symbol}:${filters.interval}:${filters.backtestId}:${screenshotMode}`}
      id="main-chart"
      interactive={!screenshotMode}
      backtestFiles={backtestFiles}
      filters={filters}
      indicators={indicatorsByKey}
      indicatorRenderers={indicatorRenderers}
      live={!screenshotMode && !filters.backtestId}
    />
  );
};
