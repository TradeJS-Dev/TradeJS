'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useFilters } from '#store';

const DashboardIndex = () => {
  const { filters } = useFilters();
  const router = useRouter();

  useEffect(() => {
    router.replace(
      `/routes/dashboard/${filters.provider || 'bybit'}/${filters.universe || 'crypto'}/${filters.symbol}/${filters.interval}`,
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
