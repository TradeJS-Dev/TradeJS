import chalk from 'chalk';
import ProgressBar from 'progress';
import { delay } from '@tradejs/core/async';
import { resolveDerivativesContextReferenceSymbols } from '@tradejs/core/constants';
import {
  coinalyzePointsToRows,
  mergeCoinalyzeMetrics,
  normalizeDerivativesIntervals,
} from '@tradejs/core/indicators';
import {
  getDerivativesBackfillCoverage,
  getDerivativesDataEdgesForSymbols,
  upsertDerivatives,
  upsertDerivativesBackfillCoverage,
  waitForDbReady,
} from '@tradejs/infra/timescale';
import { getUserSettings } from '@tradejs/infra/userSettings';
import type { DerivativesInterval } from '@tradejs/types';

type CoinalyzeMarket = {
  symbol: string;
  symbol_on_exchange?: string;
  exchange?: string;
  is_perpetual?: boolean;
  quote_asset?: string;
};

type SymbolMatch = {
  symbol: string;
  marketSymbol: string;
  exchange?: string;
};

type CoinalyzeMetric = 'oi' | 'funding' | 'liq';
type CoinalyzeSeriesPoint = Record<string, unknown>;
type CoinalyzeSeriesItem = {
  symbol?: string;
  history?: CoinalyzeSeriesPoint[];
};

type BackfillResult = {
  skipped: boolean;
  rows: number;
  matchedSymbols: number;
  unmatchedSymbols: number;
  failedWindows: number;
  skippedWindows: number;
};

type DerivativesContextBackfillMode = 'backtest' | 'signals';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DEFAULT_LOOKBACK_HOURS = 48;
const DEFAULT_INTERVALS: DerivativesInterval[] = ['15m', '1h'];

const coinalyzeIntervalMap: Record<DerivativesInterval, string> = {
  '15m': '15min',
  '1h': '1hour',
};

const derivativesIntervalMs = (interval: DerivativesInterval) =>
  interval === '1h' ? HOUR_MS : 15 * 60 * 1000;

let lastRequestTs = 0;

const asInt = (value: unknown, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseList = (value: unknown) =>
  String(value ?? '')
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);

const parseBooleanFlag = (value: unknown, fallback = false) => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const normalizeSymbols = (symbols: unknown[]) => [
  ...new Set(
    symbols
      .map((symbol) =>
        String(symbol || '')
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean),
  ),
];

export const isDerivativesTargetContextEnabled = () =>
  parseBooleanFlag(process.env.DERIVATIVES_CONTEXT_TARGET_ENABLED, false);

export const resolveDerivativesContextBackfillSymbols = (
  requestedSymbols: string[] = [],
) => {
  const referenceSymbols = resolveDerivativesContextReferenceSymbols(
    process.env.DERIVATIVES_CONTEXT_EXTRA_REFERENCE_SYMBOLS,
  );

  return isDerivativesTargetContextEnabled()
    ? normalizeSymbols([...referenceSymbols, ...requestedSymbols])
    : referenceSymbols;
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

export const isBacktestDerivativesContextEnabled = () => {
  return isDerivativesContextBackfillEnabled('BACKTEST');
};

export const isSignalsDerivativesContextEnabled = () =>
  isDerivativesContextBackfillEnabled('CRON');

const isDerivativesContextBackfillEnabled = (env: string) => {
  const normalized = String(process.env.DERIVATIVES_CONTEXT_ENABLED ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return true;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (normalized === 'backtest') {
    return env === 'BACKTEST';
  }
  if (normalized === 'live') {
    return env !== 'BACKTEST';
  }
  return false;
};

export const shouldBackfillDerivativesContextForBacktest = (params: {
  aiEnabled: boolean;
  cacheOnly: boolean;
  mlEnabled: boolean;
}) =>
  !params.cacheOnly &&
  (params.aiEnabled || params.mlEnabled) &&
  isBacktestDerivativesContextEnabled();

export const shouldBackfillDerivativesContextForSignals = (params: {
  cacheOnly: boolean;
}) => !params.cacheOnly && isSignalsDerivativesContextEnabled();

export const resolveDerivativesContextIntervals = (): DerivativesInterval[] => {
  const intervals = normalizeDerivativesIntervals(
    process.env.DERIVATIVES_CONTEXT_INTERVALS,
  ) as DerivativesInterval[];
  return intervals.length ? intervals : DEFAULT_INTERVALS;
};

export const resolveDerivativesContextLookbackMs = () => {
  const hours = Number(process.env.DERIVATIVES_CONTEXT_LOOKBACK_HOURS);
  const normalizedHours =
    Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_LOOKBACK_HOURS;
  return normalizedHours * HOUR_MS;
};

export const resolveDerivativesContextBackfillWindow = (params: {
  mode?: DerivativesContextBackfillMode;
  startMs: number;
  endMs: number;
  preloadStartMs?: number;
  nowMs?: number;
}) => {
  const {
    mode = 'signals',
    startMs,
    endMs,
    preloadStartMs,
    nowMs = Date.now(),
  } = params;
  const safeEndMs = Math.min(endMs, nowMs);
  const safeStartMs = Math.max(0, Math.min(startMs, safeEndMs));
  const lookbackFromMs = safeStartMs - resolveDerivativesContextLookbackMs();
  const defaultFromMs = mode === 'backtest' ? safeStartMs : lookbackFromMs;
  const requestedFromMs =
    mode === 'signals' ? defaultFromMs : preloadStartMs ?? defaultFromMs;
  const fromMs = Math.max(
    0,
    Math.min(
      Number.isFinite(requestedFromMs) ? requestedFromMs : safeStartMs,
      safeStartMs,
    ),
  );

  return {
    fromMs: Math.trunc(fromMs),
    toMs: Math.trunc(safeEndMs),
    testStartMs: Math.trunc(safeStartMs),
  };
};

export const resolveDerivativesContextIntervalBackfillWindow = (params: {
  fromMs: number;
  toMs: number;
  interval: DerivativesInterval;
}) => {
  const intervalMs = derivativesIntervalMs(params.interval);
  return {
    fromMs: Math.floor(params.fromMs / intervalMs) * intervalMs,
    toMs: Math.floor(params.toMs / intervalMs) * intervalMs,
    intervalMs,
  };
};

export const resolveDerivativesContextMissingFetchFromMs = (params: {
  edges?: { min?: number; max?: number };
  fromMs: number;
  toMs: number;
  intervalMs: number;
}) => {
  const min = params.edges?.min;
  const max = params.edges?.max;
  if (min == null || max == null) {
    return params.fromMs;
  }
  if (min > params.fromMs) {
    return params.fromMs;
  }
  if (max < params.toMs) {
    return Math.max(params.fromMs, max + params.intervalMs);
  }
  return null;
};

const countBackfillWindows = (params: {
  fromMs: number;
  toMs: number;
  batchMs: number;
  intervalMs: number;
}) => {
  let count = 0;
  let cursor = params.fromMs;
  while (cursor < params.toMs) {
    const toMs = Math.min(params.toMs, cursor + params.batchMs);
    count += 1;
    cursor = toMs + params.intervalMs;
  }
  return count;
};

const buildBackfillWindows = (params: {
  fromMs: number;
  toMs: number;
  batchMs: number;
  intervalMs: number;
}) => {
  const windows: Array<{ fromMs: number; toMs: number }> = [];
  let cursor = params.fromMs;
  while (cursor < params.toMs) {
    const toMs = Math.min(params.toMs, cursor + params.batchMs);
    windows.push({ fromMs: cursor, toMs });
    cursor = toMs + params.intervalMs;
  }
  return windows;
};

const hasDerivativesWindowCoverage = (params: {
  edges?: { min?: number; max?: number };
  fromMs: number;
  toMs: number;
}) =>
  params.edges?.min != null &&
  params.edges?.max != null &&
  params.edges.min <= params.fromMs &&
  params.edges.max >= params.toMs;

export const hasDerivativesContextCoverageRange = (
  ranges: Array<{ fromMs: number; toMs: number }> | undefined,
  fromMs: number,
  toMs: number,
) =>
  (ranges ?? []).some(
    (range) =>
      Number.isFinite(range.fromMs) &&
      Number.isFinite(range.toMs) &&
      range.fromMs <= fromMs &&
      range.toMs >= toMs,
  );

export const resolveDerivativesContextMissingCoverageFetchFromMs = (params: {
  ranges: Array<{ fromMs: number; toMs: number }> | undefined;
  fromMs: number;
  toMs: number;
  intervalMs: number;
}) => {
  const ranges = (params.ranges ?? [])
    .filter(
      (range) => Number.isFinite(range.fromMs) && Number.isFinite(range.toMs),
    )
    .sort((a, b) => a.fromMs - b.fromMs);
  let coveredUntil: number | undefined;

  for (const range of ranges) {
    if (range.toMs < params.fromMs) {
      continue;
    }
    if (coveredUntil == null) {
      if (range.fromMs > params.fromMs) {
        return params.fromMs;
      }
      coveredUntil = range.toMs;
      if (coveredUntil >= params.toMs) {
        return null;
      }
      continue;
    }

    if (range.fromMs > coveredUntil + params.intervalMs) {
      break;
    }
    coveredUntil = Math.max(coveredUntil, range.toMs);
    if (coveredUntil >= params.toMs) {
      return null;
    }
  }

  if (coveredUntil == null) {
    return params.fromMs;
  }
  return Math.max(params.fromMs, coveredUntil + params.intervalMs);
};

export const groupDerivativesContextMissingFetchRanges = <T>(
  ranges: Array<{ item: T; fromMs: number }>,
) => {
  const groups = new Map<number, T[]>();
  for (const range of ranges) {
    const fromMs = Math.trunc(range.fromMs);
    const items = groups.get(fromMs) ?? [];
    items.push(range.item);
    groups.set(fromMs, items);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([fromMs, items]) => ({ fromMs, items }));
};

const coverageKey = (params: {
  symbol: string;
  interval: DerivativesInterval;
  fromMs: number;
  toMs: number;
}) =>
  [
    params.symbol.trim().toUpperCase(),
    params.interval,
    Math.trunc(params.fromMs),
    Math.trunc(params.toMs),
  ].join(':');

const extendEdges = (
  current: { min?: number; max?: number } | undefined,
  fromMs: number,
  toMs: number,
) => ({
  min:
    current?.min == null ? fromMs : Math.min(current.min, Math.trunc(fromMs)),
  max: current?.max == null ? toMs : Math.max(current.max, Math.trunc(toMs)),
});

const getCoinalyzeApiKey = async (userName: string) => {
  const settings = await getUserSettings(userName);
  return (
    settings.COINALYZE_API_KEY.trim() ||
    String(process.env.COINALYZE_API_KEY ?? '').trim()
  );
};

const getCoinalyzeBaseUrl = () =>
  process.env.COINALYZE_BASE_URL?.trim() || 'https://api.coinalyze.net/v1';

const getRequestDelayMs = () =>
  Math.max(
    100,
    asInt(
      process.env.DERIVATIVES_CONTEXT_BACKFILL_REQUEST_DELAY_MS ??
        process.env.COINALYZE_MIN_REQUEST_DELAY_MS,
      200,
    ),
  );

const getRequestTimeoutMs = () =>
  Math.max(5_000, asInt(process.env.COINALYZE_REQUEST_TIMEOUT_MS, 45_000));

const networkErrorCodes = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
]);

const getNestedErrorValue = (
  error: unknown,
  key: 'code' | 'name' | 'message',
): string | null => {
  let current = error;
  const seen = new Set<unknown>();

  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const record = current as Record<string, unknown>;
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    current = record.cause;
  }

  return null;
};

const getCoinalyzeErrorCause = (error: unknown) => {
  const code = getNestedErrorValue(error, 'code');
  const message =
    getNestedErrorValue(error, 'message') ?? String(error || 'unknown error');

  return code ? `${code}: ${message}` : message;
};

const isRetryableCoinalyzeFetchError = (error: unknown) => {
  const name = getNestedErrorValue(error, 'name');
  const code = getNestedErrorValue(error, 'code');
  const message = getNestedErrorValue(error, 'message')?.toLowerCase() ?? '';

  return (
    name === 'AbortError' ||
    (code != null && networkErrorCodes.has(code)) ||
    message.includes('aborted') ||
    message.includes('fetch failed')
  );
};

export const formatCoinalyzeRequestError = ({
  url,
  error,
  attempts,
  timeoutMs,
}: {
  url: string;
  error: unknown;
  attempts: number;
  timeoutMs: number;
}) => {
  const endpoint = (() => {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return url;
    }
  })();

  return [
    `Coinalyze request failed: ${endpoint}`,
    `cause=${getCoinalyzeErrorCause(error)}`,
    `attempts=${attempts}`,
    `timeout=${timeoutMs}ms`,
    'Set COINALYZE_REQUEST_TIMEOUT_MS/COINALYZE_MAX_RETRIES to retry longer, or DERIVATIVES_CONTEXT_ENABLED=live to skip derivatives backfill during backtests.',
  ].join('; ');
};

const fetchJsonWithRateLimit = async (url: string, apiKey: string) => {
  const requestDelayMs = getRequestDelayMs();
  const requestTimeoutMs = getRequestTimeoutMs();
  const maxRetries = asInt(process.env.COINALYZE_MAX_RETRIES, 4);
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const waitMs = Math.max(0, lastRequestTs + requestDelayMs - Date.now());
    if (waitMs > 0) {
      await delay(waitMs);
    }

    lastRequestTs = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          api_key: apiKey,
          'x-api-key': apiKey,
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < maxRetries && isRetryableCoinalyzeFetchError(error)) {
        await delay(Math.min(12_000, 800 * 2 ** attempt));
        continue;
      }
      throw new Error(
        formatCoinalyzeRequestError({
          url,
          error,
          attempts: attempt + 1,
          timeoutMs: requestTimeoutMs,
        }),
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) {
      return response.json();
    }

    const text = await response.text();
    const retryAfterRaw = Number(response.headers.get('retry-after') ?? '');
    const retryAfterMs =
      Number.isFinite(retryAfterRaw) && retryAfterRaw > 0
        ? retryAfterRaw * 1000
        : null;
    const transient = response.status === 429 || response.status >= 500;
    if (attempt < maxRetries && transient) {
      await delay(retryAfterMs ?? Math.min(12_000, 800 * 2 ** attempt));
      continue;
    }

    throw new Error(`Coinalyze ${response.status}: ${text}`);
  }

  throw new Error(
    formatCoinalyzeRequestError({
      url,
      error: lastError,
      attempts: maxRetries + 1,
      timeoutMs: requestTimeoutMs,
    }),
  );
};

const fetchCoinalyzeMarkets = async (
  apiKey: string,
): Promise<CoinalyzeMarket[]> => {
  const raw = await fetchJsonWithRateLimit(
    `${getCoinalyzeBaseUrl()}/future-markets`,
    apiKey,
  );
  return Array.isArray(raw) ? (raw as CoinalyzeMarket[]) : [];
};

const selectBestMarket = (
  candidates: CoinalyzeMarket[],
  exchangePriority: string[],
) => {
  const scored = candidates.map((item) => {
    let score = 0;
    if (item.is_perpetual) score += 50;
    if (String(item.quote_asset || '').toUpperCase() === 'USDT') score += 25;
    if (item.symbol.includes('_PERP')) score += 10;

    const exchange = String(item.exchange || '').toUpperCase();
    const idx = exchangePriority.indexOf(exchange);
    if (idx >= 0) {
      score += (exchangePriority.length - idx) * 10;
    }

    return { item, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.item.symbol.localeCompare(b.item.symbol);
  });

  return scored[0]?.item ?? null;
};

const buildMatches = (
  tickers: string[],
  markets: CoinalyzeMarket[],
  exchangePriority: string[],
) => {
  const marketByTicker = new Map<string, CoinalyzeMarket[]>();
  for (const market of markets) {
    const key = String(market.symbol_on_exchange || '')
      .trim()
      .toUpperCase();
    if (!key) continue;
    const list = marketByTicker.get(key) ?? [];
    list.push(market);
    marketByTicker.set(key, list);
  }

  const matches: SymbolMatch[] = [];
  const unmatched: string[] = [];
  for (const ticker of tickers) {
    const candidates = marketByTicker.get(ticker) ?? [];
    const selected = selectBestMarket(candidates, exchangePriority);
    if (!selected) {
      unmatched.push(ticker);
      continue;
    }
    matches.push({
      symbol: ticker,
      marketSymbol: selected.symbol,
      exchange: selected.exchange,
    });
  }

  return { matches, unmatched };
};

const normalizeMetricPoint = (
  metric: CoinalyzeMetric,
  point: CoinalyzeSeriesPoint,
): CoinalyzeSeriesPoint => {
  if (metric === 'oi') {
    return {
      ...point,
      open_interest:
        point.open_interest ?? point.openInterest ?? point.oi ?? point.c,
    };
  }

  if (metric === 'funding') {
    return {
      ...point,
      funding_rate:
        point.funding_rate ?? point.fundingRate ?? point.rate ?? point.c,
    };
  }

  return {
    ...point,
    liq_long: point.liq_long ?? point.long_liq ?? point.long ?? point.l,
    liq_short: point.liq_short ?? point.short_liq ?? point.short ?? point.s,
  };
};

const toSeriesMap = (
  raw: unknown,
  metric: CoinalyzeMetric,
): Map<string, CoinalyzeSeriesPoint[]> => {
  const out = new Map<string, CoinalyzeSeriesPoint[]>();
  if (!Array.isArray(raw)) return out;

  for (const item of raw as CoinalyzeSeriesItem[]) {
    const symbol = String(item.symbol || '')
      .trim()
      .toUpperCase();
    const history = Array.isArray(item.history) ? item.history : [];
    if (!symbol) continue;
    out.set(
      symbol,
      history
        .filter((point) => point && typeof point === 'object')
        .map((point) => normalizeMetricPoint(metric, point)),
    );
  }

  return out;
};

const fetchMetricBatch = async (params: {
  endpoint: string;
  metric: CoinalyzeMetric;
  marketSymbols: string[];
  apiKey: string;
  interval: DerivativesInterval;
  fromMs: number;
  toMs: number;
}) => {
  const { endpoint, metric, marketSymbols, apiKey, interval, fromMs, toMs } =
    params;

  const url = new URL(`${getCoinalyzeBaseUrl()}${endpoint}`);
  url.searchParams.set('symbols', marketSymbols.join(','));
  url.searchParams.set('interval', coinalyzeIntervalMap[interval] || interval);
  url.searchParams.set('from', String(Math.floor(fromMs / 1000)));
  url.searchParams.set('to', String(Math.floor(toMs / 1000)));

  const raw = await fetchJsonWithRateLimit(url.toString(), apiKey);
  return toSeriesMap(raw, metric);
};

const skippedBackfillResult = (): BackfillResult => ({
  skipped: true,
  rows: 0,
  matchedSymbols: 0,
  unmatchedSymbols: 0,
  failedWindows: 0,
  skippedWindows: 0,
});

const backfillDerivativesContext = async (
  params: {
    userName: string;
    symbols: string[];
    startMs: number;
    endMs: number;
    preloadStartMs?: number;
  },
  enabled: boolean,
  mode: DerivativesContextBackfillMode,
): Promise<BackfillResult> => {
  const { userName, startMs, endMs } = params;
  const requestedSymbols = normalizeSymbols(params.symbols);
  const symbols = resolveDerivativesContextBackfillSymbols(requestedSymbols);

  if (!enabled || !requestedSymbols.length || !symbols.length) {
    return skippedBackfillResult();
  }

  const intervals = resolveDerivativesContextIntervals();
  if (!intervals.length) {
    return skippedBackfillResult();
  }

  const {
    fromMs,
    toMs: safeEndMs,
    testStartMs: safeStartMs,
  } = resolveDerivativesContextBackfillWindow({
    mode,
    startMs,
    endMs,
    preloadStartMs: params.preloadStartMs,
  });
  if (safeEndMs <= fromMs) {
    return skippedBackfillResult();
  }

  const batchDays = asInt(
    process.env.DERIVATIVES_CONTEXT_BACKFILL_BATCH_DAYS,
    30,
  );
  const batchMs = batchDays * DAY_MS;
  const intervalWindows = intervals
    .map((interval) => ({
      interval,
      ...resolveDerivativesContextIntervalBackfillWindow({
        fromMs,
        toMs: safeEndMs,
        interval,
      }),
    }))
    .filter((item) => item.toMs > item.fromMs);
  if (!intervalWindows.length) {
    return skippedBackfillResult();
  }

  await waitForDbReady();

  const edgesByInterval = new Map<
    DerivativesInterval,
    Awaited<ReturnType<typeof getDerivativesDataEdgesForSymbols>>
  >();
  await Promise.all(
    intervalWindows.map(async ({ interval }) => {
      edgesByInterval.set(
        interval,
        await getDerivativesDataEdgesForSymbols(symbols, interval),
      );
    }),
  );
  const coverageKeysByInterval = new Map<DerivativesInterval, Set<string>>();
  const coverageRangesByInterval = new Map<
    DerivativesInterval,
    Map<string, Array<{ fromMs: number; toMs: number }>>
  >();
  await Promise.all(
    intervalWindows.map(async (window) => {
      const coverageRows = await getDerivativesBackfillCoverage({
        source: 'coinalyze',
        symbols,
        interval: window.interval,
        fromMs: window.fromMs,
        toMs: window.toMs,
      });
      coverageKeysByInterval.set(
        window.interval,
        new Set(
          coverageRows.map((row) =>
            coverageKey({
              symbol: row.symbol,
              interval: row.interval,
              fromMs: row.fromMs,
              toMs: row.toMs,
            }),
          ),
        ),
      );
      const rangesBySymbol = new Map<
        string,
        Array<{ fromMs: number; toMs: number }>
      >();
      for (const row of coverageRows) {
        const symbol = row.symbol.toUpperCase();
        const ranges = rangesBySymbol.get(symbol) ?? [];
        ranges.push({ fromMs: row.fromMs, toMs: row.toMs });
        rangesBySymbol.set(symbol, ranges);
      }
      coverageRangesByInterval.set(window.interval, rangesBySymbol);
    }),
  );

  const cachedWindows = intervalWindows.reduce(
    (sum, window) =>
      sum +
      countBackfillWindows({
        fromMs: window.fromMs,
        toMs: window.toMs,
        batchMs,
        intervalMs: window.intervalMs,
      }),
    0,
  );
  const allBackfillWindowsCached = intervalWindows.every((window) => {
    const edgesBySymbol = edgesByInterval.get(window.interval);
    const coverageKeys = coverageKeysByInterval.get(window.interval);
    const backfillWindows = buildBackfillWindows({
      fromMs: window.fromMs,
      toMs: window.toMs,
      batchMs,
      intervalMs: window.intervalMs,
    });
    return symbols.every((symbol) =>
      backfillWindows.every((backfillWindow) => {
        const normalizedSymbol = symbol.toUpperCase();
        const coverageRanges =
          coverageRangesByInterval
            .get(window.interval)
            ?.get(normalizedSymbol) ?? [];
        return (
          hasDerivativesWindowCoverage({
            edges: edgesBySymbol?.get(normalizedSymbol),
            fromMs: backfillWindow.fromMs,
            toMs: backfillWindow.toMs,
          }) ||
          resolveDerivativesContextMissingCoverageFetchFromMs({
            ranges: coverageRanges,
            fromMs: backfillWindow.fromMs,
            toMs: backfillWindow.toMs,
            intervalMs: window.intervalMs,
          }) == null ||
          coverageKeys?.has(
            coverageKey({
              symbol: normalizedSymbol,
              interval: window.interval,
              fromMs: backfillWindow.fromMs,
              toMs: backfillWindow.toMs,
            }),
          )
        );
      }),
    );
  });

  if (allBackfillWindowsCached) {
    console.log(
      chalk.gray(
        `derivatives context backfill: cached symbols=${symbols.length}, requestedSymbols=${requestedSymbols.length}, intervals=${intervals.join(',')}, window=${new Date(fromMs).toISOString()}..${new Date(safeEndMs).toISOString()}`,
      ),
    );

    return {
      skipped: false,
      rows: 0,
      matchedSymbols: symbols.length,
      unmatchedSymbols: 0,
      failedWindows: 0,
      skippedWindows: cachedWindows,
    };
  }

  const apiKey = await getCoinalyzeApiKey(userName);
  if (!apiKey) {
    throw new Error(
      `Missing COINALYZE_API_KEY for derivatives context backfill (user=${userName})`,
    );
  }

  const exchangePriority = parseList(
    process.env.COINALYZE_EXCHANGE_PRIORITY ||
      process.env.DERIVATIVES_CONTEXT_EXCHANGE_PRIORITY ||
      'A,6,0',
  );
  const markets = await fetchCoinalyzeMarkets(apiKey);
  if (!markets.length) {
    throw new Error('No markets returned by Coinalyze /future-markets');
  }

  const { matches, unmatched } = buildMatches(
    symbols,
    markets,
    exchangePriority,
  );
  if (!matches.length) {
    throw new Error(
      'No matched derivatives context symbols between requested symbols and Coinalyze',
    );
  }

  const symbolBatchSize = asInt(
    process.env.DERIVATIVES_CONTEXT_BACKFILL_SYMBOL_BATCH_SIZE,
    8,
  );
  const symbolBatches = chunkArray(matches, symbolBatchSize);
  const windowsPerPair = intervalWindows.reduce(
    (sum, window) =>
      sum +
      countBackfillWindows({
        fromMs: window.fromMs,
        toMs: window.toMs,
        batchMs,
        intervalMs: window.intervalMs,
      }),
    0,
  );
  const totalWindows = symbolBatches.length * windowsPerPair;
  const bar = new ProgressBar(
    ':current/:total [:bar][:percent] :eta(s) :batch rows=:rows fail=:fail skip=:skip',
    {
      total: Math.max(1, totalWindows),
      width: 24,
    },
  );

  const oiPath =
    process.env.COINALYZE_OI_PATH?.trim() || '/open-interest-history';
  const fundingPath =
    process.env.COINALYZE_FUNDING_PATH?.trim() || '/funding-rate-history';
  const liqPath =
    process.env.COINALYZE_LIQ_PATH?.trim() || '/liquidation-history';

  let totalRows = 0;
  let failedWindows = 0;
  let skippedWindows = 0;

  console.log(
    chalk.cyan(
      `derivatives context backfill: symbols=${matches.length}, requestedSymbols=${requestedSymbols.length}, unmatched=${unmatched.length}, intervals=${intervals.join(',')}, window=${new Date(fromMs).toISOString()}..${new Date(safeEndMs).toISOString()}, testStart=${new Date(safeStartMs).toISOString()}`,
    ),
  );

  for (const window of intervalWindows) {
    const { interval, intervalMs } = window;
    const edgesBySymbol =
      edgesByInterval.get(interval) ??
      (await getDerivativesDataEdgesForSymbols(
        matches.map((item) => item.symbol),
        interval,
      ));
    const coverageKeys =
      coverageKeysByInterval.get(interval) ?? new Set<string>();
    coverageKeysByInterval.set(interval, coverageKeys);
    const coverageRangesBySymbol =
      coverageRangesByInterval.get(interval) ??
      new Map<string, Array<{ fromMs: number; toMs: number }>>();
    coverageRangesByInterval.set(interval, coverageRangesBySymbol);

    for (let batchIdx = 0; batchIdx < symbolBatches.length; batchIdx += 1) {
      const batch = symbolBatches[batchIdx];
      let cursor = window.fromMs;

      while (cursor < window.toMs) {
        const toMs = Math.min(window.toMs, cursor + batchMs);
        const missingRanges = batch
          .map((item) => {
            const key = coverageKey({
              symbol: item.symbol,
              interval,
              fromMs: cursor,
              toMs,
            });
            if (coverageKeys.has(key)) {
              return null;
            }

            const normalizedSymbol = item.symbol.toUpperCase();
            const coverageFromMs =
              resolveDerivativesContextMissingCoverageFetchFromMs({
                ranges: coverageRangesBySymbol.get(normalizedSymbol),
                fromMs: cursor,
                toMs,
                intervalMs,
              });
            if (coverageFromMs == null) {
              return null;
            }

            const edges = edgesBySymbol.get(normalizedSymbol);
            const edgesFromMs = resolveDerivativesContextMissingFetchFromMs({
              edges,
              fromMs: cursor,
              toMs,
              intervalMs,
            });
            if (edgesFromMs == null) {
              return null;
            }

            return { item, fromMs: Math.max(coverageFromMs, edgesFromMs) };
          })
          .filter(
            (item): item is { item: SymbolMatch; fromMs: number } =>
              item != null,
          );

        try {
          if (!missingRanges.length) {
            skippedWindows += 1;
          } else {
            const groupedMissingRanges =
              groupDerivativesContextMissingFetchRanges(missingRanges);
            for (const group of groupedMissingRanges) {
              const missingBatch = group.items;
              const marketSymbols = missingBatch.map(
                (item) => item.marketSymbol,
              );
              const oiMap = await fetchMetricBatch({
                endpoint: oiPath,
                metric: 'oi',
                marketSymbols,
                apiKey,
                interval,
                fromMs: group.fromMs,
                toMs,
              });
              const fundingMap = await fetchMetricBatch({
                endpoint: fundingPath,
                metric: 'funding',
                marketSymbols,
                apiKey,
                interval,
                fromMs: group.fromMs,
                toMs,
              });
              const liqMap = await fetchMetricBatch({
                endpoint: liqPath,
                metric: 'liq',
                marketSymbols,
                apiKey,
                interval,
                fromMs: group.fromMs,
                toMs,
              });

              const rows = missingBatch.flatMap((item) => {
                const marketSymbol = item.marketSymbol.toUpperCase();
                const points = mergeCoinalyzeMetrics({
                  symbol: item.symbol,
                  oiRaw: oiMap.get(marketSymbol) ?? [],
                  fundingRaw: fundingMap.get(marketSymbol) ?? [],
                  liqRaw: liqMap.get(marketSymbol) ?? [],
                });
                return coinalyzePointsToRows(points, interval, 'coinalyze');
              });

              if (rows.length) {
                await upsertDerivatives(rows);
                totalRows += rows.length;
              }
              const rowsCountBySymbol = new Map<string, number>();
              for (const row of rows) {
                const symbol = row.symbol.toUpperCase();
                rowsCountBySymbol.set(
                  symbol,
                  (rowsCountBySymbol.get(symbol) ?? 0) + 1,
                );
              }
              const coverageRows = missingBatch.map((item) => {
                const normalizedSymbol = item.symbol.toUpperCase();
                const rowsCount = rowsCountBySymbol.get(normalizedSymbol) ?? 0;
                return {
                  source: 'coinalyze' as const,
                  symbol: item.symbol,
                  interval,
                  fromMs: cursor,
                  toMs,
                  rowsCount,
                };
              });
              await upsertDerivativesBackfillCoverage(coverageRows);
              for (const coverageRow of coverageRows) {
                const symbol = coverageRow.symbol.toUpperCase();
                edgesBySymbol.set(
                  symbol,
                  extendEdges(edgesBySymbol.get(symbol), cursor, toMs),
                );
                coverageKeys.add(
                  coverageKey({
                    symbol,
                    interval,
                    fromMs: cursor,
                    toMs,
                  }),
                );
                const coverageRanges = coverageRangesBySymbol.get(symbol) ?? [];
                coverageRanges.push({ fromMs: cursor, toMs });
                coverageRangesBySymbol.set(symbol, coverageRanges);
              }
            }
          }
        } catch (error) {
          failedWindows += 1;
          console.error(
            chalk.red(
              `derivatives context backfill window failed batch=${batchIdx + 1}/${symbolBatches.length} interval=${interval} ${new Date(cursor).toISOString()}..${new Date(toMs).toISOString()}: ${error}`,
            ),
          );
        } finally {
          bar.tick(1, {
            batch: chalk.gray(
              `${batchIdx + 1}/${symbolBatches.length} ${interval}`,
            ),
            rows: totalRows,
            fail: failedWindows,
            skip: skippedWindows,
          });
        }

        cursor = toMs + intervalMs;
      }
    }
  }

  console.log('');
  console.log(
    chalk.green(
      `derivatives context backfill done: rows=${totalRows}, failed_windows=${failedWindows}, skipped_windows=${skippedWindows}`,
    ),
  );

  if (failedWindows > 0) {
    throw new Error(
      `Derivatives context backfill failed for ${failedWindows} window(s)`,
    );
  }

  return {
    skipped: false,
    rows: totalRows,
    matchedSymbols: matches.length,
    unmatchedSymbols: unmatched.length,
    failedWindows,
    skippedWindows,
  };
};

export const backfillDerivativesContextForBacktest = async (params: {
  userName: string;
  symbols: string[];
  startMs: number;
  endMs: number;
  preloadStartMs?: number;
}): Promise<BackfillResult> =>
  backfillDerivativesContext(
    params,
    isBacktestDerivativesContextEnabled(),
    'backtest',
  );

export const backfillDerivativesContextForSignals = async (params: {
  userName: string;
  symbols: string[];
  startMs: number;
  endMs: number;
  preloadStartMs?: number;
}): Promise<BackfillResult> =>
  backfillDerivativesContext(
    params,
    isSignalsDerivativesContextEnabled(),
    'signals',
  );
