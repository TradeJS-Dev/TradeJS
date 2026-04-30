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

interface Params {
  provider: string;
  symbol: string;
  interval: string;
}

type KlineCacheEntry = {
  expiresAt: number;
  value: KlineChartData;
};

declare global {
  // eslint-disable-next-line no-var
  var __tradejsKlineRawCache__: Map<string, KlineCacheEntry> | undefined;
  // eslint-disable-next-line no-var
  var __tradejsKlineBtcRawCache__: Map<string, KlineCacheEntry> | undefined;
}

const getRawKlineCache = () => {
  if (!global.__tradejsKlineRawCache__) {
    global.__tradejsKlineRawCache__ = new Map<string, KlineCacheEntry>();
  }

  return global.__tradejsKlineRawCache__;
};

const getBtcKlineCache = () => {
  if (!global.__tradejsKlineBtcRawCache__) {
    global.__tradejsKlineBtcRawCache__ = new Map<string, KlineCacheEntry>();
  }

  return global.__tradejsKlineBtcRawCache__;
};

const pruneCache = (cache: Map<string, KlineCacheEntry>, now: number) => {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }

  while (cache.size > MAX_KLINE_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    cache.delete(oldestKey);
  }
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

const getCachedRawKline = (
  cache: Map<string, KlineCacheEntry>,
  key: string,
  now: number,
) => {
  const cached = cache.get(key);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= now) {
    cache.delete(key);
    return null;
  }

  return cached.value.map((candle) => ({ ...candle })) as KlineChartData;
};

const setCachedRawKline = (
  cache: Map<string, KlineCacheEntry>,
  key: string,
  value: KlineChartData,
  ttlMs: number,
  now: number,
) => {
  cache.set(key, {
    expiresAt: now + ttlMs,
    value: value.map((candle) => ({ ...candle })) as KlineChartData,
  });
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

  const nextData = data.map((candle) => ({ ...candle }));

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

    const connectorCreator =
      (await getConnectorCreatorByProvider(provider, projectRoot)) ||
      (await getConnectorCreatorByProvider('bybit', projectRoot));
    if (!connectorCreator) {
      throw new Error('No connector available for provider');
    }
    const connector = await (connectorCreator as ConnectorCreator)({
      userName,
    });

    const typedInterval = interval as Interval;
    const normalizedEnd = normalizeEndToIntervalBoundary(
      Number(options.end),
      typedInterval,
    );
    const historicalEnd = Math.min(Number(options.end), normalizedEnd);
    const liveTailRequired = Number(options.end) > historicalEnd;
    const liveTailStart = Math.max(Number(options.start ?? 0), historicalEnd);
    const rawCache = getRawKlineCache();
    const btcCache = getBtcKlineCache();
    const now = Date.now();
    const ttlMs = getCacheTtlMs(typedInterval);

    const fetchRawSegment = async (params: {
      symbol: string;
      start: number;
      end: number;
      useBtcCache?: boolean;
    }) => {
      if (params.end <= params.start) {
        return [] as KlineChartData;
      }

      const cache = params.useBtcCache ? btcCache : rawCache;
      const cacheKey = buildRawCacheKey({
        provider,
        symbol: params.symbol,
        interval: typedInterval,
        start: params.start,
        end: params.end,
        cacheOnly: Boolean(options.cacheOnly),
      });
      const cached = getCachedRawKline(cache, cacheKey, now);
      if (cached) {
        return cached;
      }

      const data = await connector.kline({
        symbol: params.symbol,
        interval: typedInterval,
        ...options,
        start: params.start,
        end: params.end,
      });

      setCachedRawKline(cache, cacheKey, data, ttlMs, now);
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

    await ensureIndicatorPluginsLoaded(projectRoot);
    const pluginKeys = getRegisteredIndicatorEntries(projectRoot).map(
      (entry) => entry.historyKey || entry.indicator.id,
    );
    if (!pluginKeys.length) {
      return NextResponse.json({ data: baseData });
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

    const data = enrichWithPluginIndicators(baseData, btcData, pluginKeys);

    return NextResponse.json({ data });
  } catch (error) {
    logger.log('error', `Kline fetch error: %o`, error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};
