const mockBackfillDerivativesContextForBacktest = jest.fn();
const mockBackfillDerivativesContextForSignals = jest.fn();
const mockShouldBackfillDerivativesContextForBacktest = jest.fn();
const mockShouldBackfillDerivativesContextForSignals = jest.fn();
const mockBackfillBinanceMarketContextForBacktest = jest.fn();
const mockBackfillBinanceMarketContextForReplay = jest.fn();
const mockBackfillBinanceMarketContextForSignals = jest.fn();
const mockShouldBackfillBinanceMarketContextForBacktest = jest.fn();
const mockShouldBackfillBinanceMarketContextForReplay = jest.fn();
const mockShouldBackfillBinanceMarketContextForSignals = jest.fn();
const mockBackfillCoinMarketCapContextForBacktest = jest.fn();
const mockBackfillCoinMarketCapContextForReplay = jest.fn();
const mockBackfillCoinMarketCapContextForSignals = jest.fn();
const mockShouldBackfillCoinMarketCapContextForBacktest = jest.fn();
const mockShouldBackfillCoinMarketCapContextForReplay = jest.fn();
const mockShouldBackfillCoinMarketCapContextForSignals = jest.fn();
const mockBackfillHyperliquidWhaleContext = jest.fn();
const mockEnsureMarketContextSchemas = jest.fn();
const mockEnsureStrategyPluginsLoaded = jest.fn();
const mockGetStrategyManifest = jest.fn();

jest.mock('@tradejs/infra/timescale', () => ({
  ensureMarketContextSchemas: (...args: unknown[]) =>
    mockEnsureMarketContextSchemas(...args),
}));

jest.mock('@tradejs/node/registry', () => ({
  ensureStrategyPluginsLoaded: (...args: unknown[]) =>
    mockEnsureStrategyPluginsLoaded(...args),
  getStrategyManifest: (...args: unknown[]) => mockGetStrategyManifest(...args),
}));

jest.mock('../lib/derivativesContextBackfill', () => ({
  backfillDerivativesContextForBacktest: (...args: unknown[]) =>
    mockBackfillDerivativesContextForBacktest(...args),
  backfillDerivativesContextForSignals: (...args: unknown[]) =>
    mockBackfillDerivativesContextForSignals(...args),
  shouldBackfillDerivativesContextForBacktest: (...args: unknown[]) =>
    mockShouldBackfillDerivativesContextForBacktest(...args),
  shouldBackfillDerivativesContextForSignals: (...args: unknown[]) =>
    mockShouldBackfillDerivativesContextForSignals(...args),
}));

jest.mock('../lib/binanceMarketContextBackfill', () => ({
  backfillBinanceMarketContextForBacktest: (...args: unknown[]) =>
    mockBackfillBinanceMarketContextForBacktest(...args),
  backfillBinanceMarketContextForReplay: (...args: unknown[]) =>
    mockBackfillBinanceMarketContextForReplay(...args),
  backfillBinanceMarketContextForSignals: (...args: unknown[]) =>
    mockBackfillBinanceMarketContextForSignals(...args),
  shouldBackfillBinanceMarketContextForBacktest: (...args: unknown[]) =>
    mockShouldBackfillBinanceMarketContextForBacktest(...args),
  shouldBackfillBinanceMarketContextForReplay: (...args: unknown[]) =>
    mockShouldBackfillBinanceMarketContextForReplay(...args),
  shouldBackfillBinanceMarketContextForSignals: (...args: unknown[]) =>
    mockShouldBackfillBinanceMarketContextForSignals(...args),
}));

jest.mock('../lib/coinMarketCapContextBackfill', () => ({
  backfillCoinMarketCapContextForBacktest: (...args: unknown[]) =>
    mockBackfillCoinMarketCapContextForBacktest(...args),
  backfillCoinMarketCapContextForReplay: (...args: unknown[]) =>
    mockBackfillCoinMarketCapContextForReplay(...args),
  backfillCoinMarketCapContextForSignals: (...args: unknown[]) =>
    mockBackfillCoinMarketCapContextForSignals(...args),
  shouldBackfillCoinMarketCapContextForBacktest: (...args: unknown[]) =>
    mockShouldBackfillCoinMarketCapContextForBacktest(...args),
  shouldBackfillCoinMarketCapContextForReplay: (...args: unknown[]) =>
    mockShouldBackfillCoinMarketCapContextForReplay(...args),
  shouldBackfillCoinMarketCapContextForSignals: (...args: unknown[]) =>
    mockShouldBackfillCoinMarketCapContextForSignals(...args),
}));

jest.mock('../lib/hyperliquidWhaleBackfill', () => ({
  backfillHyperliquidWhaleContext: (...args: unknown[]) =>
    mockBackfillHyperliquidWhaleContext(...args),
}));

import {
  prepareMarketContextForRun,
  resolveMarketContextRunRequirements,
  shouldPrepareHyperliquidWhaleContextForRun,
} from '../lib/marketContextPrepare';

describe('prepareMarketContextForRun', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBackfillDerivativesContextForBacktest.mockResolvedValue({});
    mockBackfillDerivativesContextForSignals.mockResolvedValue({});
    mockBackfillBinanceMarketContextForBacktest.mockResolvedValue({});
    mockBackfillBinanceMarketContextForReplay.mockResolvedValue({});
    mockBackfillBinanceMarketContextForSignals.mockResolvedValue({});
    mockShouldBackfillDerivativesContextForBacktest.mockReturnValue(false);
    mockShouldBackfillDerivativesContextForSignals.mockReturnValue(false);
    mockShouldBackfillBinanceMarketContextForBacktest.mockReturnValue(false);
    mockShouldBackfillBinanceMarketContextForReplay.mockReturnValue(false);
    mockShouldBackfillBinanceMarketContextForSignals.mockReturnValue(false);
    mockBackfillCoinMarketCapContextForBacktest.mockResolvedValue({});
    mockBackfillCoinMarketCapContextForReplay.mockResolvedValue({});
    mockBackfillCoinMarketCapContextForSignals.mockResolvedValue({});
    mockShouldBackfillCoinMarketCapContextForBacktest.mockReturnValue(false);
    mockShouldBackfillCoinMarketCapContextForReplay.mockReturnValue(false);
    mockShouldBackfillCoinMarketCapContextForSignals.mockReturnValue(false);
    mockBackfillHyperliquidWhaleContext.mockResolvedValue({});
    mockEnsureMarketContextSchemas.mockResolvedValue(undefined);
    mockEnsureStrategyPluginsLoaded.mockResolvedValue(undefined);
    mockGetStrategyManifest.mockImplementation((name: string) =>
      name === 'HyperliquidConsensus'
        ? {
            name,
            contextRequirements: { core: ['hyperliquidWhales'] },
          }
        : undefined,
    );
    delete process.env.HYPERLIQUID_WHALE_BACKFILL_ENABLED;
  });

  it('does not backfill Hyperliquid whales by default', async () => {
    expect(
      shouldPrepareHyperliquidWhaleContextForRun({
        mode: 'backtest',
        cacheOnly: false,
        aiEnabled: true,
        mlEnabled: false,
      }),
    ).toBe(false);
    await prepareMarketContextForRun({
      mode: 'backtest',
      userName: 'root',
      projectRoot: '/repo',
      symbols: ['BTCUSDT'],
      interval: '15',
      startMs: 1_000,
      endMs: 2_000,
      preloadStartMs: 500,
      cacheOnly: false,
      aiEnabled: true,
      log: jest.fn(),
    });
    expect(mockBackfillHyperliquidWhaleContext).not.toHaveBeenCalled();
  });

  it('allows Hyperliquid whale backfill to be enabled explicitly', async () => {
    process.env.HYPERLIQUID_WHALE_BACKFILL_ENABLED = 'true';
    expect(
      shouldPrepareHyperliquidWhaleContextForRun({
        mode: 'backtest',
        cacheOnly: false,
        aiEnabled: true,
        mlEnabled: false,
      }),
    ).toBe(true);
    await prepareMarketContextForRun({
      mode: 'backtest',
      userName: 'root',
      projectRoot: '/repo',
      symbols: ['BTCUSDT'],
      interval: '15',
      startMs: 1_000,
      endMs: 2_000,
      preloadStartMs: 500,
      cacheOnly: false,
      aiEnabled: true,
      log: jest.fn(),
    });
    expect(mockBackfillHyperliquidWhaleContext).toHaveBeenCalledWith({
      startMs: 500,
      endMs: 2_000,
      cacheOnly: false,
      strict: false,
      log: expect.any(Function),
    });
  });

  it('allows the default Hyperliquid whale backfill to be disabled', () => {
    process.env.HYPERLIQUID_WHALE_BACKFILL_ENABLED = 'false';
    expect(
      shouldPrepareHyperliquidWhaleContextForRun(
        {
          mode: 'backtest',
          cacheOnly: false,
          aiEnabled: true,
          mlEnabled: false,
        },
        ['hyperliquidWhales'],
      ),
    ).toBe(false);
  });

  it('backfills Hyperliquid whales for the standalone consensus strategy', async () => {
    expect(
      shouldPrepareHyperliquidWhaleContextForRun(
        {
          mode: 'backtest',
          cacheOnly: false,
          aiEnabled: false,
          mlEnabled: false,
          strategyNames: ['HyperliquidConsensus'],
        },
        ['hyperliquidWhales'],
      ),
    ).toBe(true);

    await prepareMarketContextForRun({
      mode: 'backtest',
      userName: 'root',
      projectRoot: '/repo',
      symbols: ['BTCUSDT'],
      interval: '5',
      startMs: 1_000,
      endMs: 2_000,
      preloadStartMs: 500,
      cacheOnly: false,
      aiEnabled: false,
      mlEnabled: false,
      strategyNames: ['HyperliquidConsensus'],
      log: jest.fn(),
    });

    expect(mockBackfillHyperliquidWhaleContext).toHaveBeenCalledWith({
      startMs: 500,
      endMs: 2_000,
      cacheOnly: false,
      strict: false,
      log: expect.any(Function),
    });
  });

  it('allows standalone consensus backfill to be explicitly disabled', () => {
    process.env.HYPERLIQUID_WHALE_BACKFILL_ENABLED = 'false';
    expect(
      shouldPrepareHyperliquidWhaleContextForRun({
        mode: 'backtest',
        cacheOnly: false,
        aiEnabled: false,
        mlEnabled: false,
        strategyNames: ['HyperliquidConsensus'],
      }),
    ).toBe(false);
  });

  it('routes backtest context through AI/ML-aware backfill policies', async () => {
    mockShouldBackfillDerivativesContextForBacktest.mockReturnValue(true);
    mockShouldBackfillBinanceMarketContextForBacktest.mockReturnValue(true);
    mockShouldBackfillCoinMarketCapContextForBacktest.mockReturnValue(true);

    await prepareMarketContextForRun({
      mode: 'backtest',
      userName: 'root',
      projectRoot: '/repo',
      symbols: ['BTCUSDT'],
      interval: '15',
      startMs: 1_000,
      endMs: 2_000,
      preloadStartMs: 500,
      cacheOnly: false,
      aiEnabled: true,
      mlEnabled: false,
      log: jest.fn(),
    });

    expect(
      mockShouldBackfillDerivativesContextForBacktest,
    ).toHaveBeenCalledWith({
      aiEnabled: true,
      cacheOnly: false,
      mlEnabled: false,
    });
    expect(mockBackfillDerivativesContextForBacktest).toHaveBeenCalledWith({
      userName: 'root',
      symbols: ['BTCUSDT'],
      startMs: 1_000,
      endMs: 2_000,
      preloadStartMs: 500,
    });
    expect(mockBackfillBinanceMarketContextForBacktest).toHaveBeenCalledWith({
      userName: 'root',
      projectRoot: '/repo',
      symbols: ['BTCUSDT'],
      interval: '15',
      startMs: 1_000,
      endMs: 2_000,
      preloadStartMs: 500,
    });
    expect(mockBackfillCoinMarketCapContextForBacktest).toHaveBeenCalledWith({
      userName: 'root',
      startMs: 1_000,
      endMs: 2_000,
      preloadStartMs: 500,
    });
  });

  it('does not touch market context for a raw context-independent backtest', async () => {
    mockShouldBackfillDerivativesContextForBacktest.mockReturnValue(true);
    mockShouldBackfillBinanceMarketContextForBacktest.mockReturnValue(true);
    mockShouldBackfillCoinMarketCapContextForBacktest.mockReturnValue(true);

    await prepareMarketContextForRun({
      mode: 'backtest',
      userName: 'root',
      projectRoot: '/repo',
      symbols: ['BTCUSDT'],
      interval: '15',
      startMs: 1_000,
      endMs: 2_000,
      cacheOnly: false,
      aiEnabled: false,
      mlEnabled: false,
      strategyNames: ['TrendFollow'],
      log: jest.fn(),
    });

    expect(mockEnsureMarketContextSchemas).not.toHaveBeenCalled();
    expect(mockBackfillDerivativesContextForBacktest).not.toHaveBeenCalled();
    expect(mockBackfillBinanceMarketContextForBacktest).not.toHaveBeenCalled();
    expect(mockBackfillCoinMarketCapContextForBacktest).not.toHaveBeenCalled();
  });

  it('returns explicit AI demand and ensures every readable schema in the parent', async () => {
    const requirements = await prepareMarketContextForRun({
      mode: 'backtest',
      userName: 'root',
      projectRoot: '/repo',
      symbols: ['BTCUSDT'],
      interval: '15',
      startMs: 1_000,
      endMs: 2_000,
      cacheOnly: false,
      aiEnabled: true,
      mlEnabled: false,
      log: jest.fn(),
    });

    expect(requirements).toEqual({
      binance: { read: true, backfill: false, requiredBy: ['ai'] },
      coinmarketcap: { read: true, backfill: false, requiredBy: ['ai'] },
      derivatives: { read: true, backfill: false, requiredBy: ['ai'] },
      hyperliquidWhales: {
        read: true,
        backfill: false,
        requiredBy: ['ai'],
      },
    });
    expect(mockEnsureMarketContextSchemas).toHaveBeenCalledTimes(1);
    expect(mockEnsureMarketContextSchemas).toHaveBeenCalledWith([
      'binance',
      'coinmarketcap',
      'derivatives',
      'hyperliquidWhales',
    ]);
    expect(mockEnsureStrategyPluginsLoaded).not.toHaveBeenCalled();
  });

  it('ensures only a manifest-declared core source for a raw backtest', async () => {
    const requirements = await prepareMarketContextForRun({
      mode: 'backtest',
      userName: 'root',
      projectRoot: '/repo',
      symbols: ['BTCUSDT'],
      interval: '5',
      startMs: 1_000,
      endMs: 2_000,
      cacheOnly: false,
      aiEnabled: false,
      mlEnabled: false,
      strategyNames: ['HyperliquidConsensus'],
      log: jest.fn(),
    });

    expect(requirements.hyperliquidWhales).toEqual({
      read: true,
      backfill: true,
      requiredBy: ['core'],
    });
    expect(requirements.binance.read).toBe(false);
    expect(requirements.coinmarketcap.read).toBe(false);
    expect(requirements.derivatives.read).toBe(false);
    expect(mockEnsureMarketContextSchemas).toHaveBeenCalledWith([
      'hyperliquidWhales',
    ]);
  });

  it('unions and de-duplicates manifest core requirements', async () => {
    mockGetStrategyManifest.mockImplementation((name: string) => ({
      name,
      contextRequirements: {
        core:
          name === 'CoreA'
            ? ['binance', 'derivatives']
            : ['coinmarketcap', 'derivatives'],
      },
    }));

    const requirements = await resolveMarketContextRunRequirements({
      mode: 'backtest',
      userName: 'root',
      projectRoot: '/repo',
      symbols: ['BTCUSDT'],
      interval: '15',
      startMs: 1_000,
      endMs: 2_000,
      cacheOnly: false,
      aiEnabled: false,
      mlEnabled: false,
      strategyNames: ['CoreA', 'CoreB', 'CoreA'],
    });

    expect(mockEnsureStrategyPluginsLoaded).toHaveBeenCalledTimes(1);
    expect(mockGetStrategyManifest).toHaveBeenCalledTimes(2);
    expect(requirements.binance).toMatchObject({
      read: true,
      requiredBy: ['core'],
    });
    expect(requirements.coinmarketcap).toMatchObject({
      read: true,
      requiredBy: ['core'],
    });
    expect(requirements.derivatives).toMatchObject({
      read: true,
      requiredBy: ['core'],
    });
    expect(requirements.hyperliquidWhales.read).toBe(false);
  });

  it('lets a core dependency activate the matching standard backfill policy', async () => {
    mockGetStrategyManifest.mockReturnValue({
      name: 'CoreDerivatives',
      contextRequirements: { core: ['derivatives'] },
    });
    mockShouldBackfillDerivativesContextForBacktest.mockReturnValue(true);

    await prepareMarketContextForRun({
      mode: 'backtest',
      userName: 'root',
      projectRoot: '/repo',
      symbols: ['BTCUSDT'],
      interval: '15',
      startMs: 1_000,
      endMs: 2_000,
      cacheOnly: false,
      aiEnabled: false,
      mlEnabled: false,
      strategyNames: ['CoreDerivatives'],
      log: jest.fn(),
    });

    expect(
      mockShouldBackfillDerivativesContextForBacktest,
    ).toHaveBeenCalledWith({
      aiEnabled: true,
      cacheOnly: false,
      mlEnabled: false,
    });
    expect(mockBackfillDerivativesContextForBacktest).toHaveBeenCalledTimes(1);
  });

  it('routes signals context through live-mode policies', async () => {
    mockShouldBackfillDerivativesContextForSignals.mockReturnValue(true);
    mockShouldBackfillBinanceMarketContextForSignals.mockReturnValue(true);
    mockShouldBackfillCoinMarketCapContextForSignals.mockReturnValue(true);

    await prepareMarketContextForRun({
      mode: 'signals',
      userName: 'root',
      projectRoot: '/repo',
      symbols: ['ETHUSDT'],
      interval: '15',
      startMs: 1_000,
      endMs: 1_000,
      preloadStartMs: 0,
      cacheOnly: false,
      log: jest.fn(),
    });

    expect(mockBackfillDerivativesContextForSignals).toHaveBeenCalledWith({
      userName: 'root',
      symbols: ['ETHUSDT'],
      startMs: 1_000,
      endMs: 1_000,
      preloadStartMs: undefined,
    });
    expect(mockBackfillBinanceMarketContextForSignals).toHaveBeenCalledWith({
      userName: 'root',
      projectRoot: '/repo',
      symbols: ['ETHUSDT'],
      interval: '15',
      startMs: 1_000,
      endMs: 1_000,
      preloadStartMs: undefined,
    });
    expect(
      mockShouldBackfillCoinMarketCapContextForSignals,
    ).toHaveBeenCalledWith({
      cacheOnly: false,
    });
    expect(mockBackfillCoinMarketCapContextForSignals).toHaveBeenCalledWith({
      userName: 'root',
      startMs: 1_000,
      endMs: 1_000,
      preloadStartMs: undefined,
    });
    expect(mockBackfillCoinMarketCapContextForBacktest).not.toHaveBeenCalled();
    expect(mockBackfillCoinMarketCapContextForReplay).not.toHaveBeenCalled();
    expect(mockBackfillDerivativesContextForBacktest).not.toHaveBeenCalled();
  });

  it.each(['replay', 'parity'] as const)(
    'routes %s historical market context through replay policy',
    async (mode) => {
      mockShouldBackfillBinanceMarketContextForReplay.mockReturnValue(true);
      mockShouldBackfillCoinMarketCapContextForReplay.mockReturnValue(true);

      await prepareMarketContextForRun({
        mode,
        userName: 'root',
        projectRoot: '/repo',
        symbols: ['SOLUSDT'],
        interval: '15',
        startMs: 1_000,
        endMs: 2_000,
        cacheOnly: false,
        aiEnabled: false,
        mlEnabled: false,
        log: jest.fn(),
      });

      expect(
        mockShouldBackfillBinanceMarketContextForReplay,
      ).toHaveBeenCalledWith({
        cacheOnly: false,
      });
      expect(mockBackfillBinanceMarketContextForReplay).toHaveBeenCalledWith(
        expect.objectContaining({
          symbols: ['SOLUSDT'],
        }),
      );
      expect(
        mockShouldBackfillCoinMarketCapContextForReplay,
      ).toHaveBeenCalledWith({
        cacheOnly: false,
      });
      expect(mockBackfillCoinMarketCapContextForReplay).toHaveBeenCalledWith({
        userName: 'root',
        startMs: 1_000,
        endMs: 2_000,
        preloadStartMs: undefined,
      });
      expect(
        mockBackfillBinanceMarketContextForBacktest,
      ).not.toHaveBeenCalled();
      expect(mockBackfillBinanceMarketContextForSignals).not.toHaveBeenCalled();
      expect(
        mockBackfillCoinMarketCapContextForBacktest,
      ).not.toHaveBeenCalled();
      expect(mockBackfillCoinMarketCapContextForSignals).not.toHaveBeenCalled();
    },
  );

  it('does not request crypto-only context for TradFi', async () => {
    mockShouldBackfillDerivativesContextForSignals.mockReturnValue(true);
    mockShouldBackfillBinanceMarketContextForSignals.mockReturnValue(true);
    mockShouldBackfillCoinMarketCapContextForSignals.mockReturnValue(true);

    await prepareMarketContextForRun({
      mode: 'signals',
      universe: 'tradfi',
      userName: 'root',
      projectRoot: '/repo',
      symbols: ['AAPLUSDT'],
      interval: '15',
      startMs: 1_000,
      endMs: 2_000,
      cacheOnly: false,
    });

    expect(mockBackfillDerivativesContextForSignals).not.toHaveBeenCalled();
    expect(mockBackfillBinanceMarketContextForSignals).not.toHaveBeenCalled();
    expect(mockBackfillCoinMarketCapContextForSignals).not.toHaveBeenCalled();
    expect(mockEnsureMarketContextSchemas).not.toHaveBeenCalled();
  });
});
