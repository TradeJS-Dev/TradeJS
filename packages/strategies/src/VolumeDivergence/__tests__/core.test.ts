import { createVolumeDivergenceCore } from '../core';
import { config as DEFAULT_CONFIG } from '../config';
import { createTestStateController } from '../../testUtils/stateControllerTestUtils';

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
    protect: jest.fn((params: any) => ({
      kind: 'protect',
      code:
        params.code ??
        `VOLUME_DIVERGENCE_${params.protectPlan.direction}_PROTECT`,
      protectPlan: params.protectPlan,
    })),
    getDecisionPriceContext: jest.fn(),
    getCurrentPosition: jest.fn(async () => null),
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
    createStateController: createTestStateController(),
    ...overrides,
  } as any;

  strategyApi.entry.mockImplementation(async (params: any) => {
    const decisionContext = await strategyApi.getDecisionPriceContext();
    const currentPrice = Number(decisionContext.currentPrice);
    const timestamp = Number(decisionContext.timestamp);
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
  BULLISH: {
    ...DEFAULT_CONFIG.BULLISH,
    requireRetest: false,
    minDivergenceAmplitudeAtrRatio:
      DEFAULT_CONFIG.MIN_DIVERGENCE_AMPLITUDE_ATR_RATIO,
    minReclaimPct: DEFAULT_CONFIG.MIN_RECLAIM_PCT,
    minConfirmationCandleQuality:
      DEFAULT_CONFIG.MIN_CONFIRMATION_CANDLE_QUALITY,
    ...(overrides.BULLISH ?? {}),
  },
  BEARISH: {
    ...DEFAULT_CONFIG.BEARISH,
    requireRetest: false,
    minDivergenceAmplitudeAtrRatio:
      DEFAULT_CONFIG.MIN_DIVERGENCE_AMPLITUDE_ATR_RATIO,
    minReclaimPct: DEFAULT_CONFIG.MIN_RECLAIM_PCT,
    minConfirmationCandleQuality:
      DEFAULT_CONFIG.MIN_CONFIRMATION_CANDLE_QUALITY,
    ...(overrides.BEARISH ?? {}),
  },
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

const makeFollowUpCandle = ({
  previousCandle,
  price,
  volume,
}: {
  previousCandle: ReturnType<typeof makeCandle>;
  price: number;
  volume: number;
}) => {
  const candle = makeCandle(previousCandle.timestamp + 900_000, price, volume);
  candle.open = previousCandle.close;
  candle.close = price;
  candle.high = Math.max(candle.high, previousCandle.close, price);
  candle.low = Math.min(candle.low, previousCandle.close, price);
  return candle;
};

describe('createVolumeDivergenceCore', () => {
  it('returns NO_DIVERGENCE when pivots do not match divergence rules', async () => {
    const candles = Array.from({ length: 12 }).map((_, index) =>
      makeCandle(1_700_000_000_000 + index * 900_000, 100 + index, 100 + index),
    );

    const strategyApi = makeStrategyApi();
    strategyApi.getDecisionPriceContext.mockResolvedValue({
      candle: candles[candles.length - 1],
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

  it('stores pending bullish divergence and enters on later confirmation', async () => {
    const candles = makeBullishDivergenceCandles();

    const strategyApi = makeStrategyApi();
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

    const pendingResult = await core(
      candles[candles.length - 1] as any,
      candles[candles.length - 1] as any,
    );

    expect(pendingResult).toEqual({
      kind: 'skip',
      code: 'WAIT_REVERSAL_CONFIRMATION',
    });
    expect(strategyApi.entry).not.toHaveBeenCalled();

    const confirmationCandle = makeFollowUpCandle({
      previousCandle: candles[candles.length - 1],
      price: 94,
      volume: 90,
    });
    strategyApi.getDecisionPriceContext.mockResolvedValue({
      candle: confirmationCandle,
      timestamp: confirmationCandle.timestamp,
      currentPrice: confirmationCandle.close,
    });

    const result = await core(
      confirmationCandle as any,
      confirmationCandle as any,
    );

    expect(result.kind).toBe('entry');
    expect(strategyApi.entry).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'LONG',
        orderPlan: expect.objectContaining({
          stopLossPrice: expect.any(Number),
        }),
        additionalIndicators: expect.objectContaining({
          divergenceKind: 'bullish',
          volumeDivergenceSetup: expect.objectContaining({
            divergenceAmplitudeAtrRatio: expect.any(Number),
            reclaimPct: expect.any(Number),
            confirmationCandleQuality: expect.any(Number),
            atrPct: expect.any(Number),
            confirmationDistancePct: expect.any(Number),
          }),
          volumeDivergenceSignalTiming: expect.objectContaining({
            entryTiming: 'confirmation_ready',
            barsSinceDetection: 1,
          }),
        }),
      }),
    );
  });

  it('rebuilds pending bullish divergence from initial history and enters on first confirmation candle', async () => {
    const candles = makeBullishDivergenceCandles();
    const confirmationCandle = makeFollowUpCandle({
      previousCandle: candles[candles.length - 1],
      price: 94,
      volume: 90,
    });

    const strategyApi = makeStrategyApi();
    strategyApi.getDecisionPriceContext.mockResolvedValue({
      candle: confirmationCandle,
      timestamp: confirmationCandle.timestamp,
      currentPrice: confirmationCandle.close,
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
      confirmationCandle as any,
      confirmationCandle as any,
    );

    expect(result.kind).toBe('entry');
    expect(strategyApi.entry).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'LONG',
        additionalIndicators: expect.objectContaining({
          divergenceKind: 'bullish',
          volumeDivergenceSignalTiming: expect.objectContaining({
            entryTiming: 'confirmation_ready',
            barsSinceDetection: 1,
          }),
        }),
      }),
    );
  });

  it('waits for a causal retest after bullish rebound confirmation', async () => {
    const candles = makeBullishDivergenceCandles();
    const strategyApi = makeStrategyApi();
    const retestConfig = makeConfig({
      ...DIVERGENCE_TEST_CONFIG,
      BULLISH: {
        requireRetest: true,
        retestToleranceAtr: 0.5,
        maxRetestBars: 3,
        maxConfirmationDistanceAtr: 2,
      },
    });
    const core = await createVolumeDivergenceCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: retestConfig,
      isConfigFromBacktest: false,
      connector: {} as any,
      data: candles as any,
      btcData: candles as any,
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi,
      indicatorsState: makeIndicatorsState(),
    });

    expect(await core(candles.at(-1) as any, candles.at(-1) as any)).toEqual({
      kind: 'skip',
      code: 'WAIT_REVERSAL_CONFIRMATION',
    });

    const confirmation = makeFollowUpCandle({
      previousCandle: candles.at(-1)!,
      price: 94,
      volume: 90,
    });
    strategyApi.getDecisionPriceContext.mockResolvedValue({
      candle: confirmation,
      timestamp: confirmation.timestamp,
      currentPrice: confirmation.close,
    });
    expect(await core(confirmation as any, confirmation as any)).toEqual({
      kind: 'skip',
      code: 'WAIT_CONFIRMATION_RETEST',
    });
    expect(strategyApi.entry).not.toHaveBeenCalled();

    const retest = makeCandle(confirmation.timestamp + 900_000, 92, 80);
    retest.open = 90.8;
    retest.high = 92.4;
    retest.low = 90.5;
    strategyApi.getDecisionPriceContext.mockResolvedValue({
      candle: retest,
      timestamp: retest.timestamp,
      currentPrice: retest.close,
    });
    const result = await core(retest as any, retest as any);

    expect(result.kind).toBe('entry');
    expect(strategyApi.entry).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'LONG',
        additionalIndicators: expect.objectContaining({
          setupId: expect.stringMatching(/^bullish:/),
          volumeDivergenceSignalTiming: expect.objectContaining({
            phase: 'retest_pending',
            entryTiming: 'retest_ready',
            barsSinceRebound: 1,
          }),
          volumeDivergenceThresholds: expect.objectContaining({
            requireRetest: true,
          }),
        }),
      }),
    );
  });

  it('rebuilds retest-pending state from initial candles', async () => {
    const candles = makeBullishDivergenceCandles();
    const confirmation = makeFollowUpCandle({
      previousCandle: candles.at(-1)!,
      price: 94,
      volume: 90,
    });
    const retest = makeCandle(confirmation.timestamp + 900_000, 92, 80);
    retest.open = 90.8;
    retest.high = 92.4;
    retest.low = 90.5;
    const strategyApi = makeStrategyApi();
    strategyApi.getDecisionPriceContext.mockResolvedValue({
      candle: retest,
      timestamp: retest.timestamp,
      currentPrice: retest.close,
    });
    const core = await createVolumeDivergenceCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig({
        ...DIVERGENCE_TEST_CONFIG,
        BULLISH: {
          requireRetest: true,
          retestToleranceAtr: 0.5,
          maxRetestBars: 3,
          maxConfirmationDistanceAtr: 2,
        },
      }),
      isConfigFromBacktest: false,
      connector: {} as any,
      data: [...candles, confirmation] as any,
      btcData: candles as any,
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi,
      indicatorsState: makeIndicatorsState(),
    });

    const result = await core(retest as any, retest as any);
    expect(result.kind).toBe('entry');
    expect(
      (result as any).signal.additionalIndicators.volumeDivergenceSignalTiming
        .entryTiming,
    ).toBe('retest_ready');
  });

  it('applies divergence amplitude thresholds independently by direction', async () => {
    const candles = makeBullishDivergenceCandles();
    const strategyApi = makeStrategyApi();
    const core = await createVolumeDivergenceCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig({
        ...DIVERGENCE_TEST_CONFIG,
        BULLISH: { minDivergenceAmplitudeAtrRatio: 999 },
        BEARISH: { minDivergenceAmplitudeAtrRatio: 0.01 },
      }),
      isConfigFromBacktest: false,
      connector: {} as any,
      data: candles as any,
      btcData: candles as any,
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi,
      indicatorsState: makeIndicatorsState(),
    });

    expect(await core(candles.at(-1) as any, candles.at(-1) as any)).toEqual({
      kind: 'skip',
      code: 'WEAK_DIVERGENCE_AMPLITUDE_ATR',
    });
  });

  it('keeps bullish structure-advance candidates pending until confirmation is ready', async () => {
    const candles = makeBullishDivergenceCandles();
    candles[4].low = 96.5;
    candles[6].low = 95;
    candles[6].high = 97;

    const strategyApi = makeStrategyApi();
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

    const pendingResult = await core(
      candles[candles.length - 1] as any,
      candles[candles.length - 1] as any,
    );

    expect(pendingResult).toEqual({
      kind: 'skip',
      code: 'WAIT_REVERSAL_CONFIRMATION',
    });
    expect(strategyApi.entry).not.toHaveBeenCalled();

    const weakStructureAdvanceCandle = makeFollowUpCandle({
      previousCandle: candles[candles.length - 1],
      price: 96.6,
      volume: 90,
    });
    strategyApi.getDecisionPriceContext.mockResolvedValue({
      candle: weakStructureAdvanceCandle,
      timestamp: weakStructureAdvanceCandle.timestamp,
      currentPrice: weakStructureAdvanceCandle.close,
    });

    const weakResult = await core(
      weakStructureAdvanceCandle as any,
      weakStructureAdvanceCandle as any,
    );

    expect(weakResult).toEqual({
      kind: 'skip',
      code: 'WAIT_CONFIRMATION_READY',
    });
    expect(strategyApi.entry).not.toHaveBeenCalled();

    const confirmationCandle = makeFollowUpCandle({
      previousCandle: weakStructureAdvanceCandle,
      price: 97.8,
      volume: 95,
    });
    strategyApi.getDecisionPriceContext.mockResolvedValue({
      candle: confirmationCandle,
      timestamp: confirmationCandle.timestamp,
      currentPrice: confirmationCandle.close,
    });

    const result = await core(
      confirmationCandle as any,
      confirmationCandle as any,
    );

    expect(result.kind).toBe('entry');
    expect(strategyApi.entry).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'LONG',
        additionalIndicators: expect.objectContaining({
          divergenceKind: 'bullish',
          volumeDivergenceSetup: expect.objectContaining({
            divergenceAmplitudeAtrRatio: expect.any(Number),
            reclaimPct: expect.any(Number),
            confirmationCandleQuality: expect.any(Number),
            atrPct: expect.any(Number),
            confirmationDistancePct: expect.any(Number),
          }),
          volumeDivergenceSignalTiming: expect.objectContaining({
            entryTiming: 'confirmation_ready',
            barsSinceDetection: 2,
          }),
        }),
      }),
    );
  });

  it('stores pending bearish divergence and enters on later confirmation', async () => {
    const candles = makeBearishDivergenceCandles();

    const strategyApi = makeStrategyApi();
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

    const pendingResult = await core(
      candles[candles.length - 1] as any,
      candles[candles.length - 1] as any,
    );

    expect(pendingResult).toEqual({
      kind: 'skip',
      code: 'WAIT_REVERSAL_CONFIRMATION',
    });
    expect(strategyApi.entry).not.toHaveBeenCalled();

    const confirmationCandle = makeFollowUpCandle({
      previousCandle: candles[candles.length - 1],
      price: 107,
      volume: 120,
    });
    strategyApi.getDecisionPriceContext.mockResolvedValue({
      candle: confirmationCandle,
      timestamp: confirmationCandle.timestamp,
      currentPrice: confirmationCandle.close,
    });

    const result = await core(
      confirmationCandle as any,
      confirmationCandle as any,
    );

    expect(result.kind).toBe('entry');
    expect(strategyApi.entry).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'SHORT',
        orderPlan: expect.objectContaining({
          stopLossPrice: expect.any(Number),
        }),
        additionalIndicators: expect.objectContaining({
          divergenceKind: 'bearish',
          volumeDivergenceSignalTiming: expect.objectContaining({
            entryTiming: 'confirmation_ready',
            barsSinceDetection: 1,
          }),
        }),
      }),
    );
  });

  it('returns POSITION_EXISTS when runtime already has an open position', async () => {
    const candles = makeBullishDivergenceCandles();
    const strategyApi = makeStrategyApi({
      getCurrentPosition: jest.fn(async () => ({
        symbol: 'TESTUSDT',
        qty: 1,
        price: 100,
        direction: 'LONG',
        slPrice: 99.4,
      })),
      getDecisionPriceContext: jest.fn(async () => ({
        timestamp: candles[candles.length - 1].timestamp,
        currentPrice: candles[candles.length - 1].close,
        candle: candles[candles.length - 1],
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
    strategyApi.getDecisionPriceContext.mockResolvedValue({
      candle: candles[candles.length - 1],
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
    strategyApi.getDecisionPriceContext.mockResolvedValue({
      candle: candles[candles.length - 1],
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
    strategyApi.getDecisionPriceContext.mockResolvedValue({
      candle: candles[candles.length - 1],
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

  it('returns INVALID_QTY when structural risk sizing returns non-positive qty', async () => {
    const candles = makeBullishDivergenceCandles();
    const strategyApi = makeStrategyApi();
    const core = await createVolumeDivergenceCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig({
        ...DIVERGENCE_TEST_CONFIG,
        MAX_LOSS_VALUE: 0,
      }),
      isConfigFromBacktest: false,
      connector: {} as any,
      data: candles as any,
      btcData: candles as any,
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi,
      indicatorsState: makeIndicatorsState(),
    });

    const pendingResult = await core(
      candles[candles.length - 1] as any,
      candles[candles.length - 1] as any,
    );
    expect(pendingResult).toEqual({
      kind: 'skip',
      code: 'WAIT_REVERSAL_CONFIRMATION',
    });

    const confirmationCandle = makeFollowUpCandle({
      previousCandle: candles[candles.length - 1],
      price: 94,
      volume: 90,
    });
    strategyApi.getDecisionPriceContext.mockResolvedValue({
      candle: confirmationCandle,
      timestamp: confirmationCandle.timestamp,
      currentPrice: confirmationCandle.close,
    });

    const result = await core(
      confirmationCandle as any,
      confirmationCandle as any,
    );
    expect(result).toEqual({
      kind: 'skip',
      code: 'INVALID_QTY',
    });
  });

  it('returns RISK_RATIO skip when calculated risk ratio is below minimum', async () => {
    const candles = makeBullishDivergenceCandles();
    const strategyApi = makeStrategyApi();
    const core = await createVolumeDivergenceCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig({
        ...DIVERGENCE_TEST_CONFIG,
        BULLISH: {
          ...DEFAULT_CONFIG.BULLISH,
          minRiskRatio: 2,
          requireRetest: false,
        },
        VOLUME_DIVERGENCE_TARGET_R_MULT: 1.01,
      }),
      isConfigFromBacktest: false,
      connector: {} as any,
      data: candles as any,
      btcData: candles as any,
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi,
      indicatorsState: makeIndicatorsState(),
    });

    const pendingResult = await core(
      candles[candles.length - 1] as any,
      candles[candles.length - 1] as any,
    );
    expect(pendingResult).toEqual({
      kind: 'skip',
      code: 'WAIT_REVERSAL_CONFIRMATION',
    });

    const confirmationCandle = makeFollowUpCandle({
      previousCandle: candles[candles.length - 1],
      price: 94,
      volume: 90,
    });
    strategyApi.getDecisionPriceContext.mockResolvedValue({
      candle: confirmationCandle,
      timestamp: confirmationCandle.timestamp,
      currentPrice: confirmationCandle.close,
    });

    const result = await core(
      confirmationCandle as any,
      confirmationCandle as any,
    );
    expect(result).toEqual({
      kind: 'skip',
      code: 'RISK_RATIO:0.94',
    });
  });

  it('does not skip entry in non-backtest mode when correlation is too high', async () => {
    const candles = makeBullishDivergenceCandles();
    const strategyApi = makeStrategyApi();
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

    const pendingResult = await core(
      candles[candles.length - 1] as any,
      candles[candles.length - 1] as any,
    );
    expect(pendingResult).toEqual({
      kind: 'skip',
      code: 'WAIT_REVERSAL_CONFIRMATION',
    });

    const confirmationCandle = makeFollowUpCandle({
      previousCandle: candles[candles.length - 1],
      price: 94,
      volume: 90,
    });
    strategyApi.getDecisionPriceContext.mockResolvedValue({
      candle: confirmationCandle,
      timestamp: confirmationCandle.timestamp,
      currentPrice: confirmationCandle.close,
    });

    const result = await core(
      confirmationCandle as any,
      confirmationCandle as any,
    );
    expect(result.kind).toBe('entry');
  });
});
