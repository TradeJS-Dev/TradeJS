import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import _ from 'lodash';
import { get, set } from 'idb-keyval';
import { useSearchParams } from 'next/navigation';
import { KlineChartData, Interval, Filters, Provider } from '@tradejs/types';
import { kline } from '@actions/kline';
import { isWrongData, mergeData } from '@tradejs/core/data';

interface DataState {
  data: Map<string, KlineChartData | null>;
  setData: (
    provider: Provider,
    symbol: string,
    interval: Interval,
    data: KlineChartData,
  ) => void;
}

const getKey = (filters: Pick<Filters, 'provider' | 'symbol' | 'interval'>) =>
  `${filters.provider || 'bybit'}_${filters.symbol}_${filters.interval}`;

const useDataStore = create<DataState>((set) => ({
  data: new Map<string, KlineChartData | null>(),
  setData: (provider, symbol, interval, newData) =>
    set(({ data }) => {
      const next = new Map(data);

      next.set(getKey({ provider, symbol, interval }), newData);

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
  const storedData = useDataStore((s) => s.data.get(key));
  const setData = useDataStore((s) => s.setData);

  const searchParams = useSearchParams();
  const cacheOnly = Boolean(searchParams.get('cacheOnly')) ?? false;

  useEffect(() => {
    if (key !== prevKey.current) {
      setFulfilled(false);
      prevKey.current = key;
      retried.current = false;
    }

    const updateData = async () => {
      const { provider = 'bybit', symbol, interval, start, end } = filters;
      if (!symbol) {
        if (!fulfilled) {
          setFulfilled(true);
        }
        return;
      }
      let currentData = [...(storedData ?? [])];

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
        provider,
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
          provider,
          symbol,
          interval,
          start,
          end,
          cacheOnly,
        });
        const cleaned = mergeData([], refetchData);
        setData(provider as Provider, symbol, interval, cleaned);
        if (!fulfilled) {
          setFulfilled(true);
        }
        set(key, cleaned);
        return;
      }

      setData(provider as Provider, symbol, interval, finalData);

      if (!fulfilled) {
        setFulfilled(true);
      }

      set(key, finalData);
    };

    void updateData();
  }, [cacheOnly, filters, fulfilled, key, setData, storedData]);

  return {
    key,
    data: storedData ?? [],
    fulfilled,
  };
};
