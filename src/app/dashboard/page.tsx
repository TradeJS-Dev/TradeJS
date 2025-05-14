'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useRecoilValue } from 'recoil';
import { filtersState } from '@atoms';

const DashboardIndex = () => {
  const filters = useRecoilValue(filtersState);
  const router = useRouter();

  useEffect(() => {
    router.replace(`/dashboard/${filters.symbol}/${filters.interval}`);
  }, []);

  return null;
};

export default DashboardIndex;
