import chalk from 'chalk';
import { delay } from '@tradejs/core/async';
import {
  getLatestMarketGlobalContext,
  upsertMarketGlobalContextRows,
  waitForDbReady,
} from '@tradejs/infra/timescale';
import type { MarketGlobalContextRow } from '@tradejs/types';

type BackfillParams = {
  startMs: number;
  endMs: number;
};

type BackfillResult = {
  skipped: boolean;
  rows: number;
  cached: boolean;
  failed: boolean;
};

const SOURCE = 'coingecko_global' as const;
const DEFAULT_BASE_URL = 'https://api.coingecko.com/api/v3';
const DEFAULT_MIN_REQUEST_DELAY_MS = 12_000;
const DEFAULT_CACHE_TTL_MS = 30 * 60_000;
const DEFAULT_MAX_AGE_MS = 36 * 60 * 60_000;

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
  process.env.COINGECKO_BASE_URL?.trim() || DEFAULT_BASE_URL;

const getRequestDelayMs = () =>
  asInt(
    process.env.COINGECKO_GLOBAL_CONTEXT_MIN_REQUEST_DELAY_MS,
    DEFAULT_MIN_REQUEST_DELAY_MS,
  );

const getCacheTtlMs = () =>
  asInt(
    process.env.COINGECKO_GLOBAL_CONTEXT_CACHE_TTL_MS,
    DEFAULT_CACHE_TTL_MS,
  );

const getMaxAgeMs = () =>
  asInt(process.env.COINGECKO_GLOBAL_CONTEXT_MAX_AGE_MS, DEFAULT_MAX_AGE_MS);

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

const formatCoingeckoError = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const fetchGlobalData = async () => {
  const waitMs = Math.max(0, lastRequestTs + getRequestDelayMs() - Date.now());
  if (waitMs > 0) {
    await delay(waitMs);
  }
  lastRequestTs = Date.now();

  const controller = new AbortController();
  const timeoutMs = asInt(
    process.env.COINGECKO_GLOBAL_CONTEXT_REQUEST_TIMEOUT_MS,
    15_000,
  );
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(`${getBaseUrl()}/global`, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`CoinGecko /global ${response.status}: ${text}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
};

export const coingeckoGlobalPayloadToRow = (
  payload: unknown,
): MarketGlobalContextRow | null => {
  const data = getRecord(getRecord(payload).data);
  const marketCap = getRecord(data.total_market_cap);
  const volume = getRecord(data.total_volume);
  const marketCapPercentage = getRecord(data.market_cap_percentage);
  const totalMarketCapUsd = toFiniteNumberOrNull(marketCap.usd);
  const btcDominancePct = toFiniteNumberOrNull(marketCapPercentage.btc);
  const ethDominancePct = toFiniteNumberOrNull(marketCapPercentage.eth);
  const updatedAtSeconds = toFiniteNumberOrNull(data.updated_at);
  const updatedAt =
    updatedAtSeconds == null ? new Date() : new Date(updatedAtSeconds * 1000);
  const btcMarketCapUsd =
    totalMarketCapUsd != null && btcDominancePct != null
      ? (totalMarketCapUsd * btcDominancePct) / 100
      : null;
  const altMarketCapUsd =
    totalMarketCapUsd != null && btcMarketCapUsd != null
      ? Math.max(0, totalMarketCapUsd - btcMarketCapUsd)
      : null;
  const btcToAltMarketCapRatio =
    btcMarketCapUsd != null && altMarketCapUsd != null && altMarketCapUsd > 0
      ? btcMarketCapUsd / altMarketCapUsd
      : null;

  if (btcDominancePct == null && totalMarketCapUsd == null) {
    return null;
  }

  return {
    source: SOURCE,
    ts: updatedAt,
    updatedAt,
    activeCryptocurrencies: toIntOrNull(data.active_cryptocurrencies),
    markets: toIntOrNull(data.markets),
    totalMarketCapUsd,
    totalVolumeUsd: toFiniteNumberOrNull(volume.usd),
    btcDominancePct,
    ethDominancePct,
    altMarketCapUsd,
    btcToAltMarketCapRatio,
    marketCapChangePct24hUsd: toFiniteNumberOrNull(
      data.market_cap_change_percentage_24h_usd,
    ),
  };
};

export const shouldBackfillCoingeckoGlobalContextForBacktest = ({
  aiEnabled,
  cacheOnly,
  mlEnabled,
}: {
  aiEnabled: boolean;
  cacheOnly: boolean;
  mlEnabled: boolean;
}) =>
  parseEnabledFlag(
    process.env.COINGECKO_GLOBAL_CONTEXT_ENABLED,
    (aiEnabled || mlEnabled) && !cacheOnly,
  );

export const shouldBackfillCoingeckoGlobalContextForSignals = ({
  cacheOnly,
}: {
  cacheOnly: boolean;
}) =>
  parseEnabledFlag(process.env.COINGECKO_GLOBAL_CONTEXT_ENABLED, false) &&
  !cacheOnly;

export const shouldBackfillCoingeckoGlobalContextForReplay = ({
  cacheOnly,
}: {
  cacheOnly: boolean;
}) =>
  parseEnabledFlag(process.env.COINGECKO_GLOBAL_CONTEXT_ENABLED, !cacheOnly);

const skippedResult = (cached = false): BackfillResult => ({
  skipped: true,
  rows: 0,
  cached,
  failed: false,
});

const backfillCoingeckoGlobalContext = async (
  params: BackfillParams,
  enabled: boolean,
): Promise<BackfillResult> => {
  if (!enabled || params.endMs <= params.startMs) {
    return skippedResult();
  }

  await waitForDbReady();
  const cached = await getLatestMarketGlobalContext({
    source: SOURCE,
    atMs: Date.now(),
    maxAgeMs: getCacheTtlMs(),
  });
  if (cached && !cached.stale) {
    console.log(
      chalk.gray(
        `coingecko global market context cached: asOf=${cached.ts.toISOString()}`,
      ),
    );
    return skippedResult(true);
  }

  try {
    const payload = await fetchGlobalData();
    const row = coingeckoGlobalPayloadToRow(payload);
    if (!row) {
      console.log(chalk.yellow('coingecko global market context: empty data'));
      return {
        skipped: true,
        rows: 0,
        cached: false,
        failed: true,
      };
    }
    await upsertMarketGlobalContextRows([row]);
    console.log(
      chalk.green(
        `coingecko global market context: rows=1, btcDominance=${row.btcDominancePct ?? 'n/a'}%, totalMcapUsd=${row.totalMarketCapUsd ?? 'n/a'}`,
      ),
    );
    return {
      skipped: false,
      rows: 1,
      cached: false,
      failed: false,
    };
  } catch (error) {
    console.log(
      chalk.yellow(
        `coingecko global market context skipped: ${formatCoingeckoError(error)}`,
      ),
    );
    console.log(
      chalk.gray(
        `Set COINGECKO_GLOBAL_CONTEXT_ENABLED=0 to disable this optional context, or increase COINGECKO_GLOBAL_CONTEXT_REQUEST_TIMEOUT_MS. maxAgeMs=${getMaxAgeMs()}`,
      ),
    );
    return {
      skipped: true,
      rows: 0,
      cached: false,
      failed: true,
    };
  }
};

export const backfillCoingeckoGlobalContextForBacktest = (
  params: BackfillParams,
) => backfillCoingeckoGlobalContext(params, true);

export const backfillCoingeckoGlobalContextForSignals = (
  params: BackfillParams,
) => backfillCoingeckoGlobalContext(params, true);

export const backfillCoingeckoGlobalContextForReplay = (
  params: BackfillParams,
) => backfillCoingeckoGlobalContext(params, true);
