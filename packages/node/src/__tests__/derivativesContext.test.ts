const mockGetDerivativesWindow = jest.fn();
const mockLoggerWarn = jest.fn();

jest.mock('@tradejs/infra/timescale', () => ({
  getDerivativesWindow: (...args: unknown[]) =>
    mockGetDerivativesWindow(...args),
}));

jest.mock('@tradejs/infra/logger', () => ({
  logger: {
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
  },
}));

import {
  enrichSignalWithDerivativesContext,
  getDerivativesContextReferenceSymbols,
  isDerivativesContextEnabled,
  resetDerivativesContextRuntimeState,
} from '../strategyHelpers/derivativesContext';

const originalEnv = process.env;
const DEFAULT_DERIVATIVES_REFERENCE_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'BNBUSDT',
  'SOLUSDT',
  'TRXUSDT',
  'XRPUSDT',
];

describe('strategyHelpers/derivativesContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.DERIVATIVES_CONTEXT_ENABLED;
    delete process.env.DERIVATIVES_CONTEXT_EXTRA_REFERENCE_SYMBOLS;
    delete process.env.DERIVATIVES_CONTEXT_TARGET_ENABLED;
    delete process.env.DERIVATIVES_CONTEXT_INTERVALS;
    delete process.env.DERIVATIVES_CONTEXT_LOOKBACK_HOURS;
    resetDerivativesContextRuntimeState();
    mockGetDerivativesWindow.mockImplementation(({ symbol }: any) => ({
      '15m': [
        {
          symbol,
          interval: '15m',
          ts: new Date(signal.timestamp - 60 * 60 * 1000),
          openInterest: symbol === 'BTCUSDT' ? 100 : 200,
          fundingRate: 0.0001,
          liqLong: 10,
          liqShort: 10,
          liqTotal: 20,
        },
        {
          symbol,
          interval: '15m',
          ts: new Date(signal.timestamp),
          openInterest: symbol === 'BTCUSDT' ? 105 : 210,
          fundingRate: 0.0001,
          liqLong: 10,
          liqShort: 10,
          liqTotal: 20,
        },
      ],
    }));
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const signal = {
    signalId: 's1',
    symbol: 'ETHUSDT',
    strategy: 'TrendLine',
    interval: '15',
    direction: 'LONG',
    timestamp: Date.UTC(2026, 0, 1, 12, 0, 0),
    figures: {},
    prices: {
      currentPrice: 100,
      takeProfitPrice: 110,
      stopLossPrice: 95,
      riskRatio: 2,
    },
    indicators: {},
    additionalIndicators: {
      baseContext: {
        raw: {
          price: {
            price1hPct: 1.5,
          },
        },
      },
    },
  } as any;

  it('enables derivatives context by default with 15m/1h and 48h lookback', async () => {
    expect(isDerivativesContextEnabled('BACKTEST')).toBe(true);

    const enrichedSignal = { ...signal };
    const enriched = await enrichSignalWithDerivativesContext({
      signal: enrichedSignal,
      env: 'BACKTEST',
    });

    expect(enriched).toBe(true);
    expect(mockGetDerivativesWindow).toHaveBeenCalledTimes(6);
    expect(mockGetDerivativesWindow).toHaveBeenNthCalledWith(1, {
      symbol: 'BTCUSDT',
      intervals: ['15m', '1h'],
      endMs: signal.timestamp,
      lookbackMs: 48 * 60 * 60 * 1000,
    });
    expect(mockGetDerivativesWindow).toHaveBeenNthCalledWith(2, {
      symbol: 'ETHUSDT',
      intervals: ['15m', '1h'],
      endMs: signal.timestamp,
      lookbackMs: 48 * 60 * 60 * 1000,
    });
    expect(enrichedSignal.additionalIndicators.baseContext.derivatives).toEqual(
      expect.objectContaining({
        referenceSymbols: DEFAULT_DERIVATIVES_REFERENCE_SYMBOLS,
      }),
    );
  });

  it('can be disabled explicitly', async () => {
    process.env.DERIVATIVES_CONTEXT_ENABLED = 'false';
    expect(isDerivativesContextEnabled('BACKTEST')).toBe(false);

    const enriched = await enrichSignalWithDerivativesContext({
      signal: { ...signal },
      env: 'BACKTEST',
    });

    expect(enriched).toBe(false);
    expect(mockGetDerivativesWindow).not.toHaveBeenCalled();
  });

  it('uses BTC/ETH plus default extra derivatives reference symbols', () => {
    expect(getDerivativesContextReferenceSymbols()).toEqual(
      DEFAULT_DERIVATIVES_REFERENCE_SYMBOLS,
    );
  });

  it('uses env-configured extra derivatives reference symbols', () => {
    process.env.DERIVATIVES_CONTEXT_EXTRA_REFERENCE_SYMBOLS =
      'bnb,adausdt, BNB';

    expect(getDerivativesContextReferenceSymbols()).toEqual([
      'BTCUSDT',
      'ETHUSDT',
      'BNBUSDT',
      'ADAUSDT',
    ]);
  });

  it('supports backtest-only enable flag and attaches context', async () => {
    process.env.DERIVATIVES_CONTEXT_ENABLED = 'backtest';
    const enrichedSignal = { ...signal };

    const enriched = await enrichSignalWithDerivativesContext({
      signal: enrichedSignal,
      env: 'BACKTEST',
    });

    expect(enriched).toBe(true);
    expect(mockGetDerivativesWindow).toHaveBeenCalledTimes(6);
    expect(mockGetDerivativesWindow).toHaveBeenNthCalledWith(1, {
      symbol: 'BTCUSDT',
      intervals: ['15m', '1h'],
      endMs: signal.timestamp,
      lookbackMs: 48 * 60 * 60 * 1000,
    });
    expect(mockGetDerivativesWindow).toHaveBeenNthCalledWith(2, {
      symbol: 'ETHUSDT',
      intervals: ['15m', '1h'],
      endMs: signal.timestamp,
      lookbackMs: 48 * 60 * 60 * 1000,
    });
    expect(enrichedSignal.additionalIndicators.baseContext.derivatives).toEqual(
      expect.objectContaining({
        symbol: 'BTCUSDT',
        targetSymbol: 'ETHUSDT',
        primaryReferenceSymbol: 'BTCUSDT',
        secondaryReferenceSymbol: 'ETHUSDT',
        referenceSymbols: DEFAULT_DERIVATIVES_REFERENCE_SYMBOLS,
        referenceContexts: expect.objectContaining({
          BTCUSDT: expect.objectContaining({ symbol: 'BTCUSDT' }),
          ETHUSDT: expect.objectContaining({ symbol: 'ETHUSDT' }),
        }),
        targetContext: expect.objectContaining({
          symbol: 'ETHUSDT',
        }),
        targetDerived: expect.objectContaining({
          available: true,
          sourceSymbol: 'ETHUSDT',
          referenceSymbol: 'BTCUSDT',
        }),
      }),
    );
    expect(
      enrichedSignal.additionalIndicators.baseContext.derivatives.summary
        .directionAligned,
    ).toBe(true);
    expect(
      enrichedSignal.additionalIndicators.baseContext.derivatives.summary
        .fundingChange1h,
    ).toBe(0);
    expect(
      enrichedSignal.additionalIndicators.baseContext.derivatives.summary
        .priceOiDivergenceType,
    ).toBe('price_up_oi_up');
    expect(
      enrichedSignal.additionalIndicators.baseContext.gateFeatures,
    ).toMatchObject({
      scores: {
        derivatives: expect.any(Number),
      },
      confirmations: {
        items: expect.arrayContaining(['derivatives_aligned']),
      },
    });
  });

  it('keeps BTC as primary reference metadata for BTC signals', async () => {
    process.env.DERIVATIVES_CONTEXT_ENABLED = 'true';
    process.env.DERIVATIVES_CONTEXT_EXTRA_REFERENCE_SYMBOLS = 'BNB,SOL,TRX,XRP';
    const enrichedSignal = { ...signal, symbol: 'BTCUSDT' };

    await expect(
      enrichSignalWithDerivativesContext({
        signal: enrichedSignal,
        env: 'LIVE',
      }),
    ).resolves.toBe(true);

    expect(
      mockGetDerivativesWindow.mock.calls.map((call) => call[0].symbol),
    ).toEqual(DEFAULT_DERIVATIVES_REFERENCE_SYMBOLS);
    expect(enrichedSignal.additionalIndicators.baseContext.derivatives).toEqual(
      expect.objectContaining({
        symbol: 'BTCUSDT',
        targetSymbol: 'BTCUSDT',
        primaryReferenceSymbol: 'BTCUSDT',
        secondaryReferenceSymbol: 'ETHUSDT',
        referenceSymbols: DEFAULT_DERIVATIVES_REFERENCE_SYMBOLS,
        referenceContexts: expect.objectContaining({
          BTCUSDT: expect.objectContaining({ symbol: 'BTCUSDT' }),
          ETHUSDT: expect.objectContaining({ symbol: 'ETHUSDT' }),
        }),
      }),
    );
    expect(
      enrichedSignal.additionalIndicators.baseContext.derivatives.targetContext,
    ).toBeUndefined();
  });

  it('keeps ETH as secondary reference and target context without replacing BTC primary', async () => {
    process.env.DERIVATIVES_CONTEXT_ENABLED = 'true';
    process.env.DERIVATIVES_CONTEXT_EXTRA_REFERENCE_SYMBOLS = 'BNB,SOL,TRX,XRP';
    const enrichedSignal = { ...signal, symbol: 'ETHUSDT' };

    await expect(
      enrichSignalWithDerivativesContext({
        signal: enrichedSignal,
        env: 'LIVE',
      }),
    ).resolves.toBe(true);

    expect(
      mockGetDerivativesWindow.mock.calls.map((call) => call[0].symbol),
    ).toEqual(DEFAULT_DERIVATIVES_REFERENCE_SYMBOLS);
    expect(enrichedSignal.additionalIndicators.baseContext.derivatives).toEqual(
      expect.objectContaining({
        symbol: 'BTCUSDT',
        targetSymbol: 'ETHUSDT',
        primaryReferenceSymbol: 'BTCUSDT',
        secondaryReferenceSymbol: 'ETHUSDT',
        referenceSymbols: DEFAULT_DERIVATIVES_REFERENCE_SYMBOLS,
        targetContext: expect.objectContaining({
          symbol: 'ETHUSDT',
        }),
        targetDerived: expect.objectContaining({
          available: true,
          sourceSymbol: 'ETHUSDT',
          referenceSymbol: 'BTCUSDT',
        }),
      }),
    );
  });

  it('uses BTC as the primary derivatives context for non-reference symbols', async () => {
    process.env.DERIVATIVES_CONTEXT_ENABLED = 'true';
    const enrichedSignal = { ...signal, symbol: 'DOGEUSDT' };

    await expect(
      enrichSignalWithDerivativesContext({
        signal: enrichedSignal,
        env: 'LIVE',
      }),
    ).resolves.toBe(true);

    expect(mockGetDerivativesWindow).toHaveBeenCalledTimes(6);
    expect(
      mockGetDerivativesWindow.mock.calls.map((call) => call[0].symbol),
    ).toEqual(DEFAULT_DERIVATIVES_REFERENCE_SYMBOLS);
    expect(enrichedSignal.additionalIndicators.baseContext.derivatives).toEqual(
      expect.objectContaining({
        symbol: 'BTCUSDT',
        targetSymbol: 'DOGEUSDT',
        primaryReferenceSymbol: 'BTCUSDT',
        secondaryReferenceSymbol: 'ETHUSDT',
        referenceSymbols: DEFAULT_DERIVATIVES_REFERENCE_SYMBOLS,
      }),
    );
    expect(
      enrichedSignal.additionalIndicators.baseContext.derivatives.targetContext,
    ).toBeUndefined();
  });

  it('adds target derivatives context for non-reference symbols when enabled', async () => {
    process.env.DERIVATIVES_CONTEXT_ENABLED = 'true';
    process.env.DERIVATIVES_CONTEXT_TARGET_ENABLED = 'true';
    const enrichedSignal = { ...signal, symbol: 'DOGEUSDT' };

    await expect(
      enrichSignalWithDerivativesContext({
        signal: enrichedSignal,
        env: 'LIVE',
      }),
    ).resolves.toBe(true);

    expect(mockGetDerivativesWindow).toHaveBeenCalledTimes(7);
    expect(
      mockGetDerivativesWindow.mock.calls.map((call) => call[0].symbol),
    ).toEqual([...DEFAULT_DERIVATIVES_REFERENCE_SYMBOLS, 'DOGEUSDT']);
    expect(enrichedSignal.additionalIndicators.baseContext.derivatives).toEqual(
      expect.objectContaining({
        symbol: 'BTCUSDT',
        targetSymbol: 'DOGEUSDT',
        primaryReferenceSymbol: 'BTCUSDT',
        secondaryReferenceSymbol: 'ETHUSDT',
        referenceSymbols: DEFAULT_DERIVATIVES_REFERENCE_SYMBOLS,
        referenceContexts: expect.objectContaining({
          BTCUSDT: expect.objectContaining({ symbol: 'BTCUSDT' }),
          ETHUSDT: expect.objectContaining({ symbol: 'ETHUSDT' }),
        }),
        targetContext: expect.objectContaining({
          symbol: 'DOGEUSDT',
          summary: expect.objectContaining({
            directionAligned: true,
          }),
        }),
        targetDerived: expect.objectContaining({
          available: true,
          sourceSymbol: 'DOGEUSDT',
          referenceSymbol: 'BTCUSDT',
          directionAligned: true,
          referenceDirectionAligned: true,
          targetReferenceConflict: false,
        }),
      }),
    );
    expect(
      enrichedSignal.additionalIndicators.baseContext.derivatives.summary
        .directionAligned,
    ).toBe(true);
  });

  it('uses loaded reference context as target context for extra reference symbols', async () => {
    process.env.DERIVATIVES_CONTEXT_ENABLED = 'true';
    process.env.DERIVATIVES_CONTEXT_TARGET_ENABLED = 'true';
    const enrichedSignal = { ...signal, symbol: 'SOLUSDT' };

    await expect(
      enrichSignalWithDerivativesContext({
        signal: enrichedSignal,
        env: 'LIVE',
      }),
    ).resolves.toBe(true);

    expect(mockGetDerivativesWindow).toHaveBeenCalledTimes(6);
    expect(
      mockGetDerivativesWindow.mock.calls.map((call) => call[0].symbol),
    ).toEqual(DEFAULT_DERIVATIVES_REFERENCE_SYMBOLS);
    expect(enrichedSignal.additionalIndicators.baseContext.derivatives).toEqual(
      expect.objectContaining({
        symbol: 'BTCUSDT',
        targetSymbol: 'SOLUSDT',
        primaryReferenceSymbol: 'BTCUSDT',
        secondaryReferenceSymbol: 'ETHUSDT',
        targetContext: expect.objectContaining({
          symbol: 'SOLUSDT',
        }),
        targetDerived: expect.objectContaining({
          available: true,
          sourceSymbol: 'SOLUSDT',
          referenceSymbol: 'BTCUSDT',
        }),
      }),
    );
  });

  it('disables itself after a Timescale read failure', async () => {
    process.env.DERIVATIVES_CONTEXT_ENABLED = 'true';
    mockGetDerivativesWindow.mockRejectedValue(new Error('db down'));
    const firstSignal = { ...signal };
    const secondSignal = { ...signal };

    await expect(
      enrichSignalWithDerivativesContext({
        signal: firstSignal,
        env: 'LIVE',
      }),
    ).resolves.toBe(false);
    await expect(
      enrichSignalWithDerivativesContext({
        signal: secondSignal,
        env: 'LIVE',
      }),
    ).resolves.toBe(false);

    expect(mockGetDerivativesWindow).toHaveBeenCalledTimes(6);
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
  });
});
