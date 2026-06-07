const mockGetOnchainContextWindow = jest.fn();
const mockLoggerWarn = jest.fn();

jest.mock('@tradejs/infra/timescale', () => ({
  getOnchainContextWindow: (...args: unknown[]) =>
    mockGetOnchainContextWindow(...args),
}));

jest.mock('@tradejs/infra/logger', () => ({
  logger: {
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
  },
}));

import {
  enrichSignalWithOnchainContext,
  isOnchainContextEnabled,
  resetOnchainContextRuntimeState,
} from '../strategyHelpers/onchainContext';

const originalEnv = process.env;
const timestamp = Date.UTC(2026, 0, 1, 12, 0, 0);

const makeSignal = (overrides: Record<string, unknown> = {}) =>
  ({
    signalId: 's1',
    symbol: 'ETHUSDT',
    strategy: 'TrendLine',
    interval: '15',
    direction: 'LONG',
    timestamp,
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
          price: {
            price1hPct: 1.5,
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
          },
          execution: {},
        },
        mtf: {
          candles: { m15: [], h1: [], h4: [], d1: [] },
          benchmarkCandles: { m15: [], h1: [], h4: [], d1: [] },
        },
      },
    },
    ...overrides,
  }) as any;

describe('strategyHelpers/onchainContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.ONCHAIN_CONTEXT_ENABLED;
    delete process.env.ONCHAIN_CONTEXT_INTERVALS;
    delete process.env.ONCHAIN_CONTEXT_LOOKBACK_HOURS;
    delete process.env.ONCHAIN_CONTEXT_REFERENCE_SYMBOLS;
    resetOnchainContextRuntimeState();
    mockGetOnchainContextWindow.mockImplementation(({ symbol }: any) => ({
      '15m': [
        {
          symbol,
          interval: '15m',
          ts: new Date(timestamp - 60 * 60 * 1000),
          whaleNetFlowUsd: symbol === 'ETHUSDT' ? 100 : null,
          smartTraderNetFlowUsd: symbol === 'ETHUSDT' ? 50 : null,
          cexDepositUsd: 100,
          cexWithdrawUsd: symbol === 'ETHUSDT' ? 500 : 110,
          dexBuyUsd: symbol === 'ETHUSDT' ? 250 : null,
          dexSellUsd: 100,
          entityCount: 3,
          confidenceWeightedBias: symbol === 'ETHUSDT' ? 0.6 : 0.1,
          source: 'arkham',
        },
      ],
    }));
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('keeps onchain context disabled by default', async () => {
    expect(isOnchainContextEnabled('BACKTEST')).toBe(false);

    const enriched = await enrichSignalWithOnchainContext({
      signal: makeSignal(),
      env: 'BACKTEST',
    });

    expect(enriched).toBe(false);
    expect(mockGetOnchainContextWindow).not.toHaveBeenCalled();
  });

  it('supports backtest-only enable flag and attaches Arkham context', async () => {
    process.env.ONCHAIN_CONTEXT_ENABLED = 'backtest';
    const signal = makeSignal();

    await expect(
      enrichSignalWithOnchainContext({ signal, env: 'BACKTEST' }),
    ).resolves.toBe(true);

    expect(mockGetOnchainContextWindow).toHaveBeenCalledTimes(2);
    expect(mockGetOnchainContextWindow).toHaveBeenNthCalledWith(1, {
      symbol: 'ETHUSDT',
      intervals: ['15m', '1h'],
      endMs: timestamp,
      lookbackMs: 48 * 60 * 60 * 1000,
    });
    expect(mockGetOnchainContextWindow).toHaveBeenNthCalledWith(2, {
      symbol: 'BTCUSDT',
      intervals: ['15m', '1h'],
      endMs: timestamp,
      lookbackMs: 48 * 60 * 60 * 1000,
    });
    expect(signal.additionalIndicators.baseContext.onchain).toEqual(
      expect.objectContaining({
        source: 'arkham',
        symbol: 'ETHUSDT',
        targetSymbol: 'ETHUSDT',
        primaryReferenceSymbol: 'ETHUSDT',
        referenceSymbols: ['ETHUSDT', 'BTCUSDT'],
        referenceContexts: expect.objectContaining({
          BTCUSDT: expect.objectContaining({ symbol: 'BTCUSDT' }),
          ETHUSDT: expect.objectContaining({ symbol: 'ETHUSDT' }),
        }),
      }),
    );
    expect(
      signal.additionalIndicators.baseContext.onchain.summary,
    ).toMatchObject({
      pressure: 'accumulation',
      directionAligned: true,
      riskFlags: expect.arrayContaining([
        'whale_accumulation',
        'smart_money_accumulation',
      ]),
    });
    expect(signal.additionalIndicators.baseContext.gateFeatures).toMatchObject({
      scores: {
        onchain: expect.any(Number),
      },
      confirmations: {
        items: expect.arrayContaining(['onchain_aligned']),
      },
      onchain: {
        pressure: 'accumulation',
        directionAligned: true,
      },
    });
  });

  it('uses configured intervals, lookback, and reference symbols', async () => {
    process.env.ONCHAIN_CONTEXT_ENABLED = 'true';
    process.env.ONCHAIN_CONTEXT_INTERVALS = '5m,15m';
    process.env.ONCHAIN_CONTEXT_LOOKBACK_HOURS = '12';
    process.env.ONCHAIN_CONTEXT_REFERENCE_SYMBOLS = 'btcusdt,solusdt';
    const signal = makeSignal({ symbol: 'ADAUSDT' });

    await expect(
      enrichSignalWithOnchainContext({ signal, env: 'LIVE' }),
    ).resolves.toBe(true);

    expect(
      mockGetOnchainContextWindow.mock.calls.map((call) => call[0]),
    ).toEqual([
      {
        symbol: 'ADAUSDT',
        intervals: ['5m', '15m'],
        endMs: timestamp,
        lookbackMs: 12 * 60 * 60 * 1000,
      },
      {
        symbol: 'BTCUSDT',
        intervals: ['5m', '15m'],
        endMs: timestamp,
        lookbackMs: 12 * 60 * 60 * 1000,
      },
      {
        symbol: 'SOLUSDT',
        intervals: ['5m', '15m'],
        endMs: timestamp,
        lookbackMs: 12 * 60 * 60 * 1000,
      },
    ]);
    expect(
      signal.additionalIndicators.baseContext.onchain.referenceSymbols,
    ).toEqual(['ADAUSDT', 'BTCUSDT', 'SOLUSDT']);
  });

  it('does not query Timescale when baseContext is missing', async () => {
    process.env.ONCHAIN_CONTEXT_ENABLED = 'true';
    const signal = makeSignal({ additionalIndicators: {} });

    await expect(
      enrichSignalWithOnchainContext({ signal, env: 'LIVE' }),
    ).resolves.toBe(false);

    expect(mockGetOnchainContextWindow).not.toHaveBeenCalled();
  });

  it('disables itself after a Timescale read failure', async () => {
    process.env.ONCHAIN_CONTEXT_ENABLED = 'true';
    mockGetOnchainContextWindow.mockRejectedValue(new Error('db down'));
    const firstSignal = makeSignal();
    const secondSignal = makeSignal();

    await expect(
      enrichSignalWithOnchainContext({
        signal: firstSignal,
        env: 'LIVE',
      }),
    ).resolves.toBe(false);
    await expect(
      enrichSignalWithOnchainContext({
        signal: secondSignal,
        env: 'LIVE',
      }),
    ).resolves.toBe(false);

    expect(mockGetOnchainContextWindow).toHaveBeenCalledTimes(2);
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
  });
});
