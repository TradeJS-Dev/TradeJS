import { useEffect, useMemo, useState } from 'react';
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

interface DataRequest {
  key: string;
  provider: Provider;
  symbol: string;
  interval: Interval;
  start: number;
  end: number;
  cacheOnly: boolean;
}

const MIN_CACHED_CANDLES = 2;

const getKey = (provider: Provider, symbol: string, interval: Interval) =>
  `${provider}_${symbol}_${interval}`;

const getProvider = (provider?: Provider): Provider => provider || 'bybit';

const toRequest = (filters: Filters, cacheOnly: boolean): DataRequest => {
  const provider = getProvider(filters.provider);

  return {
    key: getKey(provider, filters.symbol, filters.interval),
    provider,
    symbol: filters.symbol,
    interval: filters.interval,
    start: filters.start,
    end: filters.end,
    cacheOnly,
  };
};

const getRequestKey = ({ key, start, end, cacheOnly }: DataRequest) =>
  `${key}_${start}_${end}_${cacheOnly ? 'cache' : 'live'}`;

const hasContinuityData = (data: KlineChartData) =>
  data.length > MIN_CACHED_CANDLES;

const inFlightRequests = new Map<string, Promise<KlineChartData>>();

const useDataStore = create<DataState>((set) => ({
  data: new Map<string, KlineChartData | null>(),
  setData: (provider, symbol, interval, newData) =>
    set(({ data }) => {
      const next = new Map(data);

      next.set(getKey(provider, symbol, interval), newData);

      return {
        data: next,
      };
    }),
}));

const loadCachedData = async (key: string) =>
  ((await get(key)) as KlineChartData | null) ?? [];

const clearCachedData = async (key: string) => {
  await set(key, []);
};

const getFetchStart = (start: number, data: KlineChartData) =>
  Math.max(
    start,
    hasContinuityData(data) ? data[data.length - 2]?.timestamp || 0 : 0,
  );

const requestKline = async (
  request: Pick<
    DataRequest,
    'provider' | 'symbol' | 'interval' | 'end' | 'cacheOnly'
  > & { start: number },
) =>
  kline({
    provider: request.provider,
    symbol: request.symbol,
    interval: request.interval,
    start: request.start,
    end: request.end,
    cacheOnly: request.cacheOnly,
  });

const loadCurrentData = async ({
  key,
  symbol,
  interval,
}: Pick<DataRequest, 'key' | 'symbol' | 'interval'>) => {
  let currentData = [
    ...(useDataStore.getState().data.get(key) ?? []),
  ] as KlineChartData;

  if (currentData.length < MIN_CACHED_CANDLES) {
    const cachedData = await loadCachedData(key);

    if (hasContinuityData(cachedData)) {
      currentData = [...cachedData];
    }
  }

  if (hasContinuityData(currentData) && isWrongData(interval, currentData)) {
    console.warn('Wrong kline continuity, drop cache', symbol, interval);
    await clearCachedData(key);
    return [];
  }

  return currentData;
};

const mergeFreshData = async (
  dataRequest: DataRequest,
  currentData: KlineChartData,
) => {
  const incrementalData = await requestKline({
    ...dataRequest,
    start: getFetchStart(dataRequest.start, currentData),
  });

  const mergedData = mergeData(currentData, incrementalData);

  if (
    dataRequest.cacheOnly ||
    !hasContinuityData(mergedData) ||
    !isWrongData(dataRequest.interval, mergedData)
  ) {
    return mergedData;
  }

  console.warn(
    'Wrong kline continuity after merge, refetch full',
    dataRequest.symbol,
    dataRequest.interval,
  );
  await clearCachedData(dataRequest.key);

  const fullData = await requestKline({
    ...dataRequest,
    start: dataRequest.start,
  });

  return mergeData([], fullData);
};

const persistData = async (
  {
    provider,
    symbol,
    interval,
    key,
  }: Pick<DataRequest, 'provider' | 'symbol' | 'interval' | 'key'>,
  data: KlineChartData,
) => {
  useDataStore.getState().setData(provider, symbol, interval, data);
  await set(key, data);
};

const fetchAndStoreData = async (dataRequest: DataRequest) => {
  const requestKey = getRequestKey(dataRequest);
  const existingRequest = inFlightRequests.get(requestKey);

  if (existingRequest) {
    return existingRequest;
  }

  const pendingRequest = (async () => {
    const currentData = await loadCurrentData(dataRequest);
    const finalData = await mergeFreshData(dataRequest, currentData);
    await persistData(dataRequest, finalData);

    return finalData;
  })().finally(() => {
    inFlightRequests.delete(requestKey);
  });

  inFlightRequests.set(requestKey, pendingRequest);

  return pendingRequest;
};

export const useData = (filters: Filters) => {
  const searchParams = useSearchParams();
  const cacheOnly = Boolean(searchParams.get('cacheOnly')) ?? false;
  const { end, interval, provider, start, symbol } = filters;
  const dataRequest = useMemo(
    () =>
      toRequest(
        {
          end,
          interval,
          provider,
          start,
          symbol,
        } as Filters,
        cacheOnly,
      ),
    [cacheOnly, end, interval, provider, start, symbol],
  );
  const [fulfilledKey, setFulfilledKey] = useState<string | null>(null);
  const storedData = useDataStore((s) => s.data.get(dataRequest.key));

  const fulfilled = fulfilledKey === dataRequest.key;

  useEffect(() => {
    let cancelled = false;

    const updateData = async () => {
      if (!dataRequest.symbol) {
        if (!cancelled) {
          setFulfilledKey(dataRequest.key);
        }
        return;
      }

      await fetchAndStoreData(dataRequest);

      if (!cancelled) {
        setFulfilledKey(dataRequest.key);
      }
    };

    void updateData();

    return () => {
      cancelled = true;
    };
  }, [dataRequest]);

  return {
    key: dataRequest.key,
    data: storedData ?? [],
    fulfilled,
  };
};
