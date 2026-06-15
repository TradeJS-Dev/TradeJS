import { refreshSignalBaseContextGateFeatures } from '@tradejs/core/strategies';
import { logger } from '@tradejs/infra/logger';
import {
  getLatestMarketCmcBreadthContext,
  getLatestMarketCmcExchangeLiquidityContext,
  getLatestMarketGlobalContext,
  getLatestMarketReferenceAssetContexts,
} from '@tradejs/infra/timescale';
import type { BaseStrategyContextSnapshot, Signal } from '@tradejs/types';

const DEFAULT_MAX_AGE_MS = 48 * 60 * 60_000;
const SOURCE_GLOBAL_DAILY = 'coinmarketcap_global' as const;
const SOURCE_GLOBAL_HOURLY = 'coinmarketcap_global_hourly' as const;
const SOURCE_REFERENCE = 'coinmarketcap_reference_asset' as const;
const SOURCE_BREADTH = 'coinmarketcap_market_breadth' as const;
const SOURCE_EXCHANGE_LIQUIDITY = 'coinmarketcap_exchange_liquidity' as const;
const DEFAULT_BREADTH_UNIVERSE = 'cmc_top100';
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
const breadthContextCache = new Map<
  string,
  ReturnType<typeof getLatestMarketCmcBreadthContext>
>();
const exchangeLiquidityContextCache = new Map<
  string,
  ReturnType<typeof getLatestMarketCmcExchangeLiquidityContext>
>();

const parseEnabledFlag = (value: unknown, env: string) => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return env === 'BACKTEST';
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  if (normalized === 'backtest') return env === 'BACKTEST';
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

const getBreadthUniverse = () =>
  String(process.env.COINMARKETCAP_CONTEXT_BREADTH_UNIVERSE ?? '')
    .trim()
    .toLowerCase() || DEFAULT_BREADTH_UNIVERSE;

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
  source,
  timestamp,
  maxAgeMs,
}: {
  source: typeof SOURCE_GLOBAL_DAILY | typeof SOURCE_GLOBAL_HOURLY;
  timestamp: number;
  maxAgeMs: number;
}) => {
  const key = `${source}:${timestamp}:${maxAgeMs}`;
  const cached = globalContextCache.get(key);
  if (cached) return cached;

  const promise = getLatestMarketGlobalContext({
    source,
    atMs: timestamp,
    maxAgeMs,
  });
  globalContextCache.set(key, promise);
  return promise;
};

const getCachedReferenceContexts = ({
  interval,
  timestamp,
  maxAgeMs,
}: {
  interval: '1d' | '1h';
  timestamp: number;
  maxAgeMs: number;
}) => {
  const key = `${SOURCE_REFERENCE}:${interval}:${timestamp}:${maxAgeMs}`;
  const cached = referenceContextCache.get(key);
  if (cached) return cached;

  const promise = getLatestMarketReferenceAssetContexts({
    source: SOURCE_REFERENCE,
    symbols: ['BTCUSDT', 'ETHUSDT'],
    interval,
    atMs: timestamp,
    maxAgeMs,
  });
  referenceContextCache.set(key, promise);
  return promise;
};

const getCachedBreadthContext = ({
  timestamp,
  maxAgeMs,
}: {
  timestamp: number;
  maxAgeMs: number;
}) => {
  const universe = getBreadthUniverse();
  const key = `${SOURCE_BREADTH}:${universe}:${timestamp}:${maxAgeMs}`;
  const cached = breadthContextCache.get(key);
  if (cached) return cached;

  const promise = getLatestMarketCmcBreadthContext({
    source: SOURCE_BREADTH,
    universe,
    interval: '1d',
    atMs: timestamp,
    maxAgeMs,
  });
  breadthContextCache.set(key, promise);
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

export const isCoinMarketCapContextEnabled = (env: string) =>
  env === 'BACKTEST' &&
  parseEnabledFlag(process.env.COINMARKETCAP_CONTEXT_ENABLED, env);

export const resetCoinMarketCapContextRuntimeState = () => {
  coinMarketCapContextUnavailable = false;
  globalContextCache.clear();
  referenceContextCache.clear();
  breadthContextCache.clear();
  exchangeLiquidityContextCache.clear();
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
      globalHourlyRow,
      globalDailyRow,
      hourlyReferences,
      dailyReferences,
      previousHourlyReferences,
      previousDailyReferences,
      breadthRow,
      exchangeLiquidityRow,
    ] = await Promise.all([
      getCachedGlobalContext({
        source: SOURCE_GLOBAL_HOURLY,
        timestamp: signal.timestamp,
        maxAgeMs,
      }),
      getCachedGlobalContext({
        source: SOURCE_GLOBAL_DAILY,
        timestamp: signal.timestamp,
        maxAgeMs,
      }),
      getCachedReferenceContexts({
        interval: '1h',
        timestamp: signal.timestamp,
        maxAgeMs,
      }),
      getCachedReferenceContexts({
        interval: '1d',
        timestamp: signal.timestamp,
        maxAgeMs,
      }),
      getCachedReferenceContexts({
        interval: '1h',
        timestamp: signal.timestamp - DAY_MS,
        maxAgeMs: maxAgeMs + DAY_MS,
      }),
      getCachedReferenceContexts({
        interval: '1d',
        timestamp: signal.timestamp - DAY_MS,
        maxAgeMs: maxAgeMs + DAY_MS,
      }),
      getCachedBreadthContext({ timestamp: signal.timestamp, maxAgeMs }),
      getCachedExchangeLiquidityContext({
        timestamp: signal.timestamp,
        maxAgeMs,
      }),
    ]);
    const globalRow = globalHourlyRow ?? globalDailyRow;
    const globalInterval = globalHourlyRow ? '1h' : '1d';
    const hasHourlyReferences =
      hourlyReferences.has('BTCUSDT') && hourlyReferences.has('ETHUSDT');
    const references = hasHourlyReferences ? hourlyReferences : dailyReferences;
    const previousReferences = hasHourlyReferences
      ? previousHourlyReferences
      : previousDailyReferences;
    const referenceInterval = hasHourlyReferences ? '1h' : '1d';

    if (
      !globalRow &&
      !references.size &&
      !breadthRow &&
      !exchangeLiquidityRow
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
                  interval: globalInterval,
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
                  interval: referenceInterval,
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
          ...(breadthRow
            ? {
                cmcMarketBreadth: {
                  source: SOURCE_BREADTH,
                  universe: breadthRow.universe,
                  interval: '1d' as const,
                  asOfTs: breadthRow.ts.getTime(),
                  ageMs: breadthRow.ageMs,
                  stale: breadthRow.stale,
                  topAssetsCount: toFiniteNumberOrNull(
                    breadthRow.topAssetsCount,
                  ),
                  assetsCount: toFiniteNumberOrNull(breadthRow.assetsCount),
                  positive24hPct: toFiniteNumberOrNull(
                    breadthRow.positive24hPct,
                  ),
                  positive7dPct: toFiniteNumberOrNull(breadthRow.positive7dPct),
                  avgReturn24hPct: toFiniteNumberOrNull(
                    breadthRow.avgReturn24hPct,
                  ),
                  medianReturn24hPct: toFiniteNumberOrNull(
                    breadthRow.medianReturn24hPct,
                  ),
                  avgReturn7dPct: toFiniteNumberOrNull(
                    breadthRow.avgReturn7dPct,
                  ),
                  medianReturn7dPct: toFiniteNumberOrNull(
                    breadthRow.medianReturn7dPct,
                  ),
                  returnDispersion24hPct: toFiniteNumberOrNull(
                    breadthRow.returnDispersion24hPct,
                  ),
                  returnDispersion7dPct: toFiniteNumberOrNull(
                    breadthRow.returnDispersion7dPct,
                  ),
                  top10MarketCapShare: toFiniteNumberOrNull(
                    breadthRow.top10MarketCapShare,
                  ),
                  top25MarketCapShare: toFiniteNumberOrNull(
                    breadthRow.top25MarketCapShare,
                  ),
                  btcMarketCapShare: toFiniteNumberOrNull(
                    breadthRow.btcMarketCapShare,
                  ),
                  ethMarketCapShare: toFiniteNumberOrNull(
                    breadthRow.ethMarketCapShare,
                  ),
                  btcEthMarketCapShare: toFiniteNumberOrNull(
                    breadthRow.btcEthMarketCapShare,
                  ),
                  stablecoinMarketCapShare: toFiniteNumberOrNull(
                    breadthRow.stablecoinMarketCapShare,
                  ),
                  stablecoinVolumeShare: toFiniteNumberOrNull(
                    breadthRow.stablecoinVolumeShare,
                  ),
                  totalMarketCapUsd: toFiniteNumberOrNull(
                    breadthRow.totalMarketCapUsd,
                  ),
                  totalVolumeUsd: toFiniteNumberOrNull(
                    breadthRow.totalVolumeUsd,
                  ),
                  breadthRegime: breadthRow.breadthRegime ?? 'unknown',
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
