import { intervalToMs } from '@tradejs/core/data';
import { refreshSignalBaseContextGateFeatures } from '@tradejs/core/strategies';
import { getHyperliquidWhaleFlowAggregate } from '@tradejs/infra/timescale';
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

const MAX_CACHE_ENTRIES = 2_048;
const DEFAULT_MIN_COVERAGE_PCT = 0.8;
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
};

export const isHyperliquidWhaleContextEnabled = (env: string) =>
  parseEnabledFlag(process.env.HYPERLIQUID_WHALE_CONTEXT_ENABLED, env);

export const resetHyperliquidWhaleContextRuntimeState = () => {
  hyperliquidWhaleContextUnavailable = false;
  contextCache.clear();
};

export const loadHyperliquidWhaleFlowContext = async (params: {
  symbol: Signal['symbol'];
  interval: Signal['interval'];
  timestamp: number;
  env: string;
  enabled?: boolean;
  marketInterval?: MarketFeatureInterval;
  maxAgeMs?: number;
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
    let pending = contextCache.get(cacheKey);
    if (!pending) {
      pending = getHyperliquidWhaleFlowAggregate({
        symbol,
        interval,
        decisionTimeMs,
        maxAgeMs,
        universeFingerprint: universe.fingerprint,
        whaleRegistryFingerprint: whales.fingerprint,
      });
      setBoundedCache(cacheKey, pending);
    }
    const row = await pending;
    if (!row) return null;

    return {
      source:
        row.positionAwareWhaleSides > 0
          ? 'hyperliquid_user_fills'
          : 'hyperliquid_trades',
      interval,
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
    };
  } catch (error) {
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
