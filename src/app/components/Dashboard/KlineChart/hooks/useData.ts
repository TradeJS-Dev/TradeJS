import { useEffect, useState, useRef } from 'react';
import { KlineChartData, Filters } from '@types';
import { kline } from '@src/actions/kline';

export const useData = (filters: Filters) => {
  const [loading, setLoading] = useState(false);
  const dataRef = useRef<KlineChartData | null>(null);

  const updateData = async ({ symbol, interval, start, end }: Filters) => {
    setLoading(true);
    const newData = await kline({
      symbol,
      interval,
      start,
      end,
    });

    dataRef.current = newData;
    setLoading(false);
  };

  useEffect(() => {
    updateData(filters);
  }, [filters]);

  return {
    data: dataRef.current,
    loading,
  };
};
