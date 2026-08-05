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

  it('loads 15m rows plus stored 1h fallback with a 48h lookback', async () => {
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
    expect(
      enrichedSignal.additionalIndicators.baseContext.derivatives.targetContext,
    ).toBeUndefined();
    expect(
      enrichedSignal.additionalIndicators.baseContext.derivatives.targetDerived,
    ).toBeUndefined();
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
      }),
    );
    expect(
      enrichedSignal.additionalIndicators.baseContext.derivatives.targetContext,
    ).toBeUndefined();
    expect(
      enrichedSignal.additionalIndicators.baseContext.derivatives.targetDerived,
    ).toBeUndefined();
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
      enrichedSignal.additionalIndicators.baseContext.gateFeatures.scores,
    ).not.toHaveProperty('derivatives');
  });

  it('derives a complete 1h context from four 15m source rows', async () => {
    const hourStart = Date.UTC(2026, 0, 1, 12, 0, 0);
    mockGetDerivativesWindow.mockImplementation(({ symbol }: any) => ({
      '15m': [0, 1, 2, 3].map((offset) => ({
        symbol,
        interval: '15m',
        ts: new Date(hourStart + offset * 15 * 60 * 1000),
        openInterest: 100 + offset,
        fundingRate: 0.0001 * (offset + 1),
        liqLong: 10 + offset,
        liqShort: 20 + offset,
        liqTotal: 30 + 2 * offset,
      })),
    }));
    const enrichedSignal = {
      ...signal,
      timestamp: Date.UTC(2026, 0, 1, 12, 45, 0),
    };

    await expect(
      enrichSignalWithDerivativesContext({
        signal: enrichedSignal,
        env: 'LIVE',
      }),
    ).resolves.toBe(true);

    expect(
      enrichedSignal.additionalIndicators.baseContext.derivatives.intervals[
        '1h'
      ],
    ).toEqual(
      expect.objectContaining({
        asOfTs: hourStart + 45 * 60 * 1000,
        openInterest: 103,
        fundingRate: 0.0004,
        liqLong: 46,
        liqShort: 86,
        liqTotal: 132,
      }),
    );
  });

  it('uses legacy 1h with its old timestamp semantics when rolling 15m is unavailable', async () => {
    const previousHourStart = Date.UTC(2026, 0, 1, 11, 0, 0);
    const currentHourStart = Date.UTC(2026, 0, 1, 12, 0, 0);
    mockGetDerivativesWindow.mockImplementation(({ symbol }: any) => ({
      '1h': [
        {
          symbol,
          interval: '1h',
          ts: new Date(previousHourStart),
          openInterest: 100,
          fundingRate: 0.0001,
          liqLong: 10,
          liqShort: 20,
          liqTotal: 30,
          source: 'coinalyze',
        },
        {
          symbol,
          interval: '1h',
          ts: new Date(currentHourStart),
          openInterest: 200,
          fundingRate: 0.0002,
          liqLong: 40,
          liqShort: 50,
          liqTotal: 90,
          source: 'coinalyze',
        },
      ],
    }));
    const enrichedSignal = {
      ...signal,
      timestamp: Date.UTC(2026, 0, 1, 12, 30, 0),
    };

    await expect(
      enrichSignalWithDerivativesContext({
        signal: enrichedSignal,
        env: 'BACKTEST',
      }),
    ).resolves.toBe(true);

    expect(
      enrichedSignal.additionalIndicators.baseContext.derivatives.intervals[
        '1h'
      ],
    ).toEqual(
      expect.objectContaining({
        asOfTs: currentHourStart,
        openInterest: 200,
      }),
    );
  });

  it('uses the rolling trailing hour available at a :30 decision', async () => {
    const end = Date.UTC(2026, 0, 1, 12, 30, 0);
    mockGetDerivativesWindow.mockImplementation(({ symbol }: any) => ({
      '15m': [-3, -2, -1, 0].map((offset) => ({
        symbol,
        interval: '15m',
        ts: new Date(end + offset * 15 * 60 * 1000),
        openInterest: 200 + offset,
        fundingRate: 0.0002,
        liqLong: 10 + offset,
        liqShort: 20 + offset,
        liqTotal: 30 + 2 * offset,
      })),
      '1h': [
        {
          symbol,
          interval: '1h',
          ts: new Date(Date.UTC(2026, 0, 1, 12, 0, 0)),
          openInterest: 999,
          fundingRate: 9,
          liqLong: 999,
          liqShort: 999,
          liqTotal: 1998,
        },
      ],
    }));
    const enrichedSignal = {
      ...signal,
      timestamp: end,
    };

    await expect(
      enrichSignalWithDerivativesContext({
        signal: enrichedSignal,
        env: 'BACKTEST',
      }),
    ).resolves.toBe(true);

    expect(
      enrichedSignal.additionalIndicators.baseContext.derivatives.intervals[
        '1h'
      ],
    ).toEqual(
      expect.objectContaining({
        asOfTs: end,
        openInterest: 200,
        liqLong: 34,
        liqShort: 74,
        liqTotal: 108,
      }),
    );
  });

  it('reads derivatives through the last closed 15m bar for a 1h signal', async () => {
    const hourStart = Date.UTC(2026, 0, 1, 12, 0, 0);
    mockGetDerivativesWindow.mockImplementation(({ symbol }: any) => ({
      '15m': [0, 1, 2, 3].map((offset) => ({
        symbol,
        interval: '15m',
        ts: new Date(hourStart + offset * 15 * 60 * 1000),
        openInterest: 100 + offset,
        fundingRate: 0.0001,
        liqLong: 10,
        liqShort: 20,
        liqTotal: 30,
      })),
    }));
    const hourlySignal = {
      ...signal,
      interval: '60',
      timestamp: hourStart,
    };

    await expect(
      enrichSignalWithDerivativesContext({
        signal: hourlySignal,
        env: 'BACKTEST',
      }),
    ).resolves.toBe(true);

    expect(mockGetDerivativesWindow).toHaveBeenNthCalledWith(1, {
      symbol: 'BTCUSDT',
      intervals: ['15m', '1h'],
      endMs: hourStart + 45 * 60 * 1000,
      lookbackMs: 48 * 60 * 60 * 1000,
    });
    expect(
      hourlySignal.additionalIndicators.baseContext.derivatives.intervals[
        '15m'
      ],
    ).toEqual(
      expect.objectContaining({
        asOfTs: hourStart + 45 * 60 * 1000,
        openInterest: 103,
      }),
    );
    expect(
      hourlySignal.additionalIndicators.baseContext.derivatives.intervals['1h'],
    ).toEqual(
      expect.objectContaining({
        asOfTs: hourStart + 45 * 60 * 1000,
        openInterest: 103,
      }),
    );
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

  it('keeps ETH only as secondary reference when target context is disabled', async () => {
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
      }),
    );
    expect(
      enrichedSignal.additionalIndicators.baseContext.derivatives.targetContext,
    ).toBeUndefined();
    expect(
      enrichedSignal.additionalIndicators.baseContext.derivatives.targetDerived,
    ).toBeUndefined();
  });

  it.each(['LIVE', 'BACKTEST'])(
    'does not expose loaded extra reference data as target context in %s',
    async (env) => {
      process.env.DERIVATIVES_CONTEXT_ENABLED = 'true';
      process.env.DERIVATIVES_CONTEXT_TARGET_ENABLED = 'false';
      process.env.DERIVATIVES_CONTEXT_EXTRA_REFERENCE_SYMBOLS =
        'BNB,SOL,TRX,XRP';
      const enrichedSignal = { ...signal, symbol: 'SOLUSDT' };

      await expect(
        enrichSignalWithDerivativesContext({
          signal: enrichedSignal,
          env,
        }),
      ).resolves.toBe(true);

      expect(
        mockGetDerivativesWindow.mock.calls.map((call) => call[0].symbol),
      ).toEqual(DEFAULT_DERIVATIVES_REFERENCE_SYMBOLS);
      expect(
        enrichedSignal.additionalIndicators.baseContext.derivatives
          .referenceContexts.SOLUSDT,
      ).toEqual(expect.objectContaining({ symbol: 'SOLUSDT' }));
      expect(
        enrichedSignal.additionalIndicators.baseContext.derivatives
          .targetContext,
      ).toBeUndefined();
      expect(
        enrichedSignal.additionalIndicators.baseContext.derivatives
          .targetDerived,
      ).toBeUndefined();
    },
  );

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

  it('forwards cancellation and stays available after a transient SQL timeout', async () => {
    const controller = new AbortController();
    const timeoutError = new Error('query timeout');
    timeoutError.name = 'TimescaleQueryTimeoutError';
    mockGetDerivativesWindow.mockRejectedValueOnce(timeoutError);

    await expect(
      enrichSignalWithDerivativesContext({
        signal: { ...signal },
        env: 'BACKTEST',
        abortSignal: controller.signal,
      }),
    ).rejects.toBe(timeoutError);
    await expect(
      enrichSignalWithDerivativesContext({
        signal: { ...signal },
        env: 'BACKTEST',
        abortSignal: controller.signal,
      }),
    ).resolves.toBe(true);

    expect(
      mockGetDerivativesWindow.mock.calls.every(
        ([params]) => params.signal === controller.signal,
      ),
    ).toBe(true);
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });
});
