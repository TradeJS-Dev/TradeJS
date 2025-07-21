import { useEffect, useState } from 'react';
import { KlineChartData, Filters } from '@types';
import { kline } from '@src/actions/kline';

export const useData = (filters: Filters) => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<KlineChartData>();

  const updateData = async ({ symbol, interval, start, end }: Filters) => {
    setLoading(true);
    const newData = await kline({
      symbol,
      interval,
      start,
      end,
    });

    setData(newData);
    setLoading(false);
  };

  useEffect(() => {
    updateData(filters);
  }, [filters]);

  return {
    data,
    loading,
  };
};
