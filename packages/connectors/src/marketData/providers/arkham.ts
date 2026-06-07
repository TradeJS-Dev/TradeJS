import { delay } from '@tradejs/core/async';
import type { MarketFeatureInterval, OnchainFlowRow } from '@tradejs/types';

export type ArkhamOnchainWindowParams = {
  symbol: string;
  tokenId?: string;
  apiKey?: string;
  interval: MarketFeatureInterval;
  fromMs: number;
  toMs: number;
  chains?: string[];
  cexEntities?: string[];
  smartEntities?: string[];
  whaleEntities?: string[];
  dexBases?: string[];
  usdGte?: number | null;
  topFlowLimit?: number | null;
  includeRecentTopFlow?: boolean;
};

type ArkhamHistogramPoint = {
  time?: unknown;
  count?: unknown;
  usd?: unknown;
};

type ArkhamTopFlowPoint = {
  inUSD?: unknown;
  outUSD?: unknown;
};

type ArkhamSwapPoint = {
  historicalUSD?: unknown;
};

type ArkhamSwapsResponse = {
  swaps?: unknown;
};

const DEFAULT_SYMBOL_TOKEN_IDS: Record<string, string> = {
  BTCUSDT: 'bitcoin',
  BTCUSD: 'bitcoin',
  ETHUSDT: 'ethereum',
  ETHUSD: 'ethereum',
  SOLUSDT: 'solana',
  SOLUSD: 'solana',
  BNBUSDT: 'binancecoin',
  XRPUSDT: 'ripple',
  ADAUSDT: 'cardano',
  DOGEUSDT: 'dogecoin',
  AVAXUSDT: 'avalanche-2',
  LINKUSDT: 'chainlink',
  MATICUSDT: 'matic-network',
  POLUSDT: 'polygon-ecosystem-token',
  TONUSDT: 'the-open-network',
};

const intervalTimeLast: Record<MarketFeatureInterval, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
};

const arkhamMinRequestDelayMs = Number(
  process.env.ARKHAM_MIN_REQUEST_DELAY_MS ?? 1100,
);
const arkhamMaxRetries = Number(process.env.ARKHAM_MAX_RETRIES ?? 4);
let lastRequestTs = 0;
let requestQueue = Promise.resolve();

const toFiniteNumberOrNull = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeSymbol = (symbol: string) =>
  String(symbol || '')
    .trim()
    .toUpperCase();

const normalizeList = (items: unknown): string[] => {
  const raw = Array.isArray(items)
    ? items
    : String(items ?? '')
        .split(',')
        .map((item) => item.trim());
  return [...new Set(raw.map((item) => String(item).trim()).filter(Boolean))];
};

export const parseArkhamSymbolTokenIds = (
  value: unknown,
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const item of normalizeList(value)) {
    const [symbol, tokenId] = item.split('=').map((part) => part.trim());
    if (!symbol || !tokenId) continue;
    out[normalizeSymbol(symbol)] = tokenId;
  }
  return out;
};

export const resolveArkhamTokenId = (
  symbol: string,
  overrides?: Record<string, string>,
) => {
  const normalizedSymbol = normalizeSymbol(symbol);
  return (
    overrides?.[normalizedSymbol] ??
    DEFAULT_SYMBOL_TOKEN_IDS[normalizedSymbol] ??
    normalizedSymbol.replace(/(USDT|USD|USDC|PERP)$/u, '').toLowerCase()
  );
};

const getArkhamBaseUrl = () =>
  process.env.ARKHAM_BASE_URL?.trim() || 'https://api.arkm.com';

const appendArrayParams = (url: URL, key: string, values?: string[]) => {
  for (const value of values ?? []) {
    if (value) url.searchParams.append(key, value);
  }
};

const sumUsd = (raw: unknown) => {
  if (!Array.isArray(raw)) return 0;
  return raw.reduce((sum, point) => {
    const value = toFiniteNumberOrNull((point as ArkhamHistogramPoint)?.usd);
    return sum + (value ?? 0);
  }, 0);
};

const sumTopFlowNetUsd = (raw: unknown) => {
  if (!Array.isArray(raw)) return null;
  let total = 0;
  let points = 0;
  for (const item of raw as ArkhamTopFlowPoint[]) {
    const inUsd = toFiniteNumberOrNull(item?.inUSD) ?? 0;
    const outUsd = toFiniteNumberOrNull(item?.outUSD) ?? 0;
    total += inUsd - outUsd;
    points += 1;
  }
  return points > 0 ? total : null;
};

const sumSwapsUsd = (raw: unknown) => {
  const swaps = Array.isArray((raw as ArkhamSwapsResponse)?.swaps)
    ? ((raw as ArkhamSwapsResponse).swaps as ArkhamSwapPoint[])
    : Array.isArray(raw)
      ? (raw as ArkhamSwapPoint[])
      : [];
  return swaps.reduce((sum, swap) => {
    const value = toFiniteNumberOrNull(swap?.historicalUSD);
    return sum + (value ?? 0);
  }, 0);
};

const waitForRateLimit = async () => {
  const now = Date.now();
  const waitMs = Math.max(0, lastRequestTs + arkhamMinRequestDelayMs - now);
  if (waitMs > 0) await delay(waitMs);
  lastRequestTs = Date.now();
};

const withRateLimit = async <T>(work: () => Promise<T>) => {
  const queued = requestQueue.then(async () => {
    await waitForRateLimit();
    return work();
  });
  requestQueue = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
};

const fetchArkhamJson = async (url: URL, apiKey: string) => {
  for (let attempt = 0; attempt <= arkhamMaxRetries; attempt += 1) {
    const response = await withRateLimit(() =>
      fetch(url.toString(), {
        headers: {
          'API-Key': apiKey,
        },
      }),
    );
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
    if (attempt < arkhamMaxRetries && transient) {
      await delay(retryAfterMs ?? Math.min(10_000, 750 * 2 ** attempt));
      continue;
    }
    throw new Error(`Arkham ${url.pathname} ${response.status}: ${text}`);
  }
  return null;
};

const fetchHistogramUsd = async (params: {
  apiKey: string;
  tokenId: string;
  fromMs: number;
  toMs: number;
  chains: string[];
  usdGte?: number | null;
  base?: string;
  from?: string;
  to?: string;
  flow?: 'in' | 'out' | 'self' | 'all';
}) => {
  const url = new URL(`${getArkhamBaseUrl()}/transfers/histogram`);
  url.searchParams.set('granularity', '1h');
  url.searchParams.set('timeGte', new Date(params.fromMs).toISOString());
  url.searchParams.set('timeLte', new Date(params.toMs).toISOString());
  appendArrayParams(url, 'tokens', [params.tokenId]);
  appendArrayParams(url, 'chains', params.chains);
  if (params.usdGte != null && Number.isFinite(params.usdGte)) {
    url.searchParams.set('usdGte', String(params.usdGte));
  }
  if (params.base) appendArrayParams(url, 'base', [params.base]);
  if (params.from) appendArrayParams(url, 'from', [params.from]);
  if (params.to) appendArrayParams(url, 'to', [params.to]);
  if (params.flow) url.searchParams.set('flow', params.flow);
  const raw = await fetchArkhamJson(url, params.apiKey);
  return sumUsd(raw);
};

const fetchTopFlowNetUsd = async (params: {
  apiKey: string;
  tokenId: string;
  interval: MarketFeatureInterval;
  chains: string[];
  limit: number;
}) => {
  const url = new URL(
    `${getArkhamBaseUrl()}/token/top_flow/${encodeURIComponent(params.tokenId)}`,
  );
  url.searchParams.set('timeLast', intervalTimeLast[params.interval]);
  url.searchParams.set('limit', String(params.limit));
  appendArrayParams(url, 'chains', params.chains);
  const raw = await fetchArkhamJson(url, params.apiKey);
  return sumTopFlowNetUsd(raw);
};

const fetchSwapsUsd = async (params: {
  apiKey: string;
  tokenId: string;
  fromMs: number;
  toMs: number;
  chains: string[];
  bases: string[];
  flow: 'in' | 'out';
  usdGte?: number | null;
}) => {
  if (!params.bases.length) return null;
  let total = 0;
  for (const base of params.bases) {
    const url = new URL(`${getArkhamBaseUrl()}/swaps`);
    appendArrayParams(url, 'base', [base]);
    appendArrayParams(url, 'tokens', [params.tokenId]);
    appendArrayParams(url, 'chains', params.chains);
    url.searchParams.set('flow', params.flow);
    url.searchParams.set('timeGte', new Date(params.fromMs).toISOString());
    url.searchParams.set('timeLte', new Date(params.toMs).toISOString());
    url.searchParams.set('sortKey', 'time');
    url.searchParams.set('sortDir', 'asc');
    url.searchParams.set('limit', '100');
    if (params.usdGte != null && Number.isFinite(params.usdGte)) {
      url.searchParams.set('usdGte', String(params.usdGte));
    }
    const raw = await fetchArkhamJson(url, params.apiKey);
    total += sumSwapsUsd(raw);
  }
  return total;
};

const fetchEntityNetFlowUsd = async (params: {
  apiKey: string;
  tokenId: string;
  fromMs: number;
  toMs: number;
  chains: string[];
  entities: string[];
  usdGte?: number | null;
}) => {
  if (!params.entities.length) return null;
  let total = 0;
  for (const entity of params.entities) {
    const inUsd = await fetchHistogramUsd({
      ...params,
      base: entity,
      flow: 'in',
    });
    const outUsd = await fetchHistogramUsd({
      ...params,
      base: entity,
      flow: 'out',
    });
    total += inUsd - outUsd;
  }
  return total;
};

const calculateConfidenceWeightedBias = (parts: Array<number | null>) => {
  let directional = 0;
  let magnitude = 0;
  for (const value of parts) {
    if (value == null || !Number.isFinite(value)) continue;
    directional += value;
    magnitude += Math.abs(value);
  }
  if (magnitude <= 0) return null;
  return Math.max(-1, Math.min(1, directional / magnitude));
};

export const fetchArkhamOnchainWindow = async (
  params: ArkhamOnchainWindowParams,
): Promise<OnchainFlowRow[]> => {
  const apiKey = params.apiKey?.trim();
  if (!apiKey) {
    throw new Error('Missing ARKHAM_API_KEY in user settings or env');
  }

  const symbol = normalizeSymbol(params.symbol);
  const tokenId = (params.tokenId || resolveArkhamTokenId(symbol)).trim();
  const chains = normalizeList(params.chains);
  const cexEntities = normalizeList(params.cexEntities);
  const smartEntities = normalizeList(params.smartEntities);
  const whaleEntities = normalizeList(params.whaleEntities);
  const dexBases = normalizeList(params.dexBases);
  const usdGte = params.usdGte ?? null;

  const [cexDepositUsd, cexWithdrawUsd, smartTraderNetFlowUsd, whaleEntityNet] =
    await Promise.all([
      fetchHistogramUsd({
        apiKey,
        tokenId,
        fromMs: params.fromMs,
        toMs: params.toMs,
        chains,
        usdGte,
        to: cexEntities.length ? cexEntities.join(',') : 'type:cex',
      }),
      fetchHistogramUsd({
        apiKey,
        tokenId,
        fromMs: params.fromMs,
        toMs: params.toMs,
        chains,
        usdGte,
        from: cexEntities.length ? cexEntities.join(',') : 'type:cex',
      }),
      fetchEntityNetFlowUsd({
        apiKey,
        tokenId,
        fromMs: params.fromMs,
        toMs: params.toMs,
        chains,
        entities: smartEntities,
        usdGte,
      }),
      fetchEntityNetFlowUsd({
        apiKey,
        tokenId,
        fromMs: params.fromMs,
        toMs: params.toMs,
        chains,
        entities: whaleEntities,
        usdGte,
      }),
    ]);

  const topFlowNet =
    params.includeRecentTopFlow === true
      ? await fetchTopFlowNetUsd({
          apiKey,
          tokenId,
          interval: params.interval,
          chains,
          limit: Math.max(1, Math.trunc(params.topFlowLimit ?? 10)),
        })
      : null;
  const [dexBuyUsd, dexSellUsd] = await Promise.all([
    fetchSwapsUsd({
      apiKey,
      tokenId,
      fromMs: params.fromMs,
      toMs: params.toMs,
      chains,
      bases: dexBases,
      flow: 'in',
      usdGte,
    }),
    fetchSwapsUsd({
      apiKey,
      tokenId,
      fromMs: params.fromMs,
      toMs: params.toMs,
      chains,
      bases: dexBases,
      flow: 'out',
      usdGte,
    }),
  ]);
  const whaleNetFlowUsd = whaleEntityNet ?? topFlowNet;
  const cexNetFlowUsd = cexWithdrawUsd - cexDepositUsd;
  const dexNetBuyUsd =
    dexBuyUsd != null || dexSellUsd != null
      ? (dexBuyUsd ?? 0) - (dexSellUsd ?? 0)
      : null;

  return [
    {
      symbol,
      interval: params.interval,
      ts: new Date(params.toMs),
      whaleNetFlowUsd,
      smartTraderNetFlowUsd,
      cexDepositUsd,
      cexWithdrawUsd,
      dexBuyUsd,
      dexSellUsd,
      entityCount:
        smartEntities.length + whaleEntities.length + dexBases.length || null,
      confidenceWeightedBias: calculateConfidenceWeightedBias([
        whaleNetFlowUsd,
        smartTraderNetFlowUsd,
        cexNetFlowUsd,
        dexNetBuyUsd,
      ]),
      source: 'arkham',
    },
  ];
};
