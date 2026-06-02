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

const buildPrefixSum = (values: number[]) => {
  const prefix = [0];
  for (const value of values) prefix.push(prefix[prefix.length - 1] + value);
  return prefix;
};

const sumPrefixRange = (
  prefix: number[],
  startIndex: number,
  endIndexInclusive: number,
) => {
  if (endIndexInclusive < startIndex) return 0;
  const start = Math.max(0, startIndex);
  const end = Math.min(prefix.length - 2, endIndexInclusive);
  if (end < start) return 0;
  return prefix[end + 1] - prefix[start];
};

const windowReturn = (
  candles: KlineChartData,
  index: number,
  lookbackBars: number,
) => {
  const previous = candles[index - lookbackBars];
  const current = candles[index];
  return previous && previous.close > 0
    ? (current.close - previous.close) / previous.close
    : null;
};

type BtcAltRegime = NonNullable<MarketBreadthRow['btcAltRegime']>;

export const classifyBtcAltRegime = ({
  btcReturn24h,
  altBasketReturn24h,
  btcVsAltReturn24h,
}: {
  btcReturn24h?: number | null;
  altBasketReturn24h?: number | null;
  btcVsAltReturn24h?: number | null;
}): BtcAltRegime => {
  if (
    btcReturn24h == null ||
    altBasketReturn24h == null ||
    btcVsAltReturn24h == null
  ) {
    return 'unknown';
  }

  if (btcReturn24h < -0.015 && altBasketReturn24h < -0.025) {
    return 'risk_off';
  }
  if (
    btcReturn24h > 0.005 &&
    altBasketReturn24h > 0.005 &&
    altBasketReturn24h > btcReturn24h
  ) {
    return 'risk_on';
  }
  if (btcVsAltReturn24h > 0.005) return 'btc_lead';
  if (btcVsAltReturn24h < -0.005) return 'alt_lead';
  return 'neutral';
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
  btcCandles,
  source = 'binance_klines',
}: {
  universe: string;
  interval: MarketFeatureInterval;
  candlesBySymbol: Record<string, KlineChartData>;
  btcCandles?: KlineChartData;
  source?: string;
}): MarketBreadthRow[] => {
  const timestamps = new Set<number>();
  const indexedSymbols = Object.values(candlesBySymbol).map((candles) => ({
    candles,
    byTimestamp: new Map(
      candles.map((candle, index) => [candle.timestamp, index]),
    ),
    turnoverPrefix: buildPrefixSum(
      candles.map((candle) => Math.max(0, candle.turnover ?? 0)),
    ),
    closePrefix: buildPrefixSum(candles.map((candle) => candle.close)),
  }));
  const btcIndexed = btcCandles
    ? {
        candles: btcCandles,
        byTimestamp: new Map(
          btcCandles.map((candle, index) => [candle.timestamp, index]),
        ),
        turnoverPrefix: buildPrefixSum(
          btcCandles.map((candle) => Math.max(0, candle.turnover ?? 0)),
        ),
      }
    : null;
  const intervalMs = MARKET_FEATURE_INTERVAL_MS[interval];
  const bars1h = Math.max(1, Math.round(3_600_000 / intervalMs));
  const bars4h = Math.max(1, Math.round(14_400_000 / intervalMs));
  const bars24h = Math.max(1, Math.round(86_400_000 / intervalMs));

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
      const altReturns1h: number[] = [];
      const altReturns4h: number[] = [];
      const altReturns24h: number[] = [];
      let altTurnover1h = 0;
      let altTurnover24h = 0;
      let previousAltTurnover24h = 0;

      for (const indexed of indexedSymbols) {
        const { candles, byTimestamp, turnoverPrefix, closePrefix } = indexed;
        const index = byTimestamp.get(timestamp);
        if (index == null) continue;
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

        const ma20Start = index - 19;
        if (ma20Start >= 0) {
          aboveMa20Eligible += 1;
          const ma20 = sumPrefixRange(closePrefix, ma20Start, index) / 20;
          if (candle.close > ma20) aboveMa20 += 1;
        }

        const ma50Start = index - 49;
        if (ma50Start >= 0) {
          aboveMa50Eligible += 1;
          const ma50 = sumPrefixRange(closePrefix, ma50Start, index) / 50;
          if (candle.close > ma50) aboveMa50 += 1;
        }

        const altReturn1h = windowReturn(candles, index, bars1h);
        const altReturn4h = windowReturn(candles, index, bars4h);
        const altReturn24h = windowReturn(candles, index, bars24h);
        if (altReturn1h != null) altReturns1h.push(altReturn1h);
        if (altReturn4h != null) altReturns4h.push(altReturn4h);
        if (altReturn24h != null) altReturns24h.push(altReturn24h);
        altTurnover1h += sumPrefixRange(
          turnoverPrefix,
          index - bars1h + 1,
          index,
        );
        altTurnover24h += sumPrefixRange(
          turnoverPrefix,
          index - bars24h + 1,
          index,
        );
        previousAltTurnover24h += sumPrefixRange(
          turnoverPrefix,
          index - bars24h * 2 + 1,
          index - bars24h,
        );
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

      const btcIndex = btcIndexed?.byTimestamp.get(timestamp);
      const btcReturn1h =
        btcIndexed && btcIndex != null
          ? windowReturn(btcIndexed.candles, btcIndex, bars1h)
          : null;
      const btcReturn4h =
        btcIndexed && btcIndex != null
          ? windowReturn(btcIndexed.candles, btcIndex, bars4h)
          : null;
      const btcReturn24h =
        btcIndexed && btcIndex != null
          ? windowReturn(btcIndexed.candles, btcIndex, bars24h)
          : null;
      const btcTurnover1h =
        btcIndexed && btcIndex != null
          ? sumPrefixRange(
              btcIndexed.turnoverPrefix,
              btcIndex - bars1h + 1,
              btcIndex,
            )
          : null;
      const btcTurnover24h =
        btcIndexed && btcIndex != null
          ? sumPrefixRange(
              btcIndexed.turnoverPrefix,
              btcIndex - bars24h + 1,
              btcIndex,
            )
          : null;
      const previousBtcTurnover24h =
        btcIndexed && btcIndex != null
          ? sumPrefixRange(
              btcIndexed.turnoverPrefix,
              btcIndex - bars24h * 2 + 1,
              btcIndex - bars24h,
            )
          : null;
      const altBasketReturn1h = mean(altReturns1h);
      const altBasketReturn4h = mean(altReturns4h);
      const altBasketReturn24h = mean(altReturns24h);
      const btcVsAltReturn1h =
        btcReturn1h == null || altBasketReturn1h == null
          ? null
          : btcReturn1h - altBasketReturn1h;
      const btcVsAltReturn4h =
        btcReturn4h == null || altBasketReturn4h == null
          ? null
          : btcReturn4h - altBasketReturn4h;
      const btcVsAltReturn24h =
        btcReturn24h == null || altBasketReturn24h == null
          ? null
          : btcReturn24h - altBasketReturn24h;
      const btcTurnoverShare1h =
        btcTurnover1h == null
          ? null
          : safeDivide(btcTurnover1h, btcTurnover1h + altTurnover1h);
      const btcTurnoverShare24h =
        btcTurnover24h == null
          ? null
          : safeDivide(btcTurnover24h, btcTurnover24h + altTurnover24h);
      const previousBtcTurnoverShare24h =
        previousBtcTurnover24h == null
          ? null
          : safeDivide(
              previousBtcTurnover24h,
              previousBtcTurnover24h + previousAltTurnover24h,
            );
      const btcTurnoverShareChange24h =
        btcTurnoverShare24h == null || previousBtcTurnoverShare24h == null
          ? null
          : btcTurnoverShare24h - previousBtcTurnoverShare24h;

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
        btcReturn1h,
        btcReturn4h,
        btcReturn24h,
        altBasketReturn1h,
        altBasketReturn4h,
        altBasketReturn24h,
        btcVsAltReturn1h,
        btcVsAltReturn4h,
        btcVsAltReturn24h,
        btcTurnoverShare1h,
        btcTurnoverShare24h,
        btcTurnoverShareChange24h,
        altVolToBtcVol24h:
          btcTurnover24h == null
            ? null
            : safeDivide(altTurnover24h, btcTurnover24h),
        altDispersion24h: standardDeviation(altReturns24h),
        btcAltRegime: classifyBtcAltRegime({
          btcReturn24h,
          altBasketReturn24h,
          btcVsAltReturn24h,
        }),
        source,
      };
    })
    .filter((row) => row.symbolsCount > 0);
};
