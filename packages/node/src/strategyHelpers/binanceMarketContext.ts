import {
  getLatestMarketBreadth,
  getLatestMarketTradeFlow,
} from '@tradejs/infra/timescale/marketContext';
import { logger } from '@tradejs/infra/logger';
import { refreshSignalBaseContextGateFeatures } from '@tradejs/core/strategies';
import type {
  BaseMarketBreadthContext,
  BaseStrategyContextSnapshot,
  MarketFeatureInterval,
  MarketTradeFlowRow,
  Signal,
} from '@tradejs/types';
import {
  getBinanceBreadthUniverses,
  type BinanceBreadthUniverseKey,
} from '../binanceBreadthUniverses';
import { isMarketContextCancellationError } from './marketContextErrors';

const DEFAULT_MAX_AGE_BY_INTERVAL: Record<MarketFeatureInterval, number> = {
  '1m': 3 * 60_000,
  '5m': 10 * 60_000,
  '15m': 30 * 60_000,
  '1h': 2 * 60 * 60_000,
};

let binanceMarketContextUnavailable = false;

type MarketFeatureAsOfRow<T> = T & {
  ageMs: number | null;
  stale: boolean;
};

type ReferenceMarketRows = Array<{
  symbol: string;
  tradeFlow: BaseStrategyContextSnapshot['participation']['tradeFlow'] | null;
}>;

const referenceRowsCache = new Map<string, Promise<ReferenceMarketRows>>();
const breadthCache = new Map<
  string,
  ReturnType<typeof getLatestMarketBreadth>
>();

const parseEnabledFlag = (value: unknown, env: string) => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!normalized)
    return env === 'BACKTEST' || env === 'CRON' || env === 'PARITY';
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  if (normalized === 'backtest') return env === 'BACKTEST';
  if (normalized === 'live') return env !== 'BACKTEST';
  return false;
};

const toFiniteNumberOrNull = (value: unknown): number | null => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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

const resolveMarketInterval = (
  signal: Signal,
  override?: MarketFeatureInterval,
) => override ?? signalIntervalToMarketInterval(signal.interval);

const getReferenceSymbols = () => {
  const symbols = (
    process.env.BINANCE_MARKET_CONTEXT_REFERENCE_SYMBOLS || 'BTCUSDT,ETHUSDT'
  )
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  return symbols.length ? [...new Set(symbols)] : ['BTCUSDT', 'ETHUSDT'];
};

const resolvePrimaryReferenceSymbol = (signalSymbol: string) => {
  const symbol = signalSymbol.trim().toUpperCase();
  const referenceSymbols = getReferenceSymbols();
  return referenceSymbols.includes(symbol) ? symbol : referenceSymbols[0];
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

export const isBinanceMarketContextEnabled = (env: string) =>
  parseEnabledFlag(process.env.BINANCE_MARKET_CONTEXT_ENABLED, env);

export const resetBinanceMarketContextRuntimeState = () => {
  binanceMarketContextUnavailable = false;
  referenceRowsCache.clear();
  breadthCache.clear();
};

const toTradeFlowContext = (
  row: MarketFeatureAsOfRow<MarketTradeFlowRow> | null,
  interval: MarketFeatureInterval,
) =>
  row
    ? {
        source: 'binance_agg_trades' as const,
        interval,
        asOfTs: row.ts.getTime(),
        ageMs: row.ageMs,
        stale: row.stale,
        trades: toFiniteNumberOrNull(row.trades),
        buyPressurePct: toFiniteNumberOrNull(row.buyPressurePct),
        buyBaseVolume: toFiniteNumberOrNull(row.buyBaseVolume),
        sellBaseVolume: toFiniteNumberOrNull(row.sellBaseVolume),
        buyQuoteVolume: toFiniteNumberOrNull(row.buyQuoteVolume),
        sellQuoteVolume: toFiniteNumberOrNull(row.sellQuoteVolume),
        netBaseDelta: toFiniteNumberOrNull(row.netBaseDelta),
        netQuoteDelta: toFiniteNumberOrNull(row.netQuoteDelta),
      }
    : null;

const getCachedReferenceRows = ({
  referenceSymbols,
  interval,
  timestamp,
  maxAgeMs,
  abortSignal,
}: {
  referenceSymbols: string[];
  interval: MarketFeatureInterval;
  timestamp: number;
  maxAgeMs: number;
  abortSignal?: AbortSignal;
}) => {
  const key = `${referenceSymbols.join(',')}:${interval}:${timestamp}:${maxAgeMs}`;
  const cached = referenceRowsCache.get(key);
  if (cached) return cached;

  const promise = Promise.all(
    referenceSymbols.map(async (symbol) => {
      const tradeFlow = await getLatestMarketTradeFlow({
        symbol,
        interval,
        atMs: timestamp,
        maxAgeMs,
        ...(abortSignal ? { signal: abortSignal } : {}),
      });
      return {
        symbol,
        tradeFlow: toTradeFlowContext(tradeFlow, interval),
      };
    }),
  );
  referenceRowsCache.set(key, promise);
  void promise.catch(() => referenceRowsCache.delete(key));
  return promise;
};

const getCachedBreadth = ({
  breadthUniverse,
  interval,
  timestamp,
  maxAgeMs,
  abortSignal,
}: {
  breadthUniverse: string;
  interval: MarketFeatureInterval;
  timestamp: number;
  maxAgeMs: number;
  abortSignal?: AbortSignal;
}) => {
  const key = `${breadthUniverse}:${interval}:${timestamp}:${maxAgeMs}`;
  const cached = breadthCache.get(key);
  if (cached) return cached;

  const promise = getLatestMarketBreadth({
    universe: breadthUniverse,
    interval,
    atMs: timestamp,
    maxAgeMs,
    ...(abortSignal ? { signal: abortSignal } : {}),
  });
  breadthCache.set(key, promise);
  void promise.catch(() => breadthCache.delete(key));
  return promise;
};

const toMarketBreadthContext = (
  breadth: NonNullable<Awaited<ReturnType<typeof getLatestMarketBreadth>>>,
  interval: MarketFeatureInterval,
): BaseMarketBreadthContext => ({
  source: 'binance_klines',
  universe: breadth.universe,
  interval,
  asOfTs: breadth.ts.getTime(),
  ageMs: breadth.ageMs,
  stale: breadth.stale,
  symbolsCount: toFiniteNumberOrNull(breadth.symbolsCount),
  advancers: toFiniteNumberOrNull(breadth.advancers),
  decliners: toFiniteNumberOrNull(breadth.decliners),
  unchanged: toFiniteNumberOrNull(breadth.unchanged),
  advanceDeclineRatio: toFiniteNumberOrNull(breadth.advanceDeclineRatio),
  pctAboveMa20: toFiniteNumberOrNull(breadth.pctAboveMa20),
  pctAboveMa50: toFiniteNumberOrNull(breadth.pctAboveMa50),
  equalWeightedReturn: toFiniteNumberOrNull(breadth.equalWeightedReturn),
  volumeWeightedReturn: toFiniteNumberOrNull(breadth.volumeWeightedReturn),
  dispersion: toFiniteNumberOrNull(breadth.dispersion),
});

export const enrichSignalWithBinanceMarketContext = async (params: {
  signal: Signal;
  env: string;
  enabled?: boolean;
  interval?: MarketFeatureInterval;
  breadthUniverse?: string;
  maxAgeMs?: number;
  abortSignal?: AbortSignal;
}): Promise<boolean> => {
  const {
    signal,
    env,
    enabled = isBinanceMarketContextEnabled(env),
    interval = resolveMarketInterval(signal, params.interval),
    maxAgeMs = DEFAULT_MAX_AGE_BY_INTERVAL[interval],
  } = params;
  if (
    signal.universe === 'tradfi' ||
    !enabled ||
    binanceMarketContextUnavailable ||
    !hasBaseContext(signal)
  ) {
    return false;
  }

  try {
    const referenceSymbols = getReferenceSymbols();
    const primaryReferenceSymbol = resolvePrimaryReferenceSymbol(signal.symbol);
    const breadthUniverses = params.breadthUniverse
      ? [
          {
            key: 'top30' as const,
            universe: params.breadthUniverse,
          },
        ]
      : getBinanceBreadthUniverses();
    const [referenceRows, breadthRows] = await Promise.all([
      getCachedReferenceRows({
        referenceSymbols,
        interval,
        timestamp: signal.timestamp,
        maxAgeMs,
        abortSignal: params.abortSignal,
      }),
      Promise.all(
        breadthUniverses.map(async ({ key, universe }) => ({
          key,
          breadth: await getCachedBreadth({
            breadthUniverse: universe,
            interval,
            timestamp: signal.timestamp,
            maxAgeMs,
            abortSignal: params.abortSignal,
          }),
        })),
      ),
    ]);
    const availableBreadths = breadthRows.filter(
      (
        row,
      ): row is {
        key: BinanceBreadthUniverseKey;
        breadth: NonNullable<typeof row.breadth>;
      } => row.breadth != null,
    );
    const marketBreadths = Object.fromEntries(
      availableBreadths.map(({ key, breadth }) => [
        key,
        toMarketBreadthContext(breadth, interval),
      ]),
    );
    const primaryBreadth = availableBreadths.find(
      ({ key }) => key === 'top30',
    )?.breadth;

    const tradeFlowBySymbol = Object.fromEntries(
      referenceRows
        .filter((row) => row.tradeFlow)
        .map((row) => [row.symbol, row.tradeFlow!]),
    );
    const targetReferenceSymbol = signal.symbol.trim().toUpperCase();
    const targetTradeFlow = tradeFlowBySymbol[targetReferenceSymbol];

    if (!Object.keys(tradeFlowBySymbol).length && !availableBreadths.length) {
      return false;
    }

    const baseContext = signal.additionalIndicators.baseContext;

    signal.additionalIndicators = {
      ...signal.additionalIndicators,
      baseContext: {
        ...baseContext,
        participation: {
          ...baseContext.participation,
          ...(targetTradeFlow
            ? {
                tradeFlow: targetTradeFlow,
              }
            : {}),
        },
        relative: {
          ...baseContext.relative,
          execution: {
            ...baseContext.relative.execution,
          },
          ...(Object.keys(tradeFlowBySymbol).length
            ? {
                referenceTradeFlow: {
                  source: 'binance_reference_market' as const,
                  primaryReferenceSymbol,
                  referenceSymbols,
                  tradeFlowBySymbol,
                },
              }
            : {}),
          ...(availableBreadths.length
            ? {
                marketBreadths,
                ...(primaryBreadth
                  ? {
                      marketBreadth: toMarketBreadthContext(
                        primaryBreadth,
                        interval,
                      ),
                      btcAltRegime: {
                        source: 'binance_klines' as const,
                        universe: primaryBreadth.universe,
                        interval,
                        asOfTs: primaryBreadth.ts.getTime(),
                        ageMs: primaryBreadth.ageMs,
                        stale: primaryBreadth.stale,
                        btcReturn1h: toFiniteNumberOrNull(
                          primaryBreadth.btcReturn1h,
                        ),
                        btcReturn4h: toFiniteNumberOrNull(
                          primaryBreadth.btcReturn4h,
                        ),
                        btcReturn24h: toFiniteNumberOrNull(
                          primaryBreadth.btcReturn24h,
                        ),
                        altBasketReturn1h: toFiniteNumberOrNull(
                          primaryBreadth.altBasketReturn1h,
                        ),
                        altBasketReturn4h: toFiniteNumberOrNull(
                          primaryBreadth.altBasketReturn4h,
                        ),
                        altBasketReturn24h: toFiniteNumberOrNull(
                          primaryBreadth.altBasketReturn24h,
                        ),
                        btcVsAltReturn1h: toFiniteNumberOrNull(
                          primaryBreadth.btcVsAltReturn1h,
                        ),
                        btcVsAltReturn4h: toFiniteNumberOrNull(
                          primaryBreadth.btcVsAltReturn4h,
                        ),
                        btcVsAltReturn24h: toFiniteNumberOrNull(
                          primaryBreadth.btcVsAltReturn24h,
                        ),
                        btcTurnoverShare1h: toFiniteNumberOrNull(
                          primaryBreadth.btcTurnoverShare1h,
                        ),
                        btcTurnoverShare24h: toFiniteNumberOrNull(
                          primaryBreadth.btcTurnoverShare24h,
                        ),
                        btcTurnoverShareChange24h: toFiniteNumberOrNull(
                          primaryBreadth.btcTurnoverShareChange24h,
                        ),
                        altVolToBtcVol24h: toFiniteNumberOrNull(
                          primaryBreadth.altVolToBtcVol24h,
                        ),
                        altDispersion24h: toFiniteNumberOrNull(
                          primaryBreadth.altDispersion24h,
                        ),
                        regime: primaryBreadth.btcAltRegime ?? 'unknown',
                      },
                    }
                  : {}),
              }
            : {}),
        },
      },
    };
    refreshSignalBaseContextGateFeatures(signal);
    return true;
  } catch (error) {
    if (isMarketContextCancellationError(error, params.abortSignal)) {
      throw error;
    }
    binanceMarketContextUnavailable = true;
    logger.warn(
      'Binance market context disabled after Timescale read failure: %s',
      String(error),
    );
    return false;
  }
};
