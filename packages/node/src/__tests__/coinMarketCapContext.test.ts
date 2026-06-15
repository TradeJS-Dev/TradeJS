const mockGetLatestMarketGlobalContext = jest.fn();
const mockGetLatestMarketReferenceAssetContexts = jest.fn();
const mockGetLatestMarketCmcBreadthContext = jest.fn();
const mockGetLatestMarketCmcExchangeLiquidityContext = jest.fn();
const mockLoggerWarn = jest.fn();

jest.mock('@tradejs/infra/timescale', () => ({
  getLatestMarketCmcBreadthContext: (...args: unknown[]) =>
    mockGetLatestMarketCmcBreadthContext(...args),
  getLatestMarketCmcExchangeLiquidityContext: (...args: unknown[]) =>
    mockGetLatestMarketCmcExchangeLiquidityContext(...args),
  getLatestMarketGlobalContext: (...args: unknown[]) =>
    mockGetLatestMarketGlobalContext(...args),
  getLatestMarketReferenceAssetContexts: (...args: unknown[]) =>
    mockGetLatestMarketReferenceAssetContexts(...args),
}));

jest.mock('@tradejs/infra/logger', () => ({
  logger: {
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
  },
}));

import {
  enrichSignalWithCoinMarketCapContext,
  isCoinMarketCapContextEnabled,
  resetCoinMarketCapContextRuntimeState,
} from '../strategyHelpers/coinMarketCapContext';

const timestamp = Date.UTC(2026, 0, 2, 0, 0, 0);
const DAY_MS = 86_400_000;

const makeSignal = () =>
  ({
    signalId: 's1',
    symbol: 'ETHUSDT',
    strategy: 'TrendLine',
    interval: '15',
    direction: 'LONG',
    timestamp,
    prices: {
      currentPrice: 100,
      takeProfitPrice: 110,
      stopLossPrice: 95,
      riskRatio: 2,
    },
    indicators: {},
    additionalIndicators: {
      baseContext: {
        raw: {},
        regime: {},
        structure: {},
        participation: {},
        relative: {
          benchmark: {},
          execution: {},
        },
        mtf: {
          candles: { m15: [], h1: [], h4: [], d1: [] },
          benchmarkCandles: { m15: [], h1: [], h4: [], d1: [] },
        },
      },
    },
  }) as any;

const makeReferenceMap = (ts: number) =>
  new Map([
    [
      'BTCUSDT',
      {
        symbol: 'BTCUSDT',
        ts: new Date(ts),
        ageMs: timestamp - ts,
        stale: false,
        volumeUsd: '45000000000',
        marketCapUsd: '1400000000000',
      },
    ],
    [
      'ETHUSDT',
      {
        symbol: 'ETHUSDT',
        ts: new Date(ts),
        ageMs: timestamp - ts,
        stale: false,
        volumeUsd: '24000000000',
        marketCapUsd: '450000000000',
      },
    ],
  ]);

describe('strategyHelpers/coinMarketCapContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.COINMARKETCAP_CONTEXT_ENABLED;
    resetCoinMarketCapContextRuntimeState();
    mockGetLatestMarketGlobalContext.mockResolvedValue({
      source: 'coinmarketcap_global_hourly',
      ts: new Date(timestamp),
      updatedAt: new Date(timestamp),
      ageMs: 0,
      stale: false,
      activeCryptocurrencies: 14_000,
      activeExchanges: 780,
      activeMarketPairs: 120_000,
      totalMarketCapUsd: '2600000000000',
      totalVolumeUsd: '120000000000',
      totalVolumeReportedUsd: '110000000000',
      btcDominancePct: '54.5',
      ethDominancePct: '17.2',
      altMarketCapUsd: '1200000000000',
      altVolumeUsd: '55000000000',
      altVolumeReportedUsd: '50000000000',
      btcToAltMarketCapRatio: '1.18',
      marketCapChangePct24hUsd: '0.012',
      btcDominanceChange24hPct: '-0.4',
      ethDominanceChange24hPct: '0.2',
      altMarketCapChange24hPct: '0.018',
      altVolumeChange24hPct: '0.12',
    });
    mockGetLatestMarketCmcBreadthContext.mockResolvedValue({
      source: 'coinmarketcap_market_breadth',
      universe: 'cmc_top100',
      interval: '1d',
      ts: new Date(timestamp),
      ageMs: 0,
      stale: false,
      topAssetsCount: 100,
      assetsCount: 100,
      positive24hPct: '0.68',
      positive7dPct: '0.61',
      avgReturn24hPct: '0.018',
      medianReturn24hPct: '0.012',
      returnDispersion24hPct: '0.04',
      top10MarketCapShare: '0.72',
      top25MarketCapShare: '0.84',
      btcMarketCapShare: '0.48',
      ethMarketCapShare: '0.16',
      btcEthMarketCapShare: '0.64',
      stablecoinMarketCapShare: '0.09',
      stablecoinVolumeShare: '0.18',
      totalMarketCapUsd: '2600000000000',
      totalVolumeUsd: '120000000000',
      breadthRegime: 'risk_on',
    });
    mockGetLatestMarketCmcExchangeLiquidityContext.mockResolvedValue({
      source: 'coinmarketcap_exchange_liquidity',
      interval: '1d',
      ts: new Date(timestamp),
      ageMs: 0,
      stale: false,
      exchangesCount: 5,
      totalVolumeUsd: '80000000000',
      totalVolumeChange24hPct: '0.18',
      binanceVolumeUsd: '36000000000',
      binanceVolumeShare: '0.45',
      topExchangeVolumeShare: '0.45',
      liquidityRegime: 'balanced',
    });
    mockGetLatestMarketReferenceAssetContexts
      .mockResolvedValueOnce(makeReferenceMap(timestamp))
      .mockResolvedValueOnce(makeReferenceMap(timestamp))
      .mockResolvedValueOnce(makeReferenceMap(timestamp - DAY_MS))
      .mockResolvedValueOnce(makeReferenceMap(timestamp - DAY_MS));
  });

  it('is enabled only for backtest by default', () => {
    expect(isCoinMarketCapContextEnabled('BACKTEST')).toBe(true);
    expect(isCoinMarketCapContextEnabled('CRON')).toBe(false);
    expect(isCoinMarketCapContextEnabled('PARITY')).toBe(false);
  });

  it('attaches historical CMC global and BTC/ETH reference context', async () => {
    const signal = makeSignal();

    await expect(
      enrichSignalWithCoinMarketCapContext({
        signal,
        env: 'BACKTEST',
      }),
    ).resolves.toBe(true);

    expect(mockGetLatestMarketGlobalContext).toHaveBeenCalledWith({
      source: 'coinmarketcap_global_hourly',
      atMs: timestamp,
      maxAgeMs: 48 * 60 * 60_000,
    });
    expect(mockGetLatestMarketGlobalContext).toHaveBeenCalledWith({
      source: 'coinmarketcap_global',
      atMs: timestamp,
      maxAgeMs: 48 * 60 * 60_000,
    });
    expect(mockGetLatestMarketReferenceAssetContexts).toHaveBeenNthCalledWith(
      1,
      {
        source: 'coinmarketcap_reference_asset',
        symbols: ['BTCUSDT', 'ETHUSDT'],
        interval: '1h',
        atMs: timestamp,
        maxAgeMs: 48 * 60 * 60_000,
      },
    );
    expect(mockGetLatestMarketReferenceAssetContexts).toHaveBeenNthCalledWith(
      2,
      {
        source: 'coinmarketcap_reference_asset',
        symbols: ['BTCUSDT', 'ETHUSDT'],
        interval: '1d',
        atMs: timestamp,
        maxAgeMs: 48 * 60 * 60_000,
      },
    );
    expect(mockGetLatestMarketReferenceAssetContexts).toHaveBeenNthCalledWith(
      3,
      {
        source: 'coinmarketcap_reference_asset',
        symbols: ['BTCUSDT', 'ETHUSDT'],
        interval: '1h',
        atMs: timestamp - DAY_MS,
        maxAgeMs: 48 * 60 * 60_000 + DAY_MS,
      },
    );
    expect(mockGetLatestMarketReferenceAssetContexts).toHaveBeenNthCalledWith(
      4,
      {
        source: 'coinmarketcap_reference_asset',
        symbols: ['BTCUSDT', 'ETHUSDT'],
        interval: '1d',
        atMs: timestamp - DAY_MS,
        maxAgeMs: 48 * 60 * 60_000 + DAY_MS,
      },
    );
    expect(signal.additionalIndicators.baseContext.relative).toMatchObject({
      cmcGlobal: {
        source: 'coinmarketcap_global_hourly',
        interval: '1h',
        stale: false,
        altVolumeChange24hPct: 0.12,
        activeMarketPairs: 120_000,
        altLiquidityRegime: 'alt_friendly',
      },
      cmcReferenceAssets: {
        source: 'coinmarketcap_reference_asset',
        interval: '1h',
        stale: false,
        ethBtcMarketCapRatio: expect.any(Number),
        ethVsBtcVolumeRatio: expect.any(Number),
        referenceLiquidityRegime: 'balanced',
      },
      cmcMarketBreadth: {
        source: 'coinmarketcap_market_breadth',
        stale: false,
        positive24hPct: 0.68,
        breadthRegime: 'risk_on',
      },
      cmcExchangeLiquidity: {
        source: 'coinmarketcap_exchange_liquidity',
        stale: false,
        totalVolumeChange24hPct: 0.18,
        liquidityRegime: 'expanding',
      },
    });
    expect(signal.additionalIndicators.baseContext.gateFeatures).toMatchObject({
      relative: {
        cmcAltLiquidityAligned: true,
        cmcEthBtcAligned: null,
        cmcMarketBreadthAligned: true,
        cmcExchangeLiquidityAligned: true,
      },
      confirmations: {
        items: expect.arrayContaining([
          'cmc_alt_liquidity_aligned',
          'cmc_market_breadth_aligned',
          'cmc_exchange_liquidity_aligned',
        ]),
      },
    });
  });
});
