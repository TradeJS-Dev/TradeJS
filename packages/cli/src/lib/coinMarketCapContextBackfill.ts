import chalk from 'chalk';
import { delay } from '@tradejs/core/async';
import {
  getMarketGlobalContextCoverage,
  getMarketReferenceAssetContextCoverage,
  upsertMarketGlobalContextRows,
  upsertMarketReferenceAssetContextRows,
  waitForDbReady,
} from '@tradejs/infra/timescale';
import { getUserSettings } from '@tradejs/infra/userSettings';
import type {
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
  cached: boolean;
};

const DAY_MS = 86_400_000;
const SOURCE_GLOBAL = 'coinmarketcap_global' as const;
const SOURCE_REFERENCE = 'coinmarketcap_reference_asset' as const;
const REFERENCE_ASSETS = [
  { symbol: 'BTCUSDT', cmcId: 1 },
  { symbol: 'ETHUSDT', cmcId: 1027 },
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

const dayStartUtc = (ms: number) => {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

const toIsoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

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

const hasDailyCoverage = (
  coverage:
    | { firstMs: number; lastMs: number; rows: number }
    | null
    | undefined,
  fromMs: number,
  toMs: number,
) => {
  if (!coverage) return false;
  const expectedRows = Math.max(1, Math.floor((toMs - fromMs) / DAY_MS));
  return (
    coverage.firstMs <= fromMs + DAY_MS &&
    coverage.lastMs >= toMs - DAY_MS &&
    coverage.rows >= Math.floor(expectedRows * 0.9)
  );
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
        source: SOURCE_GLOBAL,
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
          interval: '1d',
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

  await waitForDbReady();
  const [globalCoverage, referenceCoverage] = await Promise.all([
    getMarketGlobalContextCoverage({
      source: SOURCE_GLOBAL,
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
  ]);

  const globalCached = hasDailyCoverage(globalCoverage, fromMs, toMs);
  const referencesCached = REFERENCE_ASSETS.every((asset) =>
    hasDailyCoverage(referenceCoverage.get(asset.symbol), fromMs, toMs),
  );

  if (globalCached && referencesCached) {
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
  console.log(
    chalk.cyan(
      `coinmarketcap context backfill: window=${new Date(fromMs).toISOString()}..${new Date(toMs).toISOString()}`,
    ),
  );

  if (!globalCached) {
    const payload = await coinMarketCapFetch({
      path: '/v1/global-metrics/quotes/historical',
      apiKey,
      searchParams: {
        start: toIsoDate(fromMs),
        end: toIsoDate(toMs),
        interval: '1d',
        convert: 'USD',
      },
    });
    const rows = coinMarketCapGlobalPayloadToRows(payload);
    await upsertMarketGlobalContextRows(rows);
    globalRows = rows.length;
  }

  if (!referencesCached) {
    const payload = await coinMarketCapFetch({
      path: '/v2/cryptocurrency/ohlcv/historical',
      apiKey,
      searchParams: {
        id: REFERENCE_ASSETS.map((item) => item.cmcId).join(','),
        time_start: toIsoDate(fromMs),
        time_end: toIsoDate(toMs),
        time_period: 'daily',
        interval: '1d',
        convert: 'USD',
      },
    });
    const rows = coinMarketCapOhlcvPayloadToRows(payload);
    await upsertMarketReferenceAssetContextRows(rows);
    referenceRows = rows.length;
  }

  console.log(
    chalk.green(
      `coinmarketcap context backfill done: globalRows=${globalRows}, referenceRows=${referenceRows}`,
    ),
  );

  return {
    skipped: false,
    globalRows,
    referenceRows,
    cached: false,
  };
};
