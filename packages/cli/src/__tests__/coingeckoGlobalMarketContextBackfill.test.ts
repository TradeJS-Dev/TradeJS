import {
  coingeckoGlobalPayloadToRow,
  shouldBackfillCoingeckoGlobalContextForBacktest,
  shouldBackfillCoingeckoGlobalContextForReplay,
  shouldBackfillCoingeckoGlobalContextForSignals,
} from '../lib/coingeckoGlobalMarketContextBackfill';

describe('coingeckoGlobalMarketContextBackfill', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.COINGECKO_GLOBAL_CONTEXT_ENABLED;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('maps CoinGecko /global payload to a compact BTC dominance row', () => {
    const row = coingeckoGlobalPayloadToRow({
      data: {
        active_cryptocurrencies: 12_000,
        markets: 900,
        total_market_cap: {
          usd: 3_000_000_000_000,
        },
        total_volume: {
          usd: 120_000_000_000,
        },
        market_cap_percentage: {
          btc: 55,
          eth: 12,
        },
        market_cap_change_percentage_24h_usd: -1.25,
        updated_at: 1_780_000_000,
      },
    });

    expect(row).toEqual({
      source: 'coingecko_global',
      ts: new Date(1_780_000_000_000),
      updatedAt: new Date(1_780_000_000_000),
      activeCryptocurrencies: 12_000,
      markets: 900,
      totalMarketCapUsd: 3_000_000_000_000,
      totalVolumeUsd: 120_000_000_000,
      btcDominancePct: 55,
      ethDominancePct: 12,
      altMarketCapUsd: 1_350_000_000_000,
      btcToAltMarketCapRatio: 1_650_000_000_000 / 1_350_000_000_000,
      marketCapChangePct24hUsd: -1.25,
    });
  });

  it('uses AI/ML-aware defaults for backtest and live defaults for signals/replay', () => {
    expect(
      shouldBackfillCoingeckoGlobalContextForBacktest({
        aiEnabled: true,
        mlEnabled: false,
        cacheOnly: false,
      }),
    ).toBe(true);
    expect(
      shouldBackfillCoingeckoGlobalContextForBacktest({
        aiEnabled: false,
        mlEnabled: false,
        cacheOnly: false,
      }),
    ).toBe(false);
    expect(
      shouldBackfillCoingeckoGlobalContextForSignals({ cacheOnly: false }),
    ).toBe(true);
    expect(
      shouldBackfillCoingeckoGlobalContextForReplay({ cacheOnly: false }),
    ).toBe(true);
    expect(
      shouldBackfillCoingeckoGlobalContextForReplay({ cacheOnly: true }),
    ).toBe(false);
  });

  it('allows disabling the optional CoinGecko context with env flag', () => {
    process.env.COINGECKO_GLOBAL_CONTEXT_ENABLED = '0';

    expect(
      shouldBackfillCoingeckoGlobalContextForSignals({ cacheOnly: false }),
    ).toBe(false);
    expect(
      shouldBackfillCoingeckoGlobalContextForBacktest({
        aiEnabled: true,
        mlEnabled: true,
        cacheOnly: false,
      }),
    ).toBe(false);
  });
});
