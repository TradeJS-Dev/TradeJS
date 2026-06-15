import {
  aggregateAggTradesToRows,
  buildMarketBreadthRows,
  classifyBtcAltRegime,
  estimateBinanceMarketDataVolume,
  selectBreadthUniverseFromTickers,
} from '../lib/binanceMarketData';

const makeKline = (
  timestamp: number,
  close: number,
  turnover = close * 10,
) => ({
  timestamp,
  open: close,
  high: close,
  low: close,
  close,
  volume: 10,
  turnover,
  dt: '',
});

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

  it('adds BTC-vs-alt regime metrics to market breadth rows', () => {
    const timestamps = Array.from(
      { length: 98 },
      (_, index) => index * 900_000,
    );
    const ethCandles = timestamps.map((timestamp, index) =>
      makeKline(timestamp, 100 + index * 2, 1_000 + index),
    );
    const solCandles = timestamps.map((timestamp, index) =>
      makeKline(timestamp, 100 + index * 3, 900 + index),
    );
    const btcCandles = timestamps.map((timestamp, index) =>
      makeKline(timestamp, 100 + index, 5_000 + index),
    );

    const rows = buildMarketBreadthRows({
      universe: 'top2_usdt',
      interval: '15m',
      candlesBySymbol: {
        ETHUSDT: ethCandles,
        SOLUSDT: solCandles,
      },
      btcCandles,
    });
    const lastRow = rows[rows.length - 1];

    expect(lastRow.btcReturn24h).toBeCloseTo(
      (btcCandles[97].close - btcCandles[1].close) / btcCandles[1].close,
      12,
    );
    expect(lastRow.altBasketReturn24h).toBeCloseTo(
      ((ethCandles[97].close - ethCandles[1].close) / ethCandles[1].close +
        (solCandles[97].close - solCandles[1].close) / solCandles[1].close) /
        2,
      12,
    );
    expect(lastRow.btcVsAltReturn24h).toBeLessThan(0);
    expect(lastRow.btcTurnoverShare24h).toBeGreaterThan(0);
    expect(lastRow.altVolToBtcVol24h).toBeGreaterThan(0);
    expect(lastRow.btcAltRegime).toBe('risk_on');
  });

  it('classifies BTC-alt regimes from 24h relative returns', () => {
    expect(
      classifyBtcAltRegime({
        btcReturn24h: 0.04,
        altBasketReturn24h: 0.01,
        btcVsAltReturn24h: 0.03,
      }),
    ).toBe('btc_lead');
    expect(
      classifyBtcAltRegime({
        btcReturn24h: -0.02,
        altBasketReturn24h: -0.04,
        btcVsAltReturn24h: 0.02,
      }),
    ).toBe('risk_off');
    expect(
      classifyBtcAltRegime({
        btcReturn24h: null,
        altBasketReturn24h: 0.01,
        btcVsAltReturn24h: -0.01,
      }),
    ).toBe('unknown');
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
        includeBreadth: true,
        breadthLimit: 30,
      }),
    ).toMatchObject({
      bucketRowsPerSymbol: 96,
      aggTradeBucketRows: 192,
      breadthSymbols: 30,
      breadthCandleRows: 2880,
      breadthRows: 96,
      estimatedStoredRows: 288,
    });
  });
});
