import {
  getHyperliquidWhaleBackfillFailure,
  hasHyperliquidWhaleBackfillCoverage,
  rebuildHyperliquidWhaleFlowRows,
  upsertHyperliquidWhaleBackfillCoverage,
  upsertHyperliquidWhaleBackfillFailure,
  upsertHyperliquidWhaleTradeEvents,
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

const DEFAULT_BASE_URL = 'https://api.hyperliquid.xyz';
const DEFAULT_REQUEST_DELAY_MS = 1_200;
const MAX_PAGE_SIZE = 2_000;
const MAX_PAGES_PER_WHALE = 5;

export class HyperliquidWhaleHistoryLimitError extends Error {
  constructor(readonly address: string) {
    super(
      `Hyperliquid fills exceeded ${MAX_PAGES_PER_WHALE * MAX_PAGE_SIZE} rows for ${address}; use an S3 node_fills export for this range`,
    );
    this.name = 'HyperliquidWhaleHistoryLimitError';
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

const positiveInt = (value: unknown, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getRequestDelayMs = (responseItems: number) => {
  const configured = positiveInt(
    process.env.HYPERLIQUID_WHALE_REQUEST_DELAY_MS,
    DEFAULT_REQUEST_DELAY_MS,
  );
  const estimatedWeight = 20 + Math.ceil(responseItems / 20);
  const rateSafeDelay = Math.ceil(estimatedWeight / 20) * 1_000;
  return Math.max(configured, rateSafeDelay);
};

export const fetchHyperliquidUserFillsByTime = async (params: {
  address: string;
  startTime: number;
  endTime: number;
  fetchImpl?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
}): Promise<HyperliquidUserFill[]> => {
  const fetchImpl = params.fetchImpl ?? fetch;
  const wait = params.wait ?? sleep;
  const rows: HyperliquidUserFill[] = [];
  let cursor = params.startTime;

  for (
    let page = 0;
    page < MAX_PAGES_PER_WHALE && cursor <= params.endTime;
    page += 1
  ) {
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
          aggregateByTime: false,
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
    rows.push(...pageRows);
    await wait(getRequestDelayMs(pageRows.length));
    if (pageRows.length < MAX_PAGE_SIZE) return rows;

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

  if (cursor <= params.endTime) {
    throw new HyperliquidWhaleHistoryLimitError(params.address);
  }
  return rows;
};

export type HyperliquidWhaleBackfillResult = {
  cached: boolean;
  cacheOnly: boolean;
  fills: number;
  events: number;
  buckets: number;
  complete: boolean;
  failureCached: boolean;
  skippedReason?: string;
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
  const toMs =
    Math.ceil(params.endMs / HYPERLIQUID_WHALE_BUCKET_MS) *
    HYPERLIQUID_WHALE_BUCKET_MS;
  const cached = await hasHyperliquidWhaleBackfillCoverage({
    fromMs,
    toMs,
    ...identity,
  });
  if (cached || params.cacheOnly) {
    return {
      cached,
      cacheOnly: params.cacheOnly,
      fills: 0,
      events: 0,
      buckets: 0,
      complete: cached,
      failureCached: false,
      fromMs,
      toMs,
    };
  }

  if (params.strict === false) {
    const previousFailure = await getHyperliquidWhaleBackfillFailure({
      fromMs,
      toMs,
      ...identity,
    });
    if (previousFailure) {
      params.log?.(
        `Hyperliquid whale history skipped: REST-unavailable range cached (${previousFailure.reason})`,
      );
      return {
        cached: false,
        cacheOnly: false,
        fills: 0,
        events: 0,
        buckets: 0,
        complete: false,
        failureCached: true,
        skippedReason: previousFailure.reason,
        fromMs,
        toMs,
      };
    }
  }

  let fills = 0;
  let events = 0;
  for (let index = 0; index < whales.addresses.length; index += 1) {
    const address = whales.addresses[index];
    let addressFills: HyperliquidUserFill[];
    try {
      addressFills = await fetchHyperliquidUserFillsByTime({
        address,
        startTime: fromMs,
        endTime: toMs - 1,
        fetchImpl: params.fetchImpl,
        wait: params.wait,
      });
    } catch (error) {
      if (!(error instanceof HyperliquidWhaleHistoryLimitError)) throw error;
      await upsertHyperliquidWhaleBackfillFailure({
        fromMs,
        toMs,
        reason: error.message,
        ...identity,
      });
      if (params.strict !== false) throw error;
      params.log?.(
        `Hyperliquid whale history unavailable via REST; continuing without incomplete context: ${error.message}`,
      );
      return {
        cached: false,
        cacheOnly: false,
        fills,
        events,
        buckets: 0,
        complete: false,
        failureCached: false,
        skippedReason: error.message,
        fromMs,
        toMs,
      };
    }
    const addressEvents = addressFills
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
    fills += addressFills.length;
    events += addressEvents.length;
    params.log?.(
      `Hyperliquid whales ${index + 1}/${whales.addresses.length}: fills=${fills}, events=${events}`,
    );
  }

  const buckets = await rebuildHyperliquidWhaleFlowRows({
    fromMs,
    toMs,
    ...identity,
  });
  await upsertHyperliquidWhaleBackfillCoverage({
    fromMs,
    toMs,
    rowsCount: buckets,
    ...identity,
  });
  return {
    cached: false,
    cacheOnly: false,
    fills,
    events,
    buckets,
    complete: true,
    failureCached: false,
    fromMs,
    toMs,
  };
};
