import { NextRequest, NextResponse } from 'next/server';
import { intervalToMs, mergeData } from '@tradejs/core/data';
import {
  createIndicators,
  getRegisteredIndicatorEntries,
} from '@tradejs/core/indicators';
import { getConnectorCreatorByProvider } from '@tradejs/node/connectors';
import { ensureIndicatorPluginsLoaded } from '@tradejs/node/registry';
import { logger } from '@tradejs/infra/logger';
import {
  KlineChartData,
  KlineRequest,
  Interval,
  ConnectorCreator,
} from '@tradejs/types';
import { getCurrentUserName } from '@app/lib/currentUser';
import { normalizeEndToIntervalBoundary } from '@app/lib/klineWindow';

export const dynamic = 'force-dynamic';
const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();
const DEFAULT_KLINE_CACHE_TTL_MS = 30_000;
const MAX_KLINE_CACHE_ENTRIES = 500;
const MAX_KLINE_CACHE_BYTES = 32 * 1024 * 1024;

interface Params {
  provider: string;
  symbol: string;
  interval: string;
}

type KlineCacheEntry = {
  expiresAt: number;
  sizeBytes: number;
  value: KlineChartData;
};

type ManagedKlineCache = {
  entries: Map<string, KlineCacheEntry>;
  totalBytes: number;
};

type PluginRegistrySnapshot = {
  pluginKeys: string[];
  signature: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __tradejsKlineRawCache__: ManagedKlineCache | undefined;
  // eslint-disable-next-line no-var
  var __tradejsKlineBtcRawCache__: ManagedKlineCache | undefined;
  // eslint-disable-next-line no-var
  var __tradejsKlineEnrichedCache__: ManagedKlineCache | undefined;
  // eslint-disable-next-line no-var
  var __tradejsKlineInflightRequests__:
    | Map<string, Promise<KlineChartData>>
    | undefined;
  // eslint-disable-next-line no-var
  var __tradejsPluginRegistrySnapshotPromise__:
    | Promise<PluginRegistrySnapshot>
    | undefined;
}

const cloneKlineData = (data: KlineChartData) =>
  data.map((candle) => ({ ...candle })) as KlineChartData;

const createManagedCache = (): ManagedKlineCache => ({
  entries: new Map<string, KlineCacheEntry>(),
  totalBytes: 0,
});

const getRawKlineCache = () => {
  if (!global.__tradejsKlineRawCache__) {
    global.__tradejsKlineRawCache__ = createManagedCache();
  }

  return global.__tradejsKlineRawCache__;
};

const getBtcKlineCache = () => {
  if (!global.__tradejsKlineBtcRawCache__) {
    global.__tradejsKlineBtcRawCache__ = createManagedCache();
  }

  return global.__tradejsKlineBtcRawCache__;
};

const getEnrichedKlineCache = () => {
  if (!global.__tradejsKlineEnrichedCache__) {
    global.__tradejsKlineEnrichedCache__ = createManagedCache();
  }

  return global.__tradejsKlineEnrichedCache__;
};

const getInflightRequestMap = () => {
  if (!global.__tradejsKlineInflightRequests__) {
    global.__tradejsKlineInflightRequests__ = new Map<
      string,
      Promise<KlineChartData>
    >();
  }

  return global.__tradejsKlineInflightRequests__;
};

const measureKlineDataBytes = (value: KlineChartData) =>
  Buffer.byteLength(JSON.stringify(value), 'utf8');

const pruneCache = (cache: ManagedKlineCache, now: number) => {
  for (const [key, entry] of cache.entries) {
    if (entry.expiresAt <= now) {
      cache.entries.delete(key);
      cache.totalBytes -= entry.sizeBytes;
    }
  }

  while (
    cache.entries.size > MAX_KLINE_CACHE_ENTRIES ||
    cache.totalBytes > MAX_KLINE_CACHE_BYTES
  ) {
    const oldestKey = cache.entries.keys().next().value;
    if (!oldestKey) {
      break;
    }

    const entry = cache.entries.get(oldestKey);
    cache.entries.delete(oldestKey);
    cache.totalBytes -= entry?.sizeBytes ?? 0;
  }

  cache.totalBytes = Math.max(0, cache.totalBytes);
};

const getCacheTtlMs = (interval: Interval) =>
  Math.min(intervalToMs(interval), DEFAULT_KLINE_CACHE_TTL_MS);

const buildRawCacheKey = (params: {
  provider: string;
  symbol: string;
  interval: Interval;
  start: number;
  end: number;
  cacheOnly?: boolean;
}) =>
  [
    params.provider,
    params.symbol,
    params.interval,
    params.start,
    params.end,
    params.cacheOnly ? 'cache' : 'live',
  ].join(':');

const buildEnrichedCacheKey = (params: {
  userName: string;
  provider: string;
  symbol: string;
  interval: Interval;
  start: number;
  end: number;
  historicalEnd: number;
  cacheOnly?: boolean;
  pluginSignature: string;
}) =>
  [
    params.userName,
    params.provider,
    params.symbol,
    params.interval,
    params.start,
    params.end,
    params.historicalEnd,
    params.cacheOnly ? 'cache' : 'live',
    params.pluginSignature,
  ].join(':');

const getCachedKline = (cache: ManagedKlineCache, key: string, now: number) => {
  const cached = cache.entries.get(key);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= now) {
    cache.entries.delete(key);
    cache.totalBytes -= cached.sizeBytes;
    cache.totalBytes = Math.max(0, cache.totalBytes);
    return null;
  }

  return cloneKlineData(cached.value);
};

const setCachedKline = (
  cache: ManagedKlineCache,
  key: string,
  value: KlineChartData,
  ttlMs: number,
  now: number,
) => {
  const nextValue = cloneKlineData(value);
  const nextSizeBytes = measureKlineDataBytes(nextValue);
  const previous = cache.entries.get(key);

  if (previous) {
    cache.totalBytes -= previous.sizeBytes;
  }

  cache.entries.set(key, {
    expiresAt: now + ttlMs,
    sizeBytes: nextSizeBytes,
    value: nextValue,
  });
  cache.totalBytes += nextSizeBytes;
  pruneCache(cache, now);
};

const enrichWithPluginIndicators = (
  data: KlineChartData,
  btcData: KlineChartData,
  pluginKeys: string[],
): KlineChartData => {
  if (!pluginKeys.length || !data.length) {
    return data;
  }

  const history = createIndicators(data, btcData, {
    includeMlPayload: false,
    pluginRegistryScope: projectRoot,
  }).result() as Record<string, number[]>;

  const nextData = cloneKlineData(data);

  for (const pluginKey of pluginKeys) {
    const series = history[pluginKey];
    if (!Array.isArray(series) || !series.length) {
      continue;
    }

    const startIdx = nextData.length - series.length;
    for (let i = 0; i < series.length; i += 1) {
      const candleIndex = startIdx + i;
      if (candleIndex < 0 || candleIndex >= nextData.length) {
        continue;
      }
      const value = series[i];
      if (!Number.isFinite(value)) {
        continue;
      }
      (nextData[candleIndex] as Record<string, unknown>)[pluginKey] = value;
    }
  }

  return nextData;
};

const getPluginRegistrySnapshot = async (): Promise<PluginRegistrySnapshot> => {
  if (!global.__tradejsPluginRegistrySnapshotPromise__) {
    global.__tradejsPluginRegistrySnapshotPromise__ = (async () => {
      await ensureIndicatorPluginsLoaded(projectRoot);
      const pluginKeys = getRegisteredIndicatorEntries(projectRoot)
        .map((entry) => entry.historyKey || entry.indicator.id)
        .sort();

      return {
        pluginKeys,
        signature: pluginKeys.join(','),
      };
    })().catch((error) => {
      global.__tradejsPluginRegistrySnapshotPromise__ = undefined;
      throw error;
    });
  }

  return global.__tradejsPluginRegistrySnapshotPromise__;
};

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<Params> },
) => {
  try {
    const userName = await getCurrentUserName();
    if (!userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { provider, symbol, interval } = await params;
    const body = await request.json();
    const options = body as
      | Omit<KlineRequest, 'symbol' | 'interval'>
      | undefined;

    if (!options || !symbol || !interval || !options.end) {
      return NextResponse.json(
        { error: 'Missing required kline parameters' },
        { status: 400 },
      );
    }

    const typedInterval = interval as Interval;
    const normalizedEnd = normalizeEndToIntervalBoundary(
      Number(options.end),
      typedInterval,
    );
    const historicalEnd = Math.min(Number(options.end), normalizedEnd);
    const pluginSnapshot = await getPluginRegistrySnapshot();
    const requestKey = buildEnrichedCacheKey({
      userName,
      provider,
      symbol,
      interval: typedInterval,
      start: Number(options.start ?? 0),
      end: Number(options.end),
      historicalEnd,
      cacheOnly: Boolean(options.cacheOnly),
      pluginSignature: pluginSnapshot.signature,
    });
    const now = Date.now();
    const ttlMs = getCacheTtlMs(typedInterval);
    const enrichedCache = getEnrichedKlineCache();
    const cachedEnriched = getCachedKline(enrichedCache, requestKey, now);
    if (cachedEnriched) {
      return NextResponse.json({ data: cachedEnriched });
    }

    const inflightRequests = getInflightRequestMap();
    const inflight = inflightRequests.get(requestKey);
    if (inflight) {
      return NextResponse.json({ data: await inflight });
    }

    const pending = (async () => {
      const connectorCreator =
        (await getConnectorCreatorByProvider(provider, projectRoot)) ||
        (await getConnectorCreatorByProvider('bybit', projectRoot));
      if (!connectorCreator) {
        throw new Error('No connector available for provider');
      }
      const connector = await (connectorCreator as ConnectorCreator)({
        userName,
      });

      const liveTailRequired = Number(options.end) > historicalEnd;
      const liveTailStart = Math.max(Number(options.start ?? 0), historicalEnd);
      const rawCache = getRawKlineCache();
      const btcCache = getBtcKlineCache();

      const fetchRawSegment = async (segmentParams: {
        symbol: string;
        start: number;
        end: number;
        useBtcCache?: boolean;
      }) => {
        if (segmentParams.end <= segmentParams.start) {
          return [] as KlineChartData;
        }

        const cache = segmentParams.useBtcCache ? btcCache : rawCache;
        const cacheKey = buildRawCacheKey({
          provider,
          symbol: segmentParams.symbol,
          interval: typedInterval,
          start: segmentParams.start,
          end: segmentParams.end,
          cacheOnly: Boolean(options.cacheOnly),
        });
        const cached = getCachedKline(cache, cacheKey, now);
        if (cached) {
          return cached;
        }

        const data = await connector.kline({
          symbol: segmentParams.symbol,
          interval: typedInterval,
          ...options,
          start: segmentParams.start,
          end: segmentParams.end,
        });

        setCachedKline(cache, cacheKey, data, ttlMs, now);
        return data;
      };

      const baseHistorical =
        historicalEnd > Number(options.start ?? 0)
          ? await fetchRawSegment({
              symbol,
              start: Number(options.start ?? 0),
              end: historicalEnd,
            })
          : [];
      const baseLiveTail = liveTailRequired
        ? await connector.kline({
            symbol,
            interval: typedInterval,
            ...options,
            start: liveTailStart,
            end: Number(options.end),
          })
        : [];
      const baseData = mergeData(baseHistorical, baseLiveTail);

      if (!pluginSnapshot.pluginKeys.length) {
        setCachedKline(enrichedCache, requestKey, baseData, ttlMs, now);
        return baseData;
      }

      const btcData =
        symbol === 'BTCUSDT'
          ? baseData
          : mergeData(
              historicalEnd > Number(options.start ?? 0)
                ? await fetchRawSegment({
                    symbol: 'BTCUSDT',
                    start: Number(options.start ?? 0),
                    end: historicalEnd,
                    useBtcCache: true,
                  })
                : [],
              liveTailRequired
                ? await connector.kline({
                    symbol: 'BTCUSDT',
                    interval: typedInterval,
                    ...options,
                    start: liveTailStart,
                    end: Number(options.end),
                  })
                : [],
            );

      const data = enrichWithPluginIndicators(
        baseData,
        btcData,
        pluginSnapshot.pluginKeys,
      );
      setCachedKline(enrichedCache, requestKey, data, ttlMs, now);
      return data;
    })().finally(() => {
      inflightRequests.delete(requestKey);
    });

    inflightRequests.set(requestKey, pending);

    return NextResponse.json({ data: await pending });
  } catch (error) {
    logger.log('error', `Kline fetch error: %o`, error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};
