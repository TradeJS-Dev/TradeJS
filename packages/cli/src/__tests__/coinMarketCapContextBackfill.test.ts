import {
  coinMarketCapGlobalPayloadToRows,
  coinMarketCapOhlcvPayloadToRows,
  shouldBackfillCoinMarketCapContextForBacktest,
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

  it('maps historical BTC and ETH OHLCV rows', () => {
    const rows = coinMarketCapOhlcvPayloadToRows({
      data: {
        1: {
          id: 1,
          symbol: 'BTC',
          quotes: [
            {
              quote: {
                USD: {
                  timestamp: '2026-01-01T00:00:00.000Z',
                  open: 100,
                  high: 110,
                  low: 90,
                  close: 105,
                  volume: 1000,
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
              quote: {
                USD: {
                  timestamp: '2026-01-01T00:00:00.000Z',
                  open: 10,
                  high: 11,
                  low: 9,
                  close: 10.5,
                  volume: 100,
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
});
