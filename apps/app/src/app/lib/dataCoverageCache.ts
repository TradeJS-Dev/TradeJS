import { readDataCoverageSnapshot } from '@tradejs/infra/timescale/dataCoverage';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const RECENT_WINDOW_MS = 7 * DAY_MS;
const MAX_CACHED_RESULTS = 128;

type Snapshot = Awaited<ReturnType<typeof readDataCoverageSnapshot>>;
type Entry = {
  result: Promise<Snapshot>;
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
  refresh,
  annual,
}: {
  dataset: string;
  period: { from: number; to: number };
  refresh: boolean;
  annual: boolean;
}) {
  const key = `${dataset}:${period.from}:${period.to}`;
  const existing = cache.get(key);
  const pending = existing?.expiresAt === Infinity;
  if (existing && (pending || (!refresh && existing.expiresAt > Date.now()))) {
    cache.delete(key);
    cache.set(key, existing);
    return { result: existing.result, status: pending ? 'shared' : 'hit' };
  }

  // The work is shared between requests, so a disconnected browser cannot cancel it.
  const { signal } = new AbortController();
  const result = readDataCoverageSnapshot(dataset, period, signal);
  const entry: Entry = { result, expiresAt: Infinity };
  cache.delete(key);
  cache.set(key, entry);
  void result.then(
    () => {
      if (cache.get(key) !== entry) return;
      const now = Date.now();
      const ttl =
        (period.to + RECENT_WINDOW_MS > now
          ? annual
            ? 10
            : 1
          : annual
            ? 60
            : 10) * MINUTE_MS;
      entry.expiresAt = now + ttl;
      evictCachedResults();
    },
    () => {
      if (cache.get(key) === entry) cache.delete(key);
    },
  );
  return { result, status: 'miss' };
}
