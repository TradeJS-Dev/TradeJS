const mockResolveStrategyConfig = jest.fn();
const mockEnrichSignalWithMlAi = jest.fn();
const mockExecuteEntryOrder = jest.fn();

jest.mock('@utils/strategyHelpers', () => ({
  resolveStrategyConfig: (...args: unknown[]) => mockResolveStrategyConfig(...args),
  enrichSignalWithMlAi: (...args: unknown[]) => mockEnrichSignalWithMlAi(...args),
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
    configFromBacktest: false,
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

const makeRuntime = async (decisionFactory: () => any, configOverrides: Record<string, any> = {}) => {
  mockResolveStrategyConfig.mockResolvedValue({
    config: {
      ENV: 'LIVE',
      MAKE_ORDERS: true,
      ...configOverrides,
    },
    configFromBacktest: false,
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
    mockEnrichSignalWithMlAi.mockResolvedValue(5);
  });

  it('gates entry by runtime.ai.minQuality', async () => {
    mockEnrichSignalWithMlAi.mockResolvedValue(4);
    const { strategy, connector } = await makeRuntime(() => makeDecisionEntry());

    const result = await strategy({ timestamp: 1 } as any, { timestamp: 1 } as any);

    expect(mockEnrichSignalWithMlAi).toHaveBeenCalledTimes(1);
    expect(mockExecuteEntryOrder).not.toHaveBeenCalled();
    expect(connector.placeOrder).not.toHaveBeenCalled();
    expect((result as any).orderStatus).toBe('canceled');
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
    const { strategy } = await makeRuntime(() => decision, { ML_ENABLED: false });

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

    const result = await strategy({ timestamp: 1 } as any, { timestamp: 1 } as any);

    expect(mockEnrichSignalWithMlAi).not.toHaveBeenCalled();
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
    const { strategy } = await makeRuntime(() => decision, { ML_ENABLED: false });

    await strategy({ timestamp: 1 } as any, { timestamp: 1 } as any);

    expect(mockEnrichSignalWithMlAi).toHaveBeenCalledWith(
      expect.objectContaining({
        ml: expect.objectContaining({ enabled: false }),
        ai: expect.objectContaining({ enabled: false }),
      }),
    );
  });
});
