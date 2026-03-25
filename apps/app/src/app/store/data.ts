import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
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

const getRequestKey = ({
  key,
  start,
  end,
  cacheOnly,
}: {
  key: string;
  start: number;
  end: number;
  cacheOnly: boolean;
}) => `${key}_${start}_${end}_${cacheOnly ? 'cache' : 'live'}`;

const inFlightRequests = new Map<string, Promise<KlineChartData>>();

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

const fetchAndStoreData = async ({
  key,
  provider,
  symbol,
  interval,
  start,
  end,
  cacheOnly,
}: {
  key: string;
  provider: Provider;
  symbol: string;
  interval: Interval;
  start: number;
  end: number;
  cacheOnly: boolean;
}) => {
  const requestKey = getRequestKey({ key, start, end, cacheOnly });
  const existingRequest = inFlightRequests.get(requestKey);

  if (existingRequest) {
    return existingRequest;
  }

  const request = (async () => {
    let currentData = [
      ...(useDataStore.getState().data.get(key) ?? []),
    ] as KlineChartData;

    if (currentData.length < 2) {
      const cachedResult = (await get(key)) as KlineChartData | null;

      if (cachedResult && cachedResult.length > 2) {
        currentData = [...cachedResult];
      }
    }

    if (currentData.length > 2 && isWrongData(interval, currentData)) {
      console.warn('Wrong kline continuity, drop cache', symbol, interval);
      currentData = [];
      await set(key, []);
    }

    const normStart = Math.max(
      start,
      currentData.length > 2
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

    let finalData = mergeData(currentData, newData);

    if (!cacheOnly && finalData.length > 2 && isWrongData(interval, finalData)) {
      console.warn(
        'Wrong kline continuity after merge, refetch full',
        symbol,
        interval,
      );
      await set(key, []);
      const refetchData = await kline({
        provider,
        symbol,
        interval,
        start,
        end,
        cacheOnly,
      });
      finalData = mergeData([], refetchData);
    }

    useDataStore.getState().setData(provider, symbol, interval, finalData);
    await set(key, finalData);

    return finalData;
  })().finally(() => {
    inFlightRequests.delete(requestKey);
  });

  inFlightRequests.set(requestKey, request);

  return request;
};

export const useData = (filters: Filters) => {
  const {
    provider = 'bybit',
    symbol,
    interval,
    start,
    end,
  } = filters as Filters & { provider: Provider };
  const key = getKey({ provider, symbol, interval });
  const prevKey = useRef(key);
  const [fulfilled, setFulfilled] = useState(false);
  const storedData = useDataStore((s) => s.data.get(key));

  const searchParams = useSearchParams();
  const cacheOnly = Boolean(searchParams.get('cacheOnly')) ?? false;

  useEffect(() => {
    if (key !== prevKey.current) {
      setFulfilled(false);
      prevKey.current = key;
    }
  }, [key]);

  useEffect(() => {
    let cancelled = false;

    const updateData = async () => {
      if (!symbol) {
        if (!cancelled) {
          setFulfilled(true);
        }
        return;
      }

      await fetchAndStoreData({
        key,
        provider,
        symbol,
        interval,
        start,
        end,
        cacheOnly,
      });

      if (!cancelled) {
        setFulfilled(true);
      }
    };

    void updateData();

    return () => {
      cancelled = true;
    };
  }, [cacheOnly, end, interval, key, provider, start, symbol]);

  return {
    key,
    data: storedData ?? [],
    fulfilled,
  };
};
