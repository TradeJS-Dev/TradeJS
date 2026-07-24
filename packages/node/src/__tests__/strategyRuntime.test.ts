const mockResolveStrategyConfig = jest.fn();
const mockEnrichSignalWithMl = jest.fn();
const mockEnrichSignalWithAi = jest.fn();
const mockExecuteEntryOrder = jest.fn();
const mockUpdatePositionProtection = jest.fn();
const mockLoadTradejsConfig = jest.fn();
const mockGetActiveRuntimeTrade = jest.fn();
const mockMarkRuntimeTradeClosed = jest.fn();
const mockGetDerivativesWindow = jest.fn();

jest.mock('@tradejs/core/strategies', () => ({
  createStrategyAPI: jest.fn((params: any) => ({
    skip: (code: string) => ({ kind: 'skip', code }),
    nextIndicators: jest.fn(),
    getCurrentPosition: jest.fn(),
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
  calculateRiskRatio: jest.fn(
    ({ direction, currentPrice, takeProfitPrice, stopLossPrice }: any) => {
      const reward =
        direction === 'LONG'
          ? takeProfitPrice - currentPrice
          : currentPrice - takeProfitPrice;
      const risk =
        direction === 'LONG'
          ? currentPrice - stopLossPrice
          : stopLossPrice - currentPrice;
      return risk > 0 ? reward / risk : 0;
    },
  ),
  createStrategyIndicatorsState: jest.fn(() => ({
    isInitialized: jest.fn(() => true),
    setCurrentBar: jest.fn(),
    updateReferenceData: jest.fn(),
    onBar: jest.fn(),
    next: jest.fn(),
    ensureInitializedWithCurrentBar: jest.fn(() => ({
      snapshot: jest.fn(() => ({})),
    })),
    snapshot: jest.fn(() => ({})),
    latestNumber: jest.fn(),
  })),
  resolveBacktestExecutionPrice: jest.fn((candle: any, mode = 'open') => {
    if (mode === 'mid') return (candle.open + candle.close) / 2;
    if (mode === 'close') return candle.close;
    return candle.open;
  }),
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
  getOrderArrivalSnapshot: jest.fn(async () => ({
    arrivalSnapshotTime: Date.now(),
    arrivalSource: 'unavailable',
    bid: null,
    ask: null,
    arrivalMid: null,
    spreadBps: null,
  })),
  validateEntryProtectionAtArrival: jest.fn(),
  updatePositionProtection: (...args: unknown[]) =>
    mockUpdatePositionProtection(...args),
}));

jest.mock('../strategyHelpers/binanceMarketContext', () => ({
  enrichSignalWithBinanceMarketContext: jest.fn(async () => false),
}));

jest.mock('../strategyHelpers/coinMarketCapContext', () => ({
  enrichSignalWithCoinMarketCapContext: jest.fn(async () => false),
}));

jest.mock('../runtimeJournal', () => ({
  getActiveRuntimeTrade: (...args: unknown[]) =>
    mockGetActiveRuntimeTrade(...args),
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
  options: {
    strategyName?: string;
    testConnector?: boolean;
    onRuntimeClose?: jest.Mock;
    backtestExecutionMarketData?: any;
    universe?: 'crypto' | 'tradfi';
    assetClass?: 'crypto' | 'equity' | 'commodity' | 'forex';
    accountId?: string;
    deploymentId?: string;
    policyProfileId?: string;
  } = {},
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
    ...(options.universe ? { universe: options.universe } : {}),
    ...(options.accountId ? { accountId: options.accountId } : {}),
    ...(options.deploymentId ? { deploymentId: options.deploymentId } : {}),
  } as any;

  const strategy = await strategyCreator({
    userName: 'root',
    connectorName: 'ByBit',
    symbol: 'ETHUSDT',
    universe: options.universe,
    assetClass: options.assetClass,
    accountId: options.accountId,
    deploymentId: options.deploymentId,
    policyProfileId: options.policyProfileId,
    config: {},
    data: [],
    btcData: [],
    backtestExecutionMarketData: options.backtestExecutionMarketData,
    connector,
    onRuntimeClose: options.onRuntimeClose,
  } as any);

  return { strategy, connector };
};

describe('strategyRuntime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
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
    mockGetActiveRuntimeTrade.mockResolvedValue({
      orderId: 'ord-1',
      strategy: 'TrendLine',
      symbol: 'ETHUSDT',
      direction: 'LONG',
      qty: 1,
      entryPrice: 100,
      entryTimestamp: 1_700_000_000_000,
      status: 'active',
    });
    mockMarkRuntimeTradeClosed.mockResolvedValue(null);
    mockGetDerivativesWindow.mockResolvedValue({});
  });

  it('initializes indicators on the fly without cached restore state', async () => {
    mockResolveStrategyConfig.mockResolvedValue({
      config: { ENV: 'LIVE' },
      isConfigFromBacktest: false,
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

    const strategy = await strategyCreator({
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
      }),
    );
    const lastCall =
      createStrategyIndicatorsStateMock.mock.calls[
        createStrategyIndicatorsStateMock.mock.calls.length - 1
      ]?.[0];
    expect(lastCall).not.toHaveProperty('initialRuntimeState');
    expect(lastCall).not.toHaveProperty('replayStartIndex');
    const indicatorsState =
      createStrategyIndicatorsStateMock.mock.results.at(-1)?.value;
    const referenceData = {
      btcBinanceData: [{ timestamp: 5, close: 205 }],
      btcCoinbaseData: [{ timestamp: 5, close: 206 }],
    } as any;
    (strategy as any).__tradejsUpdateReferenceData(referenceData);
    expect(indicatorsState.updateReferenceData).toHaveBeenCalledWith(
      referenceData,
    );
  });

  it('shares CRON strategy state without retaining indicator replay state', async () => {
    mockResolveStrategyConfig.mockResolvedValue({
      config: { ENV: 'CRON', MAKE_ORDERS: false },
      isConfigFromBacktest: false,
    });
    const createCore = jest.fn(async () => async () => ({
      kind: 'skip' as const,
      code: 'NOOP',
    }));
    const strategyCreator = createStrategyRuntime({
      strategyName: 'TrendLine',
      defaults: {} as any,
      createCore,
    });

    await strategyCreator({
      userName: 'root',
      connectorName: 'ByBit',
      symbol: 'ETHUSDT',
      config: {},
      data: [{ timestamp: 1, close: 101 }],
      btcData: [{ timestamp: 1, close: 201 }],
      connector: {
        placeOrder: jest.fn(),
        setTakeProfits: jest.fn(),
        setStopLoss: jest.fn(),
        closePosition: jest.fn(),
      },
      sharedStrategyStateKey: 'signals:ETHUSDT:15:TrendLine',
    } as any);

    expect(createCore).toHaveBeenCalledWith(
      expect.objectContaining({
        sharedReplayKey: 'signals:ETHUSDT:15:TrendLine:strategy:TrendLine',
      }),
    );
    const createStrategyIndicatorsStateMock = jest.requireMock(
      '@tradejs/core/strategies',
    ).createStrategyIndicatorsState as jest.Mock;
    expect(createStrategyIndicatorsStateMock.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ sharedReplayKey: undefined }),
    );
  });

  it('does not append a duplicate candle when shared replay data already advanced', async () => {
    mockResolveStrategyConfig.mockResolvedValue({
      config: { ENV: 'PARITY', MAKE_ORDERS: false },
      isConfigFromBacktest: false,
    });
    const strategyCreator = createStrategyRuntime({
      strategyName: 'TrendLine',
      defaults: {} as any,
      createCore: async () => async () => ({ kind: 'skip', code: 'NOOP' }),
    });
    const data = [
      { timestamp: 1, close: 101 },
      { timestamp: 2, close: 102 },
    ] as any;
    const btcData = [
      { timestamp: 1, close: 201 },
      { timestamp: 2, close: 202 },
    ] as any;
    const strategy = await strategyCreator({
      userName: 'root',
      connectorName: 'ByBit',
      symbol: 'ETHUSDT',
      config: {},
      data,
      btcData,
      connector: {} as any,
    } as any);

    await strategy(
      { timestamp: 2, close: 102 } as any,
      {
        timestamp: 2,
        close: 202,
      } as any,
    );

    expect(data).toHaveLength(2);
    expect(btcData).toHaveLength(2);
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
      BACKTEST_ENTRY_DELAY_BARS: 0,
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
      { ENV: undefined, BACKTEST_ENTRY_DELAY_BARS: 0 },
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

  it('forwards explicit position increase intent to entry execution', async () => {
    const decision = makeDecisionEntry({
      orderPlan: {
        qty: 1,
        stopLossPrice: 95,
        takeProfits: [{ rate: 1, price: 105 }],
        positionIntent: 'increase',
      },
      runtime: { ml: { enabled: false }, ai: { enabled: false } },
    });
    const { strategy } = await makeRuntime(() => decision);

    await strategy({ timestamp: 1 } as any, { timestamp: 1 } as any);

    expect(mockExecuteEntryOrder).toHaveBeenCalledWith(
      expect.objectContaining({ positionIntent: 'increase' }),
    );
  });

  it('fills delayed BACKTEST entries at the next primary candle open for any interval', async () => {
    const decision = makeDecisionEntry({
      entryContext: {
        ...makeDecisionEntry().entryContext,
        direction: 'SHORT',
        prices: {
          currentPrice: 222,
          takeProfitPrice: 200,
          stopLossPrice: 330,
          riskRatio: 1.2,
        },
      },
      orderPlan: {
        qty: 3,
        stopLossPrice: 330,
        takeProfits: [{ rate: 1, price: 200 }],
      },
      signal: {
        ...makeSignal(),
        direction: 'SHORT',
        prices: {
          currentPrice: 100,
          takeProfitPrice: 200,
          stopLossPrice: 330,
          riskRatio: 1.2,
        },
      },
      runtime: {
        ml: { enabled: false },
        ai: { enabled: false },
      },
    });
    const { strategy } = await makeRuntime(() => decision, {
      ENV: 'BACKTEST',
      BACKTEST_PRICE_MODE: 'open',
      BACKTEST_ENTRY_DELAY_BARS: 1,
      INTERVAL: '5',
    });

    const queued = await strategy(
      { timestamp: 10, open: 100, high: 115, low: 95, close: 110 } as any,
      { timestamp: 10, open: 200, high: 215, low: 195, close: 210 } as any,
    );

    expect(queued).toBe('BACKTEST_ENTRY_DELAY_QUEUED:1');
    expect(mockExecuteEntryOrder).not.toHaveBeenCalled();

    const executed = await (strategy as any).__tradejsFlushBacktestDelayedEntry(
      { timestamp: 20, open: 300, high: 330, low: 290, close: 320 },
      { timestamp: 20, open: 400, high: 430, low: 390, close: 420 },
    );

    expect(mockExecuteEntryOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        currentPrice: 300,
        timestamp: 20,
      }),
    );
    expect((executed as any).additionalIndicators.backtestExecution).toEqual({
      entryDelayBars: 1,
      priceMode: 'open',
      signalTimestamp: 1_700_000_000_000,
      signalPrice: 100,
      executionTimestamp: 20,
      executionPrice: 300,
      executionSource: 'primary_timeframe',
      executionInterval: '5',
      executionDelayMs: 0,
      primaryExecutionTimestamp: 20,
      requestedExecutionTimestamp: 20,
    });
  });

  it('does not require lower timeframe data for delayed BACKTEST entries', async () => {
    const decision = makeDecisionEntry({
      entryContext: {
        ...makeDecisionEntry().entryContext,
        direction: 'SHORT',
        prices: {
          currentPrice: 222,
          takeProfitPrice: 200,
          stopLossPrice: 330,
          riskRatio: 1.2,
        },
      },
      orderPlan: {
        qty: 3,
        stopLossPrice: 330,
        takeProfits: [{ rate: 1, price: 200 }],
      },
      runtime: {
        ml: { enabled: false },
        ai: { enabled: false },
      },
    });
    const { strategy } = await makeRuntime(
      () => decision,
      {
        ENV: 'BACKTEST',
        BACKTEST_PRICE_MODE: 'open',
        BACKTEST_ENTRY_DELAY_BARS: 1,
        INTERVAL: '15',
      },
      {
        backtestExecutionMarketData: {
          interval: '5',
          data: [
            {
              timestamp: 20,
              open: 210,
              high: 212,
              low: 208,
              close: 211,
            },
          ],
          btcData: [
            {
              timestamp: 20 + 5 * 60_000,
              open: 410,
              high: 412,
              low: 408,
              close: 411,
            },
          ],
        },
      },
    );

    await strategy(
      { timestamp: 10, open: 100, high: 115, low: 95, close: 110 } as any,
      { timestamp: 10, open: 200, high: 215, low: 195, close: 210 } as any,
    );

    const executed = await (strategy as any).__tradejsFlushBacktestDelayedEntry(
      { timestamp: 20, open: 300, high: 330, low: 290, close: 320 },
      { timestamp: 20, open: 400, high: 430, low: 390, close: 420 },
    );

    expect(mockExecuteEntryOrder).toHaveBeenCalledWith(
      expect.objectContaining({ currentPrice: 300, timestamp: 20 }),
    );
    expect(
      (executed as any).additionalIndicators.backtestExecution.executionSource,
    ).toBe('primary_timeframe');
  });

  it('fills delayed BACKTEST entries from the next primary candle open', async () => {
    const decision = makeDecisionEntry({
      entryContext: {
        ...makeDecisionEntry().entryContext,
        direction: 'LONG',
        prices: {
          currentPrice: 222,
          takeProfitPrice: 360,
          stopLossPrice: 200,
          riskRatio: 1.2,
        },
      },
      orderPlan: {
        qty: 3,
        stopLossPrice: 200,
        takeProfits: [{ rate: 1, price: 360 }],
      },
      signal: {
        ...makeSignal(),
        prices: {
          currentPrice: 100,
          takeProfitPrice: 360,
          stopLossPrice: 200,
          riskRatio: 2,
        },
      },
      runtime: {
        ml: { enabled: false },
        ai: { enabled: false },
      },
    });
    const { strategy } = await makeRuntime(
      () => decision,
      {
        ENV: 'BACKTEST',
        BACKTEST_PRICE_MODE: 'close',
        BACKTEST_ENTRY_DELAY_BARS: 1,
        INTERVAL: '15',
      },
      {
        backtestExecutionMarketData: {
          interval: '5',
          data: [
            {
              timestamp: 20 + 5 * 60_000,
              open: 310,
              high: 312,
              low: 308,
              close: 311,
            },
          ],
          btcData: [
            {
              timestamp: 20 + 5 * 60_000,
              open: 410,
              high: 412,
              low: 408,
              close: 411,
            },
          ],
        },
      },
    );

    await strategy(
      { timestamp: 10, open: 100, high: 115, low: 95, close: 110 } as any,
      { timestamp: 10, open: 200, high: 215, low: 195, close: 210 } as any,
    );

    const executed = await (strategy as any).__tradejsFlushBacktestDelayedEntry(
      { timestamp: 20, open: 300, high: 330, low: 290, close: 320 },
      { timestamp: 20, open: 400, high: 430, low: 390, close: 420 },
    );

    expect(mockExecuteEntryOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        currentPrice: 300,
        timestamp: 20,
      }),
    );
    expect((executed as any).prices.currentPrice).toBe(300);
    expect((executed as any).additionalIndicators.backtestExecution).toEqual(
      expect.objectContaining({
        entryDelayBars: 1,
        priceMode: 'open',
        executionTimestamp: 20,
        executionPrice: 300,
        executionSource: 'primary_timeframe',
        executionInterval: '15',
        executionDelayMs: 0,
        primaryExecutionTimestamp: 20,
        requestedExecutionTimestamp: 20,
      }),
    );
  });

  it('fills delayed 60m BACKTEST entries from the next 60m candle open', async () => {
    const decision = makeDecisionEntry({
      entryContext: {
        ...makeDecisionEntry().entryContext,
        direction: 'LONG',
        interval: '60',
        prices: {
          currentPrice: 222,
          takeProfitPrice: 360,
          stopLossPrice: 200,
          riskRatio: 1.2,
        },
      },
      orderPlan: {
        qty: 3,
        stopLossPrice: 200,
        takeProfits: [{ rate: 1, price: 360 }],
      },
      signal: {
        ...makeSignal(),
        interval: '60',
        prices: {
          currentPrice: 100,
          takeProfitPrice: 360,
          stopLossPrice: 200,
          riskRatio: 2,
        },
      },
      runtime: {
        ml: { enabled: false },
        ai: { enabled: false },
      },
    });
    const { strategy } = await makeRuntime(
      () => decision,
      {
        ENV: 'BACKTEST',
        BACKTEST_PRICE_MODE: 'open',
        BACKTEST_ENTRY_DELAY_BARS: 1,
        INTERVAL: '60',
      },
      {
        backtestExecutionMarketData: {
          interval: '15',
          data: [
            {
              timestamp: 20 + 15 * 60_000,
              open: 315,
              high: 318,
              low: 312,
              close: 316,
            },
          ],
          btcData: [
            {
              timestamp: 20 + 15 * 60_000,
              open: 415,
              high: 418,
              low: 412,
              close: 416,
            },
          ],
        },
      },
    );

    await strategy(
      { timestamp: 10, open: 100, high: 115, low: 95, close: 110 } as any,
      { timestamp: 10, open: 200, high: 215, low: 195, close: 210 } as any,
    );

    const executed = await (strategy as any).__tradejsFlushBacktestDelayedEntry(
      { timestamp: 20, open: 300, high: 330, low: 290, close: 320 },
      { timestamp: 20, open: 400, high: 430, low: 390, close: 420 },
    );

    expect(mockExecuteEntryOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        currentPrice: 300,
        timestamp: 20,
      }),
    );
    expect((executed as any).additionalIndicators.backtestExecution).toEqual(
      expect.objectContaining({
        executionTimestamp: 20,
        executionPrice: 300,
        executionSource: 'primary_timeframe',
        executionInterval: '60',
        executionDelayMs: 0,
        primaryExecutionTimestamp: 20,
        requestedExecutionTimestamp: 20,
      }),
    );
  });

  it('passes execution-only market candles to delayed BACKTEST beforePlaceOrder hooks', async () => {
    const beforePlaceOrder = jest.fn(async () => {});
    setStrategyManifestHooks('TrendLine', { beforePlaceOrder });
    mockExecuteEntryOrder.mockImplementation(
      async ({ beforePlaceOrder: bp }: any) => {
        await bp?.();
        return 300;
      },
    );

    const { strategy } = await makeRuntime(
      () =>
        makeDecisionEntry({
          entryContext: {
            ...makeDecisionEntry().entryContext,
            prices: {
              currentPrice: 222,
              takeProfitPrice: 200,
              stopLossPrice: 330,
              riskRatio: 1.2,
            },
          },
          orderPlan: {
            qty: 3,
            stopLossPrice: 330,
            takeProfits: [{ rate: 1, price: 200 }],
          },
          signal: {
            ...makeSignal(),
            direction: 'SHORT',
          },
          runtime: { ml: { enabled: false }, ai: { enabled: false } },
        }),
      {
        ENV: 'BACKTEST',
        BACKTEST_PRICE_MODE: 'open',
        BACKTEST_ENTRY_DELAY_BARS: 1,
      },
      {
        backtestExecutionMarketData: {
          interval: '5',
          data: [
            {
              timestamp: 20 + 5 * 60_000,
              open: 300,
              high: 302,
              low: 298,
              close: 301,
              volume: 1,
              turnover: 300,
            },
          ],
          btcData: [
            {
              timestamp: 20 + 5 * 60_000,
              open: 400,
              high: 402,
              low: 398,
              close: 401,
              volume: 1,
              turnover: 400,
            },
          ],
        },
      },
    );

    await strategy(
      { timestamp: 10, open: 100, high: 115, low: 95, close: 110 } as any,
      { timestamp: 10, open: 200, high: 215, low: 195, close: 210 } as any,
    );
    await (strategy as any).__tradejsFlushBacktestDelayedEntry(
      {
        timestamp: 20,
        open: 300,
        high: 330,
        low: 290,
        close: 320,
        volume: 9,
        turnover: 2_700,
      },
      {
        timestamp: 20,
        open: 400,
        high: 430,
        low: 390,
        close: 420,
        volume: 8,
        turnover: 3_200,
      },
    );

    expect(beforePlaceOrder).toHaveBeenCalledTimes(1);
    const hookArg = (beforePlaceOrder.mock.calls as any[][])[0][0];
    expect(hookArg.market.candle).toMatchObject({
      timestamp: 20,
      open: 300,
      high: 300,
      low: 300,
      close: 300,
      volume: 0,
      turnover: 0,
    });
    expect(hookArg.market.btcCandle).toMatchObject({
      timestamp: 20,
      open: 400,
      high: 400,
      low: 400,
      close: 400,
      volume: 0,
      turnover: 0,
    });
  });

  it('skips delayed BACKTEST entries when the execution price is beyond the stop', async () => {
    const decision = makeDecisionEntry({
      runtime: {
        ml: { enabled: false },
        ai: { enabled: false },
      },
    });
    const { strategy } = await makeRuntime(
      () => decision,
      {
        ENV: 'BACKTEST',
        BACKTEST_PRICE_MODE: 'open',
        BACKTEST_ENTRY_DELAY_BARS: 1,
      },
      {
        backtestExecutionMarketData: {
          interval: '5',
          data: [
            {
              timestamp: 20 + 5 * 60_000,
              open: 300,
              high: 330,
              low: 290,
              close: 320,
            },
          ],
          btcData: [
            {
              timestamp: 20 + 5 * 60_000,
              open: 400,
              high: 430,
              low: 390,
              close: 420,
            },
          ],
        },
      },
    );

    await strategy(
      { timestamp: 10, open: 100, high: 115, low: 95, close: 110 } as any,
      { timestamp: 10, open: 200, high: 215, low: 195, close: 210 } as any,
    );

    const skipped = await (strategy as any).__tradejsFlushBacktestDelayedEntry(
      { timestamp: 20, open: 300, high: 330, low: 290, close: 320 },
      { timestamp: 20, open: 400, high: 430, low: 390, close: 420 },
    );

    expect(mockExecuteEntryOrder).not.toHaveBeenCalled();
    expect((skipped as any).orderStatus).toBe('skipped');
    expect((skipped as any).orderSkipReason).toBe(
      'BACKTEST_DELAYED_ENTRY_BEYOND_STOP',
    );
    expect(
      (skipped as any).additionalIndicators.backtestExecution.skipReason,
    ).toBe('BACKTEST_DELAYED_ENTRY_BEYOND_STOP');
  });

  it('uses one-bar BACKTEST entry delay by default', async () => {
    const decision = makeDecisionEntry({
      runtime: {
        ml: { enabled: false },
        ai: { enabled: false },
      },
    });
    const { strategy } = await makeRuntime(() => decision, {
      ENV: 'BACKTEST',
      BACKTEST_PRICE_MODE: 'open',
    });

    const result = await strategy(
      { timestamp: 10, open: 100, high: 115, low: 95, close: 110 } as any,
      { timestamp: 10, open: 200, high: 215, low: 195, close: 210 } as any,
    );

    expect(result).toBe('BACKTEST_ENTRY_DELAY_QUEUED:1');
    expect(mockExecuteEntryOrder).not.toHaveBeenCalled();
  });

  it('allows explicit zero BACKTEST entry delay for legacy same-bar execution', async () => {
    const decision = makeDecisionEntry({
      runtime: {
        ml: { enabled: false },
        ai: { enabled: false },
      },
    });
    const { strategy } = await makeRuntime(() => decision, {
      ENV: 'BACKTEST',
      BACKTEST_ENTRY_DELAY_BARS: 0,
    });

    await strategy({ timestamp: 10 } as any, { timestamp: 10 } as any);

    expect(mockExecuteEntryOrder).toHaveBeenCalledTimes(1);
  });

  it('disables runtime trade journaling for backtest-style replay envs', async () => {
    for (const env of ['BACKTEST', 'PARITY']) {
      const { strategy } = await makeRuntime(
        () => makeDecisionEntry(),
        {
          ENV: env,
          BACKTEST_ENTRY_DELAY_BARS: 0,
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
        orderPlan: {
          ...makeDecisionEntry().orderPlan,
          positionIntent: 'increase',
        },
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
        positionIntent: 'increase',
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

  it('applies TradFi policy metadata, model key and leverage to the shared core', async () => {
    const baseManifest = realGetStrategyManifest('TrendLine') ?? {
      name: 'TrendLine',
    };
    manifestOverrides.set('TrendLine', {
      ...baseManifest,
      policyProfiles: [
        {
          id: 'tradfi',
          appliesTo: {
            universes: ['tradfi'],
            assetClasses: ['equity'],
          },
          entryRuntimeDefaults: {
            ml: {
              enabled: true,
              modelKey: 'TrendLine:tradfi',
              mlThreshold: 0.7,
            },
            ai: { enabled: false },
          },
        },
      ],
    });
    const decision = makeDecisionEntry({ runtime: undefined });
    const { strategy } = await makeRuntime(
      () => decision,
      { LEVERAGE: 7, ML_ENABLED: true, ML_THRESHOLD: 0.7 },
      {
        universe: 'tradfi',
        assetClass: 'equity',
        accountId: 'tradfi-main',
        deploymentId: 'tradfi-live',
        policyProfileId: 'tradfi',
      },
    );

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(mockEnrichSignalWithMl).toHaveBeenCalledWith(
      expect.objectContaining({
        ml: expect.objectContaining({
          enabled: true,
          modelKey: 'TrendLine:tradfi',
          mlThreshold: 0.7,
        }),
      }),
    );
    expect(mockEnrichSignalWithAi).toHaveBeenCalledWith(
      expect.objectContaining({
        ai: expect.objectContaining({ enabled: false }),
      }),
    );
    expect(mockExecuteEntryOrder).toHaveBeenCalledWith(
      expect.objectContaining({ leverage: 7 }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        universe: 'tradfi',
        assetClass: 'equity',
        accountId: 'tradfi-main',
        deploymentId: 'tradfi-live',
        policyProfileId: 'tradfi',
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
    const onRuntimeClose = jest.fn();
    mockMarkRuntimeTradeClosed.mockResolvedValueOnce({
      orderId: 'ord-1',
      signalId: 'sig-1',
      strategy: 'TrendLine',
      symbol: 'ETHUSDT',
      direction: 'LONG',
      qty: 1,
      entryPrice: 100,
      entryTimestamp: 1_700_000_000_000,
      status: 'closed',
      exitPrice: 101,
      exitTimestamp: 1_700_000_123_000,
      closedPnl: 1,
      exitType: 'exit',
    });
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
      {},
      { onRuntimeClose },
    );

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(connector.closePosition).toHaveBeenCalledTimes(1);
    expect(mockGetActiveRuntimeTrade).toHaveBeenCalledWith({
      userName: 'root',
      symbol: 'ETHUSDT',
    });
    expect(mockMarkRuntimeTradeClosed).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy: 'TrendLine',
        symbol: 'ETHUSDT',
        exitPrice: 100,
        exitTimestamp: 1_700_000_123_000,
        exitType: 'exit',
      }),
    );
    expect(onRuntimeClose).toHaveBeenCalledWith(
      expect.objectContaining({
        userName: 'root',
        strategy: 'TrendLine',
        openedByStrategy: 'TrendLine',
        symbol: 'ETHUSDT',
        direction: 'LONG',
        code: 'CLOSE_BY_SIGNAL',
        orderId: 'ord-1',
        signalId: 'sig-1',
        qty: 1,
        entryPrice: 100,
        entryTimestamp: 1_700_000_000_000,
        exitPrice: 101,
        exitTimestamp: 1_700_000_123_000,
        closedPnl: 1,
        exitType: 'exit',
      }),
    );
    expect(result).toBe('CLOSE_BY_SIGNAL');
  });

  it('blocks closePosition when runtime journal active trade belongs to another strategy', async () => {
    mockGetActiveRuntimeTrade.mockResolvedValueOnce({
      orderId: 'ord-2',
      strategy: 'TrendShift',
      symbol: 'ETHUSDT',
      direction: 'LONG',
      qty: 1,
      entryPrice: 100,
      entryTimestamp: 1_700_000_000_000,
      status: 'active',
    });
    const onRuntimeClose = jest.fn();
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
      {},
      { onRuntimeClose },
    );

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(connector.closePosition).not.toHaveBeenCalled();
    expect(mockMarkRuntimeTradeClosed).not.toHaveBeenCalled();
    expect(onRuntimeClose).not.toHaveBeenCalled();
    expect(result).toBe('CLOSE_BLOCKED_BY_FOREIGN_STRATEGY_POSITION');
  });

  it('blocks closePosition when runtime journal has no active trade for the symbol', async () => {
    mockGetActiveRuntimeTrade.mockResolvedValueOnce(null);
    const onRuntimeClose = jest.fn();
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
      {},
      { onRuntimeClose },
    );

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(connector.closePosition).not.toHaveBeenCalled();
    expect(mockMarkRuntimeTradeClosed).not.toHaveBeenCalled();
    expect(onRuntimeClose).not.toHaveBeenCalled();
    expect(result).toBe('CLOSE_BLOCKED_BY_UNTRACKED_POSITION');
  });

  it('does not require runtime journal ownership when runtime trade recording is disabled', async () => {
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
      { RECORD_RUNTIME_TRADES: false },
    );

    const result = await strategy(
      { timestamp: 1 } as any,
      { timestamp: 1 } as any,
    );

    expect(mockGetActiveRuntimeTrade).not.toHaveBeenCalled();
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
