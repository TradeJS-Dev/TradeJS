import { useEffect, useRef, useState } from 'react';
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

      next.set(getKey({ symbol, interval }), newData);

      return {
        data: next,
      };
    }),
}));

export const useData = (filters: Filters) => {
  const key = getKey(filters);
  const prevKey = useRef(key);
  const [fulfilled, setFulfilled] = useState(false);
  const data = useDataStore((s) => s.data.get(key)) || [];
  const setData = useDataStore((s) => s.setData);

  const searchParams = useSearchParams();
  const cacheOnly = Boolean(searchParams.get('cacheOnly')) ?? false;

  const updateData = async () => {
    const { symbol, interval, start, end } = filters;
    let currentData = [...data];

    if (!currentData || currentData.length < 2) {
      const cachedResult = (await get(key)) as KlineChartData | null;

      if (cachedResult && cachedResult.length > 2) {
        currentData = [...cachedResult];
      }
    }

    const normStart = Math.max(
      start,
      currentData?.length > 2
        ? currentData[currentData.length - 2]?.timestamp || 0
        : 0,
    );

    const newData = await kline({
      symbol,
      interval,
      start: normStart,
      end,
      cacheOnly,
    });

    const finalData = mergeData(currentData, newData);

    setData(symbol, interval, finalData);

    if (!fulfilled) {
      setFulfilled(true);
    }

    set(key, finalData);
  };

  useEffect(() => {
    if (key !== prevKey.current) {
      setFulfilled(false);
      prevKey.current = key;
    }

    updateData();
  }, [key, filters.end]);

  return {
    key,
    data,
    fulfilled,
  };
};
