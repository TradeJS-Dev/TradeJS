const mockGetLatestMarketGlobalContext = jest.fn();
const mockLoggerWarn = jest.fn();

jest.mock('@tradejs/infra/timescale', () => ({
  getLatestMarketGlobalContext: (...args: unknown[]) =>
    mockGetLatestMarketGlobalContext(...args),
}));

jest.mock('@tradejs/infra/logger', () => ({
  logger: {
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
  },
}));

import {
  enrichSignalWithGlobalMarketContext,
  isGlobalMarketContextEnabled,
  resetGlobalMarketContextRuntimeState,
} from '../strategyHelpers/globalMarketContext';

const timestamp = Date.UTC(2026, 0, 2, 12, 0, 0);

const makeSignal = () =>
  ({
    signalId: 's1',
    symbol: 'SOLUSDT',
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
        candle: {
          open: 100,
          high: 101,
          low: 99,
          close: 100,
          volume: 1000,
          turnover: 100000,
          timestamp,
        },
        prevCandle: null,
        raw: {
          volatility: {
            atr: 1,
          },
        },
        regime: {
          volatility: {},
        },
        structure: {
          localRange: {
            rangePosition20: 0.5,
            breakoutState: 'inside_range',
          },
        },
        participation: {
          volume: {
            volumeRel20: 1,
          },
        },
        relative: {
          benchmark: {
            trendAlignment: 'aligned_bull',
            relativeStrength1h: 0.01,
          },
          execution: {},
        },
        mtf: {
          candles: { m15: [], h1: [], h4: [], d1: [] },
          benchmarkCandles: { m15: [], h1: [], h4: [], d1: [] },
        },
      },
    },
  }) as any;

describe('strategyHelpers/globalMarketContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.COINGECKO_GLOBAL_CONTEXT_ENABLED;
    resetGlobalMarketContextRuntimeState();
    mockGetLatestMarketGlobalContext.mockResolvedValue({
      source: 'coingecko_global',
      ts: new Date(timestamp - 60_000),
      updatedAt: new Date(timestamp - 60_000),
      ageMs: 60_000,
      stale: false,
      btcDominancePct: '54.5',
      ethDominancePct: '12.1',
      altMarketCapUsd: '1200000000000',
      totalMarketCapUsd: '2600000000000',
      btcToAltMarketCapRatio: '1.18',
      btcDominanceChange24hPct: '-0.4',
      marketCapChangePct24hUsd: '1.2',
    });
  });

  it('is disabled by default for backtest and enabled by default for cron', () => {
    expect(isGlobalMarketContextEnabled('BACKTEST')).toBe(false);
    expect(isGlobalMarketContextEnabled('CRON')).toBe(true);
    expect(isGlobalMarketContextEnabled('LIVE')).toBe(false);
  });

  it('allows explicitly enabling backtest context with env flag', () => {
    process.env.COINGECKO_GLOBAL_CONTEXT_ENABLED = 'backtest';

    expect(isGlobalMarketContextEnabled('BACKTEST')).toBe(true);
    expect(isGlobalMarketContextEnabled('CRON')).toBe(false);
  });

  it('does not query Timescale for default backtest enrichment', async () => {
    const signal = makeSignal();

    await expect(
      enrichSignalWithGlobalMarketContext({
        signal,
        env: 'BACKTEST',
      }),
    ).resolves.toBe(false);

    expect(mockGetLatestMarketGlobalContext).not.toHaveBeenCalled();
  });

  it('attaches as-of CoinGecko BTC dominance context and refreshes gate features', async () => {
    const signal = makeSignal();

    await expect(
      enrichSignalWithGlobalMarketContext({
        signal,
        env: 'BACKTEST',
        enabled: true,
      }),
    ).resolves.toBe(true);

    expect(mockGetLatestMarketGlobalContext).toHaveBeenCalledWith({
      source: 'coingecko_global',
      atMs: timestamp,
      maxAgeMs: 36 * 60 * 60_000,
    });
    expect(
      signal.additionalIndicators.baseContext.relative.btcDominance,
    ).toEqual({
      source: 'coingecko_global',
      asOfTs: timestamp - 60_000,
      updatedAtTs: timestamp - 60_000,
      ageMs: 60_000,
      stale: false,
      btcDominancePct: 54.5,
      ethDominancePct: 12.1,
      altMarketCapUsd: 1200000000000,
      totalMarketCapUsd: 2600000000000,
      btcToAltMarketCapRatio: 1.18,
      btcDominanceChange24hPct: -0.4,
      altLiquidityRegime: 'alt_friendly',
      marketCapChangePct24hUsd: 1.2,
    });
    expect(signal.additionalIndicators.baseContext.gateFeatures).toMatchObject({
      confirmations: {
        items: expect.arrayContaining(['btc_dominance_aligned']),
      },
      relative: {
        btcDominancePct: 54.5,
        btcDominanceChange24hPct: -0.4,
        btcDominanceAltLiquidityRegime: 'alt_friendly',
        btcDominanceAligned: true,
        btcDominanceStale: false,
      },
    });
  });

  it('does not attach rows newer than the signal timestamp', async () => {
    const signal = makeSignal();
    mockGetLatestMarketGlobalContext.mockResolvedValue(null);

    await expect(
      enrichSignalWithGlobalMarketContext({
        signal,
        env: 'BACKTEST',
        enabled: true,
      }),
    ).resolves.toBe(false);

    expect(mockGetLatestMarketGlobalContext).toHaveBeenCalledWith(
      expect.objectContaining({ atMs: timestamp }),
    );
    expect(
      signal.additionalIndicators.baseContext.relative.btcDominance,
    ).toBeUndefined();
  });
});
