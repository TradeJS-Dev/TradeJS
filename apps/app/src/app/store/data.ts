import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { get, set } from 'idb-keyval';
import { useSearchParams } from 'next/navigation';
import {
  KlineChartData,
  Interval,
  Filters,
  MarketUniverse,
  Provider,
} from '@tradejs/types';
import { kline } from '#actions/kline';
import { isWrongData, mergeData } from '@tradejs/core/data';
import { normalizeEndToIntervalBoundary } from '#app/lib/klineWindow';
import {
  buildDashboardKlineTopic,
  subscribeMarketKline,
} from './marketKlineStream';

interface DataState {
  data: Map<string, KlineChartData | null>;
  setData: (
    provider: Provider,
    symbol: string,
    interval: Interval,
    data: KlineChartData,
    universe?: MarketUniverse,
  ) => void;
}

interface DataRequest {
  key: string;
  provider: Provider;
  symbol: string;
  interval: Interval;
  universe: MarketUniverse;
  start: number;
  end: number;
  cacheBucketEnd: number;
  cacheOnly: boolean;
}

const MIN_CACHED_CANDLES = 2;

const getKey = (
  provider: Provider,
  universe: MarketUniverse,
  symbol: string,
  interval: Interval,
) => `${provider}_${universe}_${symbol}_${interval}`;

const getProvider = (provider?: Provider): Provider => provider || 'bybit';

const toRequest = (filters: Filters, cacheOnly: boolean): DataRequest => {
  const provider = getProvider(filters.provider);
  const universe = filters.universe ?? 'crypto';

  return {
    key: getKey(provider, universe, filters.symbol, filters.interval),
    provider,
    universe,
    symbol: filters.symbol,
    interval: filters.interval,
    start: filters.start,
    end: filters.end,
    cacheBucketEnd: normalizeEndToIntervalBoundary(
      filters.end,
      filters.interval,
    ),
    cacheOnly,
  };
};

const getRequestKey = ({
  key,
  start,
  cacheBucketEnd,
  cacheOnly,
}: DataRequest) =>
  `${key}_${start}_${cacheBucketEnd}_${cacheOnly ? 'cache' : 'live'}`;

const filterDataToWindow = (
  data: KlineChartData,
  start: number,
  end: number,
): KlineChartData =>
  data.filter((candle) => candle.timestamp >= start && candle.timestamp <= end);

const hasContinuityData = (data: KlineChartData) =>
  data.length > MIN_CACHED_CANDLES;

const inFlightRequests = new Map<string, Promise<KlineChartData>>();

const useDataStore = create<DataState>((set) => ({
  data: new Map<string, KlineChartData | null>(),
  setData: (provider, symbol, interval, newData, universe = 'crypto') =>
    set(({ data }) => {
      const next = new Map(data);

      next.set(getKey(provider, universe, symbol, interval), newData);

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
    'provider' | 'universe' | 'symbol' | 'interval' | 'end' | 'cacheOnly'
  > & { start: number },
) =>
  kline({
    provider: request.provider,
    universe: request.universe,
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
    universe,
    symbol,
    interval,
    key,
  }: Pick<DataRequest, 'provider' | 'universe' | 'symbol' | 'interval' | 'key'>,
  data: KlineChartData,
) => {
  useDataStore.getState().setData(provider, symbol, interval, data, universe);
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

export const useData = (filters: Filters, live = true) => {
  const searchParams = useSearchParams();
  const cacheOnly = Boolean(searchParams.get('cacheOnly')) ?? false;
  const { end, interval, provider, start, symbol, universe } = filters;
  const dataRequest = useMemo(
    () =>
      toRequest(
        {
          end,
          interval,
          provider,
          universe,
          start,
          symbol,
        } as Filters,
        cacheOnly,
      ),
    [cacheOnly, end, interval, provider, start, symbol, universe],
  );
  const requestKey = useMemo(() => getRequestKey(dataRequest), [dataRequest]);
  const [fulfilledRequestKey, setFulfilledRequestKey] = useState<string | null>(
    null,
  );
  const [liveWindow, setLiveWindow] = useState({ key: '', end: 0 });
  const storedData = useDataStore((s) => s.data.get(dataRequest.key));
  const effectiveEnd = Math.max(
    dataRequest.end,
    liveWindow.key === dataRequest.key ? liveWindow.end : dataRequest.end,
  );
  const windowedData = useMemo(
    () => filterDataToWindow(storedData ?? [], dataRequest.start, effectiveEnd),
    [dataRequest.start, effectiveEnd, storedData],
  );

  const fulfilled = fulfilledRequestKey === requestKey;

  useEffect(() => {
    let cancelled = false;

    const updateData = async () => {
      if (!dataRequest.symbol) {
        if (!cancelled) {
          setFulfilledRequestKey(requestKey);
        }
        return;
      }

      await fetchAndStoreData(dataRequest);

      if (!cancelled) {
        setFulfilledRequestKey(requestKey);
      }
    };

    void updateData();

    return () => {
      cancelled = true;
    };
  }, [dataRequest, requestKey]);

  useEffect(() => {
    if (!live || cacheOnly || !dataRequest.symbol) return;
    const topic = buildDashboardKlineTopic(dataRequest);
    const catchUp = () => {
      const end = Date.now();
      void fetchAndStoreData({
        ...dataRequest,
        end,
        cacheBucketEnd: normalizeEndToIntervalBoundary(
          end,
          dataRequest.interval,
        ),
      });
    };
    return subscribeMarketKline({
      topic,
      onReconnect: catchUp,
      onEvent: (event) => {
        setLiveWindow((current) => ({
          key: dataRequest.key,
          end: Math.max(
            current.key === dataRequest.key ? current.end : dataRequest.end,
            event.candle.timestamp,
          ),
        }));
        const current = useDataStore.getState().data.get(dataRequest.key) ?? [];
        void persistData(dataRequest, mergeData(current, [event.candle]));
      },
    });
  }, [cacheOnly, dataRequest, live]);

  return {
    key: dataRequest.key,
    data: windowedData,
    fulfilled,
  };
};
