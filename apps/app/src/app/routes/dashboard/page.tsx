'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useFilters } from '#store';
import { buildDashboardPath } from '#app/lib/marketRoutes';

const DashboardIndex = () => {
  const { filters } = useFilters();
  const router = useRouter();

  useEffect(() => {
    router.replace(
      buildDashboardPath({
        provider: filters.provider || 'bybit',
        universe: filters.universe || 'crypto',
        symbol: filters.symbol,
        interval: filters.interval,
      }),
    );
  }, [
    filters.interval,
    filters.provider,
    filters.symbol,
    filters.universe,
    router,
  ]);

  return null;
};

export default DashboardIndex;
