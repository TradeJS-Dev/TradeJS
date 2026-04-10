import { createVolumeDivergenceCore } from '../core';
import { config as DEFAULT_CONFIG } from '../config';

const makeCandle = (timestamp: number, price: number, volume: number) => ({
  timestamp,
  dt: new Date(timestamp).toISOString(),
  open: price * 0.99,
  close: price,
  high: price * 1.01,
  low: price * 0.98,
  volume,
  turnover: price * volume,
});

const makeStrategyApi = (overrides: Record<string, any> = {}) => {
  const skip = jest.fn((code: string) => ({ kind: 'skip', code }));
  const strategyApi = {
    skip,
    entry: jest.fn(),
    getMarketData: jest.fn(),
    getCurrentPosition: jest.fn(),
    isCurrentPositionExists: jest.fn(async () => false),
    getDirectionalTpSlPrices: jest.fn(() => ({
      stopLossPrice: 98,
      takeProfitPrice: 104,
      riskRatio: 3,
      qty: 2,
    })),
    createLastTradeController: jest.fn(() => ({
      isInCooldown: jest.fn(() => false),
      markTrade: jest.fn(),
      getLastTradeTimestamp: jest.fn(() => null),
    })),
    ...overrides,
  } as any;

  strategyApi.entry.mockImplementation(async (params: any) => {
    const marketData = await strategyApi.getMarketData();
    const currentPrice = Number(marketData.currentPrice);
    const timestamp = Number(marketData.timestamp);
    const takeProfitPrices = Array.isArray(params.orderPlan?.takeProfits)
      ? params.orderPlan.takeProfits.map((tp: any) => Number(tp.price))
      : [];
    const takeProfitPrice =
      params.direction === 'LONG'
        ? Math.max(...takeProfitPrices)
        : Math.min(...takeProfitPrices);
    const stopLossPrice = Number(params.orderPlan?.stopLossPrice);
    const reward =
      params.direction === 'LONG'
        ? takeProfitPrice - currentPrice
        : currentPrice - takeProfitPrice;
    const risk =
      params.direction === 'LONG'
        ? currentPrice - stopLossPrice
        : stopLossPrice - currentPrice;
    const prices = {
      currentPrice,
      takeProfitPrice,
      stopLossPrice,
      riskRatio: risk > 0 ? reward / risk : 0,
    };

    return {
      kind: 'entry',
      code: params.code ?? `VOLUME_DIVERGENCE_${params.direction}_ENTRY`,
      entryContext: {
        strategy: 'VolumeDivergence',
        symbol: 'TESTUSDT',
        interval: '15',
        direction: params.direction,
        timestamp,
        prices,
      },
      orderPlan: params.orderPlan,
      signal: {
        strategy: 'VolumeDivergence',
        direction: params.direction,
        timestamp,
        prices,
        figures: params.figures,
        indicators: params.indicators,
        additionalIndicators: params.additionalIndicators,
      },
    };
  });

  return strategyApi;
};

const makeIndicatorsState = () =>
  ({
    setCurrentBar: jest.fn(),
    onBar: jest.fn(),
    next: jest.fn(),
    ensureInitializedWithCurrentBar: jest.fn(),
    snapshot: jest.fn(() => ({ correlation: [0.1] })),
    latestNumber: jest.fn(() => 0.1),
    isInitialized: jest.fn(() => true),
  }) as any;

const makeConfig = (overrides: Record<string, any> = {}) => ({
  ...DEFAULT_CONFIG,
  ...overrides,
});

const DIVERGENCE_TEST_CONFIG = {
  NORMALIZATION_LENGTH: 8,
  PIVOT_LOOKBACK_LEFT: 2,
  PIVOT_LOOKBACK_RIGHT: 1,
  MIN_BARS_BETWEEN_PIVOTS: 1,
  MAX_BARS_BETWEEN_PIVOTS: 10,
};

const makeBullishDivergenceCandles = () => {
  const baseTs = 1_700_000_000_000;
  const volumes = [0, 200, 80, 40, 120, 60, 180, 20];
  const prices = [110, 108, 106, 105, 100, 98, 90, 92];

  return volumes.map((volume, index) => {
    const candle = makeCandle(baseTs + index * 900_000, prices[index], volume);
    if (index === 4) candle.low = 100;
    if (index === 6) candle.low = 90;
    return candle;
  });
};

const makeBearishDivergenceCandles = () => {
  const baseTs = 1_700_100_000_000;
  const volumes = [1000, 100, 200, 900, 150, 200, 250, 300, 100];
  const prices = [100, 101, 102, 104, 103, 106, 108, 112, 111];

  return volumes.map((volume, index) => {
    const candle = makeCandle(baseTs + index * 900_000, prices[index], volume);
    if (index === 3) candle.high = 104;
    if (index === 7) candle.high = 112;
    return candle;
  });
};

describe('createVolumeDivergenceCore', () => {
  it('returns NO_DIVERGENCE when pivots do not match divergence rules', async () => {
    const candles = Array.from({ length: 12 }).map((_, index) =>
      makeCandle(1_700_000_000_000 + index * 900_000, 100 + index, 100 + index),
    );

    const strategyApi = makeStrategyApi();
    strategyApi.getMarketData.mockResolvedValue({
      fullData: candles,
      lastCandle: candles[candles.length - 1],
      timestamp: candles[candles.length - 1].timestamp,
      currentPrice: candles[candles.length - 1].close,
    });

    const core = await createVolumeDivergenceCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig({
        ...DIVERGENCE_TEST_CONFIG,
      }),
      isConfigFromBacktest: false,
      connector: { getPosition: jest.fn() } as any,
      data: candles as any,
      btcData: candles as any,
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi,
      indicatorsState: makeIndicatorsState(),
    });

    const result = await core(
      candles[candles.length - 1] as any,
      candles[candles.length - 1] as any,
    );

    expect(result).toEqual({ kind: 'skip', code: 'NO_DIVERGENCE' });
    expect(strategyApi.entry).not.toHaveBeenCalled();
  });

  it('returns entry on bullish divergence', async () => {
    const candles = makeBullishDivergenceCandles();

    const strategyApi = makeStrategyApi();
    strategyApi.getMarketData.mockResolvedValue({
      fullData: candles,
      lastCandle: candles[candles.length - 1],
      timestamp: candles[candles.length - 1].timestamp,
      currentPrice: candles[candles.length - 1].close,
    });

    const core = await createVolumeDivergenceCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig({
        ...DIVERGENCE_TEST_CONFIG,
      }),
      isConfigFromBacktest: false,
      connector: { getPosition: jest.fn() } as any,
      data: candles as any,
      btcData: candles as any,
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi,
      indicatorsState: makeIndicatorsState(),
    });

    const result = await core(
      candles[candles.length - 1] as any,
      candles[candles.length - 1] as any,
    );

    expect(result.kind).toBe('entry');
    expect(strategyApi.entry).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'LONG',
        orderPlan: expect.objectContaining({
          stopLossPrice: 98,
        }),
        additionalIndicators: expect.objectContaining({
          divergenceKind: 'bullish',
        }),
      }),
    );
  });

  it('returns entry on bearish divergence', async () => {
    const candles = makeBearishDivergenceCandles();

    const strategyApi = makeStrategyApi();
    strategyApi.getMarketData.mockResolvedValue({
      fullData: candles,
      lastCandle: candles[candles.length - 1],
      timestamp: candles[candles.length - 1].timestamp,
      currentPrice: candles[candles.length - 1].close,
    });

    const core = await createVolumeDivergenceCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig({
        ...DIVERGENCE_TEST_CONFIG,
      }),
      isConfigFromBacktest: false,
      connector: { getPosition: jest.fn() } as any,
      data: candles as any,
      btcData: candles as any,
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi,
      indicatorsState: makeIndicatorsState(),
    });

    const result = await core(
      candles[candles.length - 1] as any,
      candles[candles.length - 1] as any,
    );

    expect(result.kind).toBe('entry');
    expect(strategyApi.entry).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'SHORT',
        orderPlan: expect.objectContaining({
          stopLossPrice: 98,
        }),
        additionalIndicators: expect.objectContaining({
          divergenceKind: 'bearish',
        }),
      }),
    );
  });

  it('returns POSITION_EXISTS when runtime already has an open position', async () => {
    const candles = makeBullishDivergenceCandles();
    const strategyApi = makeStrategyApi({
      isCurrentPositionExists: jest.fn(async () => true),
      getMarketData: jest.fn(async () => ({
        fullData: candles,
        timestamp: candles[candles.length - 1].timestamp,
        currentPrice: candles[candles.length - 1].close,
      })),
    });
    const indicatorsState = makeIndicatorsState();

    const core = await createVolumeDivergenceCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig({
        ...DIVERGENCE_TEST_CONFIG,
      }),
      isConfigFromBacktest: false,
      connector: {} as any,
      data: candles as any,
      btcData: candles as any,
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi,
      indicatorsState,
    });

    const result = await core(
      candles[candles.length - 1] as any,
      candles[candles.length - 1] as any,
    );

    expect(result).toEqual({
      kind: 'skip',
      code: 'POSITION_EXISTS',
    });
    expect(indicatorsState.onBar).toHaveBeenCalledTimes(1);
  });

  it('returns WAIT_DATA when candle history is too short', async () => {
    const candles = makeBullishDivergenceCandles().slice(0, 3);
    const strategyApi = makeStrategyApi();
    strategyApi.getMarketData.mockResolvedValue({
      fullData: candles,
      lastCandle: candles[candles.length - 1],
      timestamp: candles[candles.length - 1].timestamp,
      currentPrice: candles[candles.length - 1].close,
    });

    const core = await createVolumeDivergenceCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig({
        PIVOT_LOOKBACK_LEFT: 2,
        PIVOT_LOOKBACK_RIGHT: 1,
      }),
      isConfigFromBacktest: false,
      connector: {} as any,
      data: candles as any,
      btcData: candles as any,
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi,
      indicatorsState: makeIndicatorsState(),
    });

    const result = await core(
      candles[candles.length - 1] as any,
      candles[candles.length - 1] as any,
    );
    expect(result).toEqual({
      kind: 'skip',
      code: 'WAIT_DATA',
    });
  });

  it('returns DEV_TRADE_COOLDOWN when last trade cooldown is active', async () => {
    const candles = makeBullishDivergenceCandles();
    const strategyApi = makeStrategyApi({
      createLastTradeController: jest.fn(() => ({
        isInCooldown: jest.fn(() => true),
        markTrade: jest.fn(),
        getLastTradeTimestamp: jest.fn(() => candles[0].timestamp),
      })),
    });
    strategyApi.getMarketData.mockResolvedValue({
      fullData: candles,
      lastCandle: candles[candles.length - 1],
      timestamp: candles[candles.length - 1].timestamp,
      currentPrice: candles[candles.length - 1].close,
    });

    const core = await createVolumeDivergenceCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig({
        ...DIVERGENCE_TEST_CONFIG,
      }),
      isConfigFromBacktest: false,
      connector: {} as any,
      data: candles as any,
      btcData: candles as any,
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi,
      indicatorsState: makeIndicatorsState(),
    });

    const result = await core(
      candles[candles.length - 1] as any,
      candles[candles.length - 1] as any,
    );
    expect(result).toEqual({
      kind: 'skip',
      code: 'DEV_TRADE_COOLDOWN',
    });
  });

  it('returns STRATEGY_DISABLED when divergence side is disabled in config', async () => {
    const candles = makeBullishDivergenceCandles();
    const strategyApi = makeStrategyApi();
    strategyApi.getMarketData.mockResolvedValue({
      fullData: candles,
      lastCandle: candles[candles.length - 1],
      timestamp: candles[candles.length - 1].timestamp,
      currentPrice: candles[candles.length - 1].close,
    });

    const core = await createVolumeDivergenceCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig({
        ...DIVERGENCE_TEST_CONFIG,
        BULLISH: {
          ...DEFAULT_CONFIG.BULLISH,
          enable: false,
        },
      }),
      isConfigFromBacktest: false,
      connector: {} as any,
      data: candles as any,
      btcData: candles as any,
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi,
      indicatorsState: makeIndicatorsState(),
    });

    const result = await core(
      candles[candles.length - 1] as any,
      candles[candles.length - 1] as any,
    );
    expect(result).toEqual({
      kind: 'skip',
      code: 'STRATEGY_DISABLED',
    });
  });

  it('returns INVALID_QTY when directional sizing returns non-positive qty', async () => {
    const candles = makeBullishDivergenceCandles();
    const strategyApi = makeStrategyApi({
      getDirectionalTpSlPrices: jest.fn(() => ({
        stopLossPrice: 98,
        takeProfitPrice: 104,
        riskRatio: 3,
        qty: 0,
      })),
    });
    strategyApi.getMarketData.mockResolvedValue({
      fullData: candles,
      lastCandle: candles[candles.length - 1],
      timestamp: candles[candles.length - 1].timestamp,
      currentPrice: candles[candles.length - 1].close,
    });

    const core = await createVolumeDivergenceCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig({
        ...DIVERGENCE_TEST_CONFIG,
      }),
      isConfigFromBacktest: false,
      connector: {} as any,
      data: candles as any,
      btcData: candles as any,
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi,
      indicatorsState: makeIndicatorsState(),
    });

    const result = await core(
      candles[candles.length - 1] as any,
      candles[candles.length - 1] as any,
    );
    expect(result).toEqual({
      kind: 'skip',
      code: 'INVALID_QTY',
    });
  });

  it('returns RISK_RATIO skip when calculated risk ratio is below minimum', async () => {
    const candles = makeBullishDivergenceCandles();
    const strategyApi = makeStrategyApi({
      getDirectionalTpSlPrices: jest.fn(() => ({
        stopLossPrice: 98,
        takeProfitPrice: 104,
        riskRatio: 1.01,
        qty: 1,
      })),
    });
    strategyApi.getMarketData.mockResolvedValue({
      fullData: candles,
      lastCandle: candles[candles.length - 1],
      timestamp: candles[candles.length - 1].timestamp,
      currentPrice: candles[candles.length - 1].close,
    });

    const core = await createVolumeDivergenceCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig({
        ...DIVERGENCE_TEST_CONFIG,
        BULLISH: {
          ...DEFAULT_CONFIG.BULLISH,
          minRiskRatio: 2,
        },
      }),
      isConfigFromBacktest: false,
      connector: {} as any,
      data: candles as any,
      btcData: candles as any,
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi,
      indicatorsState: makeIndicatorsState(),
    });

    const result = await core(
      candles[candles.length - 1] as any,
      candles[candles.length - 1] as any,
    );
    expect(result).toEqual({
      kind: 'skip',
      code: 'RISK_RATIO:1.01',
    });
  });

  it('does not skip entry in non-backtest mode when correlation is too high', async () => {
    const candles = makeBullishDivergenceCandles();
    const strategyApi = makeStrategyApi();
    strategyApi.getMarketData.mockResolvedValue({
      fullData: candles,
      lastCandle: candles[candles.length - 1],
      timestamp: candles[candles.length - 1].timestamp,
      currentPrice: candles[candles.length - 1].close,
    });
    const indicatorsState = makeIndicatorsState();
    indicatorsState.latestNumber = jest.fn(() => 0.95);

    const core = await createVolumeDivergenceCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig({
        ...DIVERGENCE_TEST_CONFIG,
        ENV: 'PROD',
        MAX_CORRELATION: 0.9,
      }),
      isConfigFromBacktest: false,
      connector: {} as any,
      data: candles as any,
      btcData: candles as any,
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi,
      indicatorsState,
    });

    const result = await core(
      candles[candles.length - 1] as any,
      candles[candles.length - 1] as any,
    );
    expect(result.kind).toBe('entry');
  });
});
