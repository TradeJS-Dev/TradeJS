import ProgressBar from 'progress';
import {
  getHyperliquidWhaleWalletCoverage,
  hasHyperliquidWhaleBackfillCoverage,
  rebuildHyperliquidWhaleCoverageRows,
  rebuildHyperliquidWhaleFlowRows,
  upsertHyperliquidWhaleTradeEvents,
  upsertHyperliquidWhaleWalletCoverage,
} from '@tradejs/infra/timescale';
import {
  getHyperliquidPerpUniverseSnapshot,
  getHyperliquidWhaleRegistrySnapshot,
} from '@tradejs/node/strategies';
import type { HyperliquidWhaleTradeEventRow } from '@tradejs/types';
import {
  HYPERLIQUID_WHALE_BUCKET_MS,
  normalizeHyperliquidUserFill,
  type HyperliquidUserFill,
} from './hyperliquidWhaleData';
import {
  HyperliquidInfoRateLimiter,
  hyperliquidInfoResponseWeight,
} from './hyperliquidRateLimiter';

const DEFAULT_BASE_URL = 'https://api.hyperliquid.xyz';
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_RATE_LIMIT_WEIGHT = 1_000;
const MAX_PAGE_SIZE = 2_000;
const MAX_PAGES_PER_WHALE = 5;
const REQUEST_WEIGHT = 20;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

const positiveInt = (value: unknown, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const minuteCeil = (value: number) =>
  Math.ceil(value / HYPERLIQUID_WHALE_BUCKET_MS) * HYPERLIQUID_WHALE_BUCKET_MS;

const nextMinute = (value: number) =>
  (Math.floor(value / HYPERLIQUID_WHALE_BUCKET_MS) + 1) *
  HYPERLIQUID_WHALE_BUCKET_MS;

export type HyperliquidUserFillsFetchResult = {
  fills: HyperliquidUserFill[];
  truncated: boolean;
  coveredFromMs: number;
};

export const fetchHyperliquidUserFillsByTime = async (params: {
  address: string;
  startTime: number;
  endTime: number;
  fetchImpl?: typeof fetch;
  rateLimiter?: HyperliquidInfoRateLimiter;
  wait?: (ms: number) => Promise<void>;
  maxPages?: number;
}): Promise<HyperliquidUserFillsFetchResult> => {
  const fetchImpl = params.fetchImpl ?? fetch;
  const limiter =
    params.rateLimiter ??
    new HyperliquidInfoRateLimiter(
      positiveInt(
        process.env.HYPERLIQUID_WHALE_RATE_LIMIT_WEIGHT,
        DEFAULT_RATE_LIMIT_WEIGHT,
      ),
      Date.now,
      params.wait ?? sleep,
    );
  const fills: HyperliquidUserFill[] = [];
  let cursor = params.startTime;

  for (
    let page = 0;
    page < (params.maxPages ?? MAX_PAGES_PER_WHALE) && cursor <= params.endTime;
    page += 1
  ) {
    await limiter.reserve(REQUEST_WEIGHT);
    const response = await fetchImpl(
      `${process.env.HYPERLIQUID_API_BASE_URL?.trim() || DEFAULT_BASE_URL}/info`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'userFillsByTime',
          user: params.address,
          startTime: cursor,
          endTime: params.endTime,
          aggregateByTime: true,
        }),
      },
    );
    if (!response.ok) {
      throw new Error(
        `Hyperliquid userFillsByTime ${response.status}: ${await response.text()}`,
      );
    }
    const raw = await response.json();
    const pageRows = Array.isArray(raw) ? (raw as HyperliquidUserFill[]) : [];
    const responseWeight = hyperliquidInfoResponseWeight(pageRows.length);
    if (responseWeight > 0) await limiter.reserve(responseWeight);
    fills.push(...pageRows);
    if (pageRows.length < MAX_PAGE_SIZE) {
      return { fills, truncated: false, coveredFromMs: params.startTime };
    }

    const lastTime = Math.max(
      ...pageRows.map((row) => Number(row.time)).filter(Number.isFinite),
    );
    if (!Number.isFinite(lastTime) || lastTime < cursor) {
      throw new Error(
        `Hyperliquid fills pagination stalled for ${params.address}`,
      );
    }
    cursor = lastTime + 1;
  }

  if (cursor > params.endTime) {
    return { fills, truncated: false, coveredFromMs: params.startTime };
  }
  const firstAvailableTime = Math.min(
    ...fills.map((fill) => Number(fill.time)).filter(Number.isFinite),
  );
  return {
    fills,
    truncated: true,
    coveredFromMs: Math.min(params.endTime + 1, nextMinute(firstAvailableTime)),
  };
};

const runConcurrent = async <T>(params: {
  items: T[];
  concurrency: number;
  worker: (item: T, index: number) => Promise<void>;
}) => {
  let nextIndex = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(params.concurrency, params.items.length) },
      async () => {
        for (;;) {
          const index = nextIndex;
          nextIndex += 1;
          if (index >= params.items.length) return;
          await params.worker(params.items[index], index);
        }
      },
    ),
  );
};

export type HyperliquidWhaleBackfillResult = {
  cached: boolean;
  cacheOnly: boolean;
  fills: number;
  events: number;
  buckets: number;
  coverageBuckets: number;
  complete: boolean;
  walletsProcessed: number;
  walletsCached: number;
  completeWallets: number;
  truncatedWallets: number;
  failedWallets: number;
  fromMs: number;
  toMs: number;
};

export const backfillHyperliquidWhaleContext = async (params: {
  startMs: number;
  endMs: number;
  cacheOnly: boolean;
  strict?: boolean;
  fetchImpl?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
  concurrency?: number;
  log?: (message: string) => void;
}): Promise<HyperliquidWhaleBackfillResult> => {
  const universe = getHyperliquidPerpUniverseSnapshot();
  const whales = getHyperliquidWhaleRegistrySnapshot();
  const trackedSymbols = new Set(universe.symbols);
  const identity = {
    universeFingerprint: universe.fingerprint,
    whaleRegistryFingerprint: whales.fingerprint,
  };
  const fromMs =
    Math.floor(params.startMs / HYPERLIQUID_WHALE_BUCKET_MS) *
    HYPERLIQUID_WHALE_BUCKET_MS;
  const toMs = minuteCeil(params.endMs);
  const cached = await hasHyperliquidWhaleBackfillCoverage({
    fromMs,
    toMs,
    ...identity,
  });
  const emptyResult = (): HyperliquidWhaleBackfillResult => ({
    cached,
    cacheOnly: params.cacheOnly,
    fills: 0,
    events: 0,
    buckets: 0,
    coverageBuckets: 0,
    complete: cached,
    walletsProcessed: 0,
    walletsCached: 0,
    completeWallets: 0,
    truncatedWallets: 0,
    failedWallets: 0,
    fromMs,
    toMs,
  });
  if (cached || params.cacheOnly) return emptyResult();

  const limiter = new HyperliquidInfoRateLimiter(
    positiveInt(
      process.env.HYPERLIQUID_WHALE_RATE_LIMIT_WEIGHT,
      DEFAULT_RATE_LIMIT_WEIGHT,
    ),
    Date.now,
    params.wait ?? sleep,
  );
  const concurrency = Math.min(
    4,
    positiveInt(
      params.concurrency ?? process.env.HYPERLIQUID_WHALE_CONCURRENCY,
      DEFAULT_CONCURRENCY,
    ),
  );
  let fills = 0;
  let events = 0;
  let walletsProcessed = 0;
  let walletsCached = 0;
  let completeWallets = 0;
  let truncatedWallets = 0;
  let failedWallets = 0;
  const failures: Error[] = [];

  await runConcurrent({
    items: whales.addresses,
    concurrency,
    worker: async (address) => {
      const previous = await getHyperliquidWhaleWalletCoverage({
        address,
        fromMs,
        toMs,
        ...identity,
      });
      if (previous && previous.status !== 'failed') {
        walletsCached += 1;
        if (previous.status === 'complete') completeWallets += 1;
        else truncatedWallets += 1;
      } else {
        try {
          const result = await fetchHyperliquidUserFillsByTime({
            address,
            startTime: fromMs,
            endTime: toMs - 1,
            fetchImpl: params.fetchImpl,
            rateLimiter: limiter,
          });
          const addressEvents = result.fills
            .map((fill) =>
              normalizeHyperliquidUserFill({
                fill,
                address,
                trackedSymbols,
                identity,
              }),
            )
            .filter((row): row is HyperliquidWhaleTradeEventRow => row != null);
          await upsertHyperliquidWhaleTradeEvents(addressEvents);
          await upsertHyperliquidWhaleWalletCoverage({
            address,
            fromMs,
            toMs,
            coveredFromMs: result.coveredFromMs,
            coveredToMs: toMs,
            status: result.truncated ? 'truncated' : 'complete',
            fillsCount: result.fills.length,
            ...identity,
          });
          fills += result.fills.length;
          events += addressEvents.length;
          if (result.truncated) truncatedWallets += 1;
          else completeWallets += 1;
        } catch (error) {
          const normalizedError =
            error instanceof Error ? error : new Error(String(error));
          failures.push(normalizedError);
          failedWallets += 1;
          await upsertHyperliquidWhaleWalletCoverage({
            address,
            fromMs,
            toMs,
            coveredFromMs: null,
            coveredToMs: null,
            status: 'failed',
            fillsCount: 0,
            error: normalizedError.message,
            ...identity,
          });
        }
      }
      walletsProcessed += 1;
      params.log?.(
        `Hyperliquid whales ${walletsProcessed}/${whales.addresses.length}: complete=${completeWallets}, truncated=${truncatedWallets}, failed=${failedWallets}, fills=${fills}, events=${events}`,
      );
    },
  });

  const buckets = await rebuildHyperliquidWhaleFlowRows({
    fromMs,
    toMs,
    ...identity,
  });
  const totalCoverageBuckets = Math.ceil(
    (toMs - fromMs) / HYPERLIQUID_WHALE_BUCKET_MS,
  );
  const coverageBar = new ProgressBar(
    'Hyperliquid coverage :current/:total [:bar][:percent] :eta(s) rows=:rows chunk=:chunk',
    {
      total: Math.max(1, totalCoverageBuckets),
      width: 24,
    },
  );
  let displayedCoverageBuckets = 0;
  const coverageBuckets = await rebuildHyperliquidWhaleCoverageRows({
    fromMs,
    toMs,
    expectedWhales: whales.addresses.length,
    ...identity,
    onProgress: (progress) => {
      const next = Math.max(
        displayedCoverageBuckets,
        Math.min(progress.completedBuckets, coverageBar.total),
      );
      const delta = next - displayedCoverageBuckets;
      if (delta > 0) {
        coverageBar.tick(delta, {
          rows: progress.rows,
          chunk: `${progress.chunkIndex}/${progress.totalChunks}`,
        });
        displayedCoverageBuckets = next;
      }
    },
  });
  const result: HyperliquidWhaleBackfillResult = {
    cached: false,
    cacheOnly: false,
    fills,
    events,
    buckets,
    coverageBuckets,
    complete: truncatedWallets === 0 && failedWallets === 0,
    walletsProcessed,
    walletsCached,
    completeWallets,
    truncatedWallets,
    failedWallets,
    fromMs,
    toMs,
  };
  if (params.strict !== false && failures.length) {
    throw new AggregateError(
      failures,
      `Hyperliquid whale backfill failed for ${failures.length}/${whales.addresses.length} wallets`,
    );
  }
  return result;
};
