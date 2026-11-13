import { readDataCoverageSnapshot } from '@tradejs/infra/timescale/dataCoverage';
import {
  getHashJsonField,
  getHashJsonValues,
  setHashJsonField,
} from '@tradejs/infra/redis';
import type { SavedCoverage } from './dataCoverageOverview';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const RECENT_WINDOW_MS = 7 * DAY_MS;
const MAX_CACHED_RESULTS = 128;
const MAX_SCAN_MS = 2 * MINUTE_MS;

type Snapshot = Awaited<ReturnType<typeof readDataCoverageSnapshot>>;
type Entry = {
  result: Promise<Snapshot>;
  controller: AbortController;
  expiresAt: number;
  snapshot?: Snapshot;
  overview?: SavedCoverage;
  failed?: boolean;
  progress: { scannedDays: number; totalDays: number };
};

const cache = new Map<string, Entry>();
const periodKey = (
  dataset: string,
  { from, to }: { from: number; to: number },
) => `${dataset}:${from}:${to}`;
const savedKey = (year: number) => `tradejs:data-coverage:v1:${year}`;

export const readSavedCoverageYear = (year: number) =>
  getHashJsonValues<SavedCoverage>(savedKey(year));

export const readSavedCoverage = (year: number, dataset: string) =>
  getHashJsonField<SavedCoverage>(savedKey(year), dataset);

export const getDataCoverageEntry = (
  dataset: string,
  period: { from: number; to: number },
) => cache.get(periodKey(dataset, period));

function evictCachedResults() {
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
  polling = false,
  saveYear,
}: {
  dataset: string;
  period: { from: number; to: number };
  refresh: boolean;
  annual: boolean;
  polling?: boolean;
  saveYear?: number;
}) {
  const key = periodKey(dataset, period);
  const existing = cache.get(key);
  const pending = existing?.expiresAt === Infinity;
  if (
    existing &&
    (pending ||
      (!refresh &&
        (!existing.failed || polling) &&
        existing.expiresAt > Date.now()))
  ) {
    cache.delete(key);
    cache.set(key, existing);
    return {
      entry: existing,
      result: existing.result,
      status: pending ? 'shared' : 'hit',
    };
  }

  const progress = { scannedDays: 0, totalDays: 0 };
  // The scan is shared between requests and has its own deadline.
  const controller = new AbortController();
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(MAX_SCAN_MS),
  ]);
  const result = readDataCoverageSnapshot(
    dataset,
    period,
    signal,
    (scannedDays, totalDays) => {
      progress.scannedDays = scannedDays;
      progress.totalDays = totalDays;
    },
  );
  const entry: Entry = {
    result,
    controller,
    expiresAt: Infinity,
    progress,
    overview: existing?.overview,
  };
  cache.delete(key);
  cache.set(key, entry);
  void result.then(
    async (snapshot) => {
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
      entry.snapshot = snapshot;
      entry.overview = {
        dataset,
        coverage: snapshot.coverage,
        calculatedAt: now,
      };
      entry.expiresAt = now + ttl;
      evictCachedResults();
      if (saveYear !== undefined)
        await setHashJsonField(savedKey(saveYear), dataset, entry.overview, {
          expire: 0,
        });
    },
    () => {
      if (cache.get(key) !== entry) return;
      entry.failed = true;
      entry.expiresAt = Date.now() + MINUTE_MS;
      evictCachedResults();
    },
  );
  return { entry, result, status: 'miss' };
}

export function invalidateDataCoverage(dataset: string, day: number) {
  for (const [key, entry] of cache) {
    const [id, from, to] = key.split(':');
    if (id === dataset && day >= Number(from) && day < Number(to)) {
      if (entry.expiresAt === Infinity) {
        cache.delete(key);
        entry.controller.abort();
      } else entry.expiresAt = 0;
    }
  }
}
