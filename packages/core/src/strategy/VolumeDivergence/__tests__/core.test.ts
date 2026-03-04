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
  const entry = jest.fn((params: any) => ({
    kind: 'entry',
    code: params.code,
    entryContext: {
      strategy: 'VolumeDivergence',
      symbol: 'TESTUSDT',
      interval: '15',
      direction: params.direction,
      timestamp: params.timestamp,
      prices: params.prices,
    },
    orderPlan: params.orderPlan,
    signal: {
      strategy: 'VolumeDivergence',
      direction: params.direction,
      prices: params.prices,
      figures: params.figures,
      indicators: params.indicators,
      additionalIndicators: params.additionalIndicators,
    },
  }));

  return {
    skip,
    entry,
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
        NORMALIZATION_LENGTH: 8,
        PIVOT_LOOKBACK_LEFT: 2,
        PIVOT_LOOKBACK_RIGHT: 1,
        MIN_BARS_BETWEEN_PIVOTS: 1,
        MAX_BARS_BETWEEN_PIVOTS: 10,
      }),
      isConfigFromBacktest: false,
      connector: { getPosition: jest.fn() } as any,
      data: candles as any,
      btcData: candles as any,
      loadPineScript: jest.fn(() => ''),
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
    const baseTs = 1_700_000_000_000;
    const volumes = [0, 200, 80, 40, 120, 60, 180, 20];
    const prices = [110, 108, 106, 105, 100, 98, 90, 92];

    const candles = volumes.map((volume, index) => {
      const candle = makeCandle(
        baseTs + index * 900_000,
        prices[index],
        volume,
      );
      if (index === 4) candle.low = 100;
      if (index === 6) candle.low = 90;
      return candle;
    });

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
        NORMALIZATION_LENGTH: 8,
        PIVOT_LOOKBACK_LEFT: 2,
        PIVOT_LOOKBACK_RIGHT: 1,
        MIN_BARS_BETWEEN_PIVOTS: 1,
        MAX_BARS_BETWEEN_PIVOTS: 10,
      }),
      isConfigFromBacktest: false,
      connector: { getPosition: jest.fn() } as any,
      data: candles as any,
      btcData: candles as any,
      loadPineScript: jest.fn(() => ''),
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
        code: 'VOLUME_DIVERGENCE_REVERSAL_SIGNAL',
        direction: 'LONG',
        additionalIndicators: expect.objectContaining({
          divergenceKind: 'bullish',
        }),
      }),
    );
  });
});
