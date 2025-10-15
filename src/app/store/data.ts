import { useEffect, useState } from 'react';
import { create } from 'zustand';
import _ from 'lodash';
import { get, set } from 'idb-keyval';
import { useSearchParams } from 'next/navigation';
import { KlineChartData, Interval, Filters } from '@types';
import { kline } from '@actions/kline';
import { mergeData } from '@utils/array';

interface DataState {
  data: Map<string, KlineChartData | null>;
  setData: (symbol: string, interval: Interval, data: KlineChartData) => void;
}

const getKey = (filters: Pick<Filters, 'symbol' | 'interval'>) => `${filters.symbol}_${filters.interval}`;

const useDataStore = create<DataState>((set) => ({
  data: new Map<string, KlineChartData | null>(),
  setData: (symbol, interval, newData) =>
    set(({ data }) => {
      const next = new Map(data);
      const prevData = next.get(getKey({ symbol, interval })) || [];
      const compareData = mergeData(prevData, newData);

      next.set(getKey({ symbol, interval }), compareData);

      return {
        data: next,
      }
    }),
}));

export const useData = (filters: Filters, silent = false) => {
  const key = getKey(filters);
  const data = useDataStore((s) => s.data.get(key));
  const setData = useDataStore((s) => s.setData);
  const [loading, setLoading] = useState(false);

  const searchParams = useSearchParams();
  const cacheOnly = Boolean(searchParams.get('cacheOnly')) ?? false;

  const updateData = async (
  ) => {
    const {symbol, interval, start, end} = filters;

    const cachedResult = await get(key) as KlineChartData | null;

    if (!silent) {
      setLoading(true);
    }

    if (cachedResult && !_.isEmpty(cachedResult)) {
      setData(filters.symbol, filters.interval, cachedResult);
    }
    
    const newData = await kline({
      symbol,
      interval,
      start: Math.max(start, data?.[0]?.timestamp || 0, cachedResult?.[0]?.timestamp || 0),
      end,
      silent,
      cacheOnly,
    });

    setData(symbol, interval, newData);

    if (!silent) {
      setLoading(false);
    }

    await set(key, newData);
  };

  useEffect(() => {
    updateData();

    // const id = setInterval(() => {
    //   updateData(filters, true);
    // }, 2000);

    // return () => {
    //   clearInterval(id);
    // }
  }, [key, silent]);

  useEffect(() => {
    if (data && !_.isEmpty(data)) {
      set(key, data);
    }
  }, [data, key])

  return {
    data: data || [],
    updateData,
    loading,
  };
};