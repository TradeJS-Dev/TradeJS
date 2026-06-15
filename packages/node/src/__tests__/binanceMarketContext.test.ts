const mockGetLatestMarketTradeFlow = jest.fn();
const mockGetLatestMarketBreadth = jest.fn();
const mockLoggerWarn = jest.fn();

jest.mock('@tradejs/infra/timescale', () => ({
  getLatestMarketTradeFlow: (...args: unknown[]) =>
    mockGetLatestMarketTradeFlow(...args),
  getLatestMarketBreadth: (...args: unknown[]) =>
    mockGetLatestMarketBreadth(...args),
}));

jest.mock('@tradejs/infra/logger', () => ({
  logger: {
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
  },
}));

import {
  enrichSignalWithBinanceMarketContext,
  isBinanceMarketContextEnabled,
  resetBinanceMarketContextRuntimeState,
} from '../strategyHelpers/binanceMarketContext';

const timestamp = Date.UTC(2026, 0, 1, 12, 0, 0);

const makeSignal = () =>
  ({
    signalId: 's1',
    symbol: 'BTCUSDT',
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

const makeAltSignal = () => ({
  ...makeSignal(),
  symbol: 'SOLUSDT',
});

describe('strategyHelpers/binanceMarketContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.BINANCE_MARKET_CONTEXT_ENABLED;
    resetBinanceMarketContextRuntimeState();
    mockGetLatestMarketTradeFlow.mockResolvedValue({
      symbol: 'BTCUSDT',
      interval: '15m',
      ts: new Date(timestamp),
      ageMs: 0,
      stale: false,
      trades: 12,
      buyBaseVolume: '8',
      sellBaseVolume: '4',
      buyQuoteVolume: '800',
      sellQuoteVolume: '400',
      netBaseDelta: '4',
      netQuoteDelta: '400',
      buyPressurePct: '0.6666667',
      source: 'binance_agg_trades',
    });
    mockGetLatestMarketBreadth.mockResolvedValue({
      universe: 'binance_top30_usdt',
      interval: '15m',
      ts: new Date(timestamp),
      ageMs: 0,
      stale: false,
      symbolsCount: 30,
      advancers: 20,
      decliners: 8,
      unchanged: 2,
      advanceDeclineRatio: '2.5',
      pctAboveMa20: '0.6',
      pctAboveMa50: '0.5',
      equalWeightedReturn: '0.01',
      volumeWeightedReturn: '0.02',
      dispersion: '0.03',
      source: 'binance_klines',
    });
  });

  it('is enabled by default for backtest and signals environments', () => {
    expect(isBinanceMarketContextEnabled('BACKTEST')).toBe(true);
    expect(isBinanceMarketContextEnabled('CRON')).toBe(true);
    expect(isBinanceMarketContextEnabled('PARITY')).toBe(true);
    expect(isBinanceMarketContextEnabled('LIVE')).toBe(false);
  });

  it('attaches as-of Binance market context and refreshes gate features', async () => {
    const signal = makeSignal();

    await expect(
      enrichSignalWithBinanceMarketContext({
        signal,
        env: 'BACKTEST',
      }),
    ).resolves.toBe(true);

    expect(mockGetLatestMarketTradeFlow).toHaveBeenCalledWith({
      symbol: 'BTCUSDT',
      interval: '15m',
      atMs: timestamp,
      maxAgeMs: 30 * 60_000,
    });
    expect(signal.additionalIndicators.baseContext).toMatchObject({
      participation: {
        tradeFlow: {
          source: 'binance_agg_trades',
          interval: '15m',
          stale: false,
          trades: 12,
          buyPressurePct: 0.6666667,
          netBaseDelta: 4,
          netQuoteDelta: 400,
        },
      },
      relative: {
        referenceTradeFlow: {
          source: 'binance_reference_market',
          primaryReferenceSymbol: 'BTCUSDT',
          referenceSymbols: ['BTCUSDT', 'ETHUSDT'],
          tradeFlowBySymbol: {
            BTCUSDT: expect.objectContaining({
              source: 'binance_agg_trades',
              buyPressurePct: 0.6666667,
            }),
            ETHUSDT: expect.objectContaining({
              source: 'binance_agg_trades',
              buyPressurePct: 0.6666667,
            }),
          },
        },
        marketBreadth: {
          source: 'binance_klines',
          universe: 'binance_top30_usdt',
          stale: false,
          equalWeightedReturn: 0.01,
        },
      },
      gateFeatures: expect.objectContaining({
        participation: expect.objectContaining({
          tradeFlowAligned: true,
        }),
        relative: expect.objectContaining({
          marketBreadthAligned: true,
        }),
      }),
    });
  });

  it('attaches Binance market context in parity env without an explicit enabled override', async () => {
    const signal = makeSignal();

    await expect(
      enrichSignalWithBinanceMarketContext({
        signal,
        env: 'PARITY',
      }),
    ).resolves.toBe(true);

    expect(mockGetLatestMarketTradeFlow).toHaveBeenCalledWith({
      symbol: 'BTCUSDT',
      interval: '15m',
      atMs: timestamp,
      maxAgeMs: 30 * 60_000,
    });
    expect(
      signal.additionalIndicators.baseContext.participation.tradeFlow,
    ).toMatchObject({
      source: 'binance_agg_trades',
      stale: false,
      buyPressurePct: 0.6666667,
    });
    expect(
      signal.additionalIndicators.baseContext.relative.marketBreadth,
    ).toMatchObject({
      source: 'binance_klines',
      universe: 'binance_top30_usdt',
      stale: false,
    });
  });

  it('keeps alt-symbol reference data separate from target-specific fields', async () => {
    const signal = makeAltSignal();

    await expect(
      enrichSignalWithBinanceMarketContext({
        signal,
        env: 'BACKTEST',
      }),
    ).resolves.toBe(true);

    expect(
      signal.additionalIndicators.baseContext.participation.tradeFlow,
    ).toBe(undefined);
    expect(
      signal.additionalIndicators.baseContext.relative.referenceTradeFlow,
    ).toMatchObject({
      primaryReferenceSymbol: 'BTCUSDT',
      referenceSymbols: ['BTCUSDT', 'ETHUSDT'],
      tradeFlowBySymbol: {
        BTCUSDT: expect.objectContaining({ buyPressurePct: 0.6666667 }),
      },
    });
    expect(
      signal.additionalIndicators.baseContext.gateFeatures.participation
        .referenceTradeFlowAligned,
    ).toBe(true);
  });

  it('does not attach rows newer than the signal timestamp', async () => {
    const signal = makeSignal();
    mockGetLatestMarketTradeFlow.mockResolvedValue(null);
    mockGetLatestMarketBreadth.mockResolvedValue(null);

    await expect(
      enrichSignalWithBinanceMarketContext({
        signal,
        env: 'BACKTEST',
      }),
    ).resolves.toBe(false);

    expect(mockGetLatestMarketTradeFlow).toHaveBeenCalledWith(
      expect.objectContaining({ atMs: timestamp }),
    );
    expect(
      signal.additionalIndicators.baseContext.participation.tradeFlow,
    ).toBe(undefined);
  });
});
