import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import _ from 'lodash';
import { get, set } from 'idb-keyval';
import { useSearchParams } from 'next/navigation';
import { KlineChartData, Interval, Filters } from '@types';
import { kline } from '@actions/kline';
import { mergeData, isWrongData } from '@utils/array';

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
  const retried = useRef(false);
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

    if (currentData?.length > 2 && isWrongData(interval, currentData)) {
      console.warn('Wrong kline continuity, drop cache', symbol, interval);
      currentData = [];
      set(key, []);
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

    if (
      !cacheOnly &&
      !retried.current &&
      finalData.length > 2 &&
      isWrongData(interval, finalData)
    ) {
      console.warn(
        'Wrong kline continuity after merge, refetch full',
        symbol,
        interval,
      );
      retried.current = true;
      set(key, []);
      const refetchData = await kline({
        symbol,
        interval,
        start,
        end,
        cacheOnly,
      });
      const cleaned = mergeData([], refetchData);
      setData(symbol, interval, cleaned);
      if (!fulfilled) {
        setFulfilled(true);
      }
      set(key, cleaned);
      return;
    }

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
      retried.current = false;
    }

    updateData();
  }, [key, filters.end]);

  return {
    key,
    data,
    fulfilled,
  };
};
