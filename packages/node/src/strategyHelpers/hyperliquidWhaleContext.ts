import { intervalToMs } from '@tradejs/core/data';
import { refreshSignalBaseContextGateFeatures } from '@tradejs/core/strategies';
import {
  getHyperliquidWhaleCoverageSeriesRows,
  getHyperliquidWhaleFlowAggregate,
  getHyperliquidWhaleFlowSeriesRows,
  type HyperliquidWhaleCoverageSeriesRow,
  type HyperliquidWhaleFlowAggregate,
  type HyperliquidWhaleFlowSeriesRow,
} from '@tradejs/infra/timescale';
import { logger } from '@tradejs/infra/logger';
import type {
  BaseHyperliquidWhaleFlowContext,
  BaseStrategyContextSnapshot,
  MarketFeatureInterval,
  Signal,
} from '@tradejs/types';
import {
  getHyperliquidPerpUniverseSnapshot,
  getHyperliquidWhaleRegistrySnapshot,
  resolveHyperliquidPerpFromSignalSymbol,
} from '../hyperliquidWhaleUniverse';
import { isMarketContextCancellationError } from './marketContextErrors';

const MAX_CACHE_ENTRIES = 2_048;
const MAX_COVERAGE_SERIES_CACHE_ENTRIES = 20;
const MAX_FLOW_SERIES_CACHE_ENTRIES = 64;
const SERIES_CHUNK_MS = 90 * 24 * 60 * 60_000;
const MAX_SERIES_LOOKBACK_MS = 60 * 60_000;
const DEFAULT_MIN_COVERAGE_PCT = 0.8;
const INTERVAL_MS: Record<MarketFeatureInterval, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
};
const DEFAULT_MAX_AGE_BY_INTERVAL: Record<MarketFeatureInterval, number> = {
  '1m': 2 * 60_000,
  '5m': 10 * 60_000,
  '15m': 30 * 60_000,
  '1h': 2 * 60 * 60_000,
};

let hyperliquidWhaleContextUnavailable = false;
const contextCache = new Map<
  string,
  ReturnType<typeof getHyperliquidWhaleFlowAggregate>
>();
const coverageSeriesCache = new Map<
  string,
  ReturnType<typeof getHyperliquidWhaleCoverageSeriesRows>
>();
const flowSeriesCache = new Map<
  string,
  ReturnType<typeof getHyperliquidWhaleFlowSeriesRows>
>();

const parseEnabledFlag = (value: unknown, env: string) => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return env !== 'TEST';
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  if (normalized === 'backtest') return env === 'BACKTEST';
  if (normalized === 'live') return env !== 'BACKTEST';
  return false;
};

const getMinimumCoveragePct = () => {
  const parsed = Number(process.env.HYPERLIQUID_WHALE_MIN_COVERAGE_PCT);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.min(1, parsed))
    : DEFAULT_MIN_COVERAGE_PCT;
};

const signalIntervalToMarketInterval = (
  value: Signal['interval'],
): MarketFeatureInterval => {
  const normalized = String(value).trim().toLowerCase();
  if (normalized === '1' || normalized === '1m') return '1m';
  if (normalized === '5' || normalized === '5m') return '5m';
  if (normalized === '60' || normalized === '1h') return '1h';
  return '15m';
};

const hasBaseContext = (
  signal: Signal,
): signal is Signal & {
  additionalIndicators: NonNullable<Signal['additionalIndicators']> & {
    baseContext: BaseStrategyContextSnapshot;
  };
} =>
  Boolean(
    signal.additionalIndicators?.baseContext &&
      typeof signal.additionalIndicators.baseContext === 'object' &&
      !Array.isArray(signal.additionalIndicators.baseContext),
  );

const setBoundedCache = (
  key: string,
  value: ReturnType<typeof getHyperliquidWhaleFlowAggregate>,
) => {
  if (contextCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = contextCache.keys().next().value;
    if (oldestKey != null) contextCache.delete(oldestKey);
  }
  contextCache.set(key, value);
  void value.catch(() => contextCache.delete(key));
};

const setBoundedSeriesCache = <T>(
  cache: Map<string, Promise<T>>,
  maxEntries: number,
  key: string,
  value: Promise<T>,
) => {
  if (cache.size >= maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey != null) cache.delete(oldestKey);
  }
  cache.set(key, value);
  void value.catch(() => cache.delete(key));
};

const uniqueAddressCount = (
  rows: HyperliquidWhaleFlowSeriesRow[],
  field:
    | 'whaleAddresses'
    | 'longEntryWhaleAddresses'
    | 'shortEntryWhaleAddresses'
    | 'longExitWhaleAddresses'
    | 'shortExitWhaleAddresses',
) => {
  const addresses = new Set<string>();
  for (const row of rows) {
    for (const address of row[field]) addresses.add(address);
  }
  return addresses.size;
};

const sumFlowField = (
  rows: HyperliquidWhaleFlowSeriesRow[],
  field:
    | 'trades'
    | 'whaleSides'
    | 'buyNotionalUsd'
    | 'sellNotionalUsd'
    | 'positionAwareWhaleSides'
    | 'longEntryNotionalUsd'
    | 'shortEntryNotionalUsd'
    | 'longExitNotionalUsd'
    | 'shortExitNotionalUsd',
) => rows.reduce((sum, row) => sum + row[field], 0);

const sliceSeriesWindow = <T extends { ts: Date }>(
  rows: T[],
  fromMs: number,
  toMs: number,
) => {
  const lowerBound = (timestamp: number) => {
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (rows[middle].ts.getTime() < timestamp) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  return rows.slice(lowerBound(fromMs), lowerBound(toMs));
};

export const aggregateHyperliquidWhaleFlowSeries = (params: {
  symbol: string;
  interval: MarketFeatureInterval;
  decisionTimeMs: number;
  maxAgeMs?: number;
  universeFingerprint: string;
  whaleRegistryFingerprint: string;
  coverageRows: HyperliquidWhaleCoverageSeriesRow[];
  flowRows: HyperliquidWhaleFlowSeriesRow[];
}): HyperliquidWhaleFlowAggregate | null => {
  const intervalMs = INTERVAL_MS[params.interval];
  const windowStartMs = params.decisionTimeMs - intervalMs;
  const coverageRows = sliceSeriesWindow(
    params.coverageRows,
    windowStartMs,
    params.decisionTimeMs,
  );
  const expectedBuckets = Math.ceil(intervalMs / 60_000);
  if (
    coverageRows.length !== expectedBuckets ||
    coverageRows.some((row) => row.coveredWhales <= 0)
  ) {
    return null;
  }

  const flowRows = sliceSeriesWindow(
    params.flowRows,
    windowStartMs,
    params.decisionTimeMs,
  );
  const asOfTs = new Date(
    Math.max(...coverageRows.map((row) => row.ts.getTime())),
  );
  const coveredWhales = Math.min(
    ...coverageRows.map((row) => row.coveredWhales),
  );
  const expectedWhales = Math.max(
    ...coverageRows.map((row) => row.expectedWhales),
  );
  const coveragePct = Math.min(...coverageRows.map((row) => row.coveragePct));
  const trades = sumFlowField(flowRows, 'trades');
  const whaleSides = sumFlowField(flowRows, 'whaleSides');
  const buyNotionalUsd = sumFlowField(flowRows, 'buyNotionalUsd');
  const sellNotionalUsd = sumFlowField(flowRows, 'sellNotionalUsd');
  const positionAwareWhaleSides = sumFlowField(
    flowRows,
    'positionAwareWhaleSides',
  );
  const longEntryNotionalUsd = sumFlowField(flowRows, 'longEntryNotionalUsd');
  const shortEntryNotionalUsd = sumFlowField(flowRows, 'shortEntryNotionalUsd');
  const longExitNotionalUsd = sumFlowField(flowRows, 'longExitNotionalUsd');
  const shortExitNotionalUsd = sumFlowField(flowRows, 'shortExitNotionalUsd');
  const totalNotionalUsd = buyNotionalUsd + sellNotionalUsd;
  const totalEntryNotionalUsd = longEntryNotionalUsd + shortEntryNotionalUsd;
  const ageMs = params.decisionTimeMs - (asOfTs.getTime() + 60_000);

  return {
    symbol: params.symbol,
    interval: params.interval,
    asOfTs,
    windowEndTs: new Date(params.decisionTimeMs),
    trades,
    whaleSides,
    uniqueWhales: uniqueAddressCount(flowRows, 'whaleAddresses'),
    coveredWhales,
    expectedWhales,
    coveragePct,
    buyNotionalUsd,
    sellNotionalUsd,
    netNotionalUsd: buyNotionalUsd - sellNotionalUsd,
    buySharePct:
      totalNotionalUsd > 0 ? buyNotionalUsd / totalNotionalUsd : null,
    positionAwareWhaleSides,
    positionAwarePct: whaleSides > 0 ? positionAwareWhaleSides / whaleSides : 0,
    longEntryWhales: uniqueAddressCount(flowRows, 'longEntryWhaleAddresses'),
    shortEntryWhales: uniqueAddressCount(flowRows, 'shortEntryWhaleAddresses'),
    longExitWhales: uniqueAddressCount(flowRows, 'longExitWhaleAddresses'),
    shortExitWhales: uniqueAddressCount(flowRows, 'shortExitWhaleAddresses'),
    longEntryNotionalUsd,
    shortEntryNotionalUsd,
    longExitNotionalUsd,
    shortExitNotionalUsd,
    entryNetNotionalUsd: longEntryNotionalUsd - shortEntryNotionalUsd,
    entryLongSharePct:
      totalEntryNotionalUsd > 0
        ? longEntryNotionalUsd / totalEntryNotionalUsd
        : null,
    universeFingerprint: params.universeFingerprint,
    whaleRegistryFingerprint: params.whaleRegistryFingerprint,
    source: positionAwareWhaleSides > 0 ? 'hyperliquid_user_fills' : null,
    ageMs,
    stale:
      ageMs < 0 ||
      (params.maxAgeMs != null && Number.isFinite(params.maxAgeMs)
        ? ageMs > params.maxAgeMs
        : false),
  };
};

const loadHyperliquidWhaleFlowAggregateFromSeries = async (params: {
  symbol: string;
  interval: MarketFeatureInterval;
  decisionTimeMs: number;
  maxAgeMs: number;
  universeFingerprint: string;
  whaleRegistryFingerprint: string;
  abortSignal?: AbortSignal;
}) => {
  const chunkStartMs =
    Math.floor(params.decisionTimeMs / SERIES_CHUNK_MS) * SERIES_CHUNK_MS;
  const fromMs = chunkStartMs - MAX_SERIES_LOOKBACK_MS;
  const toMs = chunkStartMs + SERIES_CHUNK_MS;
  const sharedKey = [
    fromMs,
    toMs,
    params.universeFingerprint,
    params.whaleRegistryFingerprint,
  ].join(':');

  let pendingCoverage = coverageSeriesCache.get(sharedKey);
  if (!pendingCoverage) {
    pendingCoverage = getHyperliquidWhaleCoverageSeriesRows({
      fromMs,
      toMs,
      universeFingerprint: params.universeFingerprint,
      whaleRegistryFingerprint: params.whaleRegistryFingerprint,
      ...(params.abortSignal ? { signal: params.abortSignal } : {}),
    });
    setBoundedSeriesCache(
      coverageSeriesCache,
      MAX_COVERAGE_SERIES_CACHE_ENTRIES,
      sharedKey,
      pendingCoverage,
    );
  }

  const flowKey = `${params.symbol}:${sharedKey}`;
  let pendingFlow = flowSeriesCache.get(flowKey);
  if (!pendingFlow) {
    pendingFlow = getHyperliquidWhaleFlowSeriesRows({
      symbol: params.symbol,
      fromMs,
      toMs,
      universeFingerprint: params.universeFingerprint,
      whaleRegistryFingerprint: params.whaleRegistryFingerprint,
      ...(params.abortSignal ? { signal: params.abortSignal } : {}),
    });
    setBoundedSeriesCache(
      flowSeriesCache,
      MAX_FLOW_SERIES_CACHE_ENTRIES,
      flowKey,
      pendingFlow,
    );
  }

  const [coverageRows, flowRows] = await Promise.all([
    pendingCoverage,
    pendingFlow,
  ]);
  return aggregateHyperliquidWhaleFlowSeries({
    ...params,
    coverageRows,
    flowRows,
  });
};

const toBaseHyperliquidWhaleFlowContext = (
  row: HyperliquidWhaleFlowAggregate,
  minimumCoveragePct: number,
): BaseHyperliquidWhaleFlowContext => ({
  source:
    row.positionAwareWhaleSides > 0
      ? 'hyperliquid_user_fills'
      : 'hyperliquid_trades',
  interval: row.interval,
  asOfTs: row.asOfTs.getTime(),
  windowEndTs: row.windowEndTs.getTime(),
  ageMs: row.ageMs,
  stale: row.stale,
  symbol: row.symbol,
  trades: row.trades,
  whaleSides: row.whaleSides,
  uniqueWhales: row.uniqueWhales,
  coveredWhales: row.coveredWhales,
  expectedWhales: row.expectedWhales,
  coveragePct: row.coveragePct,
  coverageSufficient: row.coveragePct >= minimumCoveragePct,
  buyNotionalUsd: row.buyNotionalUsd,
  sellNotionalUsd: row.sellNotionalUsd,
  netNotionalUsd: row.netNotionalUsd,
  buySharePct: row.buySharePct,
  positionAwareWhaleSides: row.positionAwareWhaleSides,
  positionAwarePct: row.positionAwarePct,
  longEntryWhales: row.longEntryWhales,
  shortEntryWhales: row.shortEntryWhales,
  longExitWhales: row.longExitWhales,
  shortExitWhales: row.shortExitWhales,
  longEntryNotionalUsd: row.longEntryNotionalUsd,
  shortEntryNotionalUsd: row.shortEntryNotionalUsd,
  longExitNotionalUsd: row.longExitNotionalUsd,
  shortExitNotionalUsd: row.shortExitNotionalUsd,
  entryNetNotionalUsd: row.entryNetNotionalUsd,
  entryLongSharePct: row.entryLongSharePct,
  universeFingerprint: row.universeFingerprint,
  whaleRegistryFingerprint: row.whaleRegistryFingerprint,
});

export const isHyperliquidWhaleContextEnabled = (env: string) =>
  parseEnabledFlag(process.env.HYPERLIQUID_WHALE_CONTEXT_ENABLED, env);

export const resetHyperliquidWhaleContextRuntimeState = () => {
  hyperliquidWhaleContextUnavailable = false;
  contextCache.clear();
  coverageSeriesCache.clear();
  flowSeriesCache.clear();
};

export const loadHyperliquidWhaleFlowContext = async (params: {
  symbol: Signal['symbol'];
  interval: Signal['interval'];
  timestamp: number;
  env: string;
  enabled?: boolean;
  marketInterval?: MarketFeatureInterval;
  maxAgeMs?: number;
  useSeriesCache?: boolean;
  abortSignal?: AbortSignal;
}): Promise<BaseHyperliquidWhaleFlowContext | null> => {
  if (
    !(params.enabled ?? isHyperliquidWhaleContextEnabled(params.env)) ||
    hyperliquidWhaleContextUnavailable ||
    params.interval == null
  ) {
    return null;
  }

  const symbol = resolveHyperliquidPerpFromSignalSymbol(params.symbol);
  if (!symbol) return null;
  const interval =
    params.marketInterval ?? signalIntervalToMarketInterval(params.interval);
  const decisionTimeMs = params.timestamp + intervalToMs(params.interval);
  const maxAgeMs = params.maxAgeMs ?? DEFAULT_MAX_AGE_BY_INTERVAL[interval];
  const universe = getHyperliquidPerpUniverseSnapshot();
  const whales = getHyperliquidWhaleRegistrySnapshot();
  const minimumCoveragePct = getMinimumCoveragePct();
  const cacheKey = [
    symbol,
    interval,
    decisionTimeMs,
    maxAgeMs,
    universe.fingerprint,
    whales.fingerprint,
    minimumCoveragePct,
  ].join(':');

  try {
    let row: HyperliquidWhaleFlowAggregate | null;
    if (params.useSeriesCache) {
      row = await loadHyperliquidWhaleFlowAggregateFromSeries({
        symbol,
        interval,
        decisionTimeMs,
        maxAgeMs,
        universeFingerprint: universe.fingerprint,
        whaleRegistryFingerprint: whales.fingerprint,
        abortSignal: params.abortSignal,
      });
    } else {
      let pending = contextCache.get(cacheKey);
      if (!pending) {
        pending = getHyperliquidWhaleFlowAggregate({
          symbol,
          interval,
          decisionTimeMs,
          maxAgeMs,
          universeFingerprint: universe.fingerprint,
          whaleRegistryFingerprint: whales.fingerprint,
          ...(params.abortSignal ? { signal: params.abortSignal } : {}),
        });
        setBoundedCache(cacheKey, pending);
      }
      row = await pending;
    }
    if (!row) return null;
    return toBaseHyperliquidWhaleFlowContext(row, minimumCoveragePct);
  } catch (error) {
    if (isMarketContextCancellationError(error, params.abortSignal)) {
      throw error;
    }
    hyperliquidWhaleContextUnavailable = true;
    logger.warn(
      'Hyperliquid whale context disabled after Timescale read failure: %s',
      String(error),
    );
    return null;
  }
};

export const enrichSignalWithHyperliquidWhaleContext = async (params: {
  signal: Signal;
  env: string;
  enabled?: boolean;
  interval?: MarketFeatureInterval;
  maxAgeMs?: number;
  abortSignal?: AbortSignal;
}): Promise<boolean> => {
  const { signal, env } = params;
  if (
    signal.universe === 'tradfi' ||
    signal.interval == null ||
    !hasBaseContext(signal)
  ) {
    return false;
  }

  const hyperliquidWhales = await loadHyperliquidWhaleFlowContext({
    symbol: signal.symbol,
    interval: signal.interval,
    timestamp: signal.timestamp,
    env,
    enabled: params.enabled,
    marketInterval: params.interval,
    maxAgeMs: params.maxAgeMs,
    abortSignal: params.abortSignal,
  });
  if (!hyperliquidWhales) return false;

  const baseContext = signal.additionalIndicators.baseContext;
  signal.additionalIndicators = {
    ...signal.additionalIndicators,
    baseContext: {
      ...baseContext,
      participation: {
        ...baseContext.participation,
        hyperliquidWhales,
      },
    },
  };
  refreshSignalBaseContextGateFeatures(signal);
  return true;
};
