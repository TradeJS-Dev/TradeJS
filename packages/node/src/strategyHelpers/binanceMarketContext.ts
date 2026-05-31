import {
  getLatestMarketBreadth,
  getLatestMarketOrderBookDepth,
  getLatestMarketTradeFlow,
} from '@tradejs/infra/timescale';
import { logger } from '@tradejs/infra/logger';
import { refreshSignalBaseContextGateFeatures } from '@tradejs/core/strategies';
import type {
  BaseStrategyContextSnapshot,
  BaseTargetVenueContext,
  MarketFeatureInterval,
  MarketOrderBookDepthRow,
  MarketTradeFlowRow,
  Signal,
} from '@tradejs/types';

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
  depth: BaseTargetVenueContext | null;
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
  if (!normalized) return env === 'BACKTEST' || env === 'CRON';
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

const resolveBreadthUniverse = () =>
  (process.env.BINANCE_MARKET_CONTEXT_BREADTH_UNIVERSE || 'binance_top30_usdt')
    .trim()
    .toLowerCase();

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

const toDepthContext = (
  depth: MarketFeatureAsOfRow<MarketOrderBookDepthRow> | null,
): BaseTargetVenueContext | null =>
  depth
    ? {
        source: 'binance_depth_snapshot' as const,
        venue: depth.venue,
        symbol: depth.symbol,
        bid: toFiniteNumberOrNull(depth.bid),
        ask: toFiniteNumberOrNull(depth.ask),
        mid: toFiniteNumberOrNull(depth.mid),
        spreadBps: toFiniteNumberOrNull(depth.spreadBps),
        topBidQty:
          depth.levels?.[0]?.bidBaseVolume != null
            ? toFiniteNumberOrNull(depth.levels[0].bidBaseVolume)
            : null,
        topAskQty:
          depth.levels?.[0]?.askBaseVolume != null
            ? toFiniteNumberOrNull(depth.levels[0].askBaseVolume)
            : null,
        snapshotTimestamp: depth.ts.getTime(),
        stale: depth.stale,
        ageMs: depth.ageMs,
        lastUpdateId: toFiniteNumberOrNull(depth.lastUpdateId),
        depthLevels: depth.levels,
        rawBidLevels: toFiniteNumberOrNull(depth.rawBidLevels),
        rawAskLevels: toFiniteNumberOrNull(depth.rawAskLevels),
      }
    : null;

const getCachedReferenceRows = ({
  referenceSymbols,
  interval,
  timestamp,
  maxAgeMs,
}: {
  referenceSymbols: string[];
  interval: MarketFeatureInterval;
  timestamp: number;
  maxAgeMs: number;
}) => {
  const key = `${referenceSymbols.join(',')}:${interval}:${timestamp}:${maxAgeMs}`;
  const cached = referenceRowsCache.get(key);
  if (cached) return cached;

  const promise = Promise.all(
    referenceSymbols.map(async (symbol) => {
      const [tradeFlow, depth] = await Promise.all([
        getLatestMarketTradeFlow({
          symbol,
          interval,
          atMs: timestamp,
          maxAgeMs,
        }),
        getLatestMarketOrderBookDepth({
          venue: 'binance',
          symbol,
          atMs: timestamp,
          maxAgeMs,
        }),
      ]);
      return {
        symbol,
        tradeFlow: toTradeFlowContext(tradeFlow, interval),
        depth: toDepthContext(depth),
      };
    }),
  );
  referenceRowsCache.set(key, promise);
  return promise;
};

const getCachedBreadth = ({
  breadthUniverse,
  interval,
  timestamp,
  maxAgeMs,
}: {
  breadthUniverse: string;
  interval: MarketFeatureInterval;
  timestamp: number;
  maxAgeMs: number;
}) => {
  const key = `${breadthUniverse}:${interval}:${timestamp}:${maxAgeMs}`;
  const cached = breadthCache.get(key);
  if (cached) return cached;

  const promise = getLatestMarketBreadth({
    universe: breadthUniverse,
    interval,
    atMs: timestamp,
    maxAgeMs,
  });
  breadthCache.set(key, promise);
  return promise;
};

export const enrichSignalWithBinanceMarketContext = async (params: {
  signal: Signal;
  env: string;
  enabled?: boolean;
  interval?: MarketFeatureInterval;
  breadthUniverse?: string;
  maxAgeMs?: number;
}): Promise<boolean> => {
  const {
    signal,
    env,
    enabled = isBinanceMarketContextEnabled(env),
    interval = resolveMarketInterval(signal, params.interval),
    breadthUniverse = resolveBreadthUniverse(),
    maxAgeMs = DEFAULT_MAX_AGE_BY_INTERVAL[interval],
  } = params;
  if (!enabled || binanceMarketContextUnavailable || !hasBaseContext(signal)) {
    return false;
  }

  try {
    const referenceSymbols = getReferenceSymbols();
    const primaryReferenceSymbol = resolvePrimaryReferenceSymbol(signal.symbol);
    const [referenceRows, breadth] = await Promise.all([
      getCachedReferenceRows({
        referenceSymbols,
        interval,
        timestamp: signal.timestamp,
        maxAgeMs,
      }),
      getCachedBreadth({
        breadthUniverse,
        interval,
        timestamp: signal.timestamp,
        maxAgeMs,
      }),
    ]);

    const tradeFlowBySymbol = Object.fromEntries(
      referenceRows
        .filter((row) => row.tradeFlow)
        .map((row) => [row.symbol, row.tradeFlow!]),
    );
    const depthBySymbol = Object.fromEntries(
      referenceRows
        .filter((row) => row.depth)
        .map((row) => [row.symbol, row.depth!]),
    );
    const targetReferenceSymbol = signal.symbol.trim().toUpperCase();
    const targetTradeFlow = tradeFlowBySymbol[targetReferenceSymbol];
    const targetDepth = depthBySymbol[targetReferenceSymbol];

    if (
      !Object.keys(tradeFlowBySymbol).length &&
      !Object.keys(depthBySymbol).length &&
      !breadth
    ) {
      return false;
    }

    const baseContext = signal.additionalIndicators.baseContext;
    const targetVenue =
      targetDepth ?? baseContext.relative.execution.targetVenue;

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
            targetVenue,
          },
          ...(Object.keys(tradeFlowBySymbol).length ||
          Object.keys(depthBySymbol).length
            ? {
                marketReferences: {
                  source: 'binance_reference_market' as const,
                  primaryReferenceSymbol,
                  referenceSymbols,
                  tradeFlowBySymbol,
                  depthBySymbol,
                },
              }
            : {}),
          ...(breadth
            ? {
                marketBreadth: {
                  source: 'binance_klines' as const,
                  universe: breadth.universe,
                  interval,
                  asOfTs: breadth.ts.getTime(),
                  ageMs: breadth.ageMs,
                  stale: breadth.stale,
                  symbolsCount: toFiniteNumberOrNull(breadth.symbolsCount),
                  advancers: toFiniteNumberOrNull(breadth.advancers),
                  decliners: toFiniteNumberOrNull(breadth.decliners),
                  unchanged: toFiniteNumberOrNull(breadth.unchanged),
                  advanceDeclineRatio: toFiniteNumberOrNull(
                    breadth.advanceDeclineRatio,
                  ),
                  pctAboveMa20: toFiniteNumberOrNull(breadth.pctAboveMa20),
                  pctAboveMa50: toFiniteNumberOrNull(breadth.pctAboveMa50),
                  equalWeightedReturn: toFiniteNumberOrNull(
                    breadth.equalWeightedReturn,
                  ),
                  volumeWeightedReturn: toFiniteNumberOrNull(
                    breadth.volumeWeightedReturn,
                  ),
                  dispersion: toFiniteNumberOrNull(breadth.dispersion),
                },
              }
            : {}),
        },
      },
    };
    refreshSignalBaseContextGateFeatures(signal);
    return true;
  } catch (error) {
    binanceMarketContextUnavailable = true;
    logger.warn(
      'Binance market context disabled after Timescale read failure: %s',
      String(error),
    );
    return false;
  }
};
