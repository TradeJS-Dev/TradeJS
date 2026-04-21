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

  it('supports backtest-only enable flag and attaches context', async () => {
    process.env.DERIVATIVES_CONTEXT_ENABLED = 'backtest';
    mockGetDerivativesWindow.mockResolvedValue({
      '15m': [
        {
          symbol: 'ETHUSDT',
          interval: '15m',
          ts: new Date(signal.timestamp - 60 * 60 * 1000),
          openInterest: 100,
          fundingRate: 0.0001,
          liqLong: 10,
          liqShort: 10,
          liqTotal: 20,
        },
        {
          symbol: 'ETHUSDT',
          interval: '15m',
          ts: new Date(signal.timestamp),
          openInterest: 105,
          fundingRate: 0.0001,
          liqLong: 10,
          liqShort: 10,
          liqTotal: 20,
        },
      ],
    });
    const enrichedSignal = { ...signal };

    const enriched = await enrichSignalWithDerivativesContext({
      signal: enrichedSignal,
      env: 'BACKTEST',
    });

    expect(enriched).toBe(true);
    expect(mockGetDerivativesWindow).toHaveBeenCalledWith({
      symbol: 'ETHUSDT',
      intervals: ['15m', '1h'],
      endMs: signal.timestamp,
      lookbackMs: 48 * 60 * 60 * 1000,
    });
    expect(
      enrichedSignal.additionalIndicators.derivativesContext.summary
        .directionAligned,
    ).toBe(true);
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

    expect(mockGetDerivativesWindow).toHaveBeenCalledTimes(1);
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
  });
});
