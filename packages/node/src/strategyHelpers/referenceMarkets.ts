import {
  indexReferenceMarkets,
  REFERENCE_MARKET_INTERVALS,
  REFERENCE_MARKET_SYMBOLS,
  REFERENCE_TRADFI_SYMBOLS,
} from '@tradejs/core/data';
import { logger } from '@tradejs/infra/logger';
import {
  getDataEdgesForSymbols,
  getReferenceCandlePrices,
} from '@tradejs/infra/timescale/candles';
import type { Signal } from '@tradejs/types';
import { getConnectorCreatorByProvider } from '../connectorsRegistry';

const intervals = Object.values(REFERENCE_MARKET_INTERVALS);
const intervalMs = (minutes: number) => minutes * 60_000;
const bucketMs = 7 * 24 * 60 * 60_000;
const maxCacheBuckets = 6;
const retryMs = 60_000;
const liveBucketMs = intervalMs(15);
const liveWaitMs = 10_000;

async function waitForReference<T>(pending: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), liveWaitMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const bucketCache = new Map<
  number,
  {
    expiresAt: number;
    promise: Promise<ReturnType<typeof indexReferenceMarkets> | null>;
  }
>();

const referenceMarketsEnabled = () =>
  process.env.TRADEJS_REFERENCE_MARKETS !== 'false';

const loadBucket = (timestamp: number) => {
  const now = Date.now();
  const bucket = Math.floor(timestamp / bucketMs) * bucketMs;
  const hit = bucketCache.get(bucket);
  if (hit && hit.expiresAt > now) {
    bucketCache.delete(bucket);
    bucketCache.set(bucket, hit);
    return hit.promise;
  }

  const entry = {
    expiresAt:
      bucket + bucketMs <= now
        ? Infinity
        : Math.floor(now / liveBucketMs) * liveBucketMs + liveBucketMs,
    promise: getReferenceCandlePrices(
      'bybit',
      REFERENCE_MARKET_SYMBOLS,
      intervals,
      bucket - 2 * intervalMs(240),
      Math.min(bucket + bucketMs, now),
    )
      .then(indexReferenceMarkets)
      .catch((error: unknown) => {
        entry.expiresAt = Date.now() + retryMs;
        logger.warn('Bybit reference markets read failed: %s', String(error));
        return null;
      }),
  };
  bucketCache.set(bucket, entry);
  if (bucketCache.size > maxCacheBuckets) {
    const oldest = bucketCache.keys().next();
    if (!oldest.done) bucketCache.delete(oldest.value);
  }
  return entry.promise;
};

export const enrichSignalWithReferenceMarkets = async (signal: Signal) => {
  if (
    !referenceMarketsEnabled() ||
    !Number.isSafeInteger(signal.timestamp) ||
    signal.timestamp < 0 ||
    signal.aiFeatureReplay
  )
    return;
  const lookup = await waitForReference(loadBucket(signal.timestamp));
  const referenceMarkets = lookup?.(signal.timestamp);
  if (referenceMarkets) {
    signal.additionalIndicators = {
      ...signal.additionalIndicators,
      referenceMarkets,
    };
  }
};

type ReferenceHistoryRequest = {
  userName: string;
  projectRoot: string;
  startMs: number;
  endMs: number;
  cacheOnly: boolean;
  live: boolean;
};

const liveRefreshes = new Map<
  string,
  { bucket: number; promise: Promise<void>; inFlight: boolean }
>();

/** Warm the standard Bybit candle cache. Enrichment itself never uses the network. */
export const prepareReferenceMarketHistory = async (
  request: ReferenceHistoryRequest,
) => {
  if (!referenceMarketsEnabled() || request.cacheOnly) return;
  const liveKey = request.projectRoot;
  const latestClose = Math.floor(
    Math.min(request.endMs, Date.now()) / liveBucketMs,
  );
  const hit = liveRefreshes.get(liveKey);
  if (request.live && hit && (hit.inFlight || hit.bucket === latestClose)) {
    await waitForReference(hit.promise);
    return;
  }
  if (request.live && liveRefreshes.size >= 8) {
    const settled = [...liveRefreshes].find(([, entry]) => !entry.inFlight);
    if (!settled) return;
    liveRefreshes.delete(settled[0]);
  }
  const deadline = request.live ? Date.now() + liveWaitMs : Infinity;

  const refresh = async () => {
    const requestedEnd = Math.min(request.endMs, Date.now());
    const ranges = intervals.flatMap((minutes) => {
      const step = intervalMs(minutes);
      const end = Math.floor(requestedEnd / step) * step - step;
      const start = Math.max(
        0,
        request.live
          ? end - 2 * step
          : Math.floor(request.startMs / step) * step - 2 * step,
      );
      return start < end ? [{ minutes, start, end }] : [];
    });
    const pending = await Promise.all(
      ranges.map(async (range) => {
        const edges = await getDataEdgesForSymbols(
          'bybit',
          [...REFERENCE_MARKET_SYMBOLS],
          range.minutes,
        );
        return REFERENCE_MARKET_SYMBOLS.filter((symbol) => {
          const { min, max } = edges.get(symbol) ?? {};
          return (
            min === undefined ||
            min > range.start ||
            max === undefined ||
            max < range.end
          );
        }).map((symbol) => ({ symbol, ...range }));
      }),
    );
    const tasks = pending.flat();
    if (!tasks.length) return;
    const createConnector = await getConnectorCreatorByProvider(
      'bybit',
      request.projectRoot,
    );
    if (!createConnector) return;
    const tradfiSymbols = new Set<string>(REFERENCE_TRADFI_SYMBOLS);
    const universes = new Set(
      tasks.map(({ symbol }) =>
        tradfiSymbols.has(symbol) ? ('tradfi' as const) : ('crypto' as const),
      ),
    );
    const connectors = new Map(
      await Promise.all(
        [...universes].map(
          async (universe) =>
            [
              universe,
              await createConnector({ userName: request.userName, universe }),
            ] as const,
        ),
      ),
    );
    let index = 0;
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        for (;;) {
          if (Date.now() >= deadline) return;
          const task = tasks[index++];
          if (!task) return;
          const { symbol, minutes, start, end } = task;
          const connector = connectors.get(
            tradfiSymbols.has(symbol) ? 'tradfi' : 'crypto',
          )!;
          try {
            await connector.kline({
              symbol,
              interval: String(minutes) as '15' | '60' | '240',
              start,
              end,
              warmOnly: true,
              silent: true,
            });
          } catch (error) {
            logger.warn(
              'Bybit reference history failed for %s %sm: %s',
              symbol,
              minutes,
              String(error),
            );
          }
        }
      }),
    );
    bucketCache.clear();
  };
  const promise = refresh().catch((error: unknown) => {
    logger.warn(
      'Bybit reference history preparation failed: %s',
      String(error),
    );
  });
  if (request.live) {
    const entry = { bucket: latestClose, promise, inFlight: true };
    liveRefreshes.set(liveKey, entry);
    void promise.finally(() => {
      entry.inFlight = false;
    });
    await waitForReference(promise);
    return;
  }
  return promise;
};
