import chalk from 'chalk';
import ProgressBar from 'progress';
import { delay } from '@tradejs/core/async';
import {
  coinalyzePointsToRows,
  mergeCoinalyzeMetrics,
  normalizeDerivativesIntervals,
} from '@tradejs/core/indicators';
import { upsertDerivatives, waitForDbReady } from '@tradejs/infra/timescale';
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
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DEFAULT_LOOKBACK_HOURS = 48;
const DEFAULT_INTERVALS: DerivativesInterval[] = ['15m', '1h'];

const coinalyzeIntervalMap: Record<DerivativesInterval, string> = {
  '15m': '15min',
  '1h': '1hour',
};

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

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

export const isBacktestDerivativesContextEnabled = () => {
  const normalized = String(process.env.DERIVATIVES_CONTEXT_ENABLED ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  if (['1', 'true', 'yes', 'on', 'backtest'].includes(normalized)) {
    return true;
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

const fetchJsonWithRateLimit = async (url: string, apiKey: string) => {
  const requestDelayMs = getRequestDelayMs();
  const requestTimeoutMs = getRequestTimeoutMs();
  const maxRetries = asInt(process.env.COINALYZE_MAX_RETRIES, 4);

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
      const abortError =
        error instanceof Error &&
        (error.name === 'AbortError' ||
          String(error.message).toLowerCase().includes('aborted'));
      if (attempt < maxRetries && abortError) {
        await delay(Math.min(12_000, 800 * 2 ** attempt));
        continue;
      }
      throw error;
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

  throw new Error('Coinalyze request failed after retries');
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

export const backfillDerivativesContextForBacktest = async (params: {
  userName: string;
  symbols: string[];
  startMs: number;
  endMs: number;
}): Promise<BackfillResult> => {
  const { userName, startMs, endMs } = params;
  const symbols = [
    ...new Set(
      params.symbols
        .map((symbol) =>
          String(symbol || '')
            .trim()
            .toUpperCase(),
        )
        .filter(Boolean),
    ),
  ];

  if (!isBacktestDerivativesContextEnabled() || !symbols.length) {
    return {
      skipped: true,
      rows: 0,
      matchedSymbols: 0,
      unmatchedSymbols: 0,
      failedWindows: 0,
    };
  }

  const intervals = resolveDerivativesContextIntervals();
  if (!intervals.length) {
    return {
      skipped: true,
      rows: 0,
      matchedSymbols: 0,
      unmatchedSymbols: 0,
      failedWindows: 0,
    };
  }

  const apiKey = await getCoinalyzeApiKey(userName);
  if (!apiKey) {
    throw new Error(
      `Missing COINALYZE_API_KEY for derivatives context backfill (user=${userName})`,
    );
  }

  const safeEndMs = Math.min(endMs, Date.now());
  const safeStartMs = Math.max(0, Math.min(startMs, safeEndMs));
  const fromMs = Math.max(
    0,
    safeStartMs - resolveDerivativesContextLookbackMs(),
  );
  if (safeEndMs <= fromMs) {
    return {
      skipped: true,
      rows: 0,
      matchedSymbols: 0,
      unmatchedSymbols: 0,
      failedWindows: 0,
    };
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
      'No matched symbols between backtest tickers and Coinalyze',
    );
  }

  await waitForDbReady();

  const batchDays = asInt(
    process.env.DERIVATIVES_CONTEXT_BACKFILL_BATCH_DAYS,
    30,
  );
  const symbolBatchSize = asInt(
    process.env.DERIVATIVES_CONTEXT_BACKFILL_SYMBOL_BATCH_SIZE,
    8,
  );
  const symbolBatches = chunkArray(matches, symbolBatchSize);
  const windowsPerPair = Math.ceil((safeEndMs - fromMs) / (batchDays * DAY_MS));
  const totalWindows = symbolBatches.length * intervals.length * windowsPerPair;
  const bar = new ProgressBar(
    ':current/:total [:bar][:percent] :eta(s) :batch rows=:rows fail=:fail',
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

  console.log(
    chalk.cyan(
      `derivatives context backfill: symbols=${matches.length}, unmatched=${unmatched.length}, intervals=${intervals.join(',')}`,
    ),
  );

  for (const interval of intervals) {
    for (let batchIdx = 0; batchIdx < symbolBatches.length; batchIdx += 1) {
      const batch = symbolBatches[batchIdx];
      const marketSymbols = batch.map((item) => item.marketSymbol);
      let cursor = fromMs;

      while (cursor < safeEndMs) {
        const toMs = Math.min(safeEndMs, cursor + batchDays * DAY_MS);

        try {
          const oiMap = await fetchMetricBatch({
            endpoint: oiPath,
            metric: 'oi',
            marketSymbols,
            apiKey,
            interval,
            fromMs: cursor,
            toMs,
          });
          const fundingMap = await fetchMetricBatch({
            endpoint: fundingPath,
            metric: 'funding',
            marketSymbols,
            apiKey,
            interval,
            fromMs: cursor,
            toMs,
          });
          const liqMap = await fetchMetricBatch({
            endpoint: liqPath,
            metric: 'liq',
            marketSymbols,
            apiKey,
            interval,
            fromMs: cursor,
            toMs,
          });

          const rows = batch.flatMap((item) => {
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
          });
        }

        cursor = toMs + 1;
      }
    }
  }

  console.log('');
  console.log(
    chalk.green(
      `derivatives context backfill done: rows=${totalRows}, failed_windows=${failedWindows}`,
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
  };
};
