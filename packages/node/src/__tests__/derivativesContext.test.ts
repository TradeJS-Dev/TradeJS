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

describe('strategyHelpers/derivativesContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.DERIVATIVES_CONTEXT_ENABLED;
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

  it('keeps derivatives context disabled by default', async () => {
    expect(isDerivativesContextEnabled('BACKTEST')).toBe(false);

    const enriched = await enrichSignalWithDerivativesContext({
      signal: { ...signal },
      env: 'BACKTEST',
    });

    expect(enriched).toBe(false);
    expect(mockGetDerivativesWindow).not.toHaveBeenCalled();
  });

  it('uses only BTC/ETH as derivatives reference symbols', () => {
    expect(getDerivativesContextReferenceSymbols()).toEqual([
      'BTCUSDT',
      'ETHUSDT',
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
    expect(mockGetDerivativesWindow).toHaveBeenCalledTimes(2);
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
        symbol: 'ETHUSDT',
        targetSymbol: 'ETHUSDT',
        primaryReferenceSymbol: 'ETHUSDT',
        referenceSymbols: ['BTCUSDT', 'ETHUSDT'],
        referenceContexts: expect.objectContaining({
          BTCUSDT: expect.objectContaining({ symbol: 'BTCUSDT' }),
          ETHUSDT: expect.objectContaining({ symbol: 'ETHUSDT' }),
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
  });

  it('uses BTC as the primary derivatives context for non-reference symbols', async () => {
    process.env.DERIVATIVES_CONTEXT_ENABLED = 'true';
    const enrichedSignal = { ...signal, symbol: 'SOLUSDT' };

    await expect(
      enrichSignalWithDerivativesContext({
        signal: enrichedSignal,
        env: 'LIVE',
      }),
    ).resolves.toBe(true);

    expect(mockGetDerivativesWindow).toHaveBeenCalledTimes(2);
    expect(
      mockGetDerivativesWindow.mock.calls.map((call) => call[0].symbol),
    ).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(enrichedSignal.additionalIndicators.baseContext.derivatives).toEqual(
      expect.objectContaining({
        symbol: 'BTCUSDT',
        targetSymbol: 'SOLUSDT',
        primaryReferenceSymbol: 'BTCUSDT',
        referenceSymbols: ['BTCUSDT', 'ETHUSDT'],
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

    expect(mockGetDerivativesWindow).toHaveBeenCalledTimes(2);
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
  });
});
