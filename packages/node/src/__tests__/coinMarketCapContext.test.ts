const mockGetLatestMarketGlobalContext = jest.fn();
const mockGetLatestMarketReferenceAssetContexts = jest.fn();
const mockGetLatestMarketCmcExchangeLiquidityContext = jest.fn();
const mockGetLatestMarketCmcFearGreedContext = jest.fn();
const mockGetLatestMarketCmcIndexContexts = jest.fn();
const mockLoggerWarn = jest.fn();

jest.mock('@tradejs/infra/timescale', () => ({
  getLatestMarketCmcExchangeLiquidityContext: (...args: unknown[]) =>
    mockGetLatestMarketCmcExchangeLiquidityContext(...args),
  getLatestMarketCmcFearGreedContext: (...args: unknown[]) =>
    mockGetLatestMarketCmcFearGreedContext(...args),
  getLatestMarketCmcIndexContexts: (...args: unknown[]) =>
    mockGetLatestMarketCmcIndexContexts(...args),
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

const makeIndexMap = (ts: number) =>
  new Map([
    [
      'cmc100',
      {
        source: 'coinmarketcap_index',
        indexSlug: 'cmc100',
        interval: '1d',
        ts: new Date(ts),
        ageMs: timestamp - ts,
        stale: false,
        value: '240',
        valueChange24hPct: '0.01',
        topConstituentSymbol: 'BTC',
        topConstituentWeightPct: '64.2',
      },
    ],
    [
      'cmc20',
      {
        source: 'coinmarketcap_index',
        indexSlug: 'cmc20',
        interval: '1d',
        ts: new Date(ts),
        ageMs: timestamp - ts,
        stale: false,
        value: '260',
        valueChange24hPct: '0.024',
        topConstituentSymbol: 'BTC',
        topConstituentWeightPct: '72.4',
      },
    ],
  ]);

describe('strategyHelpers/coinMarketCapContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.COINMARKETCAP_CONTEXT_ENABLED;
    resetCoinMarketCapContextRuntimeState();
    mockGetLatestMarketGlobalContext.mockResolvedValue({
      source: 'coinmarketcap_global',
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
    mockGetLatestMarketCmcFearGreedContext.mockResolvedValue({
      source: 'coinmarketcap_fear_greed',
      interval: '1d',
      ts: new Date(timestamp),
      ageMs: 0,
      stale: false,
      value: 62,
      valueChange24h: 8,
      valueChange7d: 15,
      classification: 'Greed',
      sentimentRegime: 'risk_on',
    });
    mockGetLatestMarketCmcIndexContexts.mockResolvedValue(
      makeIndexMap(timestamp),
    );
    mockGetLatestMarketReferenceAssetContexts
      .mockResolvedValueOnce(makeReferenceMap(timestamp))
      .mockResolvedValueOnce(makeReferenceMap(timestamp - DAY_MS));
  });

  it('is enabled for historical and live runtime modes by default', () => {
    expect(isCoinMarketCapContextEnabled('BACKTEST')).toBe(true);
    expect(isCoinMarketCapContextEnabled('CRON')).toBe(true);
    expect(isCoinMarketCapContextEnabled('PARITY')).toBe(true);
  });

  it('honors explicit historical/live CMC context env scopes', () => {
    process.env.COINMARKETCAP_CONTEXT_ENABLED = 'backtest';
    expect(isCoinMarketCapContextEnabled('BACKTEST')).toBe(true);
    expect(isCoinMarketCapContextEnabled('CRON')).toBe(false);

    process.env.COINMARKETCAP_CONTEXT_ENABLED = 'live';
    expect(isCoinMarketCapContextEnabled('BACKTEST')).toBe(false);
    expect(isCoinMarketCapContextEnabled('CRON')).toBe(true);
    expect(isCoinMarketCapContextEnabled('PARITY')).toBe(true);
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
      source: 'coinmarketcap_global',
      atMs: timestamp,
      maxAgeMs: 48 * 60 * 60_000,
    });
    expect(mockGetLatestMarketReferenceAssetContexts).toHaveBeenNthCalledWith(
      1,
      {
        source: 'coinmarketcap_reference_asset',
        symbols: ['BTCUSDT', 'ETHUSDT'],
        interval: '1d',
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
        atMs: timestamp - DAY_MS,
        maxAgeMs: 48 * 60 * 60_000 + DAY_MS,
      },
    );
    expect(mockGetLatestMarketCmcIndexContexts).toHaveBeenCalledWith({
      source: 'coinmarketcap_index',
      indexSlugs: ['cmc100', 'cmc20'],
      interval: '1d',
      atMs: timestamp,
      maxAgeMs: 48 * 60 * 60_000,
    });
    expect(signal.additionalIndicators.baseContext.relative).toMatchObject({
      cmcGlobal: {
        source: 'coinmarketcap_global',
        interval: '1d',
        stale: false,
        altVolumeChange24hPct: 0.12,
        activeMarketPairs: 120_000,
        altLiquidityRegime: 'alt_friendly',
      },
      cmcReferenceAssets: {
        source: 'coinmarketcap_reference_asset',
        interval: '1d',
        stale: false,
        ethBtcMarketCapRatio: expect.any(Number),
        ethVsBtcVolumeRatio: expect.any(Number),
        referenceLiquidityRegime: 'balanced',
      },
      cmcExchangeLiquidity: {
        source: 'coinmarketcap_exchange_liquidity',
        stale: false,
        totalVolumeChange24hPct: 0.18,
        liquidityRegime: 'expanding',
      },
      cmcFearGreed: {
        source: 'coinmarketcap_fear_greed',
        stale: false,
        value: 62,
        valueChange24h: 8,
        valueChange7d: 15,
        classification: 'Greed',
        sentimentRegime: 'risk_on',
      },
      cmcIndexes: {
        source: 'coinmarketcap_index',
        interval: '1d',
        stale: false,
        cmc100Value: 240,
        cmc100Change24hPct: 0.01,
        cmc100TopConstituentSymbol: 'BTC',
        cmc100TopConstituentWeightPct: 64.2,
        cmc20Value: 260,
        cmc20Change24hPct: 0.024,
        cmc20TopConstituentSymbol: 'BTC',
        cmc20TopConstituentWeightPct: 72.4,
        cmc20ToCmc100Ratio: 260 / 240,
        cmc20ToCmc100RatioChange24hPct: (1 + 0.024) / (1 + 0.01) - 1,
        indexRegime: 'top20_led',
      },
    });
    expect(signal.additionalIndicators.baseContext.gateFeatures).toMatchObject({
      relative: {
        cmcAltLiquidityAligned: true,
        cmcEthBtcAligned: null,
        cmcExchangeLiquidityAligned: true,
        cmcFearGreedAligned: true,
      },
      confirmations: {
        items: expect.arrayContaining([
          'cmc_alt_liquidity_aligned',
          'cmc_exchange_liquidity_aligned',
          'cmc_fear_greed_aligned',
        ]),
      },
    });
  });
});
