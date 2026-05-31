import type {
  AggTrade,
  KlineChartData,
  MarketBreadthRow,
  MarketDepthLevelSummary,
  MarketFeatureInterval,
  MarketOrderBookDepthRow,
  MarketTradeFlowRow,
  OrderBookDepth,
  Ticker,
} from '@tradejs/types';

export const MARKET_FEATURE_INTERVAL_MS: Record<MarketFeatureInterval, number> =
  {
    '1m': 60_000,
    '5m': 300_000,
    '15m': 900_000,
    '1h': 3_600_000,
  };

const STABLE_QUOTE_SYMBOLS = new Set([
  'USDCUSDT',
  'FDUSDUSDT',
  'TUSDUSDT',
  'BUSDUSDT',
  'USDPUSDT',
  'DAIUSDT',
]);

const finiteOrNull = (value: number) => (Number.isFinite(value) ? value : null);

const safeDivide = (num: number, den: number) =>
  Number.isFinite(num) && Number.isFinite(den) && den !== 0 ? num / den : null;

const mean = (values: number[]) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;

const standardDeviation = (values: number[]) => {
  const avg = mean(values);
  if (avg == null || values.length < 2) return null;
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};

export const normalizeMarketFeatureInterval = (
  value: unknown,
): MarketFeatureInterval => {
  const normalized = String(value || '15m')
    .trim()
    .toLowerCase();
  if (normalized === '1' || normalized === '1m') return '1m';
  if (normalized === '5' || normalized === '5m') return '5m';
  if (normalized === '15' || normalized === '15m') return '15m';
  if (normalized === '60' || normalized === '1h') return '1h';
  return '15m';
};

export const normalizeBinanceSymbols = (value: unknown): string[] =>
  String(value || '')
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);

export const selectBreadthUniverseFromTickers = (
  tickers: Ticker[],
  limit: number,
) =>
  tickers
    .filter(
      (ticker) =>
        ticker.symbol.endsWith('USDT') &&
        ticker.symbol !== 'BTCUSDT' &&
        !STABLE_QUOTE_SYMBOLS.has(ticker.symbol) &&
        Number.isFinite(ticker.turnover24h) &&
        ticker.turnover24h > 0,
    )
    .sort((a, b) => b.turnover24h - a.turnover24h)
    .slice(0, Math.max(0, limit))
    .map((ticker) => ticker.symbol);

export const estimateBinanceMarketDataVolume = ({
  symbols,
  days,
  interval,
  includeAggTrades,
  includeDepth,
  includeBreadth,
  breadthLimit,
}: {
  symbols: string[];
  days: number;
  interval: MarketFeatureInterval;
  includeAggTrades: boolean;
  includeDepth: boolean;
  includeBreadth: boolean;
  breadthLimit: number;
}) => {
  const intervalMs = MARKET_FEATURE_INTERVAL_MS[interval];
  const bucketRowsPerSymbol = Math.ceil((days * 86_400_000) / intervalMs);
  const aggTradeBucketRows = includeAggTrades
    ? symbols.length * bucketRowsPerSymbol
    : 0;
  const depthSnapshotRows = includeDepth ? symbols.length : 0;
  const breadthSymbols = includeBreadth ? Math.max(0, breadthLimit) : 0;
  const breadthCandleRows = breadthSymbols * bucketRowsPerSymbol;
  const breadthRows = includeBreadth ? bucketRowsPerSymbol : 0;

  return {
    interval,
    days,
    symbols: symbols.length,
    bucketRowsPerSymbol,
    aggTradeBucketRows,
    depthSnapshotRows,
    breadthSymbols,
    breadthCandleRows,
    breadthRows,
    estimatedStoredRows: aggTradeBucketRows + depthSnapshotRows + breadthRows,
  };
};

export const aggregateAggTradesToRows = ({
  symbol,
  interval,
  trades,
  source = 'binance_agg_trades',
}: {
  symbol: string;
  interval: MarketFeatureInterval;
  trades: AggTrade[];
  source?: string;
}): MarketTradeFlowRow[] => {
  const intervalMs = MARKET_FEATURE_INTERVAL_MS[interval];
  const buckets = new Map<number, MarketTradeFlowRow>();

  for (const trade of trades) {
    const bucketTs = Math.floor(trade.timestamp / intervalMs) * intervalMs;
    const row =
      buckets.get(bucketTs) ??
      ({
        symbol,
        interval,
        ts: new Date(bucketTs),
        trades: 0,
        buyBaseVolume: 0,
        sellBaseVolume: 0,
        buyQuoteVolume: 0,
        sellQuoteVolume: 0,
        netBaseDelta: 0,
        netQuoteDelta: 0,
        buyPressurePct: null,
        source,
      } satisfies MarketTradeFlowRow);

    const quote = trade.price * trade.quantity;
    const isAggressiveSell = trade.isBuyerMaker;
    row.trades += 1;
    if (isAggressiveSell) {
      row.sellBaseVolume = (row.sellBaseVolume ?? 0) + trade.quantity;
      row.sellQuoteVolume = (row.sellQuoteVolume ?? 0) + quote;
    } else {
      row.buyBaseVolume = (row.buyBaseVolume ?? 0) + trade.quantity;
      row.buyQuoteVolume = (row.buyQuoteVolume ?? 0) + quote;
    }
    row.netBaseDelta = (row.buyBaseVolume ?? 0) - (row.sellBaseVolume ?? 0);
    row.netQuoteDelta = (row.buyQuoteVolume ?? 0) - (row.sellQuoteVolume ?? 0);
    row.buyPressurePct = safeDivide(
      row.buyBaseVolume ?? 0,
      (row.buyBaseVolume ?? 0) + (row.sellBaseVolume ?? 0),
    );
    buckets.set(bucketTs, row);
  }

  return [...buckets.values()].sort((a, b) => a.ts.getTime() - b.ts.getTime());
};

const summarizeLevels = (
  bids: Array<[number, number]>,
  asks: Array<[number, number]>,
  levels: number,
): MarketDepthLevelSummary => {
  const bidSlice = bids.slice(0, levels);
  const askSlice = asks.slice(0, levels);
  const bidBaseVolume = bidSlice.reduce((sum, [, qty]) => sum + qty, 0);
  const askBaseVolume = askSlice.reduce((sum, [, qty]) => sum + qty, 0);
  const bidQuoteVolume = bidSlice.reduce(
    (sum, [price, qty]) => sum + price * qty,
    0,
  );
  const askQuoteVolume = askSlice.reduce(
    (sum, [price, qty]) => sum + price * qty,
    0,
  );
  const imbalance = safeDivide(
    bidQuoteVolume - askQuoteVolume,
    bidQuoteVolume + askQuoteVolume,
  );

  return {
    levels,
    bidBaseVolume: finiteOrNull(bidBaseVolume),
    askBaseVolume: finiteOrNull(askBaseVolume),
    bidQuoteVolume: finiteOrNull(bidQuoteVolume),
    askQuoteVolume: finiteOrNull(askQuoteVolume),
    imbalance,
  };
};

export const summarizeOrderBookDepth = ({
  venue = 'binance',
  depth,
  levels = [5, 10, 20, 50, 100],
  source = 'binance_depth',
}: {
  venue?: string;
  depth: OrderBookDepth;
  levels?: number[];
  source?: string;
}): MarketOrderBookDepthRow => {
  const bid = depth.bids[0]?.[0] ?? null;
  const ask = depth.asks[0]?.[0] ?? null;
  const mid = bid != null && ask != null ? (bid + ask) / 2 : null;
  const spreadBps =
    bid != null && ask != null && mid != null && mid > 0
      ? ((ask - bid) / mid) * 10_000
      : null;

  return {
    venue,
    symbol: depth.symbol,
    ts: new Date(depth.timestamp),
    lastUpdateId: depth.lastUpdateId,
    bid,
    ask,
    mid,
    spreadBps,
    levels: levels.map((level) =>
      summarizeLevels(depth.bids, depth.asks, level),
    ),
    rawBidLevels: depth.bids.length,
    rawAskLevels: depth.asks.length,
    source,
  };
};

export const buildMarketBreadthRows = ({
  universe,
  interval,
  candlesBySymbol,
  source = 'binance_klines',
}: {
  universe: string;
  interval: MarketFeatureInterval;
  candlesBySymbol: Record<string, KlineChartData>;
  source?: string;
}): MarketBreadthRow[] => {
  const timestamps = new Set<number>();
  for (const candles of Object.values(candlesBySymbol)) {
    for (const candle of candles) timestamps.add(candle.timestamp);
  }

  return [...timestamps]
    .sort((a, b) => a - b)
    .map((timestamp) => {
      const returns: number[] = [];
      const weightedReturns: Array<{ value: number; weight: number }> = [];
      let advancers = 0;
      let decliners = 0;
      let unchanged = 0;
      let aboveMa20 = 0;
      let aboveMa20Eligible = 0;
      let aboveMa50 = 0;
      let aboveMa50Eligible = 0;

      for (const candles of Object.values(candlesBySymbol)) {
        const index = candles.findIndex(
          (candle) => candle.timestamp === timestamp,
        );
        if (index < 0) continue;
        const candle = candles[index];
        const previous = candles[index - 1];
        const ret =
          previous && previous.close > 0
            ? (candle.close - previous.close) / previous.close
            : 0;

        if (ret > 0) advancers += 1;
        else if (ret < 0) decliners += 1;
        else unchanged += 1;
        returns.push(ret);
        weightedReturns.push({
          value: ret,
          weight: Math.max(0, candle.turnover ?? 0),
        });

        const ma20Window = candles.slice(Math.max(0, index - 19), index + 1);
        if (ma20Window.length >= 20) {
          aboveMa20Eligible += 1;
          const ma20 = mean(ma20Window.map((item) => item.close));
          if (ma20 != null && candle.close > ma20) aboveMa20 += 1;
        }

        const ma50Window = candles.slice(Math.max(0, index - 49), index + 1);
        if (ma50Window.length >= 50) {
          aboveMa50Eligible += 1;
          const ma50 = mean(ma50Window.map((item) => item.close));
          if (ma50 != null && candle.close > ma50) aboveMa50 += 1;
        }
      }

      const weightSum = weightedReturns.reduce(
        (sum, item) => sum + item.weight,
        0,
      );
      const volumeWeightedReturn =
        weightSum > 0
          ? weightedReturns.reduce(
              (sum, item) => sum + item.value * item.weight,
              0,
            ) / weightSum
          : null;

      return {
        universe,
        interval,
        ts: new Date(timestamp),
        symbolsCount: returns.length,
        advancers,
        decliners,
        unchanged,
        advanceDeclineRatio: safeDivide(advancers, decliners || 1),
        pctAboveMa20: safeDivide(aboveMa20, aboveMa20Eligible),
        pctAboveMa50: safeDivide(aboveMa50, aboveMa50Eligible),
        equalWeightedReturn: mean(returns),
        volumeWeightedReturn,
        dispersion: standardDeviation(returns),
        source,
      };
    })
    .filter((row) => row.symbolsCount > 0);
};
