import chalk from 'chalk';
import { delay } from '@tradejs/core/async';
import {
  getMarketCmcExchangeLiquidityContextCoverage,
  getMarketCmcFearGreedContextCoverage,
  getMarketCmcIndexContextCoverage,
  getMarketContextBackfillCoverage,
  getMarketGlobalContextCoverage,
  getMarketReferenceAssetContextCoverage,
  upsertMarketCmcExchangeLiquidityContextRows,
  upsertMarketCmcFearGreedContextRows,
  upsertMarketCmcIndexContextRows,
  upsertMarketContextBackfillCoverage,
  upsertMarketGlobalContextRows,
  upsertMarketReferenceAssetContextRows,
  waitForDbReady,
} from '@tradejs/infra/timescale';
import { getUserSettings } from '@tradejs/infra/userSettings';
import type {
  CmcExchangeLiquidityRegime,
  CmcFearGreedClassification,
  CmcFearGreedRegime,
  MarketCmcExchangeLiquidityContextRow,
  MarketCmcFearGreedContextRow,
  MarketCmcIndexContextRow,
  MarketCmcIndexSlug,
  MarketGlobalContextRow,
  MarketReferenceAssetContextRow,
} from '@tradejs/types';

type BackfillParams = {
  userName: string;
  startMs: number;
  endMs: number;
  preloadStartMs?: number;
  refreshStaleFearGreed?: boolean;
};

type BackfillResult = {
  skipped: boolean;
  globalRows: number;
  referenceRows: number;
  breadthRows: number;
  exchangeLiquidityRows: number;
  fearGreedRows: number;
  indexRows: number;
  cached: boolean;
};

const DAY_MS = 86_400_000;
const DEFAULT_CONTEXT_MAX_AGE_MS = 48 * 60 * 60_000;
const DEFAULT_FEAR_GREED_STALE_RETRY_MS = 60 * 60_000;
const SOURCE_GLOBAL_DAILY = 'coinmarketcap_global' as const;
const SOURCE_REFERENCE = 'coinmarketcap_reference_asset' as const;
const SOURCE_EXCHANGE_LIQUIDITY = 'coinmarketcap_exchange_liquidity' as const;
const SOURCE_FEAR_GREED = 'coinmarketcap_fear_greed' as const;
const SOURCE_INDEX = 'coinmarketcap_index' as const;
const COVERAGE_SCOPE_ALL = 'all';
const REFERENCE_ASSETS = [
  { symbol: 'BTCUSDT', cmcId: 1 },
  { symbol: 'ETHUSDT', cmcId: 1027 },
] as const;
const CMC_INDEXES = [
  { slug: 'cmc100', path: '/v3/index/cmc100-historical' },
  { slug: 'cmc20', path: '/v3/index/cmc20-historical' },
] as const satisfies Array<{ slug: MarketCmcIndexSlug; path: string }>;
const DEFAULT_EXCHANGE_SLUGS = [
  'binance',
  'coinbase-exchange',
  'okx',
  'bybit',
  'kraken',
] as const;
let lastRequestTs = 0;

const asInt = (value: unknown, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseEnabledFlag = (value: unknown, defaultValue: boolean) => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return defaultValue;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
};

const getBaseUrl = () =>
  process.env.COINMARKETCAP_BASE_URL?.trim() ||
  'https://pro-api.coinmarketcap.com';

const getRequestDelayMs = () =>
  asInt(process.env.COINMARKETCAP_MIN_REQUEST_DELAY_MS, 2_100);

const getMaxRetries = () => asInt(process.env.COINMARKETCAP_MAX_RETRIES, 4);

const getMaxBackfillDays = () =>
  asInt(process.env.COINMARKETCAP_CONTEXT_BACKFILL_MAX_DAYS, 1098);

const getHistoricalAccessMonths = () =>
  asInt(process.env.COINMARKETCAP_CONTEXT_HISTORICAL_ACCESS_MONTHS, 36);

const isExchangeLiquidityBackfillEnabled = () =>
  parseEnabledFlag(
    process.env.COINMARKETCAP_CONTEXT_EXCHANGE_LIQUIDITY_ENABLED,
    true,
  );

const isFearGreedBackfillEnabled = () =>
  parseEnabledFlag(process.env.COINMARKETCAP_CONTEXT_FEAR_GREED_ENABLED, true);

const isVerboseRequestLoggingEnabled = () =>
  parseEnabledFlag(process.env.COINMARKETCAP_CONTEXT_VERBOSE_REQUESTS, false);

const getFearGreedPageSize = () =>
  asInt(process.env.COINMARKETCAP_CONTEXT_FEAR_GREED_PAGE_SIZE, 500);

const getContextMaxAgeMs = () =>
  asInt(
    process.env.COINMARKETCAP_CONTEXT_MAX_AGE_MS,
    DEFAULT_CONTEXT_MAX_AGE_MS,
  );

const getFearGreedStaleRetryMs = () =>
  asInt(
    process.env.COINMARKETCAP_CONTEXT_FEAR_GREED_STALE_RETRY_MS,
    DEFAULT_FEAR_GREED_STALE_RETRY_MS,
  );

const getExchangeSlugs = () => {
  const raw = process.env.COINMARKETCAP_CONTEXT_EXCHANGE_SLUGS;
  const values = String(raw ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return values.length ? [...new Set(values)] : [...DEFAULT_EXCHANGE_SLUGS];
};

const toFiniteNumberOrNull = (value: unknown): number | null => {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(numeric) ? numeric : null;
};

const toIntOrNull = (value: unknown): number | null => {
  const numeric = toFiniteNumberOrNull(value);
  return numeric == null ? null : Math.trunc(numeric);
};

const getRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const getNestedRecord = (
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> => getRecord(value[key]);

const safeDivide = (numerator: number | null, denominator: number | null) =>
  numerator != null && denominator != null && denominator > 0
    ? numerator / denominator
    : null;

const sumFinite = (values: Array<number | null>) =>
  values.reduce<number>((sum, value) => sum + (value ?? 0), 0);

const toExchangeLiquidityRegime = ({
  binanceVolumeShare,
  topExchangeVolumeShare,
}: {
  binanceVolumeShare: number | null;
  topExchangeVolumeShare: number | null;
}): CmcExchangeLiquidityRegime => {
  if (binanceVolumeShare == null && topExchangeVolumeShare == null) {
    return 'unknown';
  }
  if ((binanceVolumeShare ?? 0) >= 0.55) return 'binance_led';
  if ((topExchangeVolumeShare ?? 0) >= 0.6) return 'concentrated';
  return 'balanced';
};

const normalizeFearGreedClassification = (
  value: unknown,
): CmcFearGreedClassification => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (normalized === 'extreme fear') return 'Extreme Fear';
  if (normalized === 'fear') return 'Fear';
  if (normalized === 'neutral') return 'Neutral';
  if (normalized === 'greed') return 'Greed';
  if (normalized === 'extreme greed') return 'Extreme Greed';
  return 'Unknown';
};

const toFearGreedRegime = ({
  value,
  classification,
}: {
  value: number | null;
  classification: CmcFearGreedClassification;
}): CmcFearGreedRegime => {
  if (value == null) return 'unknown';
  if (classification === 'Extreme Fear' || value <= 24) return 'capitulation';
  if (classification === 'Fear' || value <= 44) return 'risk_off';
  if (classification === 'Extreme Greed' || value >= 75) return 'euphoric';
  if (classification === 'Greed' || value >= 55) return 'risk_on';
  if (classification === 'Neutral' || (value >= 45 && value <= 54)) {
    return 'neutral';
  }
  return 'unknown';
};

const dayStartUtc = (ms: number) => {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

const toIsoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const subtractUtcMonths = (ms: number, months: number) => {
  const date = new Date(ms);
  const targetMonthIndex = date.getUTCMonth() - months;
  const targetMonthStart = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      targetMonthIndex,
      1,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
  const daysInTargetMonth = new Date(
    Date.UTC(
      targetMonthStart.getUTCFullYear(),
      targetMonthStart.getUTCMonth() + 1,
      0,
    ),
  ).getUTCDate();
  targetMonthStart.setUTCDate(Math.min(date.getUTCDate(), daysInTargetMonth));
  return targetMonthStart.getTime();
};

const nextUtcDayStart = (ms: number) => dayStartUtc(ms) + DAY_MS;

export const resolveCoinMarketCapBackfillWindow = (
  params: BackfillParams & { nowMs?: number },
) => {
  const warmupMs =
    asInt(process.env.COINMARKETCAP_CONTEXT_BACKFILL_WARMUP_DAYS, 35) * DAY_MS;
  const maxWindowMs = getMaxBackfillDays() * DAY_MS;
  const requestedStart = params.preloadStartMs ?? params.startMs - warmupMs;
  const cappedStart = Math.max(requestedStart, params.endMs - maxWindowMs);
  const accessFloorMs = nextUtcDayStart(
    subtractUtcMonths(params.nowMs ?? Date.now(), getHistoricalAccessMonths()),
  );
  return {
    fromMs: dayStartUtc(Math.max(cappedStart, accessFloorMs)),
    toMs: dayStartUtc(params.endMs),
  };
};

const hasIntervalCoverage = (
  coverage:
    | { firstMs: number; lastMs: number; rows: number }
    | null
    | undefined,
  fromMs: number,
  toMs: number,
  intervalMs: number,
) => {
  if (!coverage) return false;
  const expectedRows = Math.max(1, Math.floor((toMs - fromMs) / intervalMs));
  return (
    coverage.firstMs <= fromMs + intervalMs &&
    coverage.lastMs >= toMs - intervalMs &&
    coverage.rows >= Math.floor(expectedRows * 0.9)
  );
};

const hasDailyCoverage = (
  coverage:
    | { firstMs: number; lastMs: number; rows: number }
    | null
    | undefined,
  fromMs: number,
  toMs: number,
) => hasIntervalCoverage(coverage, fromMs, toMs, DAY_MS);

const coverageKey = (params: {
  source: string;
  scope: string;
  interval: string;
  fromMs: number;
  toMs: number;
}) =>
  [
    params.source.trim().toLowerCase(),
    params.scope.trim().toLowerCase(),
    params.interval.trim().toLowerCase(),
    Math.trunc(params.fromMs),
    Math.trunc(params.toMs),
  ].join(':');

export const isMarketContextBackfillCoverageDataBearing = (row: {
  rowsCount?: number | null;
}) => Number(row.rowsCount ?? 0) > 0;

export const coverageRowsToKeySet = (
  rows: Awaited<ReturnType<typeof getMarketContextBackfillCoverage>>,
) =>
  new Set(
    rows.filter(isMarketContextBackfillCoverageDataBearing).map((row) =>
      coverageKey({
        source: row.source,
        scope: row.scope,
        interval: row.interval,
        fromMs: row.fromMs,
        toMs: row.toMs,
      }),
    ),
  );

const hasBackfillCoverage = (
  coverageKeys: Set<string>,
  params: {
    source: string;
    scope: string;
    interval: string;
    fromMs: number;
    toMs: number;
  },
) => coverageKeys.has(coverageKey(params));

const hasRecentBackfillCoverage = (
  rows: Awaited<ReturnType<typeof getMarketContextBackfillCoverage>>,
  params: {
    source: string;
    scope: string;
    interval: string;
    fromMs: number;
    toMs: number;
    atMs: number;
    maxAgeMs: number;
  },
) => {
  const key = coverageKey(params);
  return rows.some((row) => {
    if (!isMarketContextBackfillCoverageDataBearing(row)) return false;
    if (
      coverageKey({
        source: row.source,
        scope: row.scope,
        interval: row.interval,
        fromMs: row.fromMs,
        toMs: row.toMs,
      }) !== key
    ) {
      return false;
    }
    const checkedAtMs = Number(row.checkedAtMs);
    return (
      Number.isFinite(checkedAtMs) &&
      Math.max(0, params.atMs - checkedAtMs) <= params.maxAgeMs
    );
  });
};

type DailyCoverage = { firstMs: number; lastMs: number; rows: number };
type SourceBackfillStatus =
  | 'cached'
  | 'backfill_covered'
  | 'fetch_pending'
  | 'fetched'
  | 'disabled';

const formatCoverageRange = (coverage: DailyCoverage | null | undefined) => {
  if (!coverage) return 'coverage=none';
  return `coverage=${new Date(coverage.firstMs).toISOString()}..${new Date(
    coverage.lastMs,
  ).toISOString()} rows=${coverage.rows}`;
};

const formatReferenceCoverage = (
  coverage: Map<string, DailyCoverage>,
): string =>
  REFERENCE_ASSETS.map(
    (asset) =>
      `${asset.symbol}:${formatCoverageRange(coverage.get(asset.symbol))}`,
  ).join(' ');

const resolveBackfillStatus = ({
  enabled = true,
  cached,
  covered,
}: {
  enabled?: boolean;
  cached: boolean;
  covered: boolean;
}): SourceBackfillStatus => {
  if (!enabled) return 'disabled';
  if (cached) return 'cached';
  if (covered) return 'backfill_covered';
  return 'fetch_pending';
};

const formatSourceStatus = ({
  name,
  status,
  rows,
  coverage,
}: {
  name: string;
  status: SourceBackfillStatus;
  rows?: number;
  coverage: string;
}) => `${name}=${status}${rows == null ? '' : ` rows=${rows}`} ${coverage}`;

type CoinMarketCapFetchStats = {
  requests: number;
  totalCredits: number;
  byPath: Map<string, { requests: number; credits: number }>;
};

const createCoinMarketCapFetchStats = (): CoinMarketCapFetchStats => ({
  requests: 0,
  totalCredits: 0,
  byPath: new Map(),
});

const getCoinMarketCapPathLabel = (path: string) => {
  if (path.includes('global-metrics')) return 'global';
  if (path.includes('cryptocurrency/quotes')) return 'reference';
  if (path.includes('exchange/quotes')) return 'exchangeLiquidity';
  if (path.includes('fear-and-greed')) return 'fearGreed';
  if (path.includes('cmc100')) return 'cmc100';
  if (path.includes('cmc20')) return 'cmc20';
  return path;
};

const recordCoinMarketCapFetchStats = (
  stats: CoinMarketCapFetchStats | undefined,
  path: string,
  creditCount: number | null,
) => {
  if (!stats) return;
  const existing = stats.byPath.get(path) ?? { requests: 0, credits: 0 };
  existing.requests += 1;
  existing.credits += creditCount ?? 0;
  stats.requests += 1;
  stats.totalCredits += creditCount ?? 0;
  stats.byPath.set(path, existing);
};

const formatCoinMarketCapFetchStats = (stats: CoinMarketCapFetchStats) => {
  const byPath = [...stats.byPath.entries()]
    .map(
      ([path, item]) =>
        `${getCoinMarketCapPathLabel(path)}=${item.requests}req/${item.credits}cr`,
    )
    .join(' ');
  return `apiRequests=${stats.requests} apiCredits=${stats.totalCredits}${byPath ? ` ${byPath}` : ''}`;
};

const formatRowTimeRange = (rows: Array<{ ts: Date }>) => {
  if (!rows.length) return 'range=none';
  const times = rows
    .map((row) => row.ts.getTime())
    .filter((value) => Number.isFinite(value));
  if (!times.length) return 'range=none';
  return `range=${new Date(Math.min(...times)).toISOString()}..${new Date(
    Math.max(...times),
  ).toISOString()}`;
};

const logBackfillSourceDone = (params: {
  name: string;
  status: SourceBackfillStatus;
  rows: number;
  details?: string;
}) => {
  console.log(
    chalk.gray(
      `coinmarketcap context source done: ${params.name}=${params.status} rows=${params.rows}${params.details ? ` ${params.details}` : ''}`,
    ),
  );
};

const markBackfillCoverage = (
  rows: Array<{
    source: string;
    scope: string;
    interval: string;
    fromMs: number;
    toMs: number;
    rowsCount: number;
  }>,
) => upsertMarketContextBackfillCoverage(rows);

const coinMarketCapFetch = async (params: {
  path: string;
  apiKey: string;
  searchParams: Record<string, string>;
  stats?: CoinMarketCapFetchStats;
}) => {
  const url = new URL(`${getBaseUrl()}${params.path}`);
  for (const [key, value] of Object.entries(params.searchParams)) {
    url.searchParams.set(key, value);
  }

  for (let attempt = 0; attempt <= getMaxRetries(); attempt += 1) {
    const waitMs = Math.max(
      0,
      lastRequestTs + getRequestDelayMs() - Date.now(),
    );
    if (waitMs > 0) {
      await delay(waitMs);
    }
    lastRequestTs = Date.now();

    const response = await fetch(url.toString(), {
      headers: {
        accept: 'application/json',
        'X-CMC_PRO_API_KEY': params.apiKey,
      },
    });

    if (response.ok) {
      const payload = await response.json();
      const creditCount = toFiniteNumberOrNull(
        getRecord(getRecord(payload).status).credit_count,
      );
      recordCoinMarketCapFetchStats(params.stats, params.path, creditCount);
      if (creditCount != null && isVerboseRequestLoggingEnabled()) {
        console.log(
          chalk.gray(`coinmarketcap ${params.path}: credits=${creditCount}`),
        );
      }
      return payload;
    }

    const text = await response.text();
    const retryAfterRaw = Number(response.headers.get('retry-after') ?? '');
    const retryAfterMs =
      Number.isFinite(retryAfterRaw) && retryAfterRaw > 0
        ? retryAfterRaw * 1000
        : null;
    const transient = response.status === 429 || response.status >= 500;
    if (attempt < getMaxRetries() && transient) {
      await delay(retryAfterMs ?? Math.min(30_000, 1000 * 2 ** attempt));
      continue;
    }

    throw new Error(`CoinMarketCap ${params.path} ${response.status}: ${text}`);
  }

  return null;
};

const fetchCoinMarketCapIndexRows = async (params: {
  apiKey: string;
  index: (typeof CMC_INDEXES)[number];
  fromMs: number;
  toMs: number;
  stats?: CoinMarketCapFetchStats;
}) => {
  const rows: MarketCmcIndexContextRow[] = [];
  const maxChunkDays = 9;
  const totalChunks = Math.max(
    1,
    Math.ceil(
      (params.toMs - params.fromMs + DAY_MS) / ((maxChunkDays + 1) * DAY_MS),
    ),
  );
  let chunk = 0;
  for (
    let cursorMs = params.fromMs;
    cursorMs <= params.toMs;
    cursorMs += (maxChunkDays + 1) * DAY_MS
  ) {
    chunk += 1;
    const chunkEndMs = Math.min(params.toMs, cursorMs + maxChunkDays * DAY_MS);
    const payload = await coinMarketCapFetch({
      path: params.index.path,
      apiKey: params.apiKey,
      stats: params.stats,
      searchParams: {
        time_start: new Date(cursorMs).toISOString(),
        time_end: new Date(chunkEndMs).toISOString(),
        interval: 'daily',
      },
    });
    rows.push(
      ...coinMarketCapIndexPayloadToRows(payload, params.index.slug, '1d'),
    );
    if (chunk === 1 || chunk === totalChunks || chunk % 25 === 0) {
      console.log(
        chalk.gray(
          `coinmarketcap index backfill progress: ${params.index.slug} chunk=${chunk}/${totalChunks} rows=${rows.length} chunkRange=${new Date(cursorMs).toISOString()}..${new Date(chunkEndMs).toISOString()}`,
        ),
      );
    }
  }
  return { rows, chunks: chunk };
};

export const coinMarketCapGlobalPayloadToRows = (
  payload: unknown,
  source: MarketGlobalContextRow['source'] = SOURCE_GLOBAL_DAILY,
): MarketGlobalContextRow[] => {
  const quotes = getRecord(getRecord(payload).data).quotes;
  if (!Array.isArray(quotes)) return [];

  return quotes
    .map((item): MarketGlobalContextRow | null => {
      const record = getRecord(item);
      const quote = getRecord(getRecord(record.quote).USD);
      const tsRaw = record.timestamp ?? quote.timestamp;
      const ts = typeof tsRaw === 'string' ? new Date(tsRaw) : null;
      if (!ts || Number.isNaN(ts.getTime())) return null;

      const totalMarketCapUsd = toFiniteNumberOrNull(quote.total_market_cap);
      const altMarketCapUsd = toFiniteNumberOrNull(quote.altcoin_market_cap);
      const btcToAltMarketCapRatio =
        totalMarketCapUsd != null &&
        altMarketCapUsd != null &&
        altMarketCapUsd > 0
          ? Math.max(0, totalMarketCapUsd - altMarketCapUsd) / altMarketCapUsd
          : null;

      return {
        source,
        ts,
        updatedAt: ts,
        activeCryptocurrencies: toIntOrNull(record.active_cryptocurrencies),
        activeExchanges: toIntOrNull(record.active_exchanges),
        activeMarketPairs: toIntOrNull(record.active_market_pairs),
        markets: toIntOrNull(record.active_exchanges),
        totalMarketCapUsd,
        totalVolumeUsd: toFiniteNumberOrNull(quote.total_volume_24h),
        totalVolumeReportedUsd: toFiniteNumberOrNull(
          quote.total_volume_24h_reported,
        ),
        btcDominancePct: toFiniteNumberOrNull(record.btc_dominance),
        ethDominancePct: toFiniteNumberOrNull(record.eth_dominance),
        altMarketCapUsd,
        altVolumeUsd: toFiniteNumberOrNull(quote.altcoin_volume_24h),
        altVolumeReportedUsd: toFiniteNumberOrNull(
          quote.altcoin_volume_24h_reported,
        ),
        btcToAltMarketCapRatio,
        marketCapChangePct24hUsd: null,
      };
    })
    .filter((row): row is MarketGlobalContextRow => row != null);
};

const normalizeAssetDataItems = (payload: unknown) => {
  const data = getRecord(payload).data;
  if (!data) return [] as Record<string, unknown>[];
  if (Array.isArray(data)) {
    return data.filter(
      (item): item is Record<string, unknown> =>
        item != null && typeof item === 'object' && !Array.isArray(item),
    );
  }
  if (typeof data === 'object' && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.quotes)) return [record];
    return Object.values(record).filter(
      (item): item is Record<string, unknown> =>
        item != null && typeof item === 'object' && !Array.isArray(item),
    );
  }
  return [];
};

export const coinMarketCapHistoricalQuotesPayloadToRows = (
  payload: unknown,
  interval: MarketReferenceAssetContextRow['interval'] = '1d',
): MarketReferenceAssetContextRow[] => {
  return normalizeAssetDataItems(payload).flatMap((asset) => {
    const cmcId = toIntOrNull(asset.id);
    const symbolRaw = String(asset.symbol ?? '')
      .trim()
      .toUpperCase();
    const target = REFERENCE_ASSETS.find(
      (item) =>
        item.cmcId === cmcId || item.symbol.replace('USDT', '') === symbolRaw,
    );
    const quotes = Array.isArray(asset.quotes)
      ? asset.quotes
      : Object.values(getRecord(asset.quotes));
    if (!target || !cmcId || !quotes.length) return [];

    return quotes
      .map((item): MarketReferenceAssetContextRow | null => {
        const record = getRecord(item);
        const quote = getNestedRecord(getRecord(record.quote), 'USD');
        const tsRaw = record.timestamp ?? quote.timestamp ?? quote.last_updated;
        const ts = typeof tsRaw === 'string' ? new Date(tsRaw) : null;
        if (!ts || Number.isNaN(ts.getTime())) return null;

        return {
          source: SOURCE_REFERENCE,
          symbol: target.symbol,
          cmcId,
          interval,
          ts,
          openUsd: null,
          highUsd: null,
          lowUsd: null,
          closeUsd: toFiniteNumberOrNull(quote.price),
          volumeUsd: toFiniteNumberOrNull(quote.volume_24h),
          marketCapUsd: toFiniteNumberOrNull(quote.market_cap),
        };
      })
      .filter((row): row is MarketReferenceAssetContextRow => row != null);
  });
};

export const coinMarketCapExchangeQuotesPayloadToLiquidityRows = (
  payload: unknown,
  interval: MarketCmcExchangeLiquidityContextRow['interval'] = '1d',
): MarketCmcExchangeLiquidityContextRow[] => {
  const data = getRecord(payload).data;
  const exchangeItems = Array.isArray(data)
    ? data
    : Object.values(getRecord(data));
  const rowsByTs = new Map<
    number,
    Array<{ slug: string; name: string; volumeUsd: number | null }>
  >();

  for (const item of exchangeItems) {
    const exchange = getRecord(item);
    const slug = String(exchange.slug ?? '')
      .trim()
      .toLowerCase();
    const name = String(exchange.name ?? '')
      .trim()
      .toLowerCase();
    const quotes = Array.isArray(exchange.quotes)
      ? exchange.quotes
      : Array.isArray(exchange.quote)
        ? exchange.quote
        : [exchange];
    for (const quoteItem of quotes) {
      const record = getRecord(quoteItem);
      const quote = getNestedRecord(getNestedRecord(record, 'quote'), 'USD');
      const fallbackQuote = getNestedRecord(exchange, 'quote');
      const usd = Object.keys(quote).length
        ? quote
        : getNestedRecord(fallbackQuote, 'USD');
      const tsRaw =
        record.timestamp ??
        usd.timestamp ??
        usd.last_updated ??
        exchange.last_updated;
      const ts = typeof tsRaw === 'string' ? new Date(tsRaw) : null;
      if (!ts || Number.isNaN(ts.getTime())) continue;
      const volumeUsd =
        toFiniteNumberOrNull(usd.volume_24h) ??
        toFiniteNumberOrNull(usd.volume_24h_adjusted) ??
        toFiniteNumberOrNull(usd.spot_volume_usd) ??
        toFiniteNumberOrNull(usd.reported_volume_24h);
      const key = ts.getTime();
      const rows = rowsByTs.get(key) ?? [];
      rows.push({ slug, name, volumeUsd });
      rowsByTs.set(key, rows);
    }
  }

  return [...rowsByTs.entries()]
    .sort(([left], [right]) => left - right)
    .map(([ts, exchanges]) => {
      const volumes = exchanges.map((exchange) => exchange.volumeUsd);
      const totalVolumeUsd = sumFinite(volumes);
      const binanceVolumeUsd =
        exchanges.find(
          (exchange) =>
            exchange.slug === 'binance' || exchange.name.includes('binance'),
        )?.volumeUsd ?? null;
      const topExchangeVolume = Math.max(
        ...volumes.map((value) => value ?? 0),
        0,
      );
      const binanceVolumeShare = safeDivide(binanceVolumeUsd, totalVolumeUsd);
      const topExchangeVolumeShare = safeDivide(
        topExchangeVolume,
        totalVolumeUsd,
      );

      return {
        source: SOURCE_EXCHANGE_LIQUIDITY,
        interval,
        ts: new Date(ts),
        exchangesCount: exchanges.length,
        totalVolumeUsd,
        binanceVolumeUsd,
        binanceVolumeShare,
        topExchangeVolumeShare,
        liquidityRegime: toExchangeLiquidityRegime({
          binanceVolumeShare,
          topExchangeVolumeShare,
        }),
      };
    });
};

export const coinMarketCapFearGreedPayloadToRows = (
  payload: unknown,
): MarketCmcFearGreedContextRow[] => {
  const data = getRecord(payload).data;
  const items = Array.isArray(data) ? data : [];

  return items
    .map((item): MarketCmcFearGreedContextRow | null => {
      const record = getRecord(item);
      const timestampValue = toFiniteNumberOrNull(record.timestamp);
      const value = toIntOrNull(record.value);
      if (timestampValue == null || value == null) return null;
      const ts = new Date(timestampValue * 1000);
      if (Number.isNaN(ts.getTime())) return null;
      const classification = normalizeFearGreedClassification(
        record.value_classification,
      );

      return {
        source: SOURCE_FEAR_GREED,
        interval: '1d',
        ts,
        value,
        classification,
        sentimentRegime: toFearGreedRegime({ value, classification }),
      };
    })
    .filter((row): row is MarketCmcFearGreedContextRow => row != null);
};

const toCmcIndexWeightPct = (value: unknown): number | null => {
  if (typeof value === 'string') {
    return toFiniteNumberOrNull(value.replace('%', ''));
  }
  return toFiniteNumberOrNull(value);
};

export const coinMarketCapIndexPayloadToRows = (
  payload: unknown,
  indexSlug: MarketCmcIndexSlug,
  interval: MarketCmcIndexContextRow['interval'] = '1d',
): MarketCmcIndexContextRow[] => {
  const data = getRecord(payload).data;
  const items = Array.isArray(data) ? data : [];

  return items
    .map((item): MarketCmcIndexContextRow | null => {
      const record = getRecord(item);
      const tsRaw = record.update_time ?? record.timestamp;
      const ts = typeof tsRaw === 'string' ? new Date(tsRaw) : null;
      const value = toFiniteNumberOrNull(record.value);
      if (!ts || Number.isNaN(ts.getTime()) || value == null) return null;

      const constituentsRaw = Array.isArray(record.constituents)
        ? record.constituents
        : [];
      const constituents = constituentsRaw.map((constituent) => {
        const constituentRecord = getRecord(constituent);
        return {
          id: toIntOrNull(constituentRecord.id),
          name:
            typeof constituentRecord.name === 'string'
              ? constituentRecord.name
              : null,
          symbol:
            typeof constituentRecord.symbol === 'string'
              ? constituentRecord.symbol
              : null,
          url:
            typeof constituentRecord.url === 'string'
              ? constituentRecord.url
              : null,
          weightPct: toCmcIndexWeightPct(constituentRecord.weight),
          priceUsd: toFiniteNumberOrNull(constituentRecord.priceUsd),
          units: toFiniteNumberOrNull(constituentRecord.units),
        };
      });
      const topConstituent = constituents.reduce<
        (typeof constituents)[number] | null
      >((top, constituent) => {
        if (top == null) return constituent;
        return (constituent.weightPct ?? Number.NEGATIVE_INFINITY) >
          (top.weightPct ?? Number.NEGATIVE_INFINITY)
          ? constituent
          : top;
      }, null);

      return {
        source: SOURCE_INDEX,
        indexSlug,
        interval,
        ts,
        value,
        constituentsCount: constituents.length,
        topConstituentSymbol: topConstituent?.symbol ?? null,
        topConstituentWeightPct: topConstituent?.weightPct ?? null,
        constituents,
      };
    })
    .filter((row): row is MarketCmcIndexContextRow => row != null);
};

const shouldBackfillCoinMarketCapContextForMode = ({
  mode,
  aiEnabled,
  cacheOnly,
  mlEnabled,
}: {
  mode: 'backtest' | 'replay' | 'signals' | 'parity';
  aiEnabled?: boolean;
  cacheOnly: boolean;
  mlEnabled?: boolean;
}) =>
  parseEnabledFlag(
    process.env.COINMARKETCAP_CONTEXT_BACKFILL_ENABLED,
    mode === 'backtest'
      ? (Boolean(aiEnabled) || Boolean(mlEnabled)) && !cacheOnly
      : !cacheOnly,
  );

export const shouldBackfillCoinMarketCapContextForBacktest = (params: {
  aiEnabled: boolean;
  cacheOnly: boolean;
  mlEnabled: boolean;
}) =>
  shouldBackfillCoinMarketCapContextForMode({
    mode: 'backtest',
    ...params,
  });

export const shouldBackfillCoinMarketCapContextForReplay = (params: {
  cacheOnly: boolean;
}) =>
  shouldBackfillCoinMarketCapContextForMode({
    mode: 'replay',
    ...params,
  });

export const shouldBackfillCoinMarketCapContextForSignals = (params: {
  cacheOnly: boolean;
}) =>
  shouldBackfillCoinMarketCapContextForMode({
    mode: 'signals',
    ...params,
  });

const skippedResult = (cached = false): BackfillResult => ({
  skipped: true,
  globalRows: 0,
  referenceRows: 0,
  breadthRows: 0,
  exchangeLiquidityRows: 0,
  fearGreedRows: 0,
  indexRows: 0,
  cached,
});

export const backfillCoinMarketCapContext = async (
  params: BackfillParams,
): Promise<BackfillResult> => {
  if (!Number.isFinite(params.startMs) || !Number.isFinite(params.endMs)) {
    return skippedResult();
  }

  const { fromMs, toMs } = resolveCoinMarketCapBackfillWindow(params);
  if (toMs <= fromMs) return skippedResult();

  const exchangeLiquidityEnabled = isExchangeLiquidityBackfillEnabled();
  const fearGreedEnabled = isFearGreedBackfillEnabled();

  await waitForDbReady();
  const [
    globalDailyCoverage,
    referenceDailyCoverage,
    exchangeLiquidityCoverage,
    fearGreedCoverage,
    indexCoverage,
    globalDailyBackfillCoverage,
    referenceDailyBackfillCoverage,
    exchangeLiquidityBackfillCoverage,
    fearGreedBackfillCoverage,
    indexBackfillCoverage,
  ] = await Promise.all([
    getMarketGlobalContextCoverage({
      source: SOURCE_GLOBAL_DAILY,
      startMs: fromMs,
      endMs: toMs,
    }),
    getMarketReferenceAssetContextCoverage({
      source: SOURCE_REFERENCE,
      symbols: REFERENCE_ASSETS.map((item) => item.symbol),
      interval: '1d',
      startMs: fromMs,
      endMs: toMs,
    }),
    exchangeLiquidityEnabled
      ? getMarketCmcExchangeLiquidityContextCoverage({
          source: SOURCE_EXCHANGE_LIQUIDITY,
          interval: '1d',
          startMs: fromMs,
          endMs: toMs,
        })
      : Promise.resolve(null),
    fearGreedEnabled
      ? getMarketCmcFearGreedContextCoverage({
          source: SOURCE_FEAR_GREED,
          interval: '1d',
          startMs: fromMs,
          endMs: toMs,
        })
      : Promise.resolve(null),
    getMarketCmcIndexContextCoverage({
      source: SOURCE_INDEX,
      indexSlugs: CMC_INDEXES.map((index) => index.slug),
      interval: '1d',
      startMs: fromMs,
      endMs: toMs,
    }),
    getMarketContextBackfillCoverage({
      source: SOURCE_GLOBAL_DAILY,
      scopes: [COVERAGE_SCOPE_ALL],
      interval: '1d',
      fromMs,
      toMs,
    }),
    getMarketContextBackfillCoverage({
      source: SOURCE_REFERENCE,
      scopes: REFERENCE_ASSETS.map((item) => item.symbol),
      interval: '1d',
      fromMs,
      toMs,
    }),
    exchangeLiquidityEnabled
      ? getMarketContextBackfillCoverage({
          source: SOURCE_EXCHANGE_LIQUIDITY,
          scopes: [COVERAGE_SCOPE_ALL],
          interval: '1d',
          fromMs,
          toMs,
        })
      : Promise.resolve([]),
    fearGreedEnabled
      ? getMarketContextBackfillCoverage({
          source: SOURCE_FEAR_GREED,
          scopes: [COVERAGE_SCOPE_ALL],
          interval: '1d',
          fromMs,
          toMs,
        })
      : Promise.resolve([]),
    getMarketContextBackfillCoverage({
      source: SOURCE_INDEX,
      scopes: CMC_INDEXES.map((index) => index.slug),
      interval: '1d',
      fromMs,
      toMs,
    }),
  ]);
  const globalDailyBackfillKeys = coverageRowsToKeySet(
    globalDailyBackfillCoverage,
  );
  const referenceDailyBackfillKeys = coverageRowsToKeySet(
    referenceDailyBackfillCoverage,
  );
  const exchangeLiquidityBackfillKeys = coverageRowsToKeySet(
    exchangeLiquidityBackfillCoverage,
  );
  const fearGreedBackfillKeys = coverageRowsToKeySet(fearGreedBackfillCoverage);
  const indexBackfillKeys = coverageRowsToKeySet(indexBackfillCoverage);

  const globalDailyCached = hasDailyCoverage(globalDailyCoverage, fromMs, toMs);
  const referencesDailyCached = REFERENCE_ASSETS.every((asset) =>
    hasDailyCoverage(referenceDailyCoverage.get(asset.symbol), fromMs, toMs),
  );
  const exchangeLiquidityCached =
    !exchangeLiquidityEnabled ||
    hasDailyCoverage(exchangeLiquidityCoverage, fromMs, toMs);
  const fearGreedCached =
    !fearGreedEnabled || hasDailyCoverage(fearGreedCoverage, fromMs, toMs);
  const indexesCached = CMC_INDEXES.every((index) =>
    hasDailyCoverage(indexCoverage.get(index.slug), fromMs, toMs),
  );
  const globalDailyBackfillCovered = hasBackfillCoverage(
    globalDailyBackfillKeys,
    {
      source: SOURCE_GLOBAL_DAILY,
      scope: COVERAGE_SCOPE_ALL,
      interval: '1d',
      fromMs,
      toMs,
    },
  );
  const referencesDailyBackfillCovered = REFERENCE_ASSETS.every((asset) =>
    hasBackfillCoverage(referenceDailyBackfillKeys, {
      source: SOURCE_REFERENCE,
      scope: asset.symbol,
      interval: '1d',
      fromMs,
      toMs,
    }),
  );
  const exchangeLiquidityBackfillCovered = hasBackfillCoverage(
    exchangeLiquidityBackfillKeys,
    {
      source: SOURCE_EXCHANGE_LIQUIDITY,
      scope: COVERAGE_SCOPE_ALL,
      interval: '1d',
      fromMs,
      toMs,
    },
  );
  const fearGreedBackfillParams = {
    source: SOURCE_FEAR_GREED,
    scope: COVERAGE_SCOPE_ALL,
    interval: '1d',
    fromMs,
    toMs,
  };
  const fearGreedBackfillWasCovered = hasBackfillCoverage(
    fearGreedBackfillKeys,
    fearGreedBackfillParams,
  );
  const fearGreedLatestAgeMs =
    fearGreedCoverage == null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, params.endMs - fearGreedCoverage.lastMs);
  const refreshStaleFearGreed =
    params.refreshStaleFearGreed === true &&
    fearGreedLatestAgeMs > getContextMaxAgeMs();
  const fearGreedBackfillCovered =
    fearGreedBackfillWasCovered &&
    (!refreshStaleFearGreed ||
      hasRecentBackfillCoverage(fearGreedBackfillCoverage, {
        ...fearGreedBackfillParams,
        atMs: params.endMs,
        maxAgeMs: getFearGreedStaleRetryMs(),
      }));
  const indexesBackfillCovered = CMC_INDEXES.every((index) =>
    hasBackfillCoverage(indexBackfillKeys, {
      source: SOURCE_INDEX,
      scope: index.slug,
      interval: '1d',
      fromMs,
      toMs,
    }),
  );
  const globalDailyReady = globalDailyCached || globalDailyBackfillCovered;
  const referencesDailyReady =
    referencesDailyCached || referencesDailyBackfillCovered;
  const exchangeLiquidityReady =
    exchangeLiquidityCached ||
    !exchangeLiquidityEnabled ||
    exchangeLiquidityBackfillCovered;
  const fearGreedReady =
    fearGreedCached || !fearGreedEnabled || fearGreedBackfillCovered;
  const indexesReady = indexesCached || indexesBackfillCovered;

  let globalStatus = resolveBackfillStatus({
    cached: globalDailyCached,
    covered: globalDailyBackfillCovered,
  });
  let referenceStatus = resolveBackfillStatus({
    cached: referencesDailyCached,
    covered: referencesDailyBackfillCovered,
  });
  let exchangeLiquidityStatus = resolveBackfillStatus({
    enabled: exchangeLiquidityEnabled,
    cached: exchangeLiquidityCached,
    covered: exchangeLiquidityBackfillCovered,
  });
  let fearGreedStatus = resolveBackfillStatus({
    enabled: fearGreedEnabled,
    cached: fearGreedCached,
    covered: fearGreedBackfillCovered,
  });
  let indexStatus = resolveBackfillStatus({
    cached: indexesCached,
    covered: indexesBackfillCovered,
  });

  console.log(
    chalk.gray(
      [
        'coinmarketcap context status:',
        formatSourceStatus({
          name: 'global',
          status: globalStatus,
          coverage: formatCoverageRange(globalDailyCoverage),
        }),
        formatSourceStatus({
          name: 'reference',
          status: referenceStatus,
          coverage: formatReferenceCoverage(referenceDailyCoverage),
        }),
        formatSourceStatus({
          name: 'exchangeLiquidity',
          status: exchangeLiquidityStatus,
          coverage: formatCoverageRange(exchangeLiquidityCoverage),
        }),
        formatSourceStatus({
          name: 'fearGreed',
          status: fearGreedStatus,
          coverage: formatCoverageRange(fearGreedCoverage),
        }),
        formatSourceStatus({
          name: 'indexes',
          status: indexStatus,
          coverage: CMC_INDEXES.map(
            (index) =>
              `${index.slug}:${formatCoverageRange(indexCoverage.get(index.slug))}`,
          ).join(' '),
        }),
      ].join(' '),
    ),
  );

  if (
    globalDailyReady &&
    referencesDailyReady &&
    exchangeLiquidityReady &&
    fearGreedReady &&
    indexesReady
  ) {
    console.log(
      chalk.gray(
        `coinmarketcap context cached: ${new Date(fromMs).toISOString()}..${new Date(toMs).toISOString()}`,
      ),
    );
    return skippedResult(true);
  }

  const settings = await getUserSettings(params.userName);
  const apiKey = settings.COINMARKETCAP_API_KEY.trim();
  if (!apiKey) {
    throw new Error(
      `Missing COINMARKETCAP_API_KEY for historical context backfill (user=${params.userName})`,
    );
  }

  let globalRows = 0;
  let referenceRows = 0;
  let exchangeLiquidityRows = 0;
  let fearGreedRows = 0;
  let indexRows = 0;
  const fetchStats = createCoinMarketCapFetchStats();
  const pendingSources = [
    !globalDailyReady ? 'global' : null,
    !referencesDailyReady ? 'reference' : null,
    exchangeLiquidityEnabled && !exchangeLiquidityReady
      ? 'exchangeLiquidity'
      : null,
    fearGreedEnabled && !fearGreedReady ? 'fearGreed' : null,
    !indexesReady ? 'indexes' : null,
  ].filter((source): source is string => source != null);
  console.log(
    chalk.cyan(
      `coinmarketcap context backfill: window=${new Date(fromMs).toISOString()}..${new Date(toMs).toISOString()} days=${Math.floor((toMs - fromMs) / DAY_MS) + 1} fetch=${pendingSources.join(',')}`,
    ),
  );

  if (!globalDailyReady) {
    const payload = await coinMarketCapFetch({
      path: '/v1/global-metrics/quotes/historical',
      apiKey,
      stats: fetchStats,
      searchParams: {
        time_start: toIsoDate(fromMs),
        time_end: toIsoDate(toMs),
        interval: '1d',
        convert: 'USD',
      },
    });
    const rows = coinMarketCapGlobalPayloadToRows(payload, SOURCE_GLOBAL_DAILY);
    await upsertMarketGlobalContextRows(rows);
    await markBackfillCoverage([
      {
        source: SOURCE_GLOBAL_DAILY,
        scope: COVERAGE_SCOPE_ALL,
        interval: '1d',
        fromMs,
        toMs,
        rowsCount: rows.length,
      },
    ]);
    globalRows += rows.length;
    globalStatus = 'fetched';
    logBackfillSourceDone({
      name: 'global',
      status: globalStatus,
      rows: rows.length,
      details: formatRowTimeRange(rows),
    });
  }

  if (!referencesDailyReady) {
    const payload = await coinMarketCapFetch({
      path: '/v3/cryptocurrency/quotes/historical',
      apiKey,
      stats: fetchStats,
      searchParams: {
        id: REFERENCE_ASSETS.map((item) => item.cmcId).join(','),
        time_start: toIsoDate(fromMs),
        time_end: toIsoDate(toMs),
        interval: '1d',
        convert: 'USD',
      },
    });
    const rows = coinMarketCapHistoricalQuotesPayloadToRows(payload, '1d');
    await upsertMarketReferenceAssetContextRows(rows);
    await markBackfillCoverage(
      REFERENCE_ASSETS.map((asset) => ({
        source: SOURCE_REFERENCE,
        scope: asset.symbol,
        interval: '1d',
        fromMs,
        toMs,
        rowsCount: rows.filter((row) => row.symbol === asset.symbol).length,
      })),
    );
    referenceRows += rows.length;
    referenceStatus = 'fetched';
    logBackfillSourceDone({
      name: 'reference',
      status: referenceStatus,
      rows: rows.length,
      details: `${REFERENCE_ASSETS.map(
        (asset) =>
          `${asset.symbol}:${rows.filter((row) => row.symbol === asset.symbol).length}`,
      ).join(' ')} ${formatRowTimeRange(rows)}`,
    });
  }

  if (exchangeLiquidityEnabled && !exchangeLiquidityReady) {
    const payload = await coinMarketCapFetch({
      path: '/v1/exchange/quotes/historical',
      apiKey,
      stats: fetchStats,
      searchParams: {
        slug: getExchangeSlugs().join(','),
        time_start: toIsoDate(fromMs),
        time_end: toIsoDate(toMs),
        interval: '1d',
        convert: 'USD',
      },
    });
    const rows = coinMarketCapExchangeQuotesPayloadToLiquidityRows(
      payload,
      '1d',
    );
    await upsertMarketCmcExchangeLiquidityContextRows(rows);
    await markBackfillCoverage([
      {
        source: SOURCE_EXCHANGE_LIQUIDITY,
        scope: COVERAGE_SCOPE_ALL,
        interval: '1d',
        fromMs,
        toMs,
        rowsCount: rows.length,
      },
    ]);
    exchangeLiquidityRows = rows.length;
    exchangeLiquidityStatus = 'fetched';
    logBackfillSourceDone({
      name: 'exchangeLiquidity',
      status: exchangeLiquidityStatus,
      rows: rows.length,
      details: formatRowTimeRange(rows),
    });
  }

  if (fearGreedEnabled && !fearGreedReady) {
    const rows: MarketCmcFearGreedContextRow[] = [];
    const pageSize = getFearGreedPageSize();
    let pages = 0;
    for (let start = 1; ; start += pageSize) {
      const payload = await coinMarketCapFetch({
        path: '/v3/fear-and-greed/historical',
        apiKey,
        stats: fetchStats,
        searchParams: {
          start: String(start),
          limit: String(pageSize),
        },
      });
      pages += 1;
      const pageRows = coinMarketCapFearGreedPayloadToRows(payload);
      if (!pageRows.length) break;
      const matchingRows = pageRows.filter((row) => {
        const ts = row.ts.getTime();
        return ts >= fromMs && ts <= toMs;
      });
      rows.push(...matchingRows);
      const oldestPageTs = Math.min(...pageRows.map((row) => row.ts.getTime()));
      if (oldestPageTs < fromMs || pageRows.length < pageSize) break;
    }
    await upsertMarketCmcFearGreedContextRows(rows);
    await markBackfillCoverage([
      {
        source: SOURCE_FEAR_GREED,
        scope: COVERAGE_SCOPE_ALL,
        interval: '1d',
        fromMs,
        toMs,
        rowsCount: rows.length,
      },
    ]);
    fearGreedRows = rows.length;
    fearGreedStatus = 'fetched';
    logBackfillSourceDone({
      name: 'fearGreed',
      status: fearGreedStatus,
      rows: rows.length,
      details: `pages=${pages} ${formatRowTimeRange(rows)}`,
    });
  }

  if (!indexesReady) {
    const rowsByIndex = await Promise.all(
      CMC_INDEXES.map(async (index) => ({
        index,
        result: await fetchCoinMarketCapIndexRows({
          apiKey,
          index,
          fromMs,
          toMs,
          stats: fetchStats,
        }),
      })),
    );
    const rows = rowsByIndex.flatMap((item) => item.result.rows);
    await upsertMarketCmcIndexContextRows(rows);
    await markBackfillCoverage(
      rowsByIndex.map(({ index, result }) => ({
        source: SOURCE_INDEX,
        scope: index.slug,
        interval: '1d',
        fromMs,
        toMs,
        rowsCount: result.rows.length,
      })),
    );
    indexRows = rows.length;
    indexStatus = 'fetched';
    logBackfillSourceDone({
      name: 'indexes',
      status: indexStatus,
      rows: rows.length,
      details: `${rowsByIndex
        .map(
          ({ index, result }) =>
            `${index.slug}:${result.rows.length} rows/${result.chunks} chunks`,
        )
        .join(' ')} ${formatRowTimeRange(rows)}`,
    });
  }

  console.log(
    chalk.green(
      [
        'coinmarketcap context backfill done:',
        `global=${globalStatus} rows=${globalRows}`,
        `reference=${referenceStatus} rows=${referenceRows}`,
        `exchangeLiquidity=${exchangeLiquidityStatus} rows=${exchangeLiquidityRows}`,
        `fearGreed=${fearGreedStatus} rows=${fearGreedRows}`,
        `indexes=${indexStatus} rows=${indexRows}`,
        formatCoinMarketCapFetchStats(fetchStats),
      ].join(' '),
    ),
  );

  return {
    skipped: false,
    globalRows,
    referenceRows,
    breadthRows: 0,
    exchangeLiquidityRows,
    fearGreedRows,
    indexRows,
    cached: false,
  };
};

export const backfillCoinMarketCapContextForBacktest =
  backfillCoinMarketCapContext;
export const backfillCoinMarketCapContextForReplay =
  backfillCoinMarketCapContext;
export const backfillCoinMarketCapContextForSignals = (
  params: BackfillParams,
) => backfillCoinMarketCapContext({ ...params, refreshStaleFearGreed: true });
