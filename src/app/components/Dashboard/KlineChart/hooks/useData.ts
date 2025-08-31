import { useEffect, useState, useRef } from 'react';
import { KlineChartData, Filters } from '@types';
import { kline } from '@src/actions/kline';

export const useData = (filters: Filters) => {
  const [loading, setLoading] = useState(false);
  const [signal, setSignal] = useState(0);
  const dataRef = useRef<KlineChartData | null>(null);

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
