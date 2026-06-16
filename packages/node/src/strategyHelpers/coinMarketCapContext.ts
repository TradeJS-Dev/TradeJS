import { refreshSignalBaseContextGateFeatures } from '@tradejs/core/strategies';
import { logger } from '@tradejs/infra/logger';
import {
  getLatestMarketCmcExchangeLiquidityContext,
  getLatestMarketCmcFearGreedContext,
  getLatestMarketGlobalContext,
  getLatestMarketReferenceAssetContexts,
} from '@tradejs/infra/timescale';
import type { BaseStrategyContextSnapshot, Signal } from '@tradejs/types';

const DEFAULT_MAX_AGE_MS = 48 * 60 * 60_000;
const SOURCE_GLOBAL_DAILY = 'coinmarketcap_global' as const;
const SOURCE_REFERENCE = 'coinmarketcap_reference_asset' as const;
const SOURCE_EXCHANGE_LIQUIDITY = 'coinmarketcap_exchange_liquidity' as const;
const SOURCE_FEAR_GREED = 'coinmarketcap_fear_greed' as const;
const DAY_MS = 86_400_000;

let coinMarketCapContextUnavailable = false;
const globalContextCache = new Map<
  string,
  ReturnType<typeof getLatestMarketGlobalContext>
>();
const referenceContextCache = new Map<
  string,
  ReturnType<typeof getLatestMarketReferenceAssetContexts>
>();
const exchangeLiquidityContextCache = new Map<
  string,
  ReturnType<typeof getLatestMarketCmcExchangeLiquidityContext>
>();
const fearGreedContextCache = new Map<
  string,
  ReturnType<typeof getLatestMarketCmcFearGreedContext>
>();

const parseEnabledFlag = (value: unknown, env: string) => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return env === 'BACKTEST' || env === 'PARITY' || env === 'CRON';
  }
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

const safeDivide = (numerator: number | null, denominator: number | null) =>
  numerator != null && denominator != null && denominator > 0
    ? numerator / denominator
    : null;

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

const resolveMaxAgeMs = () =>
  asInt(process.env.COINMARKETCAP_CONTEXT_MAX_AGE_MS, DEFAULT_MAX_AGE_MS);

const toAltLiquidityRegime = ({
  stale,
  btcDominanceChange24hPct,
  altMarketCapChange24hPct,
  altVolumeChange24hPct,
}: {
  stale: boolean;
  btcDominanceChange24hPct: number | null;
  altMarketCapChange24hPct: number | null;
  altVolumeChange24hPct: number | null;
}): NonNullable<
  BaseStrategyContextSnapshot['relative']['cmcGlobal']
>['altLiquidityRegime'] => {
  if (stale) return 'unknown';
  if (
    (altMarketCapChange24hPct != null && altMarketCapChange24hPct <= -0.03) ||
    (altVolumeChange24hPct != null && altVolumeChange24hPct <= -0.15)
  ) {
    return 'risk_off';
  }
  if (btcDominanceChange24hPct != null && btcDominanceChange24hPct >= 0.25) {
    return 'btc_favored';
  }
  if (
    btcDominanceChange24hPct != null &&
    btcDominanceChange24hPct <= -0.25 &&
    (altMarketCapChange24hPct == null || altMarketCapChange24hPct >= 0)
  ) {
    return 'alt_friendly';
  }
  return 'neutral';
};

const toReferenceLiquidityRegime = ({
  stale,
  ethBtcMarketCapRatioChange24hPct,
  ethVsBtcVolumeRatio,
}: {
  stale: boolean;
  ethBtcMarketCapRatioChange24hPct: number | null;
  ethVsBtcVolumeRatio: number | null;
}): NonNullable<
  BaseStrategyContextSnapshot['relative']['cmcReferenceAssets']
>['referenceLiquidityRegime'] => {
  if (stale) return 'unknown';
  if (ethVsBtcVolumeRatio != null && ethVsBtcVolumeRatio < 0.15) return 'thin';
  if (
    ethBtcMarketCapRatioChange24hPct != null &&
    ethBtcMarketCapRatioChange24hPct >= 0.01
  ) {
    return 'eth_led';
  }
  if (
    ethBtcMarketCapRatioChange24hPct != null &&
    ethBtcMarketCapRatioChange24hPct <= -0.01
  ) {
    return 'btc_led';
  }
  return 'balanced';
};

const toExchangeLiquidityRegime = ({
  stale,
  totalVolumeChange24hPct,
  fallback,
}: {
  stale: boolean;
  totalVolumeChange24hPct: number | null;
  fallback: NonNullable<
    BaseStrategyContextSnapshot['relative']['cmcExchangeLiquidity']
  >['liquidityRegime'];
}): NonNullable<
  BaseStrategyContextSnapshot['relative']['cmcExchangeLiquidity']
>['liquidityRegime'] => {
  if (stale) return 'unknown';
  if (totalVolumeChange24hPct != null && totalVolumeChange24hPct >= 0.15) {
    return 'expanding';
  }
  if (totalVolumeChange24hPct != null && totalVolumeChange24hPct <= -0.15) {
    return 'contracting';
  }
  return fallback;
};

const getCachedGlobalContext = ({
  timestamp,
  maxAgeMs,
}: {
  timestamp: number;
  maxAgeMs: number;
}) => {
  const key = `${SOURCE_GLOBAL_DAILY}:${timestamp}:${maxAgeMs}`;
  const cached = globalContextCache.get(key);
  if (cached) return cached;

  const promise = getLatestMarketGlobalContext({
    source: SOURCE_GLOBAL_DAILY,
    atMs: timestamp,
    maxAgeMs,
  });
  globalContextCache.set(key, promise);
  return promise;
};

const getCachedReferenceContexts = ({
  timestamp,
  maxAgeMs,
}: {
  timestamp: number;
  maxAgeMs: number;
}) => {
  const key = `${SOURCE_REFERENCE}:1d:${timestamp}:${maxAgeMs}`;
  const cached = referenceContextCache.get(key);
  if (cached) return cached;

  const promise = getLatestMarketReferenceAssetContexts({
    source: SOURCE_REFERENCE,
    symbols: ['BTCUSDT', 'ETHUSDT'],
    interval: '1d',
    atMs: timestamp,
    maxAgeMs,
  });
  referenceContextCache.set(key, promise);
  return promise;
};

const getCachedExchangeLiquidityContext = ({
  timestamp,
  maxAgeMs,
}: {
  timestamp: number;
  maxAgeMs: number;
}) => {
  const key = `${SOURCE_EXCHANGE_LIQUIDITY}:1d:${timestamp}:${maxAgeMs}`;
  const cached = exchangeLiquidityContextCache.get(key);
  if (cached) return cached;

  const promise = getLatestMarketCmcExchangeLiquidityContext({
    source: SOURCE_EXCHANGE_LIQUIDITY,
    interval: '1d',
    atMs: timestamp,
    maxAgeMs,
  });
  exchangeLiquidityContextCache.set(key, promise);
  return promise;
};

const getCachedFearGreedContext = ({
  timestamp,
  maxAgeMs,
}: {
  timestamp: number;
  maxAgeMs: number;
}) => {
  const key = `${SOURCE_FEAR_GREED}:1d:${timestamp}:${maxAgeMs}`;
  const cached = fearGreedContextCache.get(key);
  if (cached) return cached;

  const promise = getLatestMarketCmcFearGreedContext({
    source: SOURCE_FEAR_GREED,
    interval: '1d',
    atMs: timestamp,
    maxAgeMs,
  });
  fearGreedContextCache.set(key, promise);
  return promise;
};

export const isCoinMarketCapContextEnabled = (env: string) =>
  parseEnabledFlag(process.env.COINMARKETCAP_CONTEXT_ENABLED, env);

export const resetCoinMarketCapContextRuntimeState = () => {
  coinMarketCapContextUnavailable = false;
  globalContextCache.clear();
  referenceContextCache.clear();
  exchangeLiquidityContextCache.clear();
  fearGreedContextCache.clear();
};

export const enrichSignalWithCoinMarketCapContext = async (params: {
  signal: Signal;
  env: string;
  enabled?: boolean;
  maxAgeMs?: number;
}): Promise<boolean> => {
  const {
    signal,
    env,
    enabled = isCoinMarketCapContextEnabled(env),
    maxAgeMs = resolveMaxAgeMs(),
  } = params;
  if (!enabled || coinMarketCapContextUnavailable || !hasBaseContext(signal)) {
    return false;
  }

  try {
    const [
      globalDailyRow,
      dailyReferences,
      previousDailyReferences,
      exchangeLiquidityRow,
      fearGreedRow,
    ] = await Promise.all([
      getCachedGlobalContext({
        timestamp: signal.timestamp,
        maxAgeMs,
      }),
      getCachedReferenceContexts({
        timestamp: signal.timestamp,
        maxAgeMs,
      }),
      getCachedReferenceContexts({
        timestamp: signal.timestamp - DAY_MS,
        maxAgeMs: maxAgeMs + DAY_MS,
      }),
      getCachedExchangeLiquidityContext({
        timestamp: signal.timestamp,
        maxAgeMs,
      }),
      getCachedFearGreedContext({
        timestamp: signal.timestamp,
        maxAgeMs,
      }),
    ]);
    const globalRow = globalDailyRow;
    const references = dailyReferences;
    const previousReferences = previousDailyReferences;

    if (
      !globalRow &&
      !references.size &&
      !exchangeLiquidityRow &&
      !fearGreedRow
    ) {
      return false;
    }

    const btcRow = references.get('BTCUSDT') ?? null;
    const ethRow = references.get('ETHUSDT') ?? null;
    const previousBtcRow = previousReferences.get('BTCUSDT') ?? null;
    const previousEthRow = previousReferences.get('ETHUSDT') ?? null;
    const btcMarketCapUsd = toFiniteNumberOrNull(btcRow?.marketCapUsd);
    const ethMarketCapUsd = toFiniteNumberOrNull(ethRow?.marketCapUsd);
    const previousBtcMarketCapUsd = toFiniteNumberOrNull(
      previousBtcRow?.marketCapUsd,
    );
    const previousEthMarketCapUsd = toFiniteNumberOrNull(
      previousEthRow?.marketCapUsd,
    );
    const ethBtcMarketCapRatio = safeDivide(ethMarketCapUsd, btcMarketCapUsd);
    const previousEthBtcMarketCapRatio = safeDivide(
      previousEthMarketCapUsd,
      previousBtcMarketCapUsd,
    );
    const ethBtcMarketCapRatioChange24hPct =
      ethBtcMarketCapRatio != null &&
      previousEthBtcMarketCapRatio != null &&
      previousEthBtcMarketCapRatio > 0
        ? (ethBtcMarketCapRatio - previousEthBtcMarketCapRatio) /
          previousEthBtcMarketCapRatio
        : null;
    const btcVolumeUsd = toFiniteNumberOrNull(btcRow?.volumeUsd);
    const ethVolumeUsd = toFiniteNumberOrNull(ethRow?.volumeUsd);
    const referenceStale =
      btcRow?.stale === true || ethRow?.stale === true || !btcRow || !ethRow;
    const btcDominanceChange24hPct = toFiniteNumberOrNull(
      globalRow?.btcDominanceChange24hPct,
    );
    const altMarketCapChange24hPct = toFiniteNumberOrNull(
      globalRow?.altMarketCapChange24hPct,
    );
    const altVolumeChange24hPct = toFiniteNumberOrNull(
      globalRow?.altVolumeChange24hPct,
    );
    const altLiquidityRegime = globalRow
      ? toAltLiquidityRegime({
          stale: globalRow.stale,
          btcDominanceChange24hPct,
          altMarketCapChange24hPct,
          altVolumeChange24hPct,
        })
      : 'unknown';
    const exchangeLiquidityRegime = exchangeLiquidityRow
      ? toExchangeLiquidityRegime({
          stale: exchangeLiquidityRow.stale,
          totalVolumeChange24hPct: toFiniteNumberOrNull(
            exchangeLiquidityRow.totalVolumeChange24hPct,
          ),
          fallback: exchangeLiquidityRow.liquidityRegime ?? 'unknown',
        })
      : 'unknown';
    const baseContext = signal.additionalIndicators.baseContext;

    signal.additionalIndicators = {
      ...signal.additionalIndicators,
      baseContext: {
        ...baseContext,
        relative: {
          ...baseContext.relative,
          ...(globalRow
            ? {
                cmcGlobal: {
                  source: globalRow.source,
                  interval: '1d' as const,
                  asOfTs: globalRow.ts.getTime(),
                  ageMs: globalRow.ageMs,
                  stale: globalRow.stale,
                  totalMarketCapUsd: toFiniteNumberOrNull(
                    globalRow.totalMarketCapUsd,
                  ),
                  totalVolumeUsd: toFiniteNumberOrNull(
                    globalRow.totalVolumeUsd,
                  ),
                  totalVolumeReportedUsd: toFiniteNumberOrNull(
                    globalRow.totalVolumeReportedUsd,
                  ),
                  altMarketCapUsd: toFiniteNumberOrNull(
                    globalRow.altMarketCapUsd,
                  ),
                  altVolumeUsd: toFiniteNumberOrNull(globalRow.altVolumeUsd),
                  altVolumeReportedUsd: toFiniteNumberOrNull(
                    globalRow.altVolumeReportedUsd,
                  ),
                  btcDominancePct: toFiniteNumberOrNull(
                    globalRow.btcDominancePct,
                  ),
                  ethDominancePct: toFiniteNumberOrNull(
                    globalRow.ethDominancePct,
                  ),
                  btcDominanceChange24hPct,
                  ethDominanceChange24hPct: toFiniteNumberOrNull(
                    globalRow.ethDominanceChange24hPct,
                  ),
                  altMarketCapChange24hPct,
                  altVolumeChange24hPct,
                  activeCryptocurrencies: toFiniteNumberOrNull(
                    globalRow.activeCryptocurrencies,
                  ),
                  activeExchanges: toFiniteNumberOrNull(
                    globalRow.activeExchanges,
                  ),
                  activeMarketPairs: toFiniteNumberOrNull(
                    globalRow.activeMarketPairs,
                  ),
                  altLiquidityRegime,
                },
              }
            : {}),
          ...(btcRow || ethRow
            ? {
                cmcReferenceAssets: {
                  source: SOURCE_REFERENCE,
                  interval: '1d' as const,
                  asOfTs: Math.max(
                    btcRow?.ts.getTime() ?? 0,
                    ethRow?.ts.getTime() ?? 0,
                  ),
                  ageMs:
                    btcRow?.ageMs != null && ethRow?.ageMs != null
                      ? Math.max(btcRow.ageMs, ethRow.ageMs)
                      : btcRow?.ageMs ?? ethRow?.ageMs ?? null,
                  stale: referenceStale,
                  btcMarketCapUsd,
                  ethMarketCapUsd,
                  btcVolumeUsd,
                  ethVolumeUsd,
                  btcVolumeToMarketCap: safeDivide(
                    btcVolumeUsd,
                    btcMarketCapUsd,
                  ),
                  ethVolumeToMarketCap: safeDivide(
                    ethVolumeUsd,
                    ethMarketCapUsd,
                  ),
                  ethBtcMarketCapRatio,
                  ethBtcMarketCapRatioChange24hPct,
                  ethVsBtcVolumeRatio: safeDivide(ethVolumeUsd, btcVolumeUsd),
                  referenceLiquidityRegime: toReferenceLiquidityRegime({
                    stale: referenceStale,
                    ethBtcMarketCapRatioChange24hPct,
                    ethVsBtcVolumeRatio: safeDivide(ethVolumeUsd, btcVolumeUsd),
                  }),
                },
              }
            : {}),
          ...(exchangeLiquidityRow
            ? {
                cmcExchangeLiquidity: {
                  source: SOURCE_EXCHANGE_LIQUIDITY,
                  interval: exchangeLiquidityRow.interval,
                  asOfTs: exchangeLiquidityRow.ts.getTime(),
                  ageMs: exchangeLiquidityRow.ageMs,
                  stale: exchangeLiquidityRow.stale,
                  exchangesCount: toFiniteNumberOrNull(
                    exchangeLiquidityRow.exchangesCount,
                  ),
                  totalVolumeUsd: toFiniteNumberOrNull(
                    exchangeLiquidityRow.totalVolumeUsd,
                  ),
                  totalVolumeChange24hPct: toFiniteNumberOrNull(
                    exchangeLiquidityRow.totalVolumeChange24hPct,
                  ),
                  binanceVolumeUsd: toFiniteNumberOrNull(
                    exchangeLiquidityRow.binanceVolumeUsd,
                  ),
                  binanceVolumeShare: toFiniteNumberOrNull(
                    exchangeLiquidityRow.binanceVolumeShare,
                  ),
                  topExchangeVolumeShare: toFiniteNumberOrNull(
                    exchangeLiquidityRow.topExchangeVolumeShare,
                  ),
                  liquidityRegime: exchangeLiquidityRegime,
                },
              }
            : {}),
          ...(fearGreedRow
            ? {
                cmcFearGreed: {
                  source: SOURCE_FEAR_GREED,
                  interval: '1d' as const,
                  asOfTs: fearGreedRow.ts.getTime(),
                  ageMs: fearGreedRow.ageMs,
                  stale: fearGreedRow.stale,
                  value: toFiniteNumberOrNull(fearGreedRow.value),
                  valueChange24h: toFiniteNumberOrNull(
                    fearGreedRow.valueChange24h,
                  ),
                  valueChange7d: toFiniteNumberOrNull(
                    fearGreedRow.valueChange7d,
                  ),
                  classification: fearGreedRow.classification ?? 'Unknown',
                  sentimentRegime: fearGreedRow.sentimentRegime ?? 'unknown',
                },
              }
            : {}),
        },
      },
    };
    refreshSignalBaseContextGateFeatures(signal);
    return true;
  } catch (error) {
    coinMarketCapContextUnavailable = true;
    logger.warn(
      'CoinMarketCap context disabled after Timescale read failure: %s',
      String(error),
    );
    return false;
  }
};
