import {
  readDataCoverage,
  readDataCoverageDay,
} from '@tradejs/infra/timescale/dataCoverage';
import type { DataCoverage, DataCoverageSeriesDay } from '@tradejs/types';

const MINUTE_MS = 60_000;
const RECENT_WINDOW_MS = 7 * 24 * 60 * MINUTE_MS;
const MAX_CACHED_RESULTS = 128;

type CoverageResult = DataCoverage | DataCoverageSeriesDay[];
type Entry = {
  result: Promise<CoverageResult>;
  expiresAt: number;
};

const cache = new Map<string, Entry>();

function evictCachedResults() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  for (const [key, entry] of cache) {
    if (cache.size <= MAX_CACHED_RESULTS) break;
    if (Number.isFinite(entry.expiresAt)) cache.delete(key);
  }
}

export function getCachedDataCoverage({
  dataset,
  period,
  day,
  refresh,
}: {
  dataset: string;
  period: { from: number; to: number };
  day?: number;
  refresh: boolean;
}) {
  const prefix = `${dataset}:${period.to}:`;
  const key = prefix + (day ?? 'overview');
  const existing = cache.get(key);
  if (refresh && day === undefined) {
    for (const cachedKey of cache.keys()) {
      if (cachedKey !== key && cachedKey.startsWith(prefix))
        cache.delete(cachedKey);
    }
  }
  const pending = existing?.expiresAt === Infinity;
  if (existing && (pending || (!refresh && existing.expiresAt > Date.now()))) {
    cache.delete(key);
    cache.set(key, existing);
    return { result: existing.result, status: pending ? 'shared' : 'hit' };
  }

  // The work is shared between requests, so a disconnected browser cannot cancel it.
  const { signal } = new AbortController();
  const result =
    day === undefined
      ? readDataCoverage(dataset, period, signal)
      : readDataCoverageDay(dataset, period, day, signal);
  const entry: Entry = { result, expiresAt: Infinity };
  cache.delete(key);
  cache.set(key, entry);
  void result.then(
    () => {
      if (cache.get(key) !== entry) return;
      const now = Date.now();
      const ttl =
        period.to + RECENT_WINDOW_MS > now ? MINUTE_MS : 10 * MINUTE_MS;
      entry.expiresAt = now + ttl;
      evictCachedResults();
    },
    () => {
      if (cache.get(key) === entry) cache.delete(key);
    },
  );
  return { result, status: 'miss' };
}
