const mockResolveStrategyConfig = jest.fn();
const mockEnrichSignalWithMl = jest.fn();
const mockEnrichSignalWithAi = jest.fn();
const mockExecuteEntryOrder = jest.fn();

jest.mock('@utils/strategyHelpers', () => ({
  createStrategyAPI: jest.fn((params: any) => ({
    skip: (code: string) => ({ kind: 'skip', code }),
    getMarketData: jest.fn(),
    nextIndicators: jest.fn(),
    getCurrentPosition: jest.fn(),
    isCurrentPositionExists: jest.fn(async () => false),
    entry: (entryParams: any) => ({
      kind: 'entry',
      code: entryParams.code,
      entryContext: {
        strategy: params.strategy,
        symbol: params.symbol,
        interval: params.interval,
        direction: entryParams.direction,
        timestamp: entryParams.timestamp,
        prices: entryParams.prices,
        isConfigFromBacktest: params.isConfigFromBacktest,
      },
      orderPlan: entryParams.orderPlan,
      runtime: entryParams.runtime,
      signal: entryParams.signal,
    }),
  })),
  buildDefaultIndicatorPeriods: jest.fn(() => ({})),
  createStrategyIndicatorsState: jest.fn(() => ({
    isInitialized: jest.fn(() => true),
    setCurrentBar: jest.fn(),
    onBar: jest.fn(),
    next: jest.fn(),
    ensureInitializedWithCurrentBar: jest.fn(() => ({
      snapshot: jest.fn(() => ({})),
    })),
    snapshot: jest.fn(() => ({})),
    latestNumber: jest.fn(),
  })),
  resolveStrategyConfig: (...args: unknown[]) =>
    mockResolveStrategyConfig(...args),
  enrichSignalWithMl: (...args: unknown[]) => mockEnrichSignalWithMl(...args),
  enrichSignalWithAi: (...args: unknown[]) => mockEnrichSignalWithAi(...args),
  executeEntryOrder: (...args: unknown[]) => mockExecuteEntryOrder(...args),
}));

jest.mock('@utils/logger', () => ({
  logger: {
    error: jest.fn(),
  },
}));

import { createStrategyRuntime } from '@utils/strategyRuntime';

const makeSignal = () =>
  ({
    signalId: 'sig-1',
    symbol: 'ETHUSDT',
    strategy: 'TrendLine',
    interval: '15',
    direction: 'LONG',
    timestamp: 1_700_000_000_000,
    figures: {},
    prices: {
      currentPrice: 100,
      takeProfitPrice: 105,
      stopLossPrice: 95,
      riskRatio: 2,
    },
    indicators: {},
  }) as any;

const makeDecisionEntry = (overrides: Record<string, any> = {}) => ({
  kind: 'entry',
  code: 'ENTRY',
  entryContext: {
    strategy: 'TrendLine',
    symbol: 'ETHUSDT',
    interval: '15',
    direction: 'SHORT',
    timestamp: 1_700_000_123_000,
    prices: {
      currentPrice: 222,
      takeProfitPrice: 200,
      stopLossPrice: 230,
      riskRatio: 1.2,
    },
    isConfigFromBacktest: false,
  },
  orderPlan: {
    qty: 3,
    takeProfits: [{ rate: 1, price: 200 }],
  },
  signal: makeSignal(),
  runtime: {
    ai: { enabled: true, minQuality: 5 },
    ml: { enabled: true, strategyConfig: { X: 1 }, mlThreshold: 0.5 },
  },
  ...overrides,
});

const makeRuntime = async (
  decisionFactory: () => any,
  configOverrides: Record<string, any> = {},
) => {
  mockResolveStrategyConfig.mockResolvedValue({
    config: {
      ENV: 'LIVE',
      MAKE_ORDERS: true,
      ...configOverrides,
    },
    isConfigFromBacktest: false,
  });

  const strategyCreator = createStrategyRuntime({
    strategyName: 'TrendLine',
    defaults: {} as any,
    createCore: async () => async () => decisionFactory(),
  });

  const connector = {
    placeOrder: jest.fn(async () => true),
    closePosition: jest.fn(async () => true),
  } as any;

  const strategy = await strategyCreator({
    userName: 'root',
    symbol: 'ETHUSDT',
    config: {},
    data: [],
    btcData: [],
    connector,
  } as any);

  return { strategy, connector };
};

describe('strategyRuntime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecuteEntryOrder.mockResolvedValue(222);
    mockEnrichSignalWithMl.mockResolvedValue(undefined);
    mockEnrichSignalWithAi.mockResolvedValue(5);
  });

  it('gates entry by runtime.ai.minQuality', async () => {
    mockEnrichSignalWithAi.mockResolvedValue(4);
    const { strategy, connector } = await makeRuntime(() =>
      makeDecisionEntry(),
    );

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(mockEnrichSignalWithMl).toHaveBeenCalledTimes(1);
    expect(mockEnrichSignalWithAi).toHaveBeenCalledTimes(1);
    expect(mockExecuteEntryOrder).not.toHaveBeenCalled();
    expect(connector.placeOrder).not.toHaveBeenCalled();
    expect((result as any).orderStatus).toBe('skipped');
    expect((result as any).orderSkipReason).toBe(
      'AI_QUALITY_BELOW_MIN (4 < 5)',
    );
  });

  it('allows entry when minQuality is 0 and runtime quality is 0', async () => {
    mockEnrichSignalWithAi.mockResolvedValue(0);
    const { strategy, connector } = await makeRuntime(() =>
      makeDecisionEntry({
        runtime: {
          ai: { enabled: true, minQuality: 0 },
          ml: { enabled: false },
        },
      }),
    );

    await strategy({ timestamp: 1 } as any, { timestamp: 1 } as any);

    expect(mockExecuteEntryOrder).toHaveBeenCalledTimes(1);
    expect(connector.placeOrder).not.toHaveBeenCalled();
  });

  it('does not block entry when AI quality is unavailable (e.g. AI request failed)', async () => {
    mockEnrichSignalWithAi.mockResolvedValue(undefined);
    const { strategy, connector } = await makeRuntime(() =>
      makeDecisionEntry({
        runtime: {
          ai: { enabled: true, minQuality: 5 },
          ml: { enabled: false },
        },
      }),
    );

    await strategy({ timestamp: 1 } as any, { timestamp: 1 } as any);

    expect(mockExecuteEntryOrder).toHaveBeenCalledTimes(1);
    expect(connector.placeOrder).not.toHaveBeenCalled();
  });

  it('marks entry as skipped when MAKE_ORDERS is disabled', async () => {
    const { strategy, connector } = await makeRuntime(
      () => makeDecisionEntry(),
      { MAKE_ORDERS: false },
    );

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(mockExecuteEntryOrder).not.toHaveBeenCalled();
    expect(connector.placeOrder).not.toHaveBeenCalled();
    expect((result as any).orderStatus).toBe('skipped');
    expect((result as any).orderSkipReason).toBe('MAKE_ORDERS_DISABLED');
  });

  it('uses entryContext as source of truth for executeEntryOrder args', async () => {
    const decision = makeDecisionEntry({
      signal: {
        ...makeSignal(),
        direction: 'LONG',
        timestamp: 123,
        prices: {
          currentPrice: 999,
          takeProfitPrice: 1000,
          stopLossPrice: 998,
          riskRatio: 9,
        },
      },
    });
    const { strategy } = await makeRuntime(() => decision, {
      ML_ENABLED: false,
    });

    await strategy({ timestamp: 1 } as any, { timestamp: 1 } as any);

    expect(mockExecuteEntryOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'SHORT',
        currentPrice: 222,
        timestamp: 1_700_000_123_000,
        stopLossPrice: 230,
      }),
    );
  });

  it('can execute entry decision without signal using connector.placeOrder', async () => {
    const beforePlaceOrder = jest.fn(async () => {});
    const { strategy, connector } = await makeRuntime(() =>
      makeDecisionEntry({
        signal: undefined,
        runtime: { beforePlaceOrder },
      }),
    );

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(mockEnrichSignalWithMl).not.toHaveBeenCalled();
    expect(mockEnrichSignalWithAi).not.toHaveBeenCalled();
    expect(beforePlaceOrder).toHaveBeenCalledTimes(1);
    expect(connector.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        price: 222,
        timestamp: 1_700_000_123_000,
        direction: 'SHORT',
        qty: 3,
      }),
      [{ rate: 1, price: 200 }],
      230,
    );
    expect(result).toBe('ENTRY');
  });

  it('applies manifest runtime defaults when decision runtime omits ai/ml toggles', async () => {
    const decision = makeDecisionEntry({
      entryContext: {
        ...makeDecisionEntry().entryContext,
        strategy: 'Breakout',
      },
      signal: {
        ...makeSignal(),
        strategy: 'Breakout',
      },
      runtime: undefined,
    });
    const { strategy } = await makeRuntime(() => decision, {
      ML_ENABLED: false,
    });

    await strategy({ timestamp: 1 } as any, { timestamp: 1 } as any);

    expect(mockEnrichSignalWithMl).toHaveBeenCalledWith(
      expect.objectContaining({
        ml: expect.objectContaining({ enabled: false }),
      }),
    );
    expect(mockEnrichSignalWithAi).toHaveBeenCalledWith(
      expect.objectContaining({
        ai: expect.objectContaining({ enabled: false }),
      }),
    );
  });
});
