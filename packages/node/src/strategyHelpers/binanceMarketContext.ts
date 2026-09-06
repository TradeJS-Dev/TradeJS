import {
  getMarketBreadthRows,
  getMarketTradeFlowRows,
  getLatestMarketBreadth,
  getLatestMarketTradeFlow,
} from '@tradejs/infra/timescale/marketContext';
import { logger } from '@tradejs/infra/logger';
import { refreshSignalBaseContextGateFeatures } from '@tradejs/core/strategies';
import type {
  BaseMarketBreadthContext,
  BaseStrategyContextSnapshot,
  MarketBreadthRow,
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
const MARKET_CONTEXT_PRELOAD_CHUNK_MS = 7 * 24 * 60 * 60_000;

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
const TRADE_FLOW_NUMERIC_FIELDS = [
  'trades',
  'buyBaseVolume',
  'sellBaseVolume',
  'buyQuoteVolume',
  'sellQuoteVolume',
  'netBaseDelta',
  'netQuoteDelta',
  'buyPressurePct',
] as const;
const BREADTH_COMMON_NUMERIC_FIELDS = [
  'symbolsCount',
  'advancers',
  'decliners',
  'unchanged',
  'advanceDeclineRatio',
  'pctAboveMa20',
  'pctAboveMa50',
  'equalWeightedReturn',
  'volumeWeightedReturn',
  'dispersion',
] as const;
const BREADTH_REGIME_NUMERIC_FIELDS = [
  'btcReturn1h',
  'btcReturn4h',
  'btcReturn24h',
  'altBasketReturn1h',
  'altBasketReturn4h',
  'altBasketReturn24h',
  'btcVsAltReturn1h',
  'btcVsAltReturn4h',
  'btcVsAltReturn24h',
  'btcTurnoverShare1h',
  'btcTurnoverShare24h',
  'btcTurnoverShareChange24h',
  'altVolToBtcVol24h',
  'altDispersion24h',
] as const;

type TradeFlowNumericField = (typeof TRADE_FLOW_NUMERIC_FIELDS)[number];
type BreadthCommonNumericField = (typeof BREADTH_COMMON_NUMERIC_FIELDS)[number];
type BreadthRegimeNumericField = (typeof BREADTH_REGIME_NUMERIC_FIELDS)[number];
type PackedNumericRows<Field extends string> = {
  timestamps: Float64Array;
  columns: Record<Field, Float64Array>;
};
type PackedTradeFlowRows = PackedNumericRows<TradeFlowNumericField> & {
  symbol: string;
  interval: MarketFeatureInterval;
};
type PackedBreadthRows = {
  universe: string;
  interval: MarketFeatureInterval;
  timestamps: Float64Array;
  commonColumns: Record<BreadthCommonNumericField, Float64Array>;
  regimeColumns?: Record<BreadthRegimeNumericField, Float64Array>;
  regimes?: Array<MarketBreadthRow['btcAltRegime']>;
};

let preloadedTradeFlowBySymbol: Map<string, PackedTradeFlowRows[]> | null =
  null;
let preloadedBreadthByUniverse: Map<string, PackedBreadthRows[]> | null = null;

export const getBinanceMarketContextRuntimeStats = () => ({
  referenceCacheEntries: referenceRowsCache.size,
  breadthCacheEntries: breadthCache.size,
  preloadedTradeFlowRows:
    preloadedTradeFlowBySymbol == null
      ? 0
      : [...preloadedTradeFlowBySymbol.values()].reduce(
          (sum, chunks) =>
            sum +
            chunks.reduce(
              (chunkSum, rows) => chunkSum + rows.timestamps.length,
              0,
            ),
          0,
        ),
  preloadedBreadthRows:
    preloadedBreadthByUniverse == null
      ? 0
      : [...preloadedBreadthByUniverse.values()].reduce(
          (sum, chunks) =>
            sum +
            chunks.reduce(
              (chunkSum, rows) => chunkSum + rows.timestamps.length,
              0,
            ),
          0,
        ),
});

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
  preloadedTradeFlowBySymbol = null;
  preloadedBreadthByUniverse = null;
};

const latestIndexAtOrBefore = (
  timestamps: Float64Array | undefined,
  timestamp: number,
): number => {
  if (!timestamps?.length) return -1;
  let low = 0;
  let high = timestamps.length - 1;
  let match = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const rowTimestamp = timestamps[middle];
    if (rowTimestamp == null) break;
    if (rowTimestamp <= timestamp) {
      match = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return match;
};

const latestChunkAtOrBefore = <Rows extends { timestamps: Float64Array }>(
  chunks: Rows[] | undefined,
  timestamp: number,
): Rows | null => {
  if (!chunks?.length) return null;
  let low = 0;
  let high = chunks.length - 1;
  let match: Rows | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const chunk = chunks[middle];
    const firstTimestamp = chunk?.timestamps[0];
    if (!chunk || firstTimestamp == null) break;
    if (firstTimestamp <= timestamp) {
      match = chunk;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return match;
};

const createNumericColumns = <Field extends string>(
  fields: readonly Field[],
  length: number,
) =>
  Object.fromEntries(
    fields.map((field) => [field, new Float64Array(length)]),
  ) as Record<Field, Float64Array>;

const packedNumber = (value: unknown) => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
};

const unpackedNumber = (value: number | undefined) =>
  value == null || Number.isNaN(value) ? null : value;

const packTradeFlowRows = (rows: MarketTradeFlowRow[]) => {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.symbol, (counts.get(row.symbol) ?? 0) + 1);
  }
  const packed = new Map<string, PackedTradeFlowRows>();
  for (const [symbol, length] of counts) {
    packed.set(symbol, {
      symbol,
      interval: rows.find((row) => row.symbol === symbol)?.interval ?? '15m',
      timestamps: new Float64Array(length),
      columns: createNumericColumns(TRADE_FLOW_NUMERIC_FIELDS, length),
    });
  }
  const offsets = new Map<string, number>();
  for (const row of rows) {
    const target = packed.get(row.symbol);
    if (!target) continue;
    const index = offsets.get(row.symbol) ?? 0;
    target.timestamps[index] = row.ts.getTime();
    for (const field of TRADE_FLOW_NUMERIC_FIELDS) {
      target.columns[field][index] = packedNumber(row[field]);
    }
    offsets.set(row.symbol, index + 1);
  }
  return packed;
};

const packBreadthRows = (rows: MarketBreadthRow[], primaryUniverse: string) => {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.universe, (counts.get(row.universe) ?? 0) + 1);
  }
  const packed = new Map<string, PackedBreadthRows>();
  for (const [universe, length] of counts) {
    packed.set(universe, {
      universe,
      interval:
        rows.find((row) => row.universe === universe)?.interval ?? '15m',
      timestamps: new Float64Array(length),
      commonColumns: createNumericColumns(
        BREADTH_COMMON_NUMERIC_FIELDS,
        length,
      ),
      ...(universe === primaryUniverse
        ? {
            regimeColumns: createNumericColumns(
              BREADTH_REGIME_NUMERIC_FIELDS,
              length,
            ),
            regimes: new Array<MarketBreadthRow['btcAltRegime']>(length),
          }
        : {}),
    });
  }
  const offsets = new Map<string, number>();
  for (const row of rows) {
    const target = packed.get(row.universe);
    if (!target) continue;
    const index = offsets.get(row.universe) ?? 0;
    target.timestamps[index] = row.ts.getTime();
    for (const field of BREADTH_COMMON_NUMERIC_FIELDS) {
      target.commonColumns[field][index] = packedNumber(row[field]);
    }
    if (target.regimeColumns) {
      for (const field of BREADTH_REGIME_NUMERIC_FIELDS) {
        target.regimeColumns[field][index] = packedNumber(row[field]);
      }
    }
    if (target.regimes) target.regimes[index] = row.btcAltRegime;
    offsets.set(row.universe, index + 1);
  }
  return packed;
};

const appendPackedChunks = <Rows>(
  target: Map<string, Rows[]>,
  source: Map<string, Rows>,
) => {
  for (const [key, rows] of source) {
    const chunks = target.get(key) ?? [];
    chunks.push(rows);
    target.set(key, chunks);
  }
};

const unpackTradeFlowRow = (
  chunks: PackedTradeFlowRows[] | undefined,
  timestamp: number,
): MarketTradeFlowRow | null => {
  const rows = latestChunkAtOrBefore(chunks, timestamp);
  const index = latestIndexAtOrBefore(rows?.timestamps, timestamp);
  if (!rows || index < 0) return null;
  return {
    symbol: rows.symbol,
    interval: rows.interval,
    ts: new Date(rows.timestamps[index]!),
    trades: unpackedNumber(rows.columns.trades[index]) ?? 0,
    buyBaseVolume: unpackedNumber(rows.columns.buyBaseVolume[index]),
    sellBaseVolume: unpackedNumber(rows.columns.sellBaseVolume[index]),
    buyQuoteVolume: unpackedNumber(rows.columns.buyQuoteVolume[index]),
    sellQuoteVolume: unpackedNumber(rows.columns.sellQuoteVolume[index]),
    netBaseDelta: unpackedNumber(rows.columns.netBaseDelta[index]),
    netQuoteDelta: unpackedNumber(rows.columns.netQuoteDelta[index]),
    buyPressurePct: unpackedNumber(rows.columns.buyPressurePct[index]),
  };
};

const unpackBreadthRow = (
  chunks: PackedBreadthRows[] | undefined,
  timestamp: number,
): MarketBreadthRow | null => {
  const rows = latestChunkAtOrBefore(chunks, timestamp);
  const index = latestIndexAtOrBefore(rows?.timestamps, timestamp);
  if (!rows || index < 0) return null;
  const commonNumeric = Object.fromEntries(
    BREADTH_COMMON_NUMERIC_FIELDS.map((field) => [
      field,
      unpackedNumber(rows.commonColumns[field][index]),
    ]),
  ) as Record<BreadthCommonNumericField, number | null>;
  const regimeNumeric = Object.fromEntries(
    BREADTH_REGIME_NUMERIC_FIELDS.map((field) => [
      field,
      unpackedNumber(rows.regimeColumns?.[field][index]),
    ]),
  ) as Record<BreadthRegimeNumericField, number | null>;
  return {
    universe: rows.universe,
    interval: rows.interval,
    ts: new Date(rows.timestamps[index]!),
    ...commonNumeric,
    ...regimeNumeric,
    symbolsCount: commonNumeric.symbolsCount ?? 0,
    advancers: commonNumeric.advancers ?? 0,
    decliners: commonNumeric.decliners ?? 0,
    unchanged: commonNumeric.unchanged ?? 0,
    btcAltRegime: rows.regimes?.[index] ?? null,
  };
};

const toAsOfRow = <T extends { ts: Date }>(
  row: T | null,
  timestamp: number,
  maxAgeMs: number,
): MarketFeatureAsOfRow<T> | null => {
  if (!row) return null;
  const ageMs = timestamp - row.ts.getTime();
  return {
    ...row,
    ageMs: Number.isFinite(ageMs) ? ageMs : null,
    stale: !Number.isFinite(ageMs) || ageMs < 0 || ageMs > maxAgeMs,
  };
};

export const preloadBinanceMarketContextForWindow = async (params: {
  startMs: number;
  endMs: number;
  interval: MarketFeatureInterval;
  maxAgeMs?: number;
  timeoutMs?: number;
  chunkMs?: number;
  abortSignal?: AbortSignal;
}) => {
  const maxAgeMs =
    params.maxAgeMs ?? DEFAULT_MAX_AGE_BY_INTERVAL[params.interval];
  const referenceSymbols = getReferenceSymbols();
  const breadthDefinitions = getBinanceBreadthUniverses();
  const breadthUniverses = breadthDefinitions.map(({ universe }) => universe);
  const primaryBreadthUniverse = breadthDefinitions.find(
    ({ key }) => key === 'top30',
  )!.universe;
  const timeoutMs = params.timeoutMs ?? 5 * 60_000;
  const chunkMs = params.chunkMs ?? MARKET_CONTEXT_PRELOAD_CHUNK_MS;
  if (!Number.isSafeInteger(chunkMs) || chunkMs <= 0) {
    throw new Error(`Invalid market context preload chunk: ${chunkMs}`);
  }
  const packedTradeFlow = new Map<string, PackedTradeFlowRows[]>();
  const packedBreadth = new Map<string, PackedBreadthRows[]>();
  let tradeFlowRowsCount = 0;
  let breadthRowsCount = 0;
  let fromMs = params.startMs - maxAgeMs;
  while (fromMs <= params.endMs) {
    const toMs = Math.min(params.endMs, fromMs + chunkMs - 1);
    const [tradeFlowRows, breadthRows] = await Promise.all([
      getMarketTradeFlowRows({
        symbols: referenceSymbols,
        interval: params.interval,
        fromMs,
        toMs,
        timeoutMs,
        ...(params.abortSignal ? { signal: params.abortSignal } : {}),
      }),
      getMarketBreadthRows({
        universes: breadthUniverses,
        interval: params.interval,
        fromMs,
        toMs,
        timeoutMs,
        ...(params.abortSignal ? { signal: params.abortSignal } : {}),
      }),
    ]);
    tradeFlowRowsCount += tradeFlowRows.length;
    breadthRowsCount += breadthRows.length;
    appendPackedChunks(packedTradeFlow, packTradeFlowRows(tradeFlowRows));
    appendPackedChunks(
      packedBreadth,
      packBreadthRows(breadthRows, primaryBreadthUniverse),
    );
    fromMs = toMs + 1;
  }
  preloadedTradeFlowBySymbol = packedTradeFlow;
  preloadedBreadthByUniverse = packedBreadth;
  referenceRowsCache.clear();
  breadthCache.clear();
  return {
    tradeFlowRows: tradeFlowRowsCount,
    breadthRows: breadthRowsCount,
  };
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
  if (preloadedTradeFlowBySymbol) {
    return Promise.resolve(
      referenceSymbols.map((symbol) => ({
        symbol,
        tradeFlow: toTradeFlowContext(
          toAsOfRow(
            unpackTradeFlowRow(
              preloadedTradeFlowBySymbol?.get(symbol),
              timestamp,
            ),
            timestamp,
            maxAgeMs,
          ),
          interval,
        ),
      })),
    );
  }
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
  if (preloadedBreadthByUniverse) {
    return Promise.resolve(
      toAsOfRow(
        unpackBreadthRow(
          preloadedBreadthByUniverse.get(breadthUniverse),
          timestamp,
        ),
        timestamp,
        maxAgeMs,
      ),
    );
  }
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
