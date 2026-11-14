'use client';

import { useState, type ReactNode } from 'react';
import type { Items } from '#app/types/ui';
import { useFilters, useIndicators } from '#store';
import { KlineChart } from '../KlineChart';
import type { LinkedMarket } from '../KlineChart/LinkedChart';

interface MainChartProps {
  screenshotMode?: boolean;
  backtestFiles?: Items;
  toolbar?: ReactNode;
}

export const MainChart = ({
  screenshotMode = false,
  backtestFiles,
  toolbar,
}: MainChartProps) => {
  const { filters } = useFilters();
  const { indicatorsByKey, indicatorRenderers } = useIndicators();
  const [linked, setLinked] = useState(false);
  const [linkedMarket, setLinkedMarket] = useState<LinkedMarket>();

  const toggleLinked = () => {
    setLinkedMarket(
      (current) =>
        current ?? {
          symbol: filters.symbol,
          interval: filters.interval === '60' ? '240' : '60',
          provider: filters.provider ?? 'bybit',
          universe: filters.universe ?? 'crypto',
        },
    );
    setLinked((current) => !current);
  };

  return (
    <KlineChart
      key={`${filters.provider}:${filters.universe}:${filters.symbol}:${filters.interval}:${filters.backtestId}:${screenshotMode}`}
      id="main-chart"
      interactive={!screenshotMode}
      backtestFiles={backtestFiles}
      toolbar={toolbar}
      linkedMarket={linked ? linkedMarket : undefined}
      onLinkedMarketChange={setLinkedMarket}
      onToggleLinked={toggleLinked}
      filters={filters}
      indicators={indicatorsByKey}
      indicatorRenderers={indicatorRenderers}
      live={!screenshotMode && !filters.backtestId}
    />
  );
};
