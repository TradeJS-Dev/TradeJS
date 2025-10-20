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

const getKey = (filters: Pick<Filters, 'symbol' | 'interval'>) =>
  `${filters.symbol}_${filters.interval}`;

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
      };
    }),
}));

export const useData = (filters: Filters) => {
  const key = getKey(filters);
  const data = useDataStore((s) => s.data.get(key));
  const setData = useDataStore((s) => s.setData);
  const [fulfilled, setFulfilled] = useState(false);

  const searchParams = useSearchParams();
  const cacheOnly = Boolean(searchParams.get('cacheOnly')) ?? false;

  const updateData = async () => {
    const { symbol, interval, start, end } = filters;

    console.info('kline end', end);

    const cachedResult = (await get(key)) as KlineChartData | null;

    if (!fulfilled && cachedResult && !_.isEmpty(cachedResult)) {
      setData(filters.symbol, filters.interval, cachedResult);
    }

    let normStart = start;

    if (data && data?.length > 2) {
      normStart = Math.max(normStart, data[data.length - 2]?.timestamp || 0);
    }

    if (!fulfilled && cachedResult && cachedResult?.length > 2) {
      normStart = Math.max(
        normStart,
        cachedResult[cachedResult.length - 2]?.timestamp || 0,
      );
    }

    const newData = await kline({
      symbol,
      interval,
      start: normStart,
      end,
      cacheOnly,
    });

    setData(symbol, interval, newData);

    set(key, newData);

    setFulfilled(true);

    return {
      data: newData,
    };
  };

  useEffect(() => {
    setFulfilled(false);
    updateData();
  }, [key]);

  return {
    data: data || [],
    key,
    updateData,
    fulfilled,
  };
};
