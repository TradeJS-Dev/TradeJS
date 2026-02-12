'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

const LegacyDashboardRoute = () => {
  const { symbol, interval } = useParams();
  const router = useRouter();

  useEffect(() => {
    if (typeof symbol === 'string' && typeof interval === 'string') {
      router.replace(`/routes/dashboard/bybit/${symbol}/${interval}`);
    }
  }, [symbol, interval]);

  return null;
};

export default LegacyDashboardRoute;
