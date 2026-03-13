import { delay } from '@tradejs/core/async';
import {
  coinalyzePointsToRows,
  mergeCoinalyzeMetrics,
} from '@tradejs/core/indicators';
import { DerivativesInterval } from '@tradejs/infra';
import { MarketDataProvider } from './types';

type CoinalyzeMetric = 'oi' | 'funding' | 'liq';

const coinalyzeIntervalMap: Record<DerivativesInterval, string> = {
  '15m': '15min',
  '1h': '1hour',
};
const coinalyzeMinRequestDelayMs = Number(
  process.env.COINALYZE_MIN_REQUEST_DELAY_MS ?? 300,
);
const coinalyzeMaxRetries = Number(process.env.COINALYZE_MAX_RETRIES ?? 4);
let lastRequestTs = 0;

const flattenCoinalyzeHistory = (
  raw: unknown,
): Array<Record<string, unknown>> => {
  if (!Array.isArray(raw)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const history = (item as { history?: unknown }).history;
    if (Array.isArray(history)) {
      for (const point of history) {
        if (point && typeof point === 'object') {
          out.push(point as Record<string, unknown>);
        }
      }
      continue;
    }
    out.push(item as Record<string, unknown>);
  }
  return out;
};

const normalizeMetricPayload = (
  metric: CoinalyzeMetric,
  raw: unknown,
): Array<Record<string, unknown>> => {
  const points = flattenCoinalyzeHistory(raw);
  if (!points.length) return [];

  if (metric === 'oi') {
    return points.map((point) => ({
      ...point,
      open_interest:
        point.open_interest ?? point.openInterest ?? point.oi ?? point.c,
    }));
  }

  if (metric === 'funding') {
    return points.map((point) => ({
      ...point,
      funding_rate:
        point.funding_rate ?? point.fundingRate ?? point.rate ?? point.c,
    }));
  }

  return points.map((point) => ({
    ...point,
    liq_long: point.liq_long ?? point.long_liq ?? point.long ?? point.l,
    liq_short: point.liq_short ?? point.short_liq ?? point.short ?? point.s,
  }));
};

const fetchCoinalyzeSeries = async (params: {
  endpoint: string;
  metric: CoinalyzeMetric;
  symbol: string;
  interval: DerivativesInterval;
  fromMs: number;
  toMs: number;
}) => {
  const { endpoint, metric, symbol, interval, fromMs, toMs } = params;
  const baseUrl =
    process.env.COINALYZE_BASE_URL?.trim() || 'https://api.coinalyze.net/v1';
  const apiKey = process.env.COINALYZE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Missing COINALYZE_API_KEY');
  }
  const url = new URL(`${baseUrl}${endpoint}`);
  url.searchParams.set('symbols', symbol);
  url.searchParams.set('interval', coinalyzeIntervalMap[interval] || interval);
  url.searchParams.set('from', String(Math.floor(fromMs / 1000)));
  url.searchParams.set('to', String(Math.floor(toMs / 1000)));
  const headers = {
    api_key: apiKey,
    'x-api-key': apiKey,
    Authorization: `Bearer ${apiKey}`,
  };

  for (let attempt = 0; attempt <= coinalyzeMaxRetries; attempt += 1) {
    const now = Date.now();
    const waitMs = Math.max(
      0,
      lastRequestTs + coinalyzeMinRequestDelayMs - now,
    );
    if (waitMs > 0) {
      await delay(waitMs);
    }
    lastRequestTs = Date.now();

    const response = await fetch(url.toString(), { headers });
    if (response.ok) {
      const raw = await response.json();
      return normalizeMetricPayload(metric, raw);
    }

    const text = await response.text();
    const retryAfterRaw = Number(response.headers.get('retry-after') ?? '');
    const retryAfterMs =
      Number.isFinite(retryAfterRaw) && retryAfterRaw > 0
        ? retryAfterRaw * 1000
        : null;
    const transient = response.status === 429 || response.status >= 500;
    if (attempt < coinalyzeMaxRetries && transient) {
      const backoffMs = Math.min(10_000, 750 * 2 ** attempt);
      await delay(retryAfterMs ?? backoffMs);
      continue;
    }
    throw new Error(`Coinalyze ${endpoint} ${response.status}: ${text}`);
  }
  return [];
};

export const coinalyzeProvider: MarketDataProvider = {
  name: 'coinalyze',
  fetchWindow: async ({ symbol, marketSymbol, interval, fromMs, toMs }) => {
    const oiPath =
      process.env.COINALYZE_OI_PATH?.trim() || '/open-interest-history';
    const fundingPath =
      process.env.COINALYZE_FUNDING_PATH?.trim() || '/funding-rate-history';
    const liqPath =
      process.env.COINALYZE_LIQ_PATH?.trim() || '/liquidation-history';
    const requestSymbol = (marketSymbol || symbol).trim().toUpperCase();

    const oiRaw = await fetchCoinalyzeSeries({
      endpoint: oiPath,
      metric: 'oi',
      symbol: requestSymbol,
      interval,
      fromMs,
      toMs,
    });
    const fundingRaw = await fetchCoinalyzeSeries({
      endpoint: fundingPath,
      metric: 'funding',
      symbol: requestSymbol,
      interval,
      fromMs,
      toMs,
    });
    const liqRaw = await fetchCoinalyzeSeries({
      endpoint: liqPath,
      metric: 'liq',
      symbol: requestSymbol,
      interval,
      fromMs,
      toMs,
    });

    const points = mergeCoinalyzeMetrics({
      symbol,
      oiRaw,
      fundingRaw,
      liqRaw,
    });

    return {
      derivativesRows: coinalyzePointsToRows(points, interval, 'coinalyze'),
    };
  },
};
