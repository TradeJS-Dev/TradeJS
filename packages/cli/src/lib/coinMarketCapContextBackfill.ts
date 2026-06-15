import chalk from 'chalk';
import { delay } from '@tradejs/core/async';
import {
  getMarketCmcBreadthContextCoverage,
  getMarketCmcExchangeLiquidityContextCoverage,
  getMarketCmcFearGreedContextCoverage,
  getMarketContextBackfillCoverage,
  getMarketGlobalContextCoverage,
  getMarketReferenceAssetContextCoverage,
  upsertMarketCmcBreadthContextRows,
  upsertMarketCmcExchangeLiquidityContextRows,
  upsertMarketCmcFearGreedContextRows,
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
  CmcMarketBreadthRegime,
  MarketCmcBreadthContextRow,
  MarketCmcExchangeLiquidityContextRow,
  MarketCmcFearGreedContextRow,
  MarketGlobalContextRow,
  MarketReferenceAssetContextRow,
} from '@tradejs/types';

type BackfillParams = {
  userName: string;
  startMs: number;
  endMs: number;
  preloadStartMs?: number;
};

type BackfillResult = {
  skipped: boolean;
  globalRows: number;
  referenceRows: number;
  breadthRows: number;
  exchangeLiquidityRows: number;
  fearGreedRows: number;
  cached: boolean;
};

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const SOURCE_GLOBAL_DAILY = 'coinmarketcap_global' as const;
const SOURCE_GLOBAL_HOURLY = 'coinmarketcap_global_hourly' as const;
const SOURCE_REFERENCE = 'coinmarketcap_reference_asset' as const;
const SOURCE_BREADTH = 'coinmarketcap_market_breadth' as const;
const SOURCE_EXCHANGE_LIQUIDITY = 'coinmarketcap_exchange_liquidity' as const;
const SOURCE_FEAR_GREED = 'coinmarketcap_fear_greed' as const;
const COVERAGE_SCOPE_ALL = 'all';
const REFERENCE_ASSETS = [
  { symbol: 'BTCUSDT', cmcId: 1 },
  { symbol: 'ETHUSDT', cmcId: 1027 },
] as const;
const DEFAULT_EXCHANGE_SLUGS = [
  'binance',
  'coinbase-exchange',
  'okx',
  'bybit',
  'kraken',
] as const;
const STABLECOIN_SYMBOLS = new Set([
  'USDT',
  'USDC',
  'DAI',
  'FDUSD',
  'TUSD',
  'USDE',
  'USDS',
  'BUSD',
  'PYUSD',
]);

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

const getBreadthTopLimit = () =>
  asInt(process.env.COINMARKETCAP_CONTEXT_BREADTH_TOP_LIMIT, 100);

const isHourlyBackfillEnabled = () =>
  parseEnabledFlag(process.env.COINMARKETCAP_CONTEXT_HOURLY_ENABLED, true);

const isBreadthBackfillEnabled = () =>
  parseEnabledFlag(process.env.COINMARKETCAP_CONTEXT_BREADTH_ENABLED, true);

const isExchangeLiquidityBackfillEnabled = () =>
  parseEnabledFlag(
    process.env.COINMARKETCAP_CONTEXT_EXCHANGE_LIQUIDITY_ENABLED,
    true,
  );

const isFearGreedBackfillEnabled = () =>
  parseEnabledFlag(process.env.COINMARKETCAP_CONTEXT_FEAR_GREED_ENABLED, true);

const getFearGreedPageSize = () =>
  asInt(process.env.COINMARKETCAP_CONTEXT_FEAR_GREED_PAGE_SIZE, 500);

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

const normalizePercentChange = (value: unknown) => {
  const numeric = toFiniteNumberOrNull(value);
  return numeric == null ? null : numeric / 100;
};

const average = (values: number[]) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const standardDeviation = (values: number[]) => {
  if (values.length < 2) return null;
  const avg = average(values);
  if (avg == null) return null;
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};

const safeDivide = (numerator: number | null, denominator: number | null) =>
  numerator != null && denominator != null && denominator > 0
    ? numerator / denominator
    : null;

const sumFinite = (values: Array<number | null>) =>
  values.reduce<number>((sum, value) => sum + (value ?? 0), 0);

const toBreadthRegime = ({
  positive24hPct,
  avgReturn24hPct,
  returnDispersion24hPct,
  btcMarketCapShare,
  btcEthMarketCapShare,
}: {
  positive24hPct: number | null;
  avgReturn24hPct: number | null;
  returnDispersion24hPct: number | null;
  btcMarketCapShare: number | null;
  btcEthMarketCapShare: number | null;
}): CmcMarketBreadthRegime => {
  if (positive24hPct == null && avgReturn24hPct == null) return 'unknown';
  if ((positive24hPct ?? 0) >= 0.62 && (avgReturn24hPct ?? 0) >= 0.01) {
    return btcEthMarketCapShare != null && btcEthMarketCapShare <= 0.45
      ? 'alt_broadening'
      : 'risk_on';
  }
  if ((positive24hPct ?? 1) <= 0.38 && (avgReturn24hPct ?? 0) <= -0.01) {
    return 'risk_off';
  }
  if (
    btcMarketCapShare != null &&
    btcMarketCapShare >= 0.45 &&
    (positive24hPct == null || positive24hPct < 0.55)
  ) {
    return 'btc_concentrated';
  }
  if ((returnDispersion24hPct ?? 0) >= 0.06) return 'mixed';
  return 'neutral';
};

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

const toIso = (ms: number) => new Date(ms).toISOString();

const resolveWindow = (params: BackfillParams) => {
  const warmupMs =
    asInt(process.env.COINMARKETCAP_CONTEXT_BACKFILL_WARMUP_DAYS, 35) * DAY_MS;
  const maxWindowMs = getMaxBackfillDays() * DAY_MS;
  const requestedStart = params.preloadStartMs ?? params.startMs - warmupMs;
  const cappedStart = Math.max(requestedStart, params.endMs - maxWindowMs);
  return {
    fromMs: dayStartUtc(cappedStart),
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

const hasHourlyCoverage = (
  coverage:
    | { firstMs: number; lastMs: number; rows: number }
    | null
    | undefined,
  fromMs: number,
  toMs: number,
) => hasIntervalCoverage(coverage, fromMs, toMs, HOUR_MS);

const buildHourlyChunks = (fromMs: number, toMs: number) => {
  const chunkMs =
    asInt(process.env.COINMARKETCAP_CONTEXT_HOURLY_CHUNK_DAYS, 240) * DAY_MS;
  const chunks: Array<{ fromMs: number; toMs: number }> = [];
  for (let start = fromMs; start < toMs; start += chunkMs) {
    chunks.push({ fromMs: start, toMs: Math.min(toMs, start + chunkMs) });
  }
  return chunks;
};

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

const coverageRowsToKeySet = (
  rows: Awaited<ReturnType<typeof getMarketContextBackfillCoverage>>,
) =>
  new Set(
    rows.map((row) =>
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

const enumerateDailyTimestamps = (fromMs: number, toMs: number) => {
  const items: number[] = [];
  for (let ts = fromMs; ts < toMs; ts += DAY_MS) {
    items.push(ts);
  }
  return items;
};

const coinMarketCapFetch = async (params: {
  path: string;
  apiKey: string;
  searchParams: Record<string, string>;
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
      if (creditCount != null) {
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

export const coinMarketCapOhlcvPayloadToRows = (
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
    const quotes = Array.isArray(asset.quotes) ? asset.quotes : [];
    if (!target || !cmcId || !quotes.length) return [];

    return quotes
      .map((item): MarketReferenceAssetContextRow | null => {
        const record = getRecord(item);
        const quote = getRecord(getRecord(record.quote).USD);
        const tsRaw = quote.timestamp ?? record.time_close ?? record.timestamp;
        const ts = typeof tsRaw === 'string' ? new Date(tsRaw) : null;
        if (!ts || Number.isNaN(ts.getTime())) return null;

        return {
          source: SOURCE_REFERENCE,
          symbol: target.symbol,
          cmcId,
          interval,
          ts,
          openUsd: toFiniteNumberOrNull(quote.open),
          highUsd: toFiniteNumberOrNull(quote.high),
          lowUsd: toFiniteNumberOrNull(quote.low),
          closeUsd: toFiniteNumberOrNull(quote.close),
          volumeUsd: toFiniteNumberOrNull(quote.volume),
          marketCapUsd: toFiniteNumberOrNull(quote.market_cap),
        };
      })
      .filter((row): row is MarketReferenceAssetContextRow => row != null);
  });
};

export const coinMarketCapHistoricalQuotesPayloadToRows = (
  payload: unknown,
  interval: MarketReferenceAssetContextRow['interval'] = '1h',
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

export const coinMarketCapListingsPayloadToBreadthRow = (
  payload: unknown,
  params: {
    ts: Date;
    topLimit?: number;
    universe?: string;
  },
): MarketCmcBreadthContextRow | null => {
  const data = getRecord(payload).data;
  const items = Array.isArray(data) ? data : [];
  const topLimit = params.topLimit ?? getBreadthTopLimit();
  const assets = items
    .map((item) => getRecord(item))
    .filter((item) => Object.keys(item).length > 0)
    .slice(0, topLimit);
  if (!assets.length) return null;

  const rows = assets.map((asset) => {
    const quote = getNestedRecord(getNestedRecord(asset, 'quote'), 'USD');
    return {
      id: toIntOrNull(asset.id),
      symbol: String(asset.symbol ?? '')
        .trim()
        .toUpperCase(),
      marketCap: toFiniteNumberOrNull(quote.market_cap),
      volume: toFiniteNumberOrNull(quote.volume_24h),
      return24h: normalizePercentChange(quote.percent_change_24h),
      return7d: normalizePercentChange(quote.percent_change_7d),
    };
  });
  const marketCaps = rows.map((row) => row.marketCap);
  const volumes = rows.map((row) => row.volume);
  const totalMarketCapUsd = sumFinite(marketCaps);
  const totalVolumeUsd = sumFinite(volumes);
  const returns24h = rows
    .map((row) => row.return24h)
    .filter((value): value is number => value != null);
  const returns7d = rows
    .map((row) => row.return7d)
    .filter((value): value is number => value != null);
  const positive24hPct =
    returns24h.length > 0
      ? returns24h.filter((value) => value > 0).length / returns24h.length
      : null;
  const positive7dPct =
    returns7d.length > 0
      ? returns7d.filter((value) => value > 0).length / returns7d.length
      : null;
  const top10MarketCapShare = safeDivide(
    sumFinite(marketCaps.slice(0, 10)),
    totalMarketCapUsd,
  );
  const top25MarketCapShare = safeDivide(
    sumFinite(marketCaps.slice(0, 25)),
    totalMarketCapUsd,
  );
  const btcMarketCap =
    rows.find((row) => row.symbol === 'BTC')?.marketCap ?? null;
  const ethMarketCap =
    rows.find((row) => row.symbol === 'ETH')?.marketCap ?? null;
  const stablecoinMarketCap = sumFinite(
    rows
      .filter((row) => STABLECOIN_SYMBOLS.has(row.symbol))
      .map((row) => row.marketCap),
  );
  const stablecoinVolume = sumFinite(
    rows
      .filter((row) => STABLECOIN_SYMBOLS.has(row.symbol))
      .map((row) => row.volume),
  );
  const avgReturn24hPct = average(returns24h);
  const returnDispersion24hPct = standardDeviation(returns24h);
  const btcMarketCapShare = safeDivide(btcMarketCap, totalMarketCapUsd);
  const ethMarketCapShare = safeDivide(ethMarketCap, totalMarketCapUsd);
  const btcEthMarketCapShare = safeDivide(
    sumFinite([btcMarketCap, ethMarketCap]),
    totalMarketCapUsd,
  );

  return {
    source: SOURCE_BREADTH,
    universe: params.universe ?? `cmc_top${topLimit}`,
    interval: '1d',
    ts: params.ts,
    topAssetsCount: topLimit,
    assetsCount: rows.length,
    positive24hPct,
    positive7dPct,
    avgReturn24hPct,
    medianReturn24hPct: median(returns24h),
    avgReturn7dPct: average(returns7d),
    medianReturn7dPct: median(returns7d),
    returnDispersion24hPct,
    returnDispersion7dPct: standardDeviation(returns7d),
    top10MarketCapShare,
    top25MarketCapShare,
    btcMarketCapShare,
    ethMarketCapShare,
    btcEthMarketCapShare,
    stablecoinMarketCapShare: safeDivide(
      stablecoinMarketCap,
      totalMarketCapUsd,
    ),
    stablecoinVolumeShare: safeDivide(stablecoinVolume, totalVolumeUsd),
    totalMarketCapUsd,
    totalVolumeUsd,
    breadthRegime: toBreadthRegime({
      positive24hPct,
      avgReturn24hPct,
      returnDispersion24hPct,
      btcMarketCapShare,
      btcEthMarketCapShare,
    }),
  };
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

export const shouldBackfillCoinMarketCapContextForBacktest = ({
  aiEnabled,
  cacheOnly,
  mlEnabled,
}: {
  aiEnabled: boolean;
  cacheOnly: boolean;
  mlEnabled: boolean;
}) =>
  parseEnabledFlag(
    process.env.COINMARKETCAP_CONTEXT_BACKFILL_ENABLED,
    (aiEnabled || mlEnabled) && !cacheOnly,
  );

const skippedResult = (cached = false): BackfillResult => ({
  skipped: true,
  globalRows: 0,
  referenceRows: 0,
  breadthRows: 0,
  exchangeLiquidityRows: 0,
  fearGreedRows: 0,
  cached,
});

export const backfillCoinMarketCapContextForBacktest = async (
  params: BackfillParams,
): Promise<BackfillResult> => {
  if (params.endMs <= params.startMs) {
    return skippedResult();
  }

  const { fromMs, toMs } = resolveWindow(params);
  if (toMs <= fromMs) return skippedResult();

  const hourlyEnabled = isHourlyBackfillEnabled();
  const breadthEnabled = isBreadthBackfillEnabled();
  const exchangeLiquidityEnabled = isExchangeLiquidityBackfillEnabled();
  const fearGreedEnabled = isFearGreedBackfillEnabled();
  const breadthTopLimit = getBreadthTopLimit();
  const breadthUniverse = `cmc_top${breadthTopLimit}`;
  const hourlyChunks = buildHourlyChunks(fromMs, toMs);
  const dailyTimestamps = enumerateDailyTimestamps(fromMs, toMs);

  await waitForDbReady();
  const [
    globalDailyCoverage,
    referenceDailyCoverage,
    globalHourlyCoverage,
    referenceHourlyCoverage,
    breadthCoverage,
    exchangeLiquidityCoverage,
    fearGreedCoverage,
    globalDailyBackfillCoverage,
    referenceDailyBackfillCoverage,
    globalHourlyBackfillCoverage,
    referenceHourlyBackfillCoverage,
    breadthBackfillCoverage,
    exchangeLiquidityBackfillCoverage,
    fearGreedBackfillCoverage,
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
    hourlyEnabled
      ? getMarketGlobalContextCoverage({
          source: SOURCE_GLOBAL_HOURLY,
          startMs: fromMs,
          endMs: toMs,
        })
      : Promise.resolve(null),
    hourlyEnabled
      ? getMarketReferenceAssetContextCoverage({
          source: SOURCE_REFERENCE,
          symbols: REFERENCE_ASSETS.map((item) => item.symbol),
          interval: '1h',
          startMs: fromMs,
          endMs: toMs,
        })
      : Promise.resolve(new Map()),
    breadthEnabled
      ? getMarketCmcBreadthContextCoverage({
          source: SOURCE_BREADTH,
          universe: breadthUniverse,
          interval: '1d',
          startMs: fromMs,
          endMs: toMs,
        })
      : Promise.resolve(null),
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
    hourlyEnabled
      ? getMarketContextBackfillCoverage({
          source: SOURCE_GLOBAL_HOURLY,
          scopes: [COVERAGE_SCOPE_ALL],
          interval: '1h',
          fromMs,
          toMs,
        })
      : Promise.resolve([]),
    hourlyEnabled
      ? getMarketContextBackfillCoverage({
          source: SOURCE_REFERENCE,
          scopes: REFERENCE_ASSETS.map((item) => item.symbol),
          interval: '1h',
          fromMs,
          toMs,
        })
      : Promise.resolve([]),
    breadthEnabled
      ? getMarketContextBackfillCoverage({
          source: SOURCE_BREADTH,
          scopes: [breadthUniverse],
          interval: '1d',
          fromMs,
          toMs,
        })
      : Promise.resolve([]),
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
  ]);
  const globalDailyBackfillKeys = coverageRowsToKeySet(
    globalDailyBackfillCoverage,
  );
  const referenceDailyBackfillKeys = coverageRowsToKeySet(
    referenceDailyBackfillCoverage,
  );
  const globalHourlyBackfillKeys = coverageRowsToKeySet(
    globalHourlyBackfillCoverage,
  );
  const referenceHourlyBackfillKeys = coverageRowsToKeySet(
    referenceHourlyBackfillCoverage,
  );
  const breadthBackfillKeys = coverageRowsToKeySet(breadthBackfillCoverage);
  const exchangeLiquidityBackfillKeys = coverageRowsToKeySet(
    exchangeLiquidityBackfillCoverage,
  );
  const fearGreedBackfillKeys = coverageRowsToKeySet(fearGreedBackfillCoverage);

  const globalDailyCached = hasDailyCoverage(globalDailyCoverage, fromMs, toMs);
  const referencesDailyCached = REFERENCE_ASSETS.every((asset) =>
    hasDailyCoverage(referenceDailyCoverage.get(asset.symbol), fromMs, toMs),
  );
  const globalHourlyCached =
    !hourlyEnabled || hasHourlyCoverage(globalHourlyCoverage, fromMs, toMs);
  const referencesHourlyCached =
    !hourlyEnabled ||
    REFERENCE_ASSETS.every((asset) =>
      hasHourlyCoverage(
        referenceHourlyCoverage.get(asset.symbol),
        fromMs,
        toMs,
      ),
    );
  const breadthCached =
    !breadthEnabled || hasDailyCoverage(breadthCoverage, fromMs, toMs);
  const exchangeLiquidityCached =
    !exchangeLiquidityEnabled ||
    hasDailyCoverage(exchangeLiquidityCoverage, fromMs, toMs);
  const fearGreedCached =
    !fearGreedEnabled || hasDailyCoverage(fearGreedCoverage, fromMs, toMs);
  const globalDailyReady =
    globalDailyCached ||
    hasBackfillCoverage(globalDailyBackfillKeys, {
      source: SOURCE_GLOBAL_DAILY,
      scope: COVERAGE_SCOPE_ALL,
      interval: '1d',
      fromMs,
      toMs,
    });
  const referencesDailyReady =
    referencesDailyCached ||
    REFERENCE_ASSETS.every((asset) =>
      hasBackfillCoverage(referenceDailyBackfillKeys, {
        source: SOURCE_REFERENCE,
        scope: asset.symbol,
        interval: '1d',
        fromMs,
        toMs,
      }),
    );
  const globalHourlyReady =
    !hourlyEnabled ||
    globalHourlyCached ||
    hourlyChunks.every((chunk) =>
      hasBackfillCoverage(globalHourlyBackfillKeys, {
        source: SOURCE_GLOBAL_HOURLY,
        scope: COVERAGE_SCOPE_ALL,
        interval: '1h',
        fromMs: chunk.fromMs,
        toMs: chunk.toMs,
      }),
    );
  const referencesHourlyReady =
    !hourlyEnabled ||
    referencesHourlyCached ||
    hourlyChunks.every((chunk) =>
      REFERENCE_ASSETS.every((asset) =>
        hasBackfillCoverage(referenceHourlyBackfillKeys, {
          source: SOURCE_REFERENCE,
          scope: asset.symbol,
          interval: '1h',
          fromMs: chunk.fromMs,
          toMs: chunk.toMs,
        }),
      ),
    );
  const breadthReady =
    breadthCached ||
    !breadthEnabled ||
    dailyTimestamps.every((ts) =>
      hasBackfillCoverage(breadthBackfillKeys, {
        source: SOURCE_BREADTH,
        scope: breadthUniverse,
        interval: '1d',
        fromMs: ts,
        toMs: ts + DAY_MS,
      }),
    );
  const exchangeLiquidityReady =
    exchangeLiquidityCached ||
    !exchangeLiquidityEnabled ||
    hasBackfillCoverage(exchangeLiquidityBackfillKeys, {
      source: SOURCE_EXCHANGE_LIQUIDITY,
      scope: COVERAGE_SCOPE_ALL,
      interval: '1d',
      fromMs,
      toMs,
    });
  const fearGreedReady =
    fearGreedCached ||
    !fearGreedEnabled ||
    hasBackfillCoverage(fearGreedBackfillKeys, {
      source: SOURCE_FEAR_GREED,
      scope: COVERAGE_SCOPE_ALL,
      interval: '1d',
      fromMs,
      toMs,
    });

  if (
    globalDailyReady &&
    referencesDailyReady &&
    globalHourlyReady &&
    referencesHourlyReady &&
    breadthReady &&
    exchangeLiquidityReady &&
    fearGreedReady
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
  let breadthRows = 0;
  let exchangeLiquidityRows = 0;
  let fearGreedRows = 0;
  console.log(
    chalk.cyan(
      `coinmarketcap context backfill: window=${new Date(fromMs).toISOString()}..${new Date(toMs).toISOString()}`,
    ),
  );

  if (!globalDailyReady) {
    const payload = await coinMarketCapFetch({
      path: '/v1/global-metrics/quotes/historical',
      apiKey,
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
  }

  if (!referencesDailyReady) {
    const payload = await coinMarketCapFetch({
      path: '/v2/cryptocurrency/ohlcv/historical',
      apiKey,
      searchParams: {
        id: REFERENCE_ASSETS.map((item) => item.cmcId).join(','),
        time_start: toIsoDate(fromMs),
        time_end: toIsoDate(toMs),
        interval_period: 'daily',
        interval: '1d',
        convert: 'USD',
      },
    });
    const rows = coinMarketCapOhlcvPayloadToRows(payload, '1d');
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
  }

  if (hourlyEnabled && !globalHourlyCached) {
    for (const chunk of hourlyChunks) {
      if (
        hasBackfillCoverage(globalHourlyBackfillKeys, {
          source: SOURCE_GLOBAL_HOURLY,
          scope: COVERAGE_SCOPE_ALL,
          interval: '1h',
          fromMs: chunk.fromMs,
          toMs: chunk.toMs,
        })
      ) {
        continue;
      }
      const payload = await coinMarketCapFetch({
        path: '/v1/global-metrics/quotes/historical',
        apiKey,
        searchParams: {
          time_start: toIso(chunk.fromMs),
          time_end: toIso(chunk.toMs),
          interval: '1h',
          convert: 'USD',
        },
      });
      const rows = coinMarketCapGlobalPayloadToRows(
        payload,
        SOURCE_GLOBAL_HOURLY,
      );
      await upsertMarketGlobalContextRows(rows);
      await markBackfillCoverage([
        {
          source: SOURCE_GLOBAL_HOURLY,
          scope: COVERAGE_SCOPE_ALL,
          interval: '1h',
          fromMs: chunk.fromMs,
          toMs: chunk.toMs,
          rowsCount: rows.length,
        },
      ]);
      globalHourlyBackfillKeys.add(
        coverageKey({
          source: SOURCE_GLOBAL_HOURLY,
          scope: COVERAGE_SCOPE_ALL,
          interval: '1h',
          fromMs: chunk.fromMs,
          toMs: chunk.toMs,
        }),
      );
      globalRows += rows.length;
    }
  }

  if (hourlyEnabled && !referencesHourlyCached) {
    for (const chunk of hourlyChunks) {
      const chunkCached = REFERENCE_ASSETS.every((asset) =>
        hasBackfillCoverage(referenceHourlyBackfillKeys, {
          source: SOURCE_REFERENCE,
          scope: asset.symbol,
          interval: '1h',
          fromMs: chunk.fromMs,
          toMs: chunk.toMs,
        }),
      );
      if (chunkCached) {
        continue;
      }
      const payload = await coinMarketCapFetch({
        path: '/v3/cryptocurrency/quotes/historical',
        apiKey,
        searchParams: {
          id: REFERENCE_ASSETS.map((item) => item.cmcId).join(','),
          time_start: toIso(chunk.fromMs),
          time_end: toIso(chunk.toMs),
          interval: '1h',
          convert: 'USD',
        },
      });
      const rows = coinMarketCapHistoricalQuotesPayloadToRows(payload, '1h');
      await upsertMarketReferenceAssetContextRows(rows);
      await markBackfillCoverage(
        REFERENCE_ASSETS.map((asset) => ({
          source: SOURCE_REFERENCE,
          scope: asset.symbol,
          interval: '1h',
          fromMs: chunk.fromMs,
          toMs: chunk.toMs,
          rowsCount: rows.filter((row) => row.symbol === asset.symbol).length,
        })),
      );
      for (const asset of REFERENCE_ASSETS) {
        referenceHourlyBackfillKeys.add(
          coverageKey({
            source: SOURCE_REFERENCE,
            scope: asset.symbol,
            interval: '1h',
            fromMs: chunk.fromMs,
            toMs: chunk.toMs,
          }),
        );
      }
      referenceRows += rows.length;
    }
  }

  if (breadthEnabled && !breadthCached) {
    const rows: MarketCmcBreadthContextRow[] = [];
    for (const ts of dailyTimestamps) {
      if (
        hasBackfillCoverage(breadthBackfillKeys, {
          source: SOURCE_BREADTH,
          scope: breadthUniverse,
          interval: '1d',
          fromMs: ts,
          toMs: ts + DAY_MS,
        })
      ) {
        continue;
      }
      const payload = await coinMarketCapFetch({
        path: '/v1/cryptocurrency/listings/historical',
        apiKey,
        searchParams: {
          date: toIsoDate(ts),
          start: '1',
          limit: String(breadthTopLimit),
          sort: 'market_cap',
          sort_dir: 'desc',
          cryptocurrency_type: 'all',
          convert: 'USD',
        },
      });
      const row = coinMarketCapListingsPayloadToBreadthRow(payload, {
        ts: new Date(ts),
        topLimit: breadthTopLimit,
        universe: breadthUniverse,
      });
      if (row) rows.push(row);
      await markBackfillCoverage([
        {
          source: SOURCE_BREADTH,
          scope: breadthUniverse,
          interval: '1d',
          fromMs: ts,
          toMs: ts + DAY_MS,
          rowsCount: row ? 1 : 0,
        },
      ]);
      breadthBackfillKeys.add(
        coverageKey({
          source: SOURCE_BREADTH,
          scope: breadthUniverse,
          interval: '1d',
          fromMs: ts,
          toMs: ts + DAY_MS,
        }),
      );
      if (rows.length >= 250) {
        breadthRows += rows.length;
        await upsertMarketCmcBreadthContextRows(rows.splice(0, rows.length));
      }
    }
    breadthRows += rows.length;
    await upsertMarketCmcBreadthContextRows(rows);
  }

  if (exchangeLiquidityEnabled && !exchangeLiquidityReady) {
    const payload = await coinMarketCapFetch({
      path: '/v1/exchange/quotes/historical',
      apiKey,
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
  }

  if (fearGreedEnabled && !fearGreedReady) {
    const rows: MarketCmcFearGreedContextRow[] = [];
    const pageSize = getFearGreedPageSize();
    for (let start = 1; ; start += pageSize) {
      const payload = await coinMarketCapFetch({
        path: '/v3/fear-and-greed/historical',
        apiKey,
        searchParams: {
          start: String(start),
          limit: String(pageSize),
        },
      });
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
  }

  console.log(
    chalk.green(
      `coinmarketcap context backfill done: globalRows=${globalRows}, referenceRows=${referenceRows}, breadthRows=${breadthRows}, exchangeLiquidityRows=${exchangeLiquidityRows}, fearGreedRows=${fearGreedRows}`,
    ),
  );

  return {
    skipped: false,
    globalRows,
    referenceRows,
    breadthRows,
    exchangeLiquidityRows,
    fearGreedRows,
    cached: false,
  };
};
