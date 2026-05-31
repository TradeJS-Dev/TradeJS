import {
  aggregateAggTradesToRows,
  buildMarketBreadthRows,
  estimateBinanceMarketDataVolume,
  selectBreadthUniverseFromTickers,
  summarizeOrderBookDepth,
} from '../lib/binanceMarketData';

describe('binanceMarketData helpers', () => {
  it('aggregates Binance aggTrades into interval trade-flow rows', () => {
    const rows = aggregateAggTradesToRows({
      symbol: 'BTCUSDT',
      interval: '1m',
      trades: [
        {
          aggregateTradeId: 1,
          price: 100,
          quantity: 2,
          firstTradeId: 1,
          lastTradeId: 1,
          timestamp: 60_001,
          isBuyerMaker: false,
        },
        {
          aggregateTradeId: 2,
          price: 110,
          quantity: 1,
          firstTradeId: 2,
          lastTradeId: 2,
          timestamp: 61_000,
          isBuyerMaker: true,
        },
      ],
    });

    expect(rows).toEqual([
      expect.objectContaining({
        symbol: 'BTCUSDT',
        interval: '1m',
        ts: new Date(60_000),
        trades: 2,
        buyBaseVolume: 2,
        sellBaseVolume: 1,
        buyQuoteVolume: 200,
        sellQuoteVolume: 110,
        netBaseDelta: 1,
        netQuoteDelta: 90,
        buyPressurePct: 2 / 3,
      }),
    ]);
  });

  it('summarizes order book depth at configured levels', () => {
    const row = summarizeOrderBookDepth({
      depth: {
        symbol: 'ETHUSDT',
        lastUpdateId: 12,
        timestamp: 1_000,
        bids: [
          [99, 2],
          [98, 1],
        ],
        asks: [
          [101, 1],
          [102, 1],
        ],
      },
      levels: [1, 2],
    });

    expect(row).toMatchObject({
      venue: 'binance',
      symbol: 'ETHUSDT',
      ts: new Date(1_000),
      bid: 99,
      ask: 101,
      mid: 100,
      spreadBps: 200,
      rawBidLevels: 2,
      rawAskLevels: 2,
    });
    expect(row.levels).toEqual([
      {
        levels: 1,
        bidBaseVolume: 2,
        askBaseVolume: 1,
        bidQuoteVolume: 198,
        askQuoteVolume: 101,
        imbalance: (198 - 101) / (198 + 101),
      },
      {
        levels: 2,
        bidBaseVolume: 3,
        askBaseVolume: 2,
        bidQuoteVolume: 296,
        askQuoteVolume: 203,
        imbalance: (296 - 203) / (296 + 203),
      },
    ]);
  });

  it('builds market breadth rows from aligned candles', () => {
    const rows = buildMarketBreadthRows({
      universe: 'top2_usdt',
      interval: '15m',
      candlesBySymbol: {
        ETHUSDT: [
          {
            timestamp: 1,
            open: 100,
            high: 100,
            low: 100,
            close: 100,
            volume: 1,
            turnover: 100,
            dt: '',
          },
          {
            timestamp: 2,
            open: 100,
            high: 101,
            low: 100,
            close: 101,
            volume: 1,
            turnover: 101,
            dt: '',
          },
        ],
        SOLUSDT: [
          {
            timestamp: 1,
            open: 100,
            high: 100,
            low: 100,
            close: 100,
            volume: 1,
            turnover: 100,
            dt: '',
          },
          {
            timestamp: 2,
            open: 100,
            high: 100,
            low: 99,
            close: 99,
            volume: 1,
            turnover: 99,
            dt: '',
          },
        ],
      },
    });

    expect(rows.find((row) => row.ts.getTime() === 2)).toMatchObject({
      symbolsCount: 2,
      advancers: 1,
      decliners: 1,
      unchanged: 0,
      advanceDeclineRatio: 1,
      equalWeightedReturn: 0,
    });
  });

  it('selects liquid non-stable USDT symbols for breadth universe', () => {
    const symbols = selectBreadthUniverseFromTickers(
      [
        { symbol: 'BTCUSDT', turnover24h: 10_000 } as any,
        { symbol: 'USDCUSDT', turnover24h: 9_000 } as any,
        { symbol: 'ETHUSDT', turnover24h: 8_000 } as any,
        { symbol: 'SOLUSDT', turnover24h: 7_000 } as any,
      ],
      2,
    );

    expect(symbols).toEqual(['ETHUSDT', 'SOLUSDT']);
  });

  it('estimates stored rows before heavy Binance ingestion', () => {
    expect(
      estimateBinanceMarketDataVolume({
        symbols: ['BTCUSDT', 'ETHUSDT'],
        days: 1,
        interval: '15m',
        includeAggTrades: true,
        includeDepth: true,
        includeBreadth: true,
        breadthLimit: 30,
      }),
    ).toMatchObject({
      bucketRowsPerSymbol: 96,
      aggTradeBucketRows: 192,
      depthSnapshotRows: 2,
      breadthSymbols: 30,
      breadthCandleRows: 2880,
      breadthRows: 96,
      estimatedStoredRows: 290,
    });
  });
});
