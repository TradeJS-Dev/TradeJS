import 'dotenv/config';
import args from 'args';
import chalk from 'chalk';
import ProgressBar from 'progress';
import _ from 'lodash';
import { ConnectorCreator } from '@tradejs/types';
import { connectors, ConnectorNames } from '@tradejs/connectors';
import {
  coinalyzePointsToRows,
  getLastClosedDerivativesBarStartMs,
  mergeCoinalyzeMetrics,
  normalizeDerivativesIntervals,
  resolveCoinalyzeConfirmedIntradayCoverage,
  toCoinalyzeTimestampMs,
} from '@tradejs/core/indicators';
import { delay } from '@tradejs/core/async';
import { getUserSettings } from '@tradejs/infra/userSettings';
import { getTickers } from '@tradejs/node/cli';
import {
  applyDerivativesMetricCoverage,
  upsertDerivatives,
  waitForDbReady,
} from '@tradejs/infra/timescale';
import type { DerivativesInterval } from '@tradejs/types';

type CoinalyzeMarket = {
  symbol: string;
  symbol_on_exchange: string;
  exchange: string;
  quote_asset: string;
  is_perpetual: boolean;
};

type SymbolMatch = {
  symbol: string;
  marketSymbol: string;
  exchange: string;
};

type CoinalyzeMetric = 'oi' | 'funding' | 'liq';

type CoinalyzeSeriesPoint = Record<string, unknown>;

type CoinalyzeSeriesItem = {
  symbol?: string;
  history?: CoinalyzeSeriesPoint[];
};

const coinalyzeIntervalMap: Record<DerivativesInterval, string> = {
  '15m': '15min',
  '1h': '1hour',
};

args.example(
  'yarn ts-node ./src/scripts/derivativesIngestCoinalyzeAll --days 120 --intervals 15m',
  'Fetch derivatives for all getTickers symbols matched to Coinalyze markets',
);

args.option(['U', 'user'], 'User settings profile name from Redis', 'root');
args.option(['t', 'tickers'], 'Comma-separated include symbols');
args.option(['e', 'exclude'], 'Comma-separated exclude symbols');
args.option(['l', 'tickersLimit'], 'Tickers limit');
args.option(['c', 'chunk'], 'Chunk selector, e.g. 1/4');
args.option(['i', 'intervals'], 'Intervals: 15m,1h', '15m');
args.option(['d', 'days'], 'Lookback in days', 120);
args.option(['b', 'batchDays'], 'Request chunk size in days', 120);
args.option(
  ['E', 'exchangePriority'],
  'Coinalyze exchange priority, comma-separated',
  'A,6,0',
);
args.option(
  ['S', 'symbolBatchSize'],
  'How many symbols to request in one Coinalyze call',
  8,
);
args.option(
  ['w', 'requestDelayMs'],
  'Delay between API requests to smooth rate limit',
  200,
);
args.option(
  ['T', 'requestTimeoutMs'],
  'HTTP request timeout in milliseconds',
  45_000,
);
args.option(['L', 'showTickersList'], 'Print matched symbols only', false);

const flags = args.parse(process.argv);

const asInt = (value: unknown, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseList = (value: unknown) =>
  String(value ?? '')
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);

const coinalyzeBaseUrl =
  process.env.COINALYZE_BASE_URL?.trim() || 'https://api.coinalyze.net/v1';
const coinalyzeMaxRetries = asInt(process.env.COINALYZE_MAX_RETRIES, 4);
let lastRequestTs = 0;

const fetchJsonWithRateLimit = async (url: string, apiKey: string) => {
  const requestDelayMs = Math.max(100, asInt(flags.requestDelayMs, 200));
  const requestTimeoutMs = Math.max(
    5_000,
    asInt(flags.requestTimeoutMs, 45_000),
  );

  for (let attempt = 0; attempt <= coinalyzeMaxRetries; attempt += 1) {
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
      if (attempt < coinalyzeMaxRetries && abortError) {
        const backoffMs = Math.min(12_000, 800 * 2 ** attempt);
        await delay(backoffMs);
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

    if (attempt < coinalyzeMaxRetries && transient) {
      const backoffMs = Math.min(12_000, 800 * 2 ** attempt);
      await delay(retryAfterMs ?? backoffMs);
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
    `${coinalyzeBaseUrl}/future-markets`,
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

  const url = new URL(`${coinalyzeBaseUrl}${endpoint}`);
  url.searchParams.set('symbols', marketSymbols.join(','));
  url.searchParams.set('interval', coinalyzeIntervalMap[interval] || interval);
  url.searchParams.set('from', String(Math.floor(fromMs / 1000)));
  url.searchParams.set('to', String(Math.floor(toMs / 1000)));

  const raw = await fetchJsonWithRateLimit(url.toString(), apiKey);
  return toSeriesMap(raw, metric);
};

export const main = async () => {
  const userName = String(flags.user || 'root').trim() || 'root';
  const intervals = normalizeDerivativesIntervals(
    flags.intervals,
  ) as DerivativesInterval[];
  const days = asInt(flags.days, 120);
  const batchDays = asInt(flags.batchDays, 120);
  const symbolBatchSize = asInt(flags.symbolBatchSize, 25);
  const tickersLimit =
    flags.tickersLimit !== undefined
      ? asInt(flags.tickersLimit, 0) || undefined
      : undefined;
  const exchangePriority = parseList(flags.exchangePriority || 'A,6,0');

  if (!intervals.length) throw new Error('No intervals provided');

  const settings = await getUserSettings(userName);
  const coinalyzeApiKey = settings.COINALYZE_API_KEY.trim();
  if (!coinalyzeApiKey) {
    throw new Error(
      `Missing COINALYZE_API_KEY in user settings for user ${userName}`,
    );
  }

  const connectorFactory = connectors[ConnectorNames.ByBit] as ConnectorCreator;
  const bybit = await connectorFactory({
    userName,
  });
  const tickers = await getTickers(
    bybit,
    String(flags.tickers || ''),
    String(flags.exclude || ''),
    tickersLimit,
    String(flags.chunk || ''),
  );
  if (!tickers.length) {
    throw new Error('No tickers loaded via getTickers');
  }

  const markets = await fetchCoinalyzeMarkets(coinalyzeApiKey);
  if (!markets.length) {
    throw new Error('No markets returned by Coinalyze /future-markets');
  }

  const { matches, unmatched } = buildMatches(
    tickers,
    markets,
    exchangePriority,
  );
  if (!matches.length) {
    throw new Error('No matched symbols between getTickers and Coinalyze');
  }

  console.log(
    chalk.cyan(
      `Tickers=${tickers.length}, matched=${matches.length}, unmatched=${unmatched.length}, intervals=${intervals.join(',')}, symbolBatch=${symbolBatchSize}`,
    ),
  );
  if (unmatched.length) {
    console.log(
      chalk.yellow(
        `Unmatched sample (${Math.min(20, unmatched.length)}): ${unmatched
          .slice(0, 20)
          .join(', ')}`,
      ),
    );
  }

  if (flags.showTickersList) {
    console.log(
      JSON.stringify(
        matches.map((item) => ({
          symbol: item.symbol,
          coinalyze: item.marketSymbol,
          exchange: item.exchange,
        })),
        null,
        2,
      ),
    );
    return;
  }

  await waitForDbReady();

  const now = Date.now();
  const fromMs = now - days * 24 * 60 * 60 * 1000;
  const symbolBatches = _.chunk(matches, symbolBatchSize);
  const windowsPerPair = Math.ceil(days / batchDays);
  const totalWindows = symbolBatches.length * intervals.length * windowsPerPair;
  const bar = new ProgressBar(
    ':current/:total [:bar][:percent] :eta(s) :batch rows=:rows fail=:fail',
    {
      total: Math.max(1, totalWindows),
      width: 30,
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

  for (const interval of intervals) {
    const lastClosedStartMs = getLastClosedDerivativesBarStartMs(now, interval);
    for (let batchIdx = 0; batchIdx < symbolBatches.length; batchIdx += 1) {
      const batch = symbolBatches[batchIdx];
      const marketSymbols = batch.map((item) => item.marketSymbol);
      let cursor = fromMs;

      while (cursor < lastClosedStartMs) {
        const toMs = Math.min(
          lastClosedStartMs,
          cursor + batchDays * 24 * 60 * 60 * 1000,
        );

        try {
          const oiMap = await fetchMetricBatch({
            endpoint: oiPath,
            metric: 'oi',
            marketSymbols,
            apiKey: coinalyzeApiKey,
            interval,
            fromMs: cursor,
            toMs,
          });
          const fundingMap = await fetchMetricBatch({
            endpoint: fundingPath,
            metric: 'funding',
            marketSymbols,
            apiKey: coinalyzeApiKey,
            interval,
            fromMs: cursor,
            toMs,
          });
          const liqMap = await fetchMetricBatch({
            endpoint: liqPath,
            metric: 'liq',
            marketSymbols,
            apiKey: coinalyzeApiKey,
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
          const confirmedLiquidationWindow =
            resolveCoinalyzeConfirmedIntradayCoverage({
              interval,
              fromMs: cursor,
              toMs,
              nowMs: now,
            });
          if (confirmedLiquidationWindow) {
            await applyDerivativesMetricCoverage(
              batch.map((item) => {
                const marketSymbol = item.marketSymbol.toUpperCase();
                const eventRowsCount = (liqMap.get(marketSymbol) ?? []).filter(
                  (point) => {
                    const timestamp = toCoinalyzeTimestampMs(
                      point.t ?? point.ts ?? point.time ?? point.timestamp,
                    );
                    return (
                      timestamp != null &&
                      timestamp >= confirmedLiquidationWindow.fromMs &&
                      timestamp <= confirmedLiquidationWindow.toMs
                    );
                  },
                ).length;
                return {
                  source: 'coinalyze' as const,
                  metric: 'liquidation' as const,
                  symbol: item.symbol,
                  interval,
                  fromMs: confirmedLiquidationWindow.fromMs,
                  toMs: confirmedLiquidationWindow.toMs,
                  eventRowsCount,
                };
              }),
            );
          }
        } catch (error) {
          failedWindows += 1;
          console.error(
            chalk.red(
              `batch window failed batch=${batchIdx + 1}/${symbolBatches.length} interval=${interval} ${new Date(cursor).toISOString()}..${new Date(toMs).toISOString()}: ${error}`,
            ),
          );
        } finally {
          bar.tick(1, {
            batch: chalk.gray(
              `${batchIdx + 1}/${symbolBatches.length} ${interval} (${batch.length} symbols)`,
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
      `Done. symbols=${matches.length} intervals=${intervals.join(',')} rows=${totalRows} failed_windows=${failedWindows}`,
    ),
  );

  if (failedWindows > 0) {
    process.exit(1);
  }
};
