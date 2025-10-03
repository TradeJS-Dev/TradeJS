'use client';

import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { KlineChartData, Filters } from '@types';
import { kline } from '@actions/kline';

export const useData = (filters: Filters) => {
  const [loading, setLoading] = useState(false);
  const [signal, setSignal] = useState(0);
  const dataRef = useRef<KlineChartData | null>(null);

  const searchParams = useSearchParams();
  const cacheOnly = Boolean(searchParams.get('cacheOnly')) ?? false;

  const updateData = async (
    { symbol, interval, start, end }: Filters,
    silent = false,
  ) => {
    if (!silent) {
      setLoading(true);
    }

    const newData = await kline({
      symbol,
      interval,
      start,
      end,
      silent,
      cacheOnly,
    });

    dataRef.current = newData;

    setSignal((value) => value + 1);

    if (!silent) {
      setLoading(false);
    }
  };

  useEffect(() => {
    updateData(filters);

    // const id = setInterval(() => {
    //   updateData(filters, true);
    // }, 2000);

    // return () => {
    //   clearInterval(id);
    // }
  }, [filters]);

  return {
    data: dataRef.current,
    loading,
    signal,
  };
};
