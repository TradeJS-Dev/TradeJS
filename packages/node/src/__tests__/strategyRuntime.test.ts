const mockResolveStrategyConfig = jest.fn();
const mockEnrichSignalWithMl = jest.fn();
const mockEnrichSignalWithAi = jest.fn();
const mockExecuteEntryOrder = jest.fn();
const mockUpdatePositionProtection = jest.fn();
const mockLoadTradejsConfig = jest.fn();
const mockMarkRuntimeTradeClosed = jest.fn();
const mockGetDerivativesWindow = jest.fn();
const mockPlanIndicatorCacheRestore = jest.fn();
const mockMaterializeIndicatorCachePlan = jest.fn();
const mockResolveIndicatorCacheRuntimeState = jest.fn();

jest.mock('@tradejs/core/strategies', () => ({
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
    exit: async (exitParams: any) => ({
      kind: 'exit',
      code: exitParams.code,
      closePlan: {
        direction: exitParams.direction,
        price: exitParams.price,
        timestamp: exitParams.timestamp,
      },
    }),
    protect: (protectParams: any) => ({
      kind: 'protect',
      code: protectParams.code,
      protectPlan: protectParams.protectPlan,
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
  mapMlRuntimeFromConfig: jest.fn((config: any, extras?: any) => ({
    enabled: Boolean(config?.ML_ENABLED),
    mlThreshold: config?.ML_THRESHOLD,
    ...extras,
  })),
  mapAiRuntimeFromConfig: jest.fn((config: any, extras?: any) => ({
    enabled: Boolean(config?.AI_ENABLED),
    mode: config?.AI_MODE ?? 'llm',
    minQuality: config?.AI_MIN_QUALITY,
    ...extras,
  })),
  resolveStrategyConfig: (...args: unknown[]) =>
    mockResolveStrategyConfig(...args),
}));

jest.mock('../strategyHelpers/config', () => ({
  resolveStrategyConfig: (...args: unknown[]) =>
    mockResolveStrategyConfig(...args),
}));

jest.mock('../tradejsConfig', () => {
  const actual = jest.requireActual('../tradejsConfig');
  return {
    ...actual,
    loadTradejsConfig: (...args: unknown[]) => mockLoadTradejsConfig(...args),
  };
});

jest.mock('../strategyHelpers/runtime', () => ({
  enrichSignalWithMl: (...args: unknown[]) => mockEnrichSignalWithMl(...args),
  enrichSignalWithAi: (...args: unknown[]) => mockEnrichSignalWithAi(...args),
  executeEntryOrder: (...args: unknown[]) => mockExecuteEntryOrder(...args),
  updatePositionProtection: (...args: unknown[]) =>
    mockUpdatePositionProtection(...args),
}));

jest.mock('../runtimeJournal', () => ({
  markRuntimeTradeClosed: (...args: unknown[]) =>
    mockMarkRuntimeTradeClosed(...args),
}));

jest.mock('@tradejs/infra/timescale', () => ({
  getDerivativesWindow: (...args: unknown[]) =>
    mockGetDerivativesWindow(...args),
}));

jest.mock('@tradejs/infra/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('../indicatorCache', () => ({
  planIndicatorCacheRestore: (...args: unknown[]) =>
    mockPlanIndicatorCacheRestore(...args),
  materializeIndicatorCachePlan: (...args: unknown[]) =>
    mockMaterializeIndicatorCachePlan(...args),
  resolveIndicatorCacheRuntimeState: (...args: unknown[]) =>
    mockResolveIndicatorCacheRuntimeState(...args),
}));

jest.mock('../strategy/manifests', () => {
  const actual = jest.requireActual('../strategy/manifests');
  return {
    ...actual,
    getStrategyManifest: jest.fn(actual.getStrategyManifest),
  };
});

import { createStrategyRuntime } from '../strategyRuntime';
import { logger } from '@tradejs/infra/logger';
import * as manifestsModule from '../strategy/manifests';
import { strategyEntries } from '@tradejs/strategies';
import { resetDerivativesContextRuntimeState } from '../strategyHelpers/derivativesContext';

const realGetStrategyManifest = (
  jest.requireActual('../strategy/manifests') as typeof manifestsModule
).getStrategyManifest;
const mockGetStrategyManifest =
  manifestsModule.getStrategyManifest as jest.MockedFunction<
    typeof manifestsModule.getStrategyManifest
  >;
const manifestOverrides = new Map<string, any>();
const originalEnv = process.env;

const setStrategyManifestHooks = (
  strategy: string,
  hooks: Record<string, any>,
) => {
  const base = realGetStrategyManifest(strategy) ?? { name: strategy };
  manifestOverrides.set(strategy, {
    ...base,
    hooks: {
      ...(base.hooks ?? {}),
      ...hooks,
    },
  });
};

const makeSignal = (strategy = 'TrendLine') =>
  ({
    signalId: 'sig-1',
    symbol: 'ETHUSDT',
    strategy,
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
    additionalIndicators: {
      baseContext: {},
    },
  }) as any;

const makeDecisionEntry = (
  overrides: Record<string, any> = {},
  strategy = 'TrendLine',
) => ({
  kind: 'entry',
  code: 'ENTRY',
  entryContext: {
    strategy,
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
    stopLossPrice: 230,
    takeProfits: [{ rate: 1, price: 200 }],
  },
  signal: makeSignal(strategy),
  runtime: {
    ai: { enabled: true, minQuality: 5 },
    ml: { enabled: true, strategyConfig: { X: 1 }, mlThreshold: 0.5 },
  },
  ...overrides,
});

const makeDecisionProtect = (overrides: Record<string, any> = {}) => ({
  kind: 'protect',
  code: 'PROTECT',
  protectPlan: {
    direction: 'LONG',
    stopLossPrice: 101,
    ...overrides.protectPlan,
  },
  ...overrides,
});

const makeRuntime = async (
  decisionFactory: () => any,
  configOverrides: Record<string, any> = {},
  options: { strategyName?: string; testConnector?: boolean } = {},
) => {
  const strategyName = options.strategyName ?? 'TrendLine';
  mockResolveStrategyConfig.mockResolvedValue({
    config: {
      ENV: 'LIVE',
      MAKE_ORDERS: true,
      ...configOverrides,
    },
    isConfigFromBacktest: false,
  });

  const strategyCreator = createStrategyRuntime({
    strategyName,
    defaults: {} as any,
    createCore: async () => async () => decisionFactory(),
  });

  const connector = {
    ...(options.testConnector ? { __tradejsTestConnector: true } : {}),
    placeOrder: jest.fn(async () => true),
    setTakeProfits: jest.fn(async () => true),
    setStopLoss: jest.fn(async () => true),
    closePosition: jest.fn(async () => true),
  } as any;

  const strategy = await strategyCreator({
    userName: 'root',
    connectorName: 'ByBit',
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
    process.env = { ...originalEnv };
    delete process.env.DERIVATIVES_CONTEXT_INTERVALS;
    delete process.env.DERIVATIVES_CONTEXT_LOOKBACK_HOURS;
    process.env.DERIVATIVES_CONTEXT_ENABLED = 'false';
    resetDerivativesContextRuntimeState();
    manifestsModule.resetStrategyRegistryCache();
    manifestsModule.registerStrategyEntries(strategyEntries);
    manifestOverrides.clear();
    mockLoadTradejsConfig.mockResolvedValue({});
    mockGetStrategyManifest.mockImplementation((name?: string) => {
      if (!name) {
        return undefined;
      }
      return manifestOverrides.get(name) ?? realGetStrategyManifest(name);
    });
    mockExecuteEntryOrder.mockResolvedValue(222);
    mockUpdatePositionProtection.mockResolvedValue(undefined);
    mockEnrichSignalWithMl.mockImplementation(async ({ signal, ml }: any) => {
      if (ml?.enabled !== false) {
        signal.ml = {
          probability: 0.9,
          threshold: ml?.mlThreshold ?? 0.5,
          passed: true,
        };
      }
    });
    mockEnrichSignalWithAi.mockResolvedValue(5);
    mockMarkRuntimeTradeClosed.mockResolvedValue(null);
    mockGetDerivativesWindow.mockResolvedValue({});
    mockPlanIndicatorCacheRestore.mockResolvedValue({
      cached: true,
      paramsHash: 'hash',
      version: 'v3',
      restoreState: null,
      replayStartIndex: 0,
    });
    mockMaterializeIndicatorCachePlan.mockResolvedValue(undefined);
    mockResolveIndicatorCacheRuntimeState.mockImplementation((plan) => plan);
  });

  it('plans and materializes indicator cache before runtime strategy execution starts', async () => {
    await makeRuntime(() => ({ kind: 'skip', code: 'NOOP' }));

    expect(mockPlanIndicatorCacheRestore).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'ByBit',
        symbol: 'ETHUSDT',
        interval: 15,
      }),
    );
    expect(mockMaterializeIndicatorCachePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'ByBit',
        symbol: 'ETHUSDT',
        interval: 15,
        paramsHash: 'hash',
        replayStartIndex: 0,
        cached: true,
      }),
    );
  });

  it('uses planned indicator cache state without materializing cache rows in backtests', async () => {
    await makeRuntime(
      () => ({ kind: 'skip', code: 'NOOP' }),
      { ENV: 'BACKTEST' },
      { testConnector: true },
    );

    expect(mockPlanIndicatorCacheRestore).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'ByBit',
        symbol: 'ETHUSDT',
        interval: 15,
      }),
    );
    expect(mockMaterializeIndicatorCachePlan).not.toHaveBeenCalled();
    expect(mockResolveIndicatorCacheRuntimeState).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'ByBit',
        symbol: 'ETHUSDT',
        interval: 15,
        paramsHash: 'hash',
      }),
    );
  });

  it('hydrates indicators from cached runtime state and replays only the uncached suffix', async () => {
    const cachedState = { restored: true } as any;
    mockPlanIndicatorCacheRestore.mockResolvedValue({
      cached: false,
      paramsHash: 'hash',
      version: 'v3',
      restoreState: cachedState,
      replayStartIndex: 2,
    });
    const createStrategyIndicatorsStateMock = jest.requireMock(
      '@tradejs/core/strategies',
    ).createStrategyIndicatorsState as jest.Mock;
    const strategyCreator = createStrategyRuntime({
      strategyName: 'TrendLine',
      defaults: {} as any,
      createCore: async () => async () => ({ kind: 'skip', code: 'NOOP' }),
    });
    const data = [
      { timestamp: 1, close: 101 },
      { timestamp: 2, close: 102 },
      { timestamp: 3, close: 103 },
      { timestamp: 4, close: 104 },
    ] as any;
    const btcData = [
      { timestamp: 1, close: 201 },
      { timestamp: 2, close: 202 },
      { timestamp: 3, close: 203 },
      { timestamp: 4, close: 204 },
    ] as any;

    await strategyCreator({
      userName: 'root',
      connectorName: 'ByBit',
      symbol: 'ETHUSDT',
      config: {},
      data,
      btcData,
      connector: {
        placeOrder: jest.fn(),
        setTakeProfits: jest.fn(),
        setStopLoss: jest.fn(),
        closePosition: jest.fn(),
      },
    } as any);

    expect(createStrategyIndicatorsStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data,
        btcData,
        initialRuntimeState: cachedState,
        replayStartIndex: 2,
      }),
    );
  });

  afterAll(() => {
    process.env = originalEnv;
    manifestsModule.resetStrategyRegistryCache();
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

  it('keeps BACKTEST execution ungated by AI quality while runtime envs apply the gate', async () => {
    mockEnrichSignalWithAi.mockResolvedValue(1);

    const backtestRuntime = await makeRuntime(() => makeDecisionEntry(), {
      ENV: 'BACKTEST',
    });
    await backtestRuntime.strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );
    expect(mockExecuteEntryOrder).toHaveBeenCalledTimes(1);

    mockExecuteEntryOrder.mockClear();
    const cronRuntime = await makeRuntime(() => makeDecisionEntry(), {
      ENV: 'CRON',
    });
    const result = await cronRuntime.strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(mockExecuteEntryOrder).not.toHaveBeenCalled();
    expect((result as any).orderStatus).toBe('skipped');
    expect((result as any).orderSkipReason).toBe(
      'AI_QUALITY_BELOW_MIN (1 < 5)',
    );
  });

  it('gates entry by ML threshold when runtime ML result does not pass', async () => {
    mockEnrichSignalWithMl.mockImplementation(async ({ signal }: any) => {
      signal.ml = {
        probability: 0.4,
        threshold: 0.5,
        passed: false,
      };
    });
    mockEnrichSignalWithAi.mockResolvedValue(5);
    const { strategy, connector } = await makeRuntime(() =>
      makeDecisionEntry(),
    );

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(mockEnrichSignalWithMl).toHaveBeenCalledTimes(1);
    expect(mockExecuteEntryOrder).not.toHaveBeenCalled();
    expect(connector.placeOrder).not.toHaveBeenCalled();
    expect((result as any).orderStatus).toBe('skipped');
    expect((result as any).orderSkipReason).toBe(
      'ML_THRESHOLD_NOT_MET (0.4 < 0.5)',
    );
  });

  it('blocks entry when ML result is unavailable while runtime ML is enabled', async () => {
    mockEnrichSignalWithMl.mockResolvedValue(undefined);
    mockEnrichSignalWithAi.mockResolvedValue(5);
    const { strategy, connector } = await makeRuntime(() =>
      makeDecisionEntry(),
    );

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(mockEnrichSignalWithMl).toHaveBeenCalledTimes(1);
    expect(mockExecuteEntryOrder).not.toHaveBeenCalled();
    expect(connector.placeOrder).not.toHaveBeenCalled();
    expect((result as any).orderStatus).toBe('skipped');
    expect((result as any).orderSkipReason).toBe('ML_RESULT_UNAVAILABLE');
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

  it('blocks entry when AI quality is unavailable (e.g. AI request failed)', async () => {
    mockEnrichSignalWithAi.mockResolvedValue(undefined);
    const { strategy, connector } = await makeRuntime(() =>
      makeDecisionEntry({
        runtime: {
          ai: { enabled: true, minQuality: 5 },
          ml: { enabled: false },
        },
      }),
    );

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(mockExecuteEntryOrder).not.toHaveBeenCalled();
    expect(connector.placeOrder).not.toHaveBeenCalled();
    expect((result as any).orderStatus).toBe('skipped');
    expect((result as any).orderSkipReason).toBe('AI_QUALITY_UNAVAILABLE');
  });

  it('does not block entry when AI runtime is disabled and quality is unavailable', async () => {
    mockEnrichSignalWithAi.mockResolvedValue(undefined);
    const { strategy, connector } = await makeRuntime(() =>
      makeDecisionEntry({
        runtime: {
          ai: { enabled: false, minQuality: 5 },
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

  it('uses BACKTEST as fallback env when config ENV is missing', async () => {
    mockEnrichSignalWithAi.mockResolvedValue(1);
    const { strategy } = await makeRuntime(
      () =>
        makeDecisionEntry({
          runtime: {
            ai: { enabled: true, minQuality: 5 },
            ml: { enabled: false },
          },
        }),
      { ENV: undefined },
    );

    await strategy({ timestamp: 1 } as any, { timestamp: 1 } as any);

    expect(mockExecuteEntryOrder).toHaveBeenCalledTimes(1);
  });

  it('treats non-boolean MAKE_ORDERS config as enabled by default', async () => {
    const { strategy, connector } = await makeRuntime(
      () =>
        makeDecisionEntry({
          signal: undefined,
          runtime: { ml: { enabled: false }, ai: { enabled: false } },
        }),
      { MAKE_ORDERS: 'false' as any },
    );

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(connector.placeOrder).toHaveBeenCalledTimes(1);
    expect(result).toBe('ENTRY');
  });

  it('uses entryContext prices and orderPlan stop loss for executeEntryOrder args', async () => {
    const decision = makeDecisionEntry({
      orderPlan: {
        qty: 3,
        stopLossPrice: 237,
        takeProfits: [{ rate: 1, price: 200 }],
      },
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
        stopLossPrice: 237,
      }),
    );
  });

  it('disables runtime trade journaling for backtest-style replay envs', async () => {
    for (const env of ['BACKTEST', 'PARITY']) {
      const { strategy } = await makeRuntime(
        () => makeDecisionEntry(),
        {
          ENV: env,
        },
        {
          testConnector: env === 'PARITY',
        },
      );

      await strategy({ timestamp: 1 } as any, { timestamp: 1 } as any);

      expect(mockExecuteEntryOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          recordRuntimeTrade: false,
        }),
      );
      mockExecuteEntryOrder.mockClear();
    }
  });

  it('does not execute parity orders on a non-test connector', async () => {
    const { strategy, connector } = await makeRuntime(
      () => makeDecisionEntry(),
      {
        ENV: 'PARITY',
      },
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

  it('can execute entry decision without signal using connector.placeOrder', async () => {
    const beforePlaceOrder = jest.fn(async () => {});
    const manifestBeforePlaceOrder = jest.fn(async () => {});
    setStrategyManifestHooks('TrendLine', {
      beforePlaceOrder: manifestBeforePlaceOrder,
    });
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
    expect(manifestBeforePlaceOrder).toHaveBeenCalledTimes(1);
    expect(manifestBeforePlaceOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx: expect.objectContaining({
          strategyName: 'TrendLine',
          symbol: 'ETHUSDT',
        }),
        entry: expect.objectContaining({
          context: expect.objectContaining({
            direction: 'SHORT',
            timestamp: 1_700_000_123_000,
          }),
        }),
      }),
    );
    expect(connector.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        price: 222,
        timestamp: 1_700_000_123_000,
        direction: 'SHORT',
        qty: 3,
      }),
    );
    expect(mockUpdatePositionProtection).toHaveBeenCalledWith({
      connector,
      symbol: 'ETHUSDT',
      direction: 'SHORT',
      qty: 3,
      takeProfits: [{ rate: 1, price: 200 }],
      stopLossPrice: 230,
    });
    expect(result).toBe('ENTRY');
  });

  it('runs project beforePlaceOrder hooks before manifest hooks', async () => {
    const projectBeforePlaceOrder = jest.fn(async () => {});
    const manifestBeforePlaceOrder = jest.fn(async () => {});
    mockLoadTradejsConfig.mockResolvedValue({
      hooks: {
        beforePlaceOrder: [projectBeforePlaceOrder],
      },
    });
    setStrategyManifestHooks('TrendLine', {
      beforePlaceOrder: manifestBeforePlaceOrder,
    });

    const { strategy } = await makeRuntime(() =>
      makeDecisionEntry({
        signal: undefined,
        runtime: { ml: { enabled: false }, ai: { enabled: false } },
      }),
    );

    await strategy({ timestamp: 1 } as any, { timestamp: 1 } as any);

    expect(projectBeforePlaceOrder).toHaveBeenCalledTimes(1);
    expect(manifestBeforePlaceOrder).toHaveBeenCalledTimes(1);
    expect(projectBeforePlaceOrder.mock.invocationCallOrder[0]).toBeLessThan(
      manifestBeforePlaceOrder.mock.invocationCallOrder[0],
    );
  });

  it('closes no-signal entry when protection update fails after placeOrder', async () => {
    const { strategy, connector } = await makeRuntime(() =>
      makeDecisionEntry({
        signal: undefined,
        runtime: { ml: { enabled: false }, ai: { enabled: false } },
      }),
    );
    const protectError = new Error('stop update failed');
    mockUpdatePositionProtection.mockRejectedValueOnce(protectError);

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(connector.placeOrder).toHaveBeenCalledTimes(1);
    expect(connector.closePosition).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'ETHUSDT',
        direction: 'SHORT',
        price: 222,
        timestamp: 1_700_000_123_000,
      }),
    );
    expect(result).toBe('ORDER_ERROR');
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

  it('calls onInit hook during runtime creation', async () => {
    const onInit = jest.fn(async () => {});
    setStrategyManifestHooks('TrendLine', { onInit });

    await makeRuntime(() => ({ kind: 'skip', code: 'NO_SIGNAL' }));

    expect(onInit).toHaveBeenCalledTimes(1);
    expect(onInit).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx: expect.objectContaining({
          strategyName: 'TrendLine',
          symbol: 'ETHUSDT',
        }),
      }),
    );
  });

  it('runs project onInit hooks before manifest onInit hooks', async () => {
    const projectOnInit = jest.fn(async () => {});
    const manifestOnInit = jest.fn(async () => {});
    mockLoadTradejsConfig.mockResolvedValue({
      hooks: {
        onInit: [projectOnInit],
      },
    });
    setStrategyManifestHooks('TrendLine', { onInit: manifestOnInit });

    await makeRuntime(() => ({ kind: 'skip', code: 'NO_SIGNAL' }));

    expect(projectOnInit).toHaveBeenCalledTimes(1);
    expect(manifestOnInit).toHaveBeenCalledTimes(1);
    expect(projectOnInit.mock.invocationCallOrder[0]).toBeLessThan(
      manifestOnInit.mock.invocationCallOrder[0],
    );
  });

  it('calls onBar hook before core on every bar', async () => {
    const onBar = jest.fn(async () => {});
    const decisionFactory = jest.fn(() => ({
      kind: 'skip',
      code: 'NO_SIGNAL',
    }));
    setStrategyManifestHooks('TrendLine', { onBar });

    const { strategy } = await makeRuntime(decisionFactory);

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(result).toBe('NO_SIGNAL');
    expect(onBar).toHaveBeenCalledTimes(1);
    expect(decisionFactory).toHaveBeenCalledTimes(1);
    expect(onBar.mock.invocationCallOrder[0]).toBeLessThan(
      decisionFactory.mock.invocationCallOrder[0],
    );
  });

  it('short-circuits the bar from project onBar hook without running core', async () => {
    const projectOnBar = jest.fn(async () => ({
      kind: 'skip',
      code: 'GLOBAL_CLOSE_ALL',
    }));
    const manifestOnBar = jest.fn(async () => {});
    const onSkip = jest.fn(async () => {});
    const decisionFactory = jest.fn(() => ({
      kind: 'entry',
      code: 'ENTRY',
    }));
    mockLoadTradejsConfig.mockResolvedValue({
      hooks: {
        onBar: [projectOnBar],
      },
    });
    setStrategyManifestHooks('TrendLine', {
      onBar: manifestOnBar,
      onSkip,
    });

    const { strategy } = await makeRuntime(decisionFactory);

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(result).toBe('GLOBAL_CLOSE_ALL');
    expect(projectOnBar).toHaveBeenCalledTimes(1);
    expect(manifestOnBar).not.toHaveBeenCalled();
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(decisionFactory).not.toHaveBeenCalled();
  });

  it('runs project onBar hooks before manifest onBar hooks', async () => {
    const projectOnBar = jest.fn(async () => {});
    const manifestOnBar = jest.fn(async () => {});
    mockLoadTradejsConfig.mockResolvedValue({
      hooks: {
        onBar: [projectOnBar],
      },
    });
    setStrategyManifestHooks('TrendLine', { onBar: manifestOnBar });

    const { strategy } = await makeRuntime(() => ({
      kind: 'skip',
      code: 'NO_SIGNAL',
    }));

    await strategy({ timestamp: 1 } as any, { timestamp: 1 } as any);

    expect(projectOnBar).toHaveBeenCalledTimes(1);
    expect(manifestOnBar).toHaveBeenCalledTimes(1);
    expect(projectOnBar.mock.invocationCallOrder[0]).toBeLessThan(
      manifestOnBar.mock.invocationCallOrder[0],
    );
  });

  it('calls afterCoreDecision, afterBarDecision and onSkip hooks for skip decisions', async () => {
    const afterCoreDecision = jest.fn(async () => {});
    const afterBarDecision = jest.fn(async () => {});
    const onSkip = jest.fn(async () => {});
    setStrategyManifestHooks('TrendLine', {
      afterCoreDecision,
      afterBarDecision,
      onSkip,
    });

    const { strategy } = await makeRuntime(() => ({
      kind: 'skip',
      code: 'NO_SIGNAL',
    }));

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(result).toBe('NO_SIGNAL');
    expect(afterCoreDecision).toHaveBeenCalledTimes(1);
    expect(afterBarDecision).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({
          code: 'NO_SIGNAL',
        }),
      }),
    );
  });

  it('calls afterBarDecision when onBar short-circuits the bar and skips afterCoreDecision', async () => {
    const onBar = jest.fn(async () => ({
      kind: 'skip',
      code: 'GLOBAL_CLOSE_ALL',
    }));
    const afterCoreDecision = jest.fn(async () => {});
    const afterBarDecision = jest.fn(async () => {});
    const onSkip = jest.fn(async () => {});
    setStrategyManifestHooks('TrendLine', {
      onBar,
      afterCoreDecision,
      afterBarDecision,
      onSkip,
    });

    const { strategy } = await makeRuntime(() => ({
      kind: 'entry',
      code: 'ENTRY',
    }));

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(result).toBe('GLOBAL_CLOSE_ALL');
    expect(onBar).toHaveBeenCalledTimes(1);
    expect(afterCoreDecision).not.toHaveBeenCalled();
    expect(afterBarDecision).toHaveBeenCalledTimes(1);
    expect(afterBarDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({
          code: 'GLOBAL_CLOSE_ALL',
        }),
      }),
    );
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('applies project afterCoreDecision transforms without disabling manifest hooks', async () => {
    const projectAfterCoreDecision = jest.fn(async () => ({
      kind: 'protect',
      code: 'TRENDLINE_MOVE_STOP_TO_BREAK_EVEN',
      protectPlan: {
        direction: 'LONG',
        stopLossPrice: 101,
      },
    }));
    const manifestAfterCoreDecision = jest.fn(async () => {});
    const onSkip = jest.fn(async () => {});
    mockLoadTradejsConfig.mockResolvedValue({
      hooks: {
        afterCoreDecision: [projectAfterCoreDecision],
      },
    });
    setStrategyManifestHooks('TrendLine', {
      afterCoreDecision: manifestAfterCoreDecision,
      onSkip,
    });

    const { strategy } = await makeRuntime(() => ({
      kind: 'skip',
      code: 'POSITION_EXISTS',
    }));

    const result = await strategy(
      { timestamp: 1, close: 101 } as any,
      { timestamp: 1 } as any,
    );

    expect(projectAfterCoreDecision).toHaveBeenCalledTimes(1);
    expect(manifestAfterCoreDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({
          kind: 'protect',
          code: 'TRENDLINE_MOVE_STOP_TO_BREAK_EVEN',
        }),
      }),
    );
    expect(onSkip).not.toHaveBeenCalled();
    expect(mockUpdatePositionProtection).toHaveBeenCalledWith({
      connector: expect.any(Object),
      symbol: 'ETHUSDT',
      direction: 'LONG',
      takeProfits: [],
      stopLossPrice: 101,
    });
    expect(result).toBe('TRENDLINE_MOVE_STOP_TO_BREAK_EVEN');
  });

  it('applies project afterBarDecision transforms after onBar short-circuit without disabling manifest hooks', async () => {
    const projectOnBar = jest.fn(async () => ({
      kind: 'skip',
      code: 'GLOBAL_CLOSE_ALL',
    }));
    const projectAfterBarDecision = jest.fn(async () => ({
      kind: 'protect',
      code: 'AFTER_BAR_PROTECT',
      protectPlan: {
        direction: 'LONG',
        stopLossPrice: 101,
      },
    }));
    const manifestAfterBarDecision = jest.fn(async () => {});
    const afterCoreDecision = jest.fn(async () => {});
    mockLoadTradejsConfig.mockResolvedValue({
      hooks: {
        onBar: [projectOnBar],
        afterBarDecision: [projectAfterBarDecision],
      },
    });
    setStrategyManifestHooks('TrendLine', {
      afterCoreDecision,
      afterBarDecision: manifestAfterBarDecision,
    });

    const { strategy } = await makeRuntime(() => ({
      kind: 'skip',
      code: 'NO_SIGNAL',
    }));

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(projectOnBar).toHaveBeenCalledTimes(1);
    expect(projectAfterBarDecision).toHaveBeenCalledTimes(1);
    expect(afterCoreDecision).not.toHaveBeenCalled();
    expect(manifestAfterBarDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({
          kind: 'protect',
          code: 'AFTER_BAR_PROTECT',
        }),
      }),
    );
    expect(mockUpdatePositionProtection).toHaveBeenCalledWith({
      connector: expect.any(Object),
      symbol: 'ETHUSDT',
      direction: 'LONG',
      takeProfits: [],
      stopLossPrice: 101,
    });
    expect(result).toBe('AFTER_BAR_PROTECT');
  });

  it('calls afterEnrichMl and afterEnrichAi hooks for entry signal', async () => {
    const afterEnrichMl = jest.fn(async () => {});
    const afterEnrichAi = jest.fn(async () => {});
    setStrategyManifestHooks('TrendLine', {
      afterEnrichMl,
      afterEnrichAi,
    });

    const { strategy } = await makeRuntime(() => makeDecisionEntry());

    await strategy({ timestamp: 1 } as any, { timestamp: 1 } as any);

    expect(afterEnrichMl).toHaveBeenCalledTimes(1);
    expect(afterEnrichAi).toHaveBeenCalledTimes(1);
    expect(afterEnrichAi).toHaveBeenCalledWith(
      expect.objectContaining({
        ai: expect.objectContaining({
          quality: 5,
        }),
      }),
    );
  });

  it('runs project afterEnrichAi hooks before manifest afterEnrichAi hooks', async () => {
    const projectAfterEnrichAi = jest.fn(async () => {});
    const manifestAfterEnrichAi = jest.fn(async () => {});
    mockLoadTradejsConfig.mockResolvedValue({
      hooks: {
        afterEnrichAi: [projectAfterEnrichAi],
      },
    });
    setStrategyManifestHooks('TrendLine', {
      afterEnrichAi: manifestAfterEnrichAi,
    });

    const { strategy } = await makeRuntime(() => makeDecisionEntry());

    await strategy({ timestamp: 1 } as any, { timestamp: 1 } as any);

    expect(projectAfterEnrichAi).toHaveBeenCalledTimes(1);
    expect(manifestAfterEnrichAi).toHaveBeenCalledTimes(1);
    expect(projectAfterEnrichAi.mock.invocationCallOrder[0]).toBeLessThan(
      manifestAfterEnrichAi.mock.invocationCallOrder[0],
    );
  });

  it('blocks entry when beforeEntryGate hook returns allow=false', async () => {
    const beforeEntryGate = jest.fn(async () => ({
      allow: false,
      reason: 'SESSION_BLOCK',
    }));
    setStrategyManifestHooks('TrendLine', {
      beforeEntryGate,
    });

    const { strategy, connector } = await makeRuntime(() =>
      makeDecisionEntry(),
    );

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(beforeEntryGate).toHaveBeenCalledTimes(1);
    expect(mockExecuteEntryOrder).not.toHaveBeenCalled();
    expect(connector.placeOrder).not.toHaveBeenCalled();
    expect((result as any).orderStatus).toBe('skipped');
    expect((result as any).orderSkipReason).toBe(
      'HOOK_BEFORE_ENTRY_GATE:SESSION_BLOCK',
    );
  });

  it('returns HOOK_BEFORE_ENTRY_GATE when gate blocks without reason and no signal', async () => {
    const beforeEntryGate = jest.fn(async () => ({
      allow: false,
    }));
    setStrategyManifestHooks('TrendLine', {
      beforeEntryGate,
    });

    const { strategy, connector } = await makeRuntime(() =>
      makeDecisionEntry({
        signal: undefined,
        runtime: { ml: { enabled: false }, ai: { enabled: false } },
      }),
    );

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(beforeEntryGate).toHaveBeenCalledTimes(1);
    expect(connector.placeOrder).not.toHaveBeenCalled();
    expect(result).toBe('HOOK_BEFORE_ENTRY_GATE');
  });

  it('blocks entry from project beforeEntryGate hook before manifest hook runs', async () => {
    const projectBeforeEntryGate = jest.fn(async () => ({
      allow: false,
      reason: 'GLOBAL_SESSION_BLOCK',
    }));
    const manifestBeforeEntryGate = jest.fn(async () => ({}));
    mockLoadTradejsConfig.mockResolvedValue({
      hooks: {
        beforeEntryGate: [projectBeforeEntryGate],
      },
    });
    setStrategyManifestHooks('TrendLine', {
      beforeEntryGate: manifestBeforeEntryGate,
    });

    const { strategy, connector } = await makeRuntime(() =>
      makeDecisionEntry({
        signal: undefined,
        runtime: { ml: { enabled: false }, ai: { enabled: false } },
      }),
    );

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(projectBeforeEntryGate).toHaveBeenCalledTimes(1);
    expect(manifestBeforeEntryGate).not.toHaveBeenCalled();
    expect(connector.placeOrder).not.toHaveBeenCalled();
    expect(result).toBe('HOOK_BEFORE_ENTRY_GATE:GLOBAL_SESSION_BLOCK');
  });

  it('calls afterPlaceOrder hook after successful signal order execution', async () => {
    const afterPlaceOrder = jest.fn(async () => {});
    setStrategyManifestHooks('TrendLine', {
      afterPlaceOrder,
    });

    const { strategy } = await makeRuntime(() => makeDecisionEntry());

    await strategy({ timestamp: 1 } as any, { timestamp: 1 } as any);

    expect(afterPlaceOrder).toHaveBeenCalledTimes(1);
    expect(afterPlaceOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        order: expect.objectContaining({
          result: expect.objectContaining({
            signalId: 'sig-1',
          }),
        }),
      }),
    );
  });

  it('runs project afterPlaceOrder hooks before manifest afterPlaceOrder hooks', async () => {
    const projectAfterPlaceOrder = jest.fn(async () => {});
    const manifestAfterPlaceOrder = jest.fn(async () => {});
    mockLoadTradejsConfig.mockResolvedValue({
      hooks: {
        afterPlaceOrder: [projectAfterPlaceOrder],
      },
    });
    setStrategyManifestHooks('TrendLine', {
      afterPlaceOrder: manifestAfterPlaceOrder,
    });

    const { strategy } = await makeRuntime(() => makeDecisionEntry());

    await strategy({ timestamp: 1 } as any, { timestamp: 1 } as any);

    expect(projectAfterPlaceOrder).toHaveBeenCalledTimes(1);
    expect(manifestAfterPlaceOrder).toHaveBeenCalledTimes(1);
    expect(projectAfterPlaceOrder.mock.invocationCallOrder[0]).toBeLessThan(
      manifestAfterPlaceOrder.mock.invocationCallOrder[0],
    );
  });

  it('blocks closePosition when beforeClosePosition hook returns allow=false', async () => {
    const beforeClosePosition = jest.fn(async () => ({
      allow: false,
      reason: 'WAIT_CONFIRM',
    }));
    setStrategyManifestHooks('TrendLine', {
      beforeClosePosition,
    });

    const { strategy, connector } = await makeRuntime(() => ({
      kind: 'exit',
      code: 'CLOSE_BY_SIGNAL',
      closePlan: {
        price: 100,
        timestamp: 1_700_000_123_000,
        direction: 'LONG',
      },
    }));

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(beforeClosePosition).toHaveBeenCalledTimes(1);
    expect(connector.closePosition).not.toHaveBeenCalled();
    expect(result).toBe('CLOSE_BLOCKED_BY_HOOK:WAIT_CONFIRM');
  });

  it('returns CLOSE_BLOCKED_BY_HOOK when close gate blocks without reason', async () => {
    const beforeClosePosition = jest.fn(async () => ({
      allow: false,
    }));
    setStrategyManifestHooks('TrendLine', {
      beforeClosePosition,
    });

    const { strategy, connector } = await makeRuntime(() => ({
      kind: 'exit',
      code: 'CLOSE_BY_SIGNAL',
      closePlan: {
        price: 100,
        timestamp: 1_700_000_123_000,
        direction: 'LONG',
      },
    }));

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(beforeClosePosition).toHaveBeenCalledTimes(1);
    expect(connector.closePosition).not.toHaveBeenCalled();
    expect(result).toBe('CLOSE_BLOCKED_BY_HOOK');
  });

  it('blocks closePosition from project beforeClosePosition hook before manifest hook runs', async () => {
    const projectBeforeClosePosition = jest.fn(async () => ({
      allow: false,
      reason: 'GLOBAL_CLOSE_LOCK',
    }));
    const manifestBeforeClosePosition = jest.fn(async () => ({}));
    mockLoadTradejsConfig.mockResolvedValue({
      hooks: {
        beforeClosePosition: [projectBeforeClosePosition],
      },
    });
    setStrategyManifestHooks('TrendLine', {
      beforeClosePosition: manifestBeforeClosePosition,
    });

    const { strategy, connector } = await makeRuntime(() => ({
      kind: 'exit',
      code: 'CLOSE_BY_SIGNAL',
      closePlan: {
        price: 100,
        timestamp: 1_700_000_123_000,
        direction: 'LONG',
      },
    }));

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(projectBeforeClosePosition).toHaveBeenCalledTimes(1);
    expect(manifestBeforeClosePosition).not.toHaveBeenCalled();
    expect(connector.closePosition).not.toHaveBeenCalled();
    expect(result).toBe('CLOSE_BLOCKED_BY_HOOK:GLOBAL_CLOSE_LOCK');
  });

  it('returns exit code after successful closePosition execution', async () => {
    const { strategy, connector } = await makeRuntime(() => ({
      kind: 'exit',
      code: 'CLOSE_BY_SIGNAL',
      closePlan: {
        price: 100,
        timestamp: 1_700_000_123_000,
        direction: 'LONG',
      },
    }));

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(connector.closePosition).toHaveBeenCalledTimes(1);
    expect(result).toBe('CLOSE_BY_SIGNAL');
  });

  it('returns protect code after successful protection update', async () => {
    const { strategy } = await makeRuntime(() => makeDecisionProtect());

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(mockUpdatePositionProtection).toHaveBeenCalledWith({
      connector: expect.any(Object),
      symbol: 'ETHUSDT',
      direction: 'LONG',
      takeProfits: [],
      stopLossPrice: 101,
    });
    expect(result).toBe('PROTECT');
  });

  it('returns ORDER_ERROR and reports runtime error when protection update fails', async () => {
    const onRuntimeError = jest.fn(async () => {});
    setStrategyManifestHooks('TrendLine', {
      onRuntimeError,
    });

    const { strategy } = await makeRuntime(() => makeDecisionProtect());
    const protectError = new Error('protect failed');
    mockUpdatePositionProtection.mockRejectedValueOnce(protectError);

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(result).toBe('ORDER_ERROR');
    expect(onRuntimeError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          stage: 'protectPosition',
          cause: protectError,
        }),
      }),
    );
  });

  it('calls onRuntimeError when a hook throws', async () => {
    const onRuntimeError = jest.fn(async () => {});
    const afterCoreDecision = jest.fn(async () => {
      throw new Error('hook-failed');
    });
    setStrategyManifestHooks('TrendLine', {
      onRuntimeError,
      afterCoreDecision,
    });

    const { strategy } = await makeRuntime(() => ({
      kind: 'skip',
      code: 'NO_SIGNAL',
    }));

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(result).toBe('NO_SIGNAL');
    expect(onRuntimeError).toHaveBeenCalledTimes(1);
    expect(onRuntimeError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          stage: 'afterCoreDecision',
        }),
      }),
    );
  });

  it('calls project onRuntimeError hooks before manifest onRuntimeError hooks', async () => {
    const projectOnRuntimeError = jest.fn(async () => {});
    const manifestOnRuntimeError = jest.fn(async () => {});
    const afterCoreDecision = jest.fn(async () => {
      throw new Error('hook-failed');
    });
    mockLoadTradejsConfig.mockResolvedValue({
      hooks: {
        onRuntimeError: [projectOnRuntimeError],
      },
    });
    setStrategyManifestHooks('TrendLine', {
      onRuntimeError: manifestOnRuntimeError,
      afterCoreDecision,
    });

    const { strategy } = await makeRuntime(() => ({
      kind: 'skip',
      code: 'NO_SIGNAL',
    }));

    await strategy({ timestamp: 1 } as any, { timestamp: 1 } as any);

    expect(projectOnRuntimeError).toHaveBeenCalledTimes(1);
    expect(manifestOnRuntimeError).toHaveBeenCalledTimes(1);
    expect(projectOnRuntimeError.mock.invocationCallOrder[0]).toBeLessThan(
      manifestOnRuntimeError.mock.invocationCallOrder[0],
    );
    expect(projectOnRuntimeError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          stage: 'afterCoreDecision',
        }),
      }),
    );
  });

  it('still calls manifest onRuntimeError when project onRuntimeError hook throws', async () => {
    const projectOnRuntimeError = jest.fn(async () => {
      throw new Error('project-error-hook-failed');
    });
    const manifestOnRuntimeError = jest.fn(async () => {});
    const afterCoreDecision = jest.fn(async () => {
      throw new Error('hook-failed');
    });
    mockLoadTradejsConfig.mockResolvedValue({
      hooks: {
        onRuntimeError: [projectOnRuntimeError],
      },
    });
    setStrategyManifestHooks('TrendLine', {
      onRuntimeError: manifestOnRuntimeError,
      afterCoreDecision,
    });

    const { strategy } = await makeRuntime(() => ({
      kind: 'skip',
      code: 'NO_SIGNAL',
    }));

    await strategy({ timestamp: 1 } as any, { timestamp: 1 } as any);

    expect(manifestOnRuntimeError).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'project hook onRuntimeError failed: %s %s',
      'TrendLine',
      expect.any(Error),
    );
  });

  it('calls onRuntimeError when ML enrichment fails', async () => {
    const onRuntimeError = jest.fn(async () => {});
    setStrategyManifestHooks('TrendLine', {
      onRuntimeError,
    });
    const mlError = new Error('ml-failed');
    mockEnrichSignalWithMl.mockRejectedValueOnce(mlError);

    const { strategy } = await makeRuntime(() => makeDecisionEntry());

    await expect(
      strategy({ timestamp: 1 } as any, { timestamp: 1 } as any),
    ).rejects.toThrow('ml-failed');

    expect(onRuntimeError).toHaveBeenCalledTimes(1);
    expect(onRuntimeError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          stage: 'enrichSignalWithMl',
          cause: mlError,
        }),
      }),
    );
  });

  it('falls back to base strategy hooks when decision strategy manifest is missing', async () => {
    const afterCoreDecision = jest.fn(async () => {});
    setStrategyManifestHooks('TrendLine', {
      afterCoreDecision,
    });

    const { strategy } = await makeRuntime(() =>
      makeDecisionEntry({
        entryContext: {
          ...makeDecisionEntry().entryContext,
          strategy: 'UnknownStrategy',
        },
        signal: undefined,
        runtime: { ai: { enabled: false }, ml: { enabled: false } },
      }),
    );

    await strategy({ timestamp: 1 } as any, { timestamp: 1 } as any);

    expect(afterCoreDecision).toHaveBeenCalledTimes(1);
  });

  it('falls back to base strategy onRuntimeError when decision strategy manifest is missing', async () => {
    const onRuntimeError = jest.fn(async () => {});
    setStrategyManifestHooks('TrendLine', {
      onRuntimeError,
    });

    const { strategy } = await makeRuntime(() =>
      makeDecisionEntry({
        entryContext: {
          ...makeDecisionEntry().entryContext,
          strategy: 'UnknownStrategy',
        },
        signal: undefined,
        runtime: {
          beforePlaceOrder: async () => {
            throw new Error('unknown-strategy-before-order-failed');
          },
          ai: { enabled: false },
          ml: { enabled: false },
        },
      }),
    );

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(result).toBe('ORDER_ERROR');
    expect(onRuntimeError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          stage: 'runtime.beforePlaceOrder',
        }),
      }),
    );
  });

  it('uses ENTRY_POLICY_BLOCKED skip reason when AI quality is NaN', async () => {
    mockEnrichSignalWithAi.mockResolvedValue(Number.NaN);
    const { strategy, connector } = await makeRuntime(() =>
      makeDecisionEntry(),
    );

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(mockExecuteEntryOrder).not.toHaveBeenCalled();
    expect(connector.placeOrder).not.toHaveBeenCalled();
    expect((result as any).orderStatus).toBe('skipped');
    expect((result as any).orderSkipReason).toBe('ENTRY_POLICY_BLOCKED');
  });

  it('returns ORDER_ERROR when runtime.beforePlaceOrder throws for no-signal entry', async () => {
    const onRuntimeError = jest.fn(async () => {});
    setStrategyManifestHooks('TrendLine', {
      onRuntimeError,
    });

    const { strategy, connector } = await makeRuntime(() =>
      makeDecisionEntry({
        signal: undefined,
        runtime: {
          beforePlaceOrder: async () => {
            throw new Error('before-failed');
          },
        },
      }),
    );

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(result).toBe('ORDER_ERROR');
    expect(connector.placeOrder).not.toHaveBeenCalled();
    expect(onRuntimeError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ stage: 'runtime.beforePlaceOrder' }),
      }),
    );
    expect(onRuntimeError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ stage: 'placeOrder' }),
      }),
    );
  });

  it('marks signal order as failed when executeEntryOrder throws', async () => {
    const onRuntimeError = jest.fn(async () => {});
    setStrategyManifestHooks('TrendLine', {
      onRuntimeError,
    });
    const orderError = new Error('order-failed');
    mockExecuteEntryOrder.mockImplementationOnce(async ({ signal }: any) => {
      signal.orderFailureReason = 'exchange rejected order';
      throw orderError;
    });

    const { strategy } = await makeRuntime(() => makeDecisionEntry());

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect((result as any).orderStatus).toBe('failed');
    expect((result as any).orderFailureReason).toBe('exchange rejected order');
    expect(onRuntimeError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          stage: 'placeOrder',
          cause: orderError,
        }),
      }),
    );
  });

  it('continues gracefully when a hook fails and onRuntimeError hook is absent', async () => {
    const afterCoreDecision = jest.fn(async () => {
      throw new Error('hook-failed-no-handler');
    });
    setStrategyManifestHooks('TrendLine', {
      afterCoreDecision,
      onRuntimeError: undefined,
    });

    const { strategy } = await makeRuntime(() => ({
      kind: 'skip',
      code: 'NO_SIGNAL',
    }));

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(result).toBe('NO_SIGNAL');
  });

  it('logs when onRuntimeError hook throws', async () => {
    const onRuntimeError = jest.fn(async () => {
      throw new Error('on-runtime-error-failed');
    });
    const afterCoreDecision = jest.fn(async () => {
      throw new Error('hook-failed');
    });
    setStrategyManifestHooks('TrendLine', {
      onRuntimeError,
      afterCoreDecision,
    });

    const { strategy } = await makeRuntime(() => ({
      kind: 'skip',
      code: 'NO_SIGNAL',
    }));

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(result).toBe('NO_SIGNAL');
    expect(logger.error).toHaveBeenCalledWith(
      'runtime hook onRuntimeError failed: %s %s',
      'TrendLine',
      expect.any(Error),
    );
  });

  it('skips exit order placement when MAKE_ORDERS is disabled', async () => {
    const { strategy, connector } = await makeRuntime(
      () => ({
        kind: 'exit',
        code: 'CLOSE_BY_SIGNAL',
        closePlan: {
          price: 100,
          timestamp: 1_700_000_123_000,
          direction: 'LONG',
        },
      }),
      { MAKE_ORDERS: false },
    );

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(result).toBe('CLOSE_BY_SIGNAL');
    expect(connector.closePosition).not.toHaveBeenCalled();
  });

  it('returns ORDER_ERROR and reports runtime error when closePosition fails', async () => {
    const onRuntimeError = jest.fn(async () => {});
    setStrategyManifestHooks('TrendLine', {
      onRuntimeError,
    });

    const { strategy, connector } = await makeRuntime(() => ({
      kind: 'exit',
      code: 'CLOSE_BY_SIGNAL',
      closePlan: {
        price: 100,
        timestamp: 1_700_000_123_000,
        direction: 'LONG',
      },
    }));
    const closeError = new Error('close-failed');
    connector.closePosition.mockRejectedValueOnce(closeError);

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(result).toBe('ORDER_ERROR');
    expect(onRuntimeError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          stage: 'closePosition',
          cause: closeError,
        }),
      }),
    );
  });

  it('calls onRuntimeError when AI enrichment fails', async () => {
    const onRuntimeError = jest.fn(async () => {});
    setStrategyManifestHooks('TrendLine', {
      onRuntimeError,
    });
    const aiError = new Error('ai-failed');
    mockEnrichSignalWithAi.mockRejectedValueOnce(aiError);

    const { strategy } = await makeRuntime(() => makeDecisionEntry());

    await expect(
      strategy({ timestamp: 1 } as any, { timestamp: 1 } as any),
    ).rejects.toThrow('ai-failed');

    expect(onRuntimeError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          stage: 'enrichSignalWithAi',
          cause: aiError,
        }),
      }),
    );
  });

  describe('hook params snapshots', () => {
    const candle = {
      timestamp: 1,
      dt: '2024-01-01',
      open: 100,
      high: 105,
      low: 95,
      close: 102,
      volume: 1000,
      turnover: 100000,
    } as any;
    const btcCandle = {
      timestamp: 1,
      dt: '2024-01-01',
      open: 40000,
      high: 41000,
      low: 39000,
      close: 40500,
      volume: 500,
      turnover: 20000000,
    } as any;

    const stripFunctions = (obj: any): any => {
      if (obj === null || obj === undefined) return obj;
      if (typeof obj === 'function') return '[Function]';
      if (Array.isArray(obj)) return obj.map(stripFunctions);
      if (typeof obj === 'object') {
        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
          result[key] = stripFunctions(value);
        }
        return result;
      }
      return obj;
    };

    const stripDerivativesContext = (obj: any): any => {
      if (obj === null || obj === undefined) return obj;
      if (Array.isArray(obj)) return obj.map(stripDerivativesContext);
      if (typeof obj === 'object') {
        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
          if (key === 'derivativesContext') {
            continue;
          }
          if (key === 'derivatives' && 'baseContext' in obj) {
            continue;
          }
          result[key] = stripDerivativesContext(value);
        }
        return result;
      }
      return obj;
    };

    const firstCallArgRaw = (mock: jest.Mock) =>
      (mock.mock.calls as any[][])[0][0];

    const firstCallArg = (mock: jest.Mock) =>
      stripDerivativesContext(stripFunctions(firstCallArgRaw(mock)));

    it.each([
      ['false', false],
      ['true', true],
    ])(
      'afterEnrichAi includes derivatives context when DERIVATIVES_CONTEXT_ENABLED=%s',
      async (enabled, expectedPresent) => {
        process.env.DERIVATIVES_CONTEXT_ENABLED = enabled;
        const afterEnrichAi = jest.fn(async () => {});
        setStrategyManifestHooks('TrendLine', { afterEnrichAi });

        const { strategy } = await makeRuntime(() => makeDecisionEntry());
        await strategy(candle, btcCandle);

        const params = firstCallArgRaw(afterEnrichAi);
        expect(
          params.decision.signal.additionalIndicators?.baseContext
            ?.derivatives != null,
        ).toBe(expectedPresent);
      },
    );

    it('onInit params snapshot', async () => {
      const onInit = jest.fn(async () => {});
      setStrategyManifestHooks('TrendLine', { onInit });

      await makeRuntime(() => ({ kind: 'skip', code: 'X' }));

      expect(onInit).toHaveBeenCalledTimes(1);
      expect(firstCallArg(onInit)).toMatchSnapshot();
    });

    it('afterCoreDecision params snapshot (skip)', async () => {
      const afterCoreDecision = jest.fn(async () => {});
      setStrategyManifestHooks('TrendLine', { afterCoreDecision });

      const { strategy } = await makeRuntime(() => ({
        kind: 'skip',
        code: 'NO_SIGNAL',
      }));
      await strategy(candle, btcCandle);

      expect(afterCoreDecision).toHaveBeenCalledTimes(1);
      expect(firstCallArg(afterCoreDecision)).toMatchSnapshot();
    });

    it('afterCoreDecision params snapshot (entry)', async () => {
      const afterCoreDecision = jest.fn(async () => {});
      setStrategyManifestHooks('TrendLine', { afterCoreDecision });

      const { strategy } = await makeRuntime(() => makeDecisionEntry());
      await strategy(candle, btcCandle);

      expect(afterCoreDecision).toHaveBeenCalledTimes(1);
      expect(firstCallArg(afterCoreDecision)).toMatchSnapshot();
    });

    it('afterCoreDecision params snapshot (exit)', async () => {
      const afterCoreDecision = jest.fn(async () => {});
      setStrategyManifestHooks('TrendLine', { afterCoreDecision });

      const { strategy } = await makeRuntime(() => ({
        kind: 'exit',
        code: 'CLOSE_BY_SIGNAL',
        closePlan: {
          price: 100,
          timestamp: 1_700_000_123_000,
          direction: 'LONG',
        },
      }));
      await strategy(candle, btcCandle);

      expect(afterCoreDecision).toHaveBeenCalledTimes(1);
      expect(firstCallArg(afterCoreDecision)).toMatchSnapshot();
    });

    it('onSkip params snapshot', async () => {
      const onSkip = jest.fn(async () => {});
      setStrategyManifestHooks('TrendLine', { onSkip });

      const { strategy } = await makeRuntime(() => ({
        kind: 'skip',
        code: 'FILTER_BLOCKED',
      }));
      await strategy(candle, btcCandle);

      expect(onSkip).toHaveBeenCalledTimes(1);
      expect(firstCallArg(onSkip)).toMatchSnapshot();
    });

    it('beforeClosePosition params snapshot', async () => {
      const beforeClosePosition = jest.fn(async () => {});
      setStrategyManifestHooks('TrendLine', { beforeClosePosition });

      const { strategy } = await makeRuntime(() => ({
        kind: 'exit',
        code: 'CLOSE_BY_SIGNAL',
        closePlan: {
          price: 100,
          timestamp: 1_700_000_123_000,
          direction: 'LONG',
        },
      }));
      await strategy(candle, btcCandle);

      expect(beforeClosePosition).toHaveBeenCalledTimes(1);
      expect(firstCallArg(beforeClosePosition)).toMatchSnapshot();
    });

    it('afterEnrichMl params snapshot', async () => {
      const afterEnrichMl = jest.fn(async () => {});
      setStrategyManifestHooks('TrendLine', { afterEnrichMl });

      const { strategy } = await makeRuntime(() => makeDecisionEntry());
      await strategy(candle, btcCandle);

      expect(afterEnrichMl).toHaveBeenCalledTimes(1);
      expect(firstCallArg(afterEnrichMl)).toMatchSnapshot();
    });

    it('afterEnrichAi params snapshot', async () => {
      const afterEnrichAi = jest.fn(async () => {});
      setStrategyManifestHooks('TrendLine', { afterEnrichAi });

      const { strategy } = await makeRuntime(() => makeDecisionEntry());
      await strategy(candle, btcCandle);

      expect(afterEnrichAi).toHaveBeenCalledTimes(1);
      expect(firstCallArg(afterEnrichAi)).toMatchSnapshot();
    });

    it('beforeEntryGate params snapshot (with signal)', async () => {
      const beforeEntryGate = jest.fn(async () => {});
      setStrategyManifestHooks('TrendLine', { beforeEntryGate });

      const { strategy } = await makeRuntime(() => makeDecisionEntry());
      await strategy(candle, btcCandle);

      expect(beforeEntryGate).toHaveBeenCalledTimes(1);
      expect(firstCallArg(beforeEntryGate)).toMatchSnapshot();
    });

    it('beforeEntryGate params snapshot (without signal)', async () => {
      const beforeEntryGate = jest.fn(async () => {});
      setStrategyManifestHooks('TrendLine', { beforeEntryGate });

      const { strategy } = await makeRuntime(() =>
        makeDecisionEntry({
          signal: undefined,
          runtime: { ml: { enabled: false }, ai: { enabled: false } },
        }),
      );
      await strategy(candle, btcCandle);

      expect(beforeEntryGate).toHaveBeenCalledTimes(1);
      expect(firstCallArg(beforeEntryGate)).toMatchSnapshot();
    });

    it('beforePlaceOrder params snapshot', async () => {
      const beforePlaceOrder = jest.fn(async () => {});
      setStrategyManifestHooks('TrendLine', { beforePlaceOrder });

      const { strategy } = await makeRuntime(() =>
        makeDecisionEntry({
          signal: undefined,
          runtime: { ml: { enabled: false }, ai: { enabled: false } },
        }),
      );
      await strategy(candle, btcCandle);

      expect(beforePlaceOrder).toHaveBeenCalledTimes(1);
      expect(firstCallArg(beforePlaceOrder)).toMatchSnapshot();
    });

    it('beforePlaceOrder params snapshot (with signal)', async () => {
      const beforePlaceOrder = jest.fn(async () => {});
      setStrategyManifestHooks('TrendLine', { beforePlaceOrder });
      mockExecuteEntryOrder.mockImplementation(
        async ({ beforePlaceOrder: bp }: any) => {
          await bp?.();
          return 222;
        },
      );

      const { strategy } = await makeRuntime(() => makeDecisionEntry());
      await strategy(candle, btcCandle);

      expect(beforePlaceOrder).toHaveBeenCalledTimes(1);
      expect(firstCallArg(beforePlaceOrder)).toMatchSnapshot();
    });

    it('afterPlaceOrder params snapshot (with signal)', async () => {
      const afterPlaceOrder = jest.fn(async () => {});
      setStrategyManifestHooks('TrendLine', { afterPlaceOrder });

      const { strategy } = await makeRuntime(() => makeDecisionEntry());
      await strategy(candle, btcCandle);

      expect(afterPlaceOrder).toHaveBeenCalledTimes(1);
      expect(firstCallArg(afterPlaceOrder)).toMatchSnapshot();
    });

    it('afterPlaceOrder params snapshot (without signal)', async () => {
      const afterPlaceOrder = jest.fn(async () => {});
      setStrategyManifestHooks('TrendLine', { afterPlaceOrder });

      const { strategy } = await makeRuntime(() =>
        makeDecisionEntry({
          signal: undefined,
          runtime: { ml: { enabled: false }, ai: { enabled: false } },
        }),
      );
      await strategy(candle, btcCandle);

      expect(afterPlaceOrder).toHaveBeenCalledTimes(1);
      expect(firstCallArg(afterPlaceOrder)).toMatchSnapshot();
    });

    it('onRuntimeError params snapshot', async () => {
      const onRuntimeError = jest.fn(async () => {});
      const afterCoreDecision = jest.fn(async () => {
        throw new Error('test-hook-error');
      });
      setStrategyManifestHooks('TrendLine', {
        onRuntimeError,
        afterCoreDecision,
      });

      const { strategy } = await makeRuntime(() => ({
        kind: 'skip',
        code: 'NO_SIGNAL',
      }));
      await strategy(candle, btcCandle);

      expect(onRuntimeError).toHaveBeenCalledTimes(1);
      const params = { ...(onRuntimeError.mock.calls as any[][])[0][0] };
      params.error = params.error?.message ?? params.error;
      expect(stripFunctions(params)).toMatchSnapshot();
    });
  });
});
