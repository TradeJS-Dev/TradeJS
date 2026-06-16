import {
  coinMarketCapExchangeQuotesPayloadToLiquidityRows,
  coinMarketCapFearGreedPayloadToRows,
  coinMarketCapGlobalPayloadToRows,
  coinMarketCapHistoricalQuotesPayloadToRows,
  resolveCoinMarketCapBackfillWindow,
  shouldBackfillCoinMarketCapContextForBacktest,
  shouldBackfillCoinMarketCapContextForReplay,
  shouldBackfillCoinMarketCapContextForSignals,
} from '../lib/coinMarketCapContextBackfill';

describe('coinMarketCapContextBackfill', () => {
  beforeEach(() => {
    delete process.env.COINMARKETCAP_CONTEXT_BACKFILL_ENABLED;
  });

  it('maps historical global metrics rows', () => {
    const rows = coinMarketCapGlobalPayloadToRows({
      data: {
        quotes: [
          {
            timestamp: '2026-01-01T00:00:00.000Z',
            active_cryptocurrencies: 14000,
            active_exchanges: 780,
            active_market_pairs: 120000,
            btc_dominance: 54.5,
            eth_dominance: 17.2,
            quote: {
              USD: {
                total_market_cap: 2600000000000,
                total_volume_24h: 120000000000,
                total_volume_24h_reported: 110000000000,
                altcoin_market_cap: 1200000000000,
                altcoin_volume_24h: 55000000000,
                altcoin_volume_24h_reported: 50000000000,
              },
            },
          },
        ],
      },
    });

    expect(rows).toEqual([
      expect.objectContaining({
        source: 'coinmarketcap_global',
        activeCryptocurrencies: 14000,
        activeExchanges: 780,
        activeMarketPairs: 120000,
        totalMarketCapUsd: 2600000000000,
        totalVolumeUsd: 120000000000,
        totalVolumeReportedUsd: 110000000000,
        btcDominancePct: 54.5,
        ethDominancePct: 17.2,
        altMarketCapUsd: 1200000000000,
        altVolumeUsd: 55000000000,
        altVolumeReportedUsd: 50000000000,
      }),
    ]);
  });

  it('maps historical daily BTC and ETH quote rows', () => {
    const rows = coinMarketCapHistoricalQuotesPayloadToRows(
      {
        data: {
          1: {
            id: 1,
            symbol: 'BTC',
            quotes: [
              {
                timestamp: '2026-01-01T00:00:00.000Z',
                quote: {
                  USD: {
                    price: 105,
                    volume_24h: 1000,
                    market_cap: 2000,
                  },
                },
              },
            ],
          },
          1027: {
            id: 1027,
            symbol: 'ETH',
            quotes: [
              {
                timestamp: '2026-01-01T00:00:00.000Z',
                quote: {
                  USD: {
                    price: 10.5,
                    volume_24h: 100,
                    market_cap: 500,
                  },
                },
              },
            ],
          },
        },
      },
      '1d',
    );

    expect(rows).toEqual([
      expect.objectContaining({
        source: 'coinmarketcap_reference_asset',
        symbol: 'BTCUSDT',
        cmcId: 1,
        interval: '1d',
        closeUsd: 105,
        volumeUsd: 1000,
        marketCapUsd: 2000,
      }),
      expect.objectContaining({
        source: 'coinmarketcap_reference_asset',
        symbol: 'ETHUSDT',
        cmcId: 1027,
        interval: '1d',
        closeUsd: 10.5,
        volumeUsd: 100,
        marketCapUsd: 500,
      }),
    ]);
  });

  it('maps daily BTC and ETH quote rows', () => {
    const rows = coinMarketCapHistoricalQuotesPayloadToRows({
      data: {
        1: {
          id: 1,
          symbol: 'BTC',
          quotes: [
            {
              timestamp: '2026-01-01T01:00:00.000Z',
              quote: {
                USD: {
                  price: 101,
                  volume_24h: 1000,
                  market_cap: 2000,
                },
              },
            },
          ],
        },
        1027: {
          id: 1027,
          symbol: 'ETH',
          quotes: [
            {
              timestamp: '2026-01-01T01:00:00.000Z',
              quote: {
                USD: {
                  price: 11,
                  volume_24h: 100,
                  market_cap: 500,
                },
              },
            },
          ],
        },
      },
    });

    expect(rows).toEqual([
      expect.objectContaining({
        source: 'coinmarketcap_reference_asset',
        symbol: 'BTCUSDT',
        interval: '1d',
        closeUsd: 101,
        volumeUsd: 1000,
        marketCapUsd: 2000,
      }),
      expect.objectContaining({
        source: 'coinmarketcap_reference_asset',
        symbol: 'ETHUSDT',
        interval: '1d',
        closeUsd: 11,
        volumeUsd: 100,
        marketCapUsd: 500,
      }),
    ]);
  });

  it('aggregates historical exchange quotes into CMC exchange liquidity', () => {
    const rows = coinMarketCapExchangeQuotesPayloadToLiquidityRows({
      data: {
        binance: {
          name: 'Binance',
          slug: 'binance',
          quotes: [
            {
              timestamp: '2026-01-01T00:00:00.000Z',
              quote: { USD: { volume_24h: 60 } },
            },
          ],
        },
        kraken: {
          name: 'Kraken',
          slug: 'kraken',
          quotes: [
            {
              timestamp: '2026-01-01T00:00:00.000Z',
              quote: { USD: { volume_24h: 40 } },
            },
          ],
        },
      },
    });

    expect(rows).toEqual([
      expect.objectContaining({
        source: 'coinmarketcap_exchange_liquidity',
        interval: '1d',
        exchangesCount: 2,
        totalVolumeUsd: 100,
        binanceVolumeUsd: 60,
        binanceVolumeShare: 0.6,
        topExchangeVolumeShare: 0.6,
        liquidityRegime: 'binance_led',
      }),
    ]);
  });

  it('maps historical Fear and Greed rows', () => {
    const rows = coinMarketCapFearGreedPayloadToRows({
      data: [
        {
          timestamp: '1726617600',
          value: 38,
          value_classification: 'Fear',
        },
      ],
    });

    expect(rows).toEqual([
      expect.objectContaining({
        source: 'coinmarketcap_fear_greed',
        interval: '1d',
        ts: new Date('2024-09-18T00:00:00.000Z'),
        value: 38,
        classification: 'Fear',
        sentimentRegime: 'risk_off',
      }),
    ]);
  });

  it('clamps requested windows to the CMC historical access floor', () => {
    const window = resolveCoinMarketCapBackfillWindow({
      userName: 'root',
      startMs: Date.parse('2022-03-08T20:18:03.000Z'),
      endMs: Date.parse('2026-06-15T20:18:03.000Z'),
      preloadStartMs: Date.parse('2022-03-08T20:18:03.000Z'),
      nowMs: Date.parse('2026-06-15T21:00:17.558Z'),
    });

    expect(new Date(window.fromMs).toISOString()).toBe(
      '2023-06-16T00:00:00.000Z',
    );
    expect(new Date(window.toMs).toISOString()).toBe(
      '2026-06-15T00:00:00.000Z',
    );
  });

  it('defaults to historical backfill for AI/ML backtests but not cache-only runs', () => {
    expect(
      shouldBackfillCoinMarketCapContextForBacktest({
        aiEnabled: true,
        mlEnabled: false,
        cacheOnly: false,
      }),
    ).toBe(true);
    expect(
      shouldBackfillCoinMarketCapContextForBacktest({
        aiEnabled: false,
        mlEnabled: true,
        cacheOnly: false,
      }),
    ).toBe(true);
    expect(
      shouldBackfillCoinMarketCapContextForBacktest({
        aiEnabled: true,
        mlEnabled: false,
        cacheOnly: true,
      }),
    ).toBe(false);
  });

  it('defaults to historical backfill for replay and signals when not cache-only', () => {
    expect(
      shouldBackfillCoinMarketCapContextForReplay({
        cacheOnly: false,
      }),
    ).toBe(true);
    expect(
      shouldBackfillCoinMarketCapContextForSignals({
        cacheOnly: false,
      }),
    ).toBe(true);
    expect(
      shouldBackfillCoinMarketCapContextForReplay({
        cacheOnly: true,
      }),
    ).toBe(false);
    expect(
      shouldBackfillCoinMarketCapContextForSignals({
        cacheOnly: true,
      }),
    ).toBe(false);
  });
});
