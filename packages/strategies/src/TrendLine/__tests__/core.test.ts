jest.mock('@tradejs/core/indicators', () => {
  const actual = jest.requireActual('@tradejs/core/indicators');

  return {
    ...actual,
    createTrendlineEngine: jest.fn(),
  };
});

jest.mock('@tradejs/node/strategies', () => {
  const actual = jest.requireActual('@tradejs/node/strategies');

  return {
    ...actual,
    getStrategyMarketSnapshot: jest.fn(),
    getDirectionalTpSlPrices: jest.fn(),
    buildEntrySignalDecision: jest.fn(),
  };
});

jest.mock('../filters', () => ({
  filterByVeryVolatility: jest.fn(() => true),
}));

import { createTrendlineEngine } from '@tradejs/core/indicators';
import {
  buildEntrySignalDecision,
  getStrategyMarketSnapshot,
  getDirectionalTpSlPrices,
} from '@tradejs/node/strategies';
import { filterByVeryVolatility } from '../filters';
import { createTrendLineCore } from '../core';
import { config as DEFAULT_CONFIG } from '../config';

const makeCandle = (timestamp: number, price: number) => ({
  timestamp,
  dt: new Date(timestamp).toISOString(),
  open: price * 0.99,
  close: price,
  high: price * 1.01,
  low: price * 0.98,
  volume: 100 + price,
  turnover: price * 1000,
});

const makeRangeCandle = (
  timestamp: number,
  {
    open,
    close,
    high,
    low,
  }: { open: number; close: number; high: number; low: number },
) => ({
  timestamp,
  dt: new Date(timestamp).toISOString(),
  open,
  close,
  high,
  low,
  volume: 100 + close,
  turnover: close * 1000,
});

const makeStrategyApi = () => {
  let latestMarketData: {
    timestamp: number;
    currentPrice: number;
  } | null = null;

  return {
    skip: (code: string) => ({ kind: 'skip', code }),
    entry: async (params: any) => {
      if (!latestMarketData) {
        latestMarketData = await getStrategyMarketSnapshot({} as any);
      }

      const takeProfitPrices = Array.isArray(params.orderPlan?.takeProfits)
        ? params.orderPlan.takeProfits.map((tp: any) => Number(tp.price))
        : [];
      const takeProfitPrice =
        params.direction === 'LONG'
          ? Math.max(...takeProfitPrices)
          : Math.min(...takeProfitPrices);
      const stopLossPrice = Number(params.orderPlan?.stopLossPrice);
      const currentPrice = latestMarketData.currentPrice;
      const reward =
        params.direction === 'LONG'
          ? takeProfitPrice - currentPrice
          : currentPrice - takeProfitPrice;
      const risk =
        params.direction === 'LONG'
          ? currentPrice - stopLossPrice
          : stopLossPrice - currentPrice;

      return buildEntrySignalDecision({
        code: params.code ?? `TREND_LINE_${params.direction}_ENTRY`,
        entryContext: {
          strategy: 'TrendLine',
          symbol: 'TESTUSDT',
          interval: '15',
          direction: params.direction,
          timestamp: latestMarketData.timestamp,
          prices: {
            currentPrice,
            takeProfitPrice,
            stopLossPrice,
            riskRatio: risk > 0 ? reward / risk : 0,
          },
          isConfigFromBacktest: false,
        },
        figures: params.figures,
        indicators: params.indicators,
        additionalIndicators: params.additionalIndicators,
        signalId: params.signalId,
        orderPlan: params.orderPlan,
        runtime: params.runtime,
      });
    },
    getMarketData: async (params: any) => {
      const marketData = await getStrategyMarketSnapshot(params);
      latestMarketData = marketData;
      return marketData;
    },
    nextIndicators: jest.fn(),
    getCurrentPosition: jest.fn(),
    isCurrentPositionExists: jest.fn(async () => false),
    getDirectionalTpSlPrices: (params: any) => getDirectionalTpSlPrices(params),
    createLastTradeController: jest.fn(() => ({
      isInCooldown: jest.fn(() => false),
      markTrade: jest.fn(),
      getLastTradeTimestamp: jest.fn(() => null),
    })),
  } as any;
};

const makeConfig = (overrides: Record<string, any> = {}) => ({
  ...DEFAULT_CONFIG,
  ...overrides,
});

const makeIndicatorsState = () =>
  ({
    setCurrentBar: jest.fn(),
    onBar: jest.fn(),
    next: jest.fn(),
    ensureInitializedWithCurrentBar: jest.fn(),
    snapshot: jest.fn(() => ({ maFast: [1], correlation: [0.1] })),
    latestNumber: jest.fn(() => 0.1),
    isInitialized: jest.fn(() => true),
  }) as any;

const makeBestLine = (mode: 'lows' | 'highs' = 'lows') => ({
  id: 'line-1',
  mode,
  distance: 1.5,
  touches: [{ timestamp: 1_700_000_000_000 - 1, value: 99 }],
  points: [
    {
      timestamp: 1_700_000_000_000 - 1,
      value: mode === 'lows' ? 100.5 : 99.5,
    },
  ],
});

describe('createTrendLineCore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns skip when no trendline is found', async () => {
    (createTrendlineEngine as jest.Mock)
      .mockReturnValueOnce({ next: jest.fn(() => []) })
      .mockReturnValueOnce({ next: jest.fn(() => []) });

    const indicatorsState = {
      setCurrentBar: jest.fn(),
      onBar: jest.fn(),
      next: jest.fn(),
      ensureInitializedWithCurrentBar: jest.fn(),
      snapshot: jest.fn(),
      latestNumber: jest.fn(),
      isInitialized: jest.fn(() => true),
    };

    const connector = {
      getPosition: jest.fn(),
    } as any;

    const strategyApi = makeStrategyApi();
    const core = await createTrendLineCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig(),
      isConfigFromBacktest: false,
      connector,
      data: [],
      btcData: [],
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi,
      indicatorsState: indicatorsState as any,
    });

    const candle = makeCandle(1_700_000_000_000, 100);
    const result = await core(candle as any, candle as any);

    expect(result).toEqual({ kind: 'skip', code: 'NO_TRENDLINE' });
    expect(strategyApi.isCurrentPositionExists).not.toHaveBeenCalled();
  });

  it('returns entry decision for valid trendline setup', async () => {
    const candle = makeCandle(1_700_000_000_000, 100);
    const btcCandle = makeCandle(1_700_000_000_000, 20000);
    const bestLine = {
      id: 'line-1',
      mode: 'lows',
      distance: 1.5,
      touches: [{ timestamp: candle.timestamp - 1, value: 99 }],
      points: [{ timestamp: candle.timestamp - 1, value: 100.5 }],
    };

    (createTrendlineEngine as jest.Mock)
      .mockReturnValueOnce({ next: jest.fn(() => [bestLine]) })
      .mockReturnValueOnce({ next: jest.fn(() => []) });

    const indicatorsState = {
      setCurrentBar: jest.fn(),
      onBar: jest.fn(),
      next: jest.fn(),
      ensureInitializedWithCurrentBar: jest.fn(),
      snapshot: jest.fn(() => ({ maFast: [1], correlation: [0.1] })),
      latestNumber: jest.fn(() => 0.1),
      isInitialized: jest.fn(() => true),
    };

    (getStrategyMarketSnapshot as jest.Mock).mockResolvedValue({
      fullData: [candle],
      lastCandle: candle,
      timestamp: candle.timestamp,
      currentPrice: candle.close,
    });

    (getDirectionalTpSlPrices as jest.Mock).mockReturnValue({
      stopLossPrice: 98,
      takeProfitPrice: 104,
      riskRatio: 3,
      qty: 2,
    });

    const fakeDecision = { kind: 'entry', code: 'TRENDLINE_SIGNAL' };
    (buildEntrySignalDecision as jest.Mock).mockReturnValue(fakeDecision);

    const connector = {
      getPosition: jest.fn(async () => ({ qty: 0 })),
      kline: jest.fn(),
    } as any;

    const config = makeConfig({
      ENV: 'BACKTEST',
      LOWS: {
        enable: true,
        direction: 'SHORT',
        TP: 4,
        SL: 1,
        minRiskRatio: 2,
      },
    });

    const core = await createTrendLineCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config,
      isConfigFromBacktest: true,
      connector,
      data: [candle as any],
      btcData: [btcCandle as any],
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi: makeStrategyApi(),
      indicatorsState: indicatorsState as any,
    });

    const result = await core(candle as any, btcCandle as any);

    expect(result).toBe(fakeDecision);
    expect(indicatorsState.onBar).toHaveBeenCalledWith();
    expect(buildEntrySignalDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'TRENDLINE_SIGNAL',
        entryContext: expect.objectContaining({
          direction: 'SHORT',
          timestamp: candle.timestamp,
          prices: expect.objectContaining({
            currentPrice: candle.close,
          }),
        }),
        figures: expect.objectContaining({
          lines: expect.any(Array),
          points: expect.any(Array),
        }),
        additionalIndicators: expect.objectContaining({
          trendlineTiming: expect.objectContaining({
            entryTiming: 'ready_breakout',
            entryReadyNow: true,
          }),
        }),
        orderPlan: expect.objectContaining({ qty: 2, stopLossPrice: 98 }),
      }),
    );
  });

  it('returns skip when position already exists', async () => {
    const candle = makeCandle(1_700_000_000_000, 100);
    (createTrendlineEngine as jest.Mock)
      .mockReturnValueOnce({ next: jest.fn(() => [makeBestLine('lows')]) })
      .mockReturnValueOnce({ next: jest.fn(() => []) });

    const strategyApi = makeStrategyApi();
    strategyApi.isCurrentPositionExists = jest.fn(async () => true);

    const core = await createTrendLineCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig(),
      isConfigFromBacktest: false,
      connector: {} as any,
      data: [candle as any],
      btcData: [candle as any],
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi,
      indicatorsState: makeIndicatorsState() as any,
    });

    const result = await core(candle as any, candle as any);
    expect(result).toEqual({ kind: 'skip', code: 'POSITION_EXISTS' });
  });

  it('returns structural skip when breakout is not confirmed', async () => {
    const candle = makeCandle(1_700_000_000_000, 100);
    const invalidLine = {
      ...makeBestLine('lows'),
      points: [{ timestamp: candle.timestamp - 1, value: 99 }],
    };
    (createTrendlineEngine as jest.Mock)
      .mockReturnValueOnce({ next: jest.fn(() => [invalidLine]) })
      .mockReturnValueOnce({ next: jest.fn(() => []) });
    (getStrategyMarketSnapshot as jest.Mock).mockResolvedValue({
      fullData: [candle],
      lastCandle: candle,
      timestamp: candle.timestamp,
      currentPrice: candle.close,
    });

    const core = await createTrendLineCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig(),
      isConfigFromBacktest: false,
      connector: {} as any,
      data: [candle as any],
      btcData: [candle as any],
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi: makeStrategyApi(),
      indicatorsState: makeIndicatorsState() as any,
    });

    const result = await core(candle as any, candle as any);
    expect(result).toEqual({
      kind: 'skip',
      code: 'TRENDLINE_STRUCTURE:no_clear_break',
    });
  });

  it('returns timing skip for stale breakout without retest', async () => {
    const baseTimestamp = 1_700_000_000_000;
    const candles = [
      makeRangeCandle(baseTimestamp, {
        open: 99.5,
        close: 99.4,
        high: 99.6,
        low: 99.1,
      }),
      makeRangeCandle(baseTimestamp + 900_000, {
        open: 99.4,
        close: 99.3,
        high: 99.5,
        low: 99.0,
      }),
      makeRangeCandle(baseTimestamp + 1_800_000, {
        open: 99.3,
        close: 99.2,
        high: 99.4,
        low: 98.9,
      }),
    ];
    const bestLine = {
      ...makeBestLine('lows'),
      points: [{ timestamp: baseTimestamp, value: 100 }],
    };

    (createTrendlineEngine as jest.Mock)
      .mockReturnValueOnce({ next: jest.fn(() => [bestLine]) })
      .mockReturnValueOnce({ next: jest.fn(() => []) });
    (getStrategyMarketSnapshot as jest.Mock).mockResolvedValue({
      fullData: candles,
      lastCandle: candles[candles.length - 1],
      timestamp: candles[candles.length - 1].timestamp,
      currentPrice: candles[candles.length - 1].close,
    });

    const core = await createTrendLineCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig(),
      isConfigFromBacktest: false,
      connector: {} as any,
      data: candles as any,
      btcData: candles as any,
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi: makeStrategyApi(),
      indicatorsState: makeIndicatorsState() as any,
    });

    const result = await core(
      candles[candles.length - 1] as any,
      candles[candles.length - 1] as any,
    );

    expect(result).toEqual({
      kind: 'skip',
      code: 'TRENDLINE_TIMING:STALE_BREAKOUT',
    });
  });

  it('returns entry when retest was confirmed after initial breakout', async () => {
    const baseTimestamp = 1_700_000_000_000;
    const candles = [
      makeRangeCandle(baseTimestamp, {
        open: 99.5,
        close: 99.4,
        high: 99.6,
        low: 99.1,
      }),
      makeRangeCandle(baseTimestamp + 900_000, {
        open: 99.8,
        close: 99.9,
        high: 100.1,
        low: 99.6,
      }),
      makeRangeCandle(baseTimestamp + 1_800_000, {
        open: 99.6,
        close: 99.4,
        high: 99.7,
        low: 99.1,
      }),
    ];
    const bestLine = {
      ...makeBestLine('lows'),
      points: [{ timestamp: baseTimestamp, value: 100 }],
    };

    (createTrendlineEngine as jest.Mock)
      .mockReturnValueOnce({ next: jest.fn(() => [bestLine]) })
      .mockReturnValueOnce({ next: jest.fn(() => []) });
    (getStrategyMarketSnapshot as jest.Mock).mockResolvedValue({
      fullData: candles,
      lastCandle: candles[candles.length - 1],
      timestamp: candles[candles.length - 1].timestamp,
      currentPrice: candles[candles.length - 1].close,
    });
    (getDirectionalTpSlPrices as jest.Mock).mockReturnValue({
      stopLossPrice: 98,
      takeProfitPrice: 104,
      riskRatio: 3,
      qty: 2,
    });

    const fakeDecision = { kind: 'entry', code: 'TRENDLINE_SIGNAL' };
    (buildEntrySignalDecision as jest.Mock).mockReturnValue(fakeDecision);

    const core = await createTrendLineCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig({
        ENV: 'BACKTEST',
        LOWS: {
          enable: true,
          direction: 'SHORT',
          TP: 4,
          SL: 1,
          minRiskRatio: 2,
        },
      }),
      isConfigFromBacktest: true,
      connector: {} as any,
      data: candles as any,
      btcData: candles as any,
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi: makeStrategyApi(),
      indicatorsState: makeIndicatorsState() as any,
    });

    const result = await core(
      candles[candles.length - 1] as any,
      candles[candles.length - 1] as any,
    );

    expect(result).toBe(fakeDecision);
    expect(buildEntrySignalDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalIndicators: expect.objectContaining({
          trendlineTiming: expect.objectContaining({
            retestHappened: true,
            retestConfirmed: true,
            entryTiming: 'ready_retest',
            entryReadyNow: true,
          }),
        }),
      }),
    );
  });

  it('returns skip when trade cooldown is active', async () => {
    const candle = makeCandle(1_700_000_000_000, 100);
    (createTrendlineEngine as jest.Mock)
      .mockReturnValueOnce({ next: jest.fn(() => [makeBestLine('lows')]) })
      .mockReturnValueOnce({ next: jest.fn(() => []) });

    const strategyApi = makeStrategyApi();
    strategyApi.createLastTradeController = jest.fn(() => ({
      isInCooldown: jest.fn(() => true),
      markTrade: jest.fn(),
      getLastTradeTimestamp: jest.fn(() => candle.timestamp - 60_000),
    }));

    const core = await createTrendLineCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig(),
      isConfigFromBacktest: false,
      connector: {} as any,
      data: [candle as any],
      btcData: [candle as any],
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi,
      indicatorsState: makeIndicatorsState() as any,
    });

    const result = await core(candle as any, candle as any);
    expect(result).toEqual({ kind: 'skip', code: 'DEV_TRADE_COOLDOWN' });
  });

  it('returns skip when volatility filter rejects market data', async () => {
    const candle = makeCandle(1_700_000_000_000, 100);
    (createTrendlineEngine as jest.Mock)
      .mockReturnValueOnce({ next: jest.fn(() => [makeBestLine('lows')]) })
      .mockReturnValueOnce({ next: jest.fn(() => []) });
    (getStrategyMarketSnapshot as jest.Mock).mockResolvedValue({
      fullData: [candle],
      lastCandle: candle,
      timestamp: candle.timestamp,
      currentPrice: candle.close,
    });
    (filterByVeryVolatility as jest.Mock).mockReturnValueOnce(false);

    const core = await createTrendLineCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig(),
      isConfigFromBacktest: false,
      connector: {} as any,
      data: [candle as any],
      btcData: [candle as any],
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi: makeStrategyApi(),
      indicatorsState: makeIndicatorsState() as any,
    });

    const result = await core(candle as any, candle as any);
    expect(result).toEqual({ kind: 'skip', code: 'VERY_VOLATILITY' });
  });

  it('returns skip when selected trendline side is disabled', async () => {
    const candle = makeCandle(1_700_000_000_000, 100);
    (createTrendlineEngine as jest.Mock)
      .mockReturnValueOnce({ next: jest.fn(() => [makeBestLine('lows')]) })
      .mockReturnValueOnce({ next: jest.fn(() => []) });
    (getStrategyMarketSnapshot as jest.Mock).mockResolvedValue({
      fullData: [candle],
      lastCandle: candle,
      timestamp: candle.timestamp,
      currentPrice: candle.close,
    });

    const core = await createTrendLineCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig({
        LOWS: {
          ...DEFAULT_CONFIG.LOWS,
          enable: false,
        },
      }),
      isConfigFromBacktest: false,
      connector: {} as any,
      data: [candle as any],
      btcData: [candle as any],
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi: makeStrategyApi(),
      indicatorsState: makeIndicatorsState() as any,
    });

    const result = await core(candle as any, candle as any);
    expect(result).toEqual({ kind: 'skip', code: 'STRATEGY_DISABLED' });
  });

  it('returns INVALID_QTY when sizing returns non-positive quantity', async () => {
    const candle = makeCandle(1_700_000_000_000, 100);
    (createTrendlineEngine as jest.Mock)
      .mockReturnValueOnce({ next: jest.fn(() => [makeBestLine('lows')]) })
      .mockReturnValueOnce({ next: jest.fn(() => []) });
    (getStrategyMarketSnapshot as jest.Mock).mockResolvedValue({
      fullData: [candle],
      lastCandle: candle,
      timestamp: candle.timestamp,
      currentPrice: candle.close,
    });
    (getDirectionalTpSlPrices as jest.Mock).mockReturnValueOnce({
      stopLossPrice: 98,
      takeProfitPrice: 104,
      riskRatio: 3,
      qty: 0,
    });

    const core = await createTrendLineCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig(),
      isConfigFromBacktest: false,
      connector: {} as any,
      data: [candle as any],
      btcData: [candle as any],
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi: makeStrategyApi(),
      indicatorsState: makeIndicatorsState() as any,
    });

    const result = await core(candle as any, candle as any);
    expect(result).toEqual({ kind: 'skip', code: 'INVALID_QTY' });
  });

  it('returns RISK_RATIO skip when calculated ratio is below minimum', async () => {
    const candle = makeCandle(1_700_000_000_000, 100);
    (createTrendlineEngine as jest.Mock)
      .mockReturnValueOnce({ next: jest.fn(() => [makeBestLine('lows')]) })
      .mockReturnValueOnce({ next: jest.fn(() => []) });
    (getStrategyMarketSnapshot as jest.Mock).mockResolvedValue({
      fullData: [candle],
      lastCandle: candle,
      timestamp: candle.timestamp,
      currentPrice: candle.close,
    });
    (getDirectionalTpSlPrices as jest.Mock).mockReturnValueOnce({
      stopLossPrice: 98,
      takeProfitPrice: 104,
      riskRatio: 1,
      qty: 1,
    });

    const core = await createTrendLineCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig({
        LOWS: {
          ...DEFAULT_CONFIG.LOWS,
          minRiskRatio: 2,
        },
      }),
      isConfigFromBacktest: false,
      connector: {} as any,
      data: [candle as any],
      btcData: [candle as any],
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi: makeStrategyApi(),
      indicatorsState: makeIndicatorsState() as any,
    });

    const result = await core(candle as any, candle as any);
    expect(result).toEqual({ kind: 'skip', code: 'RISK_RATIO:1' });
  });

  it('returns MAX_CORRELATION skip outside backtest when correlation is high', async () => {
    const candle = makeCandle(1_700_000_000_000, 100);
    (createTrendlineEngine as jest.Mock)
      .mockReturnValueOnce({ next: jest.fn(() => [makeBestLine('lows')]) })
      .mockReturnValueOnce({ next: jest.fn(() => []) });
    (getStrategyMarketSnapshot as jest.Mock).mockResolvedValue({
      fullData: [candle],
      lastCandle: candle,
      timestamp: candle.timestamp,
      currentPrice: candle.close,
    });
    (getDirectionalTpSlPrices as jest.Mock).mockReturnValueOnce({
      stopLossPrice: 98,
      takeProfitPrice: 104,
      riskRatio: 3,
      qty: 1,
    });

    const indicatorsState = makeIndicatorsState() as any;
    indicatorsState.latestNumber = jest.fn(() => 0.95);

    const core = await createTrendLineCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig({
        ENV: 'PROD',
        MAX_CORRELATION: 0.9,
      }),
      isConfigFromBacktest: false,
      connector: {} as any,
      data: [candle as any],
      btcData: [candle as any],
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi: makeStrategyApi(),
      indicatorsState,
    });

    const result = await core(candle as any, candle as any);
    expect(result).toEqual({ kind: 'skip', code: 'MAX_CORRELATION:0.95' });
  });
});
