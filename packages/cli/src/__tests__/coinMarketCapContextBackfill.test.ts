const mockGetMarketGlobalContextCoverage = jest.fn();
const mockGetMarketReferenceAssetContextCoverage = jest.fn();
const mockGetMarketCmcExchangeLiquidityContextCoverage = jest.fn();
const mockGetMarketCmcFearGreedContextCoverage = jest.fn();
const mockGetMarketCmcIndexContextCoverage = jest.fn();
const mockGetMarketContextBackfillCoverage = jest.fn();
const mockUpsertMarketGlobalContextRows = jest.fn();
const mockUpsertMarketReferenceAssetContextRows = jest.fn();
const mockUpsertMarketCmcExchangeLiquidityContextRows = jest.fn();
const mockUpsertMarketCmcFearGreedContextRows = jest.fn();
const mockUpsertMarketCmcIndexContextRows = jest.fn();
const mockUpsertMarketContextBackfillCoverage = jest.fn();
const mockWaitForDbReady = jest.fn();
const mockGetUserSettings = jest.fn();

jest.mock('@tradejs/infra/timescale/marketContext', () => ({
  getMarketGlobalContextCoverage: (...args: unknown[]) =>
    mockGetMarketGlobalContextCoverage(...args),
  getMarketReferenceAssetContextCoverage: (...args: unknown[]) =>
    mockGetMarketReferenceAssetContextCoverage(...args),
  getMarketCmcExchangeLiquidityContextCoverage: (...args: unknown[]) =>
    mockGetMarketCmcExchangeLiquidityContextCoverage(...args),
  getMarketCmcFearGreedContextCoverage: (...args: unknown[]) =>
    mockGetMarketCmcFearGreedContextCoverage(...args),
  getMarketCmcIndexContextCoverage: (...args: unknown[]) =>
    mockGetMarketCmcIndexContextCoverage(...args),
  getMarketContextBackfillCoverage: (...args: unknown[]) =>
    mockGetMarketContextBackfillCoverage(...args),
  upsertMarketGlobalContextRows: (...args: unknown[]) =>
    mockUpsertMarketGlobalContextRows(...args),
  upsertMarketReferenceAssetContextRows: (...args: unknown[]) =>
    mockUpsertMarketReferenceAssetContextRows(...args),
  upsertMarketCmcExchangeLiquidityContextRows: (...args: unknown[]) =>
    mockUpsertMarketCmcExchangeLiquidityContextRows(...args),
  upsertMarketCmcFearGreedContextRows: (...args: unknown[]) =>
    mockUpsertMarketCmcFearGreedContextRows(...args),
  upsertMarketCmcIndexContextRows: (...args: unknown[]) =>
    mockUpsertMarketCmcIndexContextRows(...args),
  upsertMarketContextBackfillCoverage: (...args: unknown[]) =>
    mockUpsertMarketContextBackfillCoverage(...args),
}));

jest.mock('@tradejs/infra/timescale/client', () => ({
  waitForDbReady: (...args: unknown[]) => mockWaitForDbReady(...args),
}));

jest.mock('@tradejs/infra/userSettings', () => ({
  getUserSettings: (...args: unknown[]) => mockGetUserSettings(...args),
}));

import {
  backfillCoinMarketCapContextForSignals,
  coinMarketCapExchangeQuotesPayloadToLiquidityRows,
  coinMarketCapFearGreedPayloadToRows,
  coinMarketCapGlobalPayloadToRows,
  coinMarketCapHistoricalQuotesPayloadToRows,
  coinMarketCapIndexPayloadToRows,
  coverageRowsToKeySet,
  resolveCoinMarketCapBackfillWindow,
  shouldBackfillCoinMarketCapContextForBacktest,
  shouldBackfillCoinMarketCapContextForReplay,
  shouldBackfillCoinMarketCapContextForSignals,
} from '../lib/coinMarketCapContextBackfill';

describe('coinMarketCapContextBackfill', () => {
  const originalDateNow = Date.now;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    Date.now = originalDateNow;
    delete process.env.COINMARKETCAP_CONTEXT_BACKFILL_ENABLED;
    delete process.env.COINMARKETCAP_CONTEXT_EXCHANGE_LIQUIDITY_ENABLED;
    delete process.env.COINMARKETCAP_CONTEXT_FEAR_GREED_ENABLED;
    delete process.env.COINMARKETCAP_CONTEXT_FEAR_GREED_STALE_RETRY_MS;
    delete process.env.COINMARKETCAP_CONTEXT_MAX_AGE_MS;
    mockGetMarketGlobalContextCoverage.mockResolvedValue(null);
    mockGetMarketReferenceAssetContextCoverage.mockResolvedValue(new Map());
    mockGetMarketCmcExchangeLiquidityContextCoverage.mockResolvedValue(null);
    mockGetMarketCmcFearGreedContextCoverage.mockResolvedValue(null);
    mockGetMarketCmcIndexContextCoverage.mockResolvedValue(new Map());
    mockGetMarketContextBackfillCoverage.mockResolvedValue([]);
    mockUpsertMarketGlobalContextRows.mockResolvedValue(undefined);
    mockUpsertMarketReferenceAssetContextRows.mockResolvedValue(undefined);
    mockUpsertMarketCmcExchangeLiquidityContextRows.mockResolvedValue(
      undefined,
    );
    mockUpsertMarketCmcFearGreedContextRows.mockResolvedValue(undefined);
    mockUpsertMarketCmcIndexContextRows.mockResolvedValue(undefined);
    mockUpsertMarketContextBackfillCoverage.mockResolvedValue(undefined);
    mockWaitForDbReady.mockResolvedValue(undefined);
    mockGetUserSettings.mockResolvedValue({ COINMARKETCAP_API_KEY: 'test' });
  });

  afterEach(() => {
    Date.now = originalDateNow;
    global.fetch = originalFetch;
  });

  afterAll(() => {
    Date.now = originalDateNow;
    global.fetch = originalFetch;
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

  it('maps historical CMC index rows', () => {
    const rows = coinMarketCapIndexPayloadToRows(
      {
        data: [
          {
            update_time: '2026-01-01T00:00:00.000Z',
            value: 224.5,
            constituents: [
              {
                id: 1,
                name: 'Bitcoin',
                symbol: 'BTC',
                url: 'https://coinmarketcap.com/currencies/bitcoin/',
                weight: '64.2%',
                priceUsd: '105000',
                units: '0.001',
              },
              {
                id: 1027,
                name: 'Ethereum',
                symbol: 'ETH',
                weight: 12.5,
                priceUsd: 3800,
                units: 0.01,
              },
            ],
          },
        ],
      },
      'cmc100',
    );

    expect(rows).toEqual([
      expect.objectContaining({
        source: 'coinmarketcap_index',
        indexSlug: 'cmc100',
        interval: '1d',
        ts: new Date('2026-01-01T00:00:00.000Z'),
        value: 224.5,
        constituentsCount: 2,
        topConstituentSymbol: 'BTC',
        topConstituentWeightPct: 64.2,
        constituents: [
          expect.objectContaining({
            id: 1,
            symbol: 'BTC',
            weightPct: 64.2,
            priceUsd: 105000,
            units: 0.001,
          }),
          expect.objectContaining({
            id: 1027,
            symbol: 'ETH',
            weightPct: 12.5,
            priceUsd: 3800,
            units: 0.01,
          }),
        ],
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

  it('uses preload warmup for point-in-time signals backfill', async () => {
    const nowMs = Date.parse('2026-06-19T15:27:40.000Z');
    const preloadStartMs = nowMs - 60 * 86_400_000;
    Date.now = jest.fn(() => nowMs);
    const window = resolveCoinMarketCapBackfillWindow({
      userName: 'root',
      startMs: nowMs,
      endMs: nowMs,
      preloadStartMs,
      nowMs,
    });
    const rows = Math.max(
      1,
      Math.floor((window.toMs - window.fromMs) / 86_400_000),
    );
    const readyCoverage = {
      firstMs: window.fromMs,
      lastMs: window.toMs,
      rows,
    };
    mockGetMarketGlobalContextCoverage.mockResolvedValue(readyCoverage);
    mockGetMarketReferenceAssetContextCoverage.mockResolvedValue(
      new Map([
        ['BTCUSDT', readyCoverage],
        ['ETHUSDT', readyCoverage],
      ]),
    );
    mockGetMarketCmcExchangeLiquidityContextCoverage.mockResolvedValue(
      readyCoverage,
    );
    mockGetMarketCmcFearGreedContextCoverage.mockResolvedValue(readyCoverage);
    mockGetMarketCmcIndexContextCoverage.mockResolvedValue(
      new Map([
        ['cmc100', readyCoverage],
        ['cmc20', readyCoverage],
      ]),
    );

    const result = await backfillCoinMarketCapContextForSignals({
      userName: 'root',
      startMs: nowMs,
      endMs: nowMs,
      preloadStartMs,
    });

    expect(mockWaitForDbReady).toHaveBeenCalled();
    expect(mockGetMarketGlobalContextCoverage).toHaveBeenCalledWith({
      source: 'coinmarketcap_global',
      startMs: window.fromMs,
      endMs: window.toMs,
    });
    expect(result).toEqual(
      expect.objectContaining({
        skipped: true,
        cached: true,
      }),
    );
    expect(mockGetUserSettings).not.toHaveBeenCalled();
  });

  it('retries stale signals Fear and Greed after the coverage cooldown', async () => {
    const nowMs = Date.parse('2026-07-15T15:15:42.000Z');
    const preloadStartMs = nowMs - 60 * 86_400_000;
    const window = resolveCoinMarketCapBackfillWindow({
      userName: 'root',
      startMs: nowMs,
      endMs: nowMs,
      preloadStartMs,
      nowMs,
    });
    const readyCoverage = {
      firstMs: window.fromMs,
      lastMs: window.toMs - 86_400_000,
      rows: 60,
    };
    mockGetMarketGlobalContextCoverage.mockResolvedValue(readyCoverage);
    mockGetMarketReferenceAssetContextCoverage.mockResolvedValue(
      new Map([
        ['BTCUSDT', readyCoverage],
        ['ETHUSDT', readyCoverage],
      ]),
    );
    mockGetMarketCmcExchangeLiquidityContextCoverage.mockResolvedValue(
      readyCoverage,
    );
    mockGetMarketCmcFearGreedContextCoverage.mockResolvedValue({
      firstMs: window.fromMs,
      lastMs: window.toMs - 2 * 86_400_000,
      rows: 59,
    });
    mockGetMarketCmcIndexContextCoverage.mockResolvedValue(
      new Map([
        ['cmc100', readyCoverage],
        ['cmc20', readyCoverage],
      ]),
    );
    mockGetMarketContextBackfillCoverage.mockImplementation(
      async (params: { source: string }) =>
        params.source === 'coinmarketcap_fear_greed'
          ? [
              {
                source: 'coinmarketcap_fear_greed',
                scope: 'all',
                interval: '1d',
                fromMs: window.fromMs,
                toMs: window.toMs,
                rowsCount: 59,
                checkedAtMs: nowMs - 2 * 60 * 60_000,
              },
            ]
          : [],
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: async () => ({
        status: { credit_count: 1 },
        data: [
          {
            timestamp: String(Date.parse('2026-07-14T00:00:00.000Z') / 1000),
            value: 48,
            value_classification: 'Neutral',
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const result = await backfillCoinMarketCapContextForSignals({
      userName: 'root',
      startMs: nowMs,
      endMs: nowMs,
      preloadStartMs,
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(String((global.fetch as jest.Mock).mock.calls[0]?.[0])).toContain(
      '/v3/fear-and-greed/historical',
    );
    expect(result).toEqual(
      expect.objectContaining({
        skipped: false,
        fearGreedRows: 1,
      }),
    );
  });

  it('does not retry stale signals Fear and Greed during the coverage cooldown', async () => {
    const nowMs = Date.parse('2026-07-15T15:15:42.000Z');
    const preloadStartMs = nowMs - 60 * 86_400_000;
    const window = resolveCoinMarketCapBackfillWindow({
      userName: 'root',
      startMs: nowMs,
      endMs: nowMs,
      preloadStartMs,
      nowMs,
    });
    const readyCoverage = {
      firstMs: window.fromMs,
      lastMs: window.toMs - 86_400_000,
      rows: 60,
    };
    mockGetMarketGlobalContextCoverage.mockResolvedValue(readyCoverage);
    mockGetMarketReferenceAssetContextCoverage.mockResolvedValue(
      new Map([
        ['BTCUSDT', readyCoverage],
        ['ETHUSDT', readyCoverage],
      ]),
    );
    mockGetMarketCmcExchangeLiquidityContextCoverage.mockResolvedValue(
      readyCoverage,
    );
    mockGetMarketCmcFearGreedContextCoverage.mockResolvedValue({
      firstMs: window.fromMs,
      lastMs: window.toMs - 2 * 86_400_000,
      rows: 59,
    });
    mockGetMarketCmcIndexContextCoverage.mockResolvedValue(
      new Map([
        ['cmc100', readyCoverage],
        ['cmc20', readyCoverage],
      ]),
    );
    mockGetMarketContextBackfillCoverage.mockImplementation(
      async (params: { source: string }) =>
        params.source === 'coinmarketcap_fear_greed'
          ? [
              {
                source: 'coinmarketcap_fear_greed',
                scope: 'all',
                interval: '1d',
                fromMs: window.fromMs,
                toMs: window.toMs,
                rowsCount: 59,
                checkedAtMs: nowMs - 30 * 60_000,
              },
            ]
          : [],
    );

    const result = await backfillCoinMarketCapContextForSignals({
      userName: 'root',
      startMs: nowMs,
      endMs: nowMs,
      preloadStartMs,
    });

    expect(result).toEqual(
      expect.objectContaining({ skipped: true, cached: true }),
    );
    expect(mockGetUserSettings).not.toHaveBeenCalled();
  });

  it('does not treat zero-row backfill markers as data coverage', () => {
    expect(
      coverageRowsToKeySet([
        {
          source: 'coinmarketcap_global',
          scope: 'all',
          interval: '1d',
          fromMs: 1_000,
          toMs: 2_000,
          rowsCount: 0,
        },
        {
          source: 'coinmarketcap_global',
          scope: 'all',
          interval: '1d',
          fromMs: 2_000,
          toMs: 3_000,
          rowsCount: 1,
        },
      ]),
    ).toEqual(new Set(['coinmarketcap_global:all:1d:2000:3000']));
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
