import { refreshSignalBaseContextGateFeatures } from '@tradejs/core/strategies';
import { logger } from '@tradejs/infra/logger';
import { getLatestMarketGlobalContext } from '@tradejs/infra/timescale';
import type { BaseStrategyContextSnapshot, Signal } from '@tradejs/types';

const DEFAULT_MAX_AGE_MS = 36 * 60 * 60_000;
const SOURCE = 'coingecko_global' as const;

let globalMarketContextUnavailable = false;
const globalContextCache = new Map<
  string,
  ReturnType<typeof getLatestMarketGlobalContext>
>();

const parseEnabledFlag = (value: unknown, env: string) => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return env === 'BACKTEST' || env === 'CRON';
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  if (normalized === 'backtest') return env === 'BACKTEST';
  if (normalized === 'live') return env !== 'BACKTEST';
  return false;
};

const asInt = (value: unknown, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

const resolveMaxAgeMs = () =>
  asInt(process.env.COINGECKO_GLOBAL_CONTEXT_MAX_AGE_MS, DEFAULT_MAX_AGE_MS);

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

const toAltLiquidityRegime = (
  change24hPct: number | null,
): NonNullable<
  BaseStrategyContextSnapshot['relative']['btcDominance']
>['altLiquidityRegime'] => {
  if (change24hPct == null) return 'unknown';
  if (change24hPct >= 0.25) return 'btc_favored';
  if (change24hPct <= -0.25) return 'alt_friendly';
  return 'neutral';
};

const getCachedGlobalContext = ({
  timestamp,
  maxAgeMs,
}: {
  timestamp: number;
  maxAgeMs: number;
}) => {
  const key = `${SOURCE}:${timestamp}:${maxAgeMs}`;
  const cached = globalContextCache.get(key);
  if (cached) return cached;

  const promise = getLatestMarketGlobalContext({
    source: SOURCE,
    atMs: timestamp,
    maxAgeMs,
  });
  globalContextCache.set(key, promise);
  return promise;
};

export const isGlobalMarketContextEnabled = (env: string) =>
  parseEnabledFlag(process.env.COINGECKO_GLOBAL_CONTEXT_ENABLED, env);

export const resetGlobalMarketContextRuntimeState = () => {
  globalMarketContextUnavailable = false;
  globalContextCache.clear();
};

export const enrichSignalWithGlobalMarketContext = async (params: {
  signal: Signal;
  env: string;
  enabled?: boolean;
  maxAgeMs?: number;
}): Promise<boolean> => {
  const {
    signal,
    env,
    enabled = isGlobalMarketContextEnabled(env),
    maxAgeMs = resolveMaxAgeMs(),
  } = params;
  if (!enabled || globalMarketContextUnavailable || !hasBaseContext(signal)) {
    return false;
  }

  try {
    const row = await getCachedGlobalContext({
      timestamp: signal.timestamp,
      maxAgeMs,
    });
    if (!row) {
      return false;
    }

    const btcDominanceChange24hPct = toFiniteNumberOrNull(
      row.btcDominanceChange24hPct,
    );
    const baseContext = signal.additionalIndicators.baseContext;
    signal.additionalIndicators = {
      ...signal.additionalIndicators,
      baseContext: {
        ...baseContext,
        relative: {
          ...baseContext.relative,
          btcDominance: {
            source: SOURCE,
            asOfTs: row.ts.getTime(),
            updatedAtTs: row.updatedAt?.getTime?.() ?? null,
            ageMs: row.ageMs,
            stale: row.stale,
            btcDominancePct: toFiniteNumberOrNull(row.btcDominancePct),
            ethDominancePct: toFiniteNumberOrNull(row.ethDominancePct),
            altMarketCapUsd: toFiniteNumberOrNull(row.altMarketCapUsd),
            totalMarketCapUsd: toFiniteNumberOrNull(row.totalMarketCapUsd),
            btcToAltMarketCapRatio: toFiniteNumberOrNull(
              row.btcToAltMarketCapRatio,
            ),
            btcDominanceChange24hPct,
            altLiquidityRegime: row.stale
              ? 'unknown'
              : toAltLiquidityRegime(btcDominanceChange24hPct),
            marketCapChangePct24hUsd: toFiniteNumberOrNull(
              row.marketCapChangePct24hUsd,
            ),
          },
        },
      },
    };
    refreshSignalBaseContextGateFeatures(signal);
    return true;
  } catch (error) {
    globalMarketContextUnavailable = true;
    logger.warn(
      'Global market context disabled after Timescale read failure: %s',
      String(error),
    );
    return false;
  }
};
