import { createStrategyAPI } from '../strategyHelpers/signalBuilders';
import {
  getSharedStrategyReplayState,
  releaseStrategyReplayCache,
} from '../strategyHelpers/sharedReplay';

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

describe('createStrategyAPI', () => {
  afterEach(() => {
    releaseStrategyReplayCache('test-state');
  });

  it('getDecisionPriceContext returns the current closed candle without loading indicators or market data', async () => {
    const candle = makeCandle(1_700_000_000_000, 100);
    const data: any[] = [candle];
    const connector = {
      kline: jest.fn(),
      getPosition: jest.fn(),
    } as any;
    const indicatorsState = {
      setCurrentBar: jest.fn(),
      next: jest.fn(),
      onBar: jest.fn(),
      ensureInitializedWithCurrentBar: jest.fn(),
      snapshot: jest.fn(),
      latestNumber: jest.fn(() => undefined),
      isInitialized: jest.fn(() => true),
    } as any;

    const strategyApi = createStrategyAPI({
      strategy: 'TrendLine' as any,
      symbol: 'TESTUSDT',
      interval: '15' as any,
      env: 'BACKTEST',
      connector,
      cachedData: data,
      indicatorsState,
      isConfigFromBacktest: false,
    });

    const context = await strategyApi.getDecisionPriceContext();

    expect(context).toEqual({
      timestamp: candle.timestamp,
      currentPrice: candle.close,
      candle,
    });
    expect(indicatorsState.onBar).not.toHaveBeenCalled();
    expect(indicatorsState.snapshot).not.toHaveBeenCalled();
    expect(connector.kline).not.toHaveBeenCalled();
  });

  it('getCurrentIndicatorsContext and getBaseContext reuse one indicator snapshot per current bar', () => {
    const candle = makeCandle(1_700_000_000_000, 100);
    const data: any[] = [candle];
    const connector = {
      kline: jest.fn(),
      getPosition: jest.fn(),
    } as any;
    const baseContext = {
      candle,
      prevCandle: null,
      raw: {},
      regime: {},
      structure: {},
      participation: {},
      relative: {},
      mtf: {},
    };
    const indicators = {
      baseContext,
      atr: [1],
    };
    const indicatorsState = {
      setCurrentBar: jest.fn(),
      next: jest.fn(),
      onBar: jest.fn(),
      ensureInitializedWithCurrentBar: jest.fn(),
      snapshot: jest.fn(() => indicators),
      latestNumber: jest.fn(() => undefined),
      isInitialized: jest.fn(() => true),
    } as any;

    const strategyApi = createStrategyAPI({
      strategy: 'TrendLine' as any,
      symbol: 'TESTUSDT',
      interval: '15' as any,
      env: 'BACKTEST',
      connector,
      cachedData: data,
      indicatorsState,
      isConfigFromBacktest: false,
    });

    const first = strategyApi.getCurrentIndicatorsContext();
    const second = strategyApi.getCurrentIndicatorsContext();

    expect(first.indicators).toBe(indicators);
    expect(first.baseContext).toBe(baseContext);
    expect(second).toBe(first);
    expect(strategyApi.getBaseContext()).toBe(baseContext);
    expect(indicatorsState.onBar).toHaveBeenCalledTimes(1);
    expect(indicatorsState.snapshot).toHaveBeenCalledTimes(1);
    expect(connector.kline).not.toHaveBeenCalled();

    const nextCandle = makeCandle(1_700_000_060_000, 105);
    const nextBaseContext = {
      ...baseContext,
      candle: nextCandle,
      prevCandle: candle,
    };
    const nextIndicators = {
      baseContext: nextBaseContext,
      atr: [1, 1.1],
    };
    indicatorsState.snapshot.mockReturnValue(nextIndicators);
    data.push(nextCandle);

    const third = strategyApi.getCurrentIndicatorsContext();

    expect(third.indicators).toBe(nextIndicators);
    expect(third.baseContext).toBe(nextBaseContext);
    expect(indicatorsState.onBar).toHaveBeenCalledTimes(2);
    expect(indicatorsState.snapshot).toHaveBeenCalledTimes(2);
  });

  it('loads and caches the decision base context once per closed candle', async () => {
    const candle = makeCandle(1_700_000_000_000, 100);
    const data: any[] = [candle];
    const connector = {
      kline: jest.fn(),
      getPosition: jest.fn(),
    } as any;
    const baseContext = {
      candle,
      prevCandle: null,
      raw: {},
      regime: {},
      structure: {},
      participation: {},
      relative: {},
      mtf: {},
    };
    const indicatorsState = {
      setCurrentBar: jest.fn(),
      next: jest.fn(),
      onBar: jest.fn(),
      ensureInitializedWithCurrentBar: jest.fn(),
      snapshot: jest.fn(() => ({ baseContext })),
      latestNumber: jest.fn(() => undefined),
      isInitialized: jest.fn(() => true),
    } as any;
    const loadDecisionBaseContext = jest.fn(async ({ baseContext: value }) => ({
      ...value,
      participation: { external: true },
    }));
    const strategyApi = createStrategyAPI({
      strategy: 'HyperliquidConsensus' as any,
      symbol: 'BTCUSDT',
      interval: '5' as any,
      env: 'BACKTEST',
      connector,
      cachedData: data,
      indicatorsState,
      loadDecisionBaseContext,
    });

    const first = await strategyApi.getDecisionBaseContext();
    const second = await strategyApi.getDecisionBaseContext();

    expect(first).toMatchObject({ participation: { external: true } });
    expect(second).toBe(first);
    expect(loadDecisionBaseContext).toHaveBeenCalledTimes(1);
    expect(loadDecisionBaseContext).toHaveBeenCalledWith({
      baseContext,
      candle,
      symbol: 'BTCUSDT',
      interval: '5',
    });

    const nextCandle = makeCandle(1_700_000_300_000, 101);
    data.push(nextCandle);
    indicatorsState.snapshot.mockReturnValue({
      baseContext: { ...baseContext, candle: nextCandle, prevCandle: candle },
    });

    await strategyApi.getDecisionBaseContext();
    expect(loadDecisionBaseContext).toHaveBeenCalledTimes(2);
  });

  it('reads decision base context from the latest snapshot without cloning indicator history', async () => {
    const candle = makeCandle(1_700_000_000_000, 100);
    const data: any[] = [candle];
    const connector = {
      kline: jest.fn(),
      getPosition: jest.fn(),
    } as any;
    const baseContext = {
      candle,
      prevCandle: null,
      raw: {},
      regime: {},
      structure: {},
      participation: {},
      relative: {},
      mtf: {},
    };
    const indicatorsState = {
      setCurrentBar: jest.fn(),
      next: jest.fn(),
      onBar: jest.fn(),
      ensureInitializedWithCurrentBar: jest.fn(),
      snapshot: jest.fn(() => ({ baseContext, atr: [1] })),
      latestSnapshot: jest.fn(() => ({ baseContext, atr: 1 })),
      latestNumber: jest.fn(() => undefined),
      isInitialized: jest.fn(() => true),
    } as any;
    const strategyApi = createStrategyAPI({
      strategy: 'HyperliquidConsensus' as any,
      symbol: 'BTCUSDT',
      interval: '5' as any,
      env: 'BACKTEST',
      connector,
      cachedData: data,
      indicatorsState,
    });

    await expect(strategyApi.getDecisionBaseContext()).resolves.toBe(
      baseContext,
    );
    expect(indicatorsState.onBar).toHaveBeenCalledTimes(1);
    expect(indicatorsState.latestSnapshot).toHaveBeenCalledTimes(1);
    expect(indicatorsState.snapshot).not.toHaveBeenCalled();
  });

  it('getDecisionPriceContext rejects when no current closed candle exists', async () => {
    const data: any[] = [];
    const connector = {
      kline: jest.fn(),
      getPosition: jest.fn(),
    } as any;
    const indicatorsState = {
      setCurrentBar: jest.fn(),
      next: jest.fn(),
      onBar: jest.fn(),
      ensureInitializedWithCurrentBar: jest.fn(),
      snapshot: jest.fn(),
      latestNumber: jest.fn(() => undefined),
      isInitialized: jest.fn(() => true),
    } as any;

    const strategyApi = createStrategyAPI({
      strategy: 'TrendLine' as any,
      symbol: 'TESTUSDT',
      interval: '15' as any,
      env: 'BACKTEST',
      connector,
      cachedData: data,
      indicatorsState,
      isConfigFromBacktest: false,
    });

    await expect(strategyApi.getDecisionPriceContext()).rejects.toThrow(
      'requires a current closed candle',
    );
    expect(indicatorsState.onBar).not.toHaveBeenCalled();
    expect(indicatorsState.snapshot).not.toHaveBeenCalled();
    expect(connector.kline).not.toHaveBeenCalled();
  });

  it('getCurrentPosition reuses one connector read within the same BACKTEST bar and invalidates on the next bar', async () => {
    const data: any[] = [makeCandle(1_700_000_000_000, 100)];
    let currentPosition: any = {
      symbol: 'TESTUSDT',
      qty: 1,
      price: 100,
      direction: 'LONG',
    };
    const connector = {
      kline: jest.fn(),
      getPosition: jest.fn(async () => currentPosition),
    } as any;

    const strategyApi = createStrategyAPI({
      strategy: 'TrendLine' as any,
      symbol: 'TESTUSDT',
      interval: '15' as any,
      env: 'BACKTEST',
      connector,
      cachedData: data,
      isConfigFromBacktest: false,
    });

    const first = await strategyApi.getCurrentPosition();
    const second = await strategyApi.getCurrentPosition();

    expect(second).toBe(first);
    expect(connector.getPosition).toHaveBeenCalledTimes(1);

    data.push(makeCandle(1_700_000_060_000, 105));
    currentPosition = {
      symbol: 'TESTUSDT',
      qty: 2,
      price: 105,
      direction: 'LONG',
    };

    const third = await strategyApi.getCurrentPosition();

    expect(third).toBe(currentPosition);
    expect(connector.getPosition).toHaveBeenCalledTimes(2);
  });

  it('entry auto-builds timestamp/currentPrice/prices and code from market data + orderPlan', async () => {
    const data = [makeCandle(1_700_000_000_000, 100)];
    const connector = {
      kline: jest.fn(),
      getPosition: jest.fn(),
    } as any;

    const strategyApi = createStrategyAPI({
      strategy: 'TrendLine' as any,
      symbol: 'TESTUSDT',
      interval: '15' as any,
      env: 'BACKTEST',
      connector,
      cachedData: data,
      isConfigFromBacktest: false,
    });

    const decision = await strategyApi.entry({
      direction: 'LONG',
      orderPlan: {
        qty: 1,
        stopLossPrice: 95,
        takeProfits: [
          { rate: 0.5, price: 103 },
          { rate: 0.5, price: 110 },
        ],
      },
    });

    expect(decision.code).toBe('TREND_LINE_LONG_ENTRY');
    expect(decision.entryContext.timestamp).toBe(1_700_000_000_000);
    expect(decision.entryContext.prices).toEqual({
      currentPrice: 100,
      takeProfitPrice: 110,
      stopLossPrice: 95,
      riskRatio: 2,
    });
    expect(decision.signal?.prices.takeProfitPrice).toBe(110);
    expect(connector.kline).not.toHaveBeenCalled();
  });

  it('entry uses provided code when passed', async () => {
    const data = [makeCandle(1_700_000_000_000, 100)];
    const connector = {
      kline: jest.fn(),
      getPosition: jest.fn(),
    } as any;

    const strategyApi = createStrategyAPI({
      strategy: 'TrendLine' as any,
      symbol: 'TESTUSDT',
      interval: '15' as any,
      env: 'BACKTEST',
      connector,
      cachedData: data,
      isConfigFromBacktest: false,
    });

    const decision = await strategyApi.entry({
      code: 'CUSTOM_ENTRY_CODE',
      direction: 'LONG',
      orderPlan: {
        qty: 1,
        stopLossPrice: 95,
        takeProfits: [{ rate: 1, price: 110 }],
      },
    });

    expect(decision.code).toBe('CUSTOM_ENTRY_CODE');
  });

  it('entry uses the current closed candle when indicators are already materialized', async () => {
    const candle = makeCandle(1_700_000_000_000, 100);
    const data: any[] = [candle];
    const connector = {
      kline: jest.fn(),
      getPosition: jest.fn(),
    } as any;
    const indicatorsState = {
      setCurrentBar: jest.fn(),
      next: jest.fn(),
      onBar: jest.fn(),
      ensureInitializedWithCurrentBar: jest.fn(),
      snapshot: jest.fn(() => ({
        baseContext: {
          candle,
          prevCandle: null,
          raw: {},
          regime: {},
          structure: {},
          participation: {},
          relative: {},
          mtf: {},
        },
      })),
      latestNumber: jest.fn(() => undefined),
      isInitialized: jest.fn(() => true),
    } as any;

    const strategyApi = createStrategyAPI({
      strategy: 'TrendLine' as any,
      symbol: 'TESTUSDT',
      interval: '15' as any,
      env: 'BACKTEST',
      connector,
      cachedData: data,
      indicatorsState,
      isConfigFromBacktest: false,
    });

    strategyApi.getCurrentIndicatorsContext();
    const decision = await strategyApi.entry({
      direction: 'LONG',
      orderPlan: {
        qty: 1,
        stopLossPrice: 95,
        takeProfits: [{ rate: 1, price: 110 }],
      },
    });

    expect(decision.entryContext.timestamp).toBe(candle.timestamp);
    expect(decision.entryContext.prices.currentPrice).toBe(candle.close);
    expect(indicatorsState.onBar).toHaveBeenCalledTimes(1);
    expect(indicatorsState.snapshot).toHaveBeenCalledTimes(1);
    expect(connector.kline).not.toHaveBeenCalled();
  });

  it('entry does not materialize indicators to resolve the current closed candle', async () => {
    const data = [makeCandle(1_700_000_000_000, 100)];
    const connector = {
      kline: jest.fn(),
      getPosition: jest.fn(),
    } as any;
    const indicatorsState = {
      setCurrentBar: jest.fn(),
      next: jest.fn(),
      onBar: jest.fn(),
      ensureInitializedWithCurrentBar: jest.fn(),
      snapshot: jest.fn(),
      latestNumber: jest.fn(() => undefined),
      isInitialized: jest.fn(() => true),
    } as any;

    const strategyApi = createStrategyAPI({
      strategy: 'TrendLine' as any,
      symbol: 'TESTUSDT',
      interval: '15' as any,
      env: 'BACKTEST',
      connector,
      cachedData: data,
      indicatorsState,
      isConfigFromBacktest: false,
    });

    await strategyApi.entry({
      direction: 'LONG',
      orderPlan: {
        qty: 1,
        stopLossPrice: 95,
        takeProfits: [{ rate: 1, price: 110 }],
      },
    });

    expect(indicatorsState.onBar).not.toHaveBeenCalled();
    expect(indicatorsState.snapshot).not.toHaveBeenCalled();
    expect(connector.kline).not.toHaveBeenCalled();
  });

  it('entry always reads the latest current closed candle', async () => {
    const data = [makeCandle(1_700_000_000_000, 100)];
    const connector = {
      kline: jest.fn(),
      getPosition: jest.fn(),
    } as any;

    const strategyApi = createStrategyAPI({
      strategy: 'TrendLine' as any,
      symbol: 'TESTUSDT',
      interval: '15' as any,
      env: 'BACKTEST',
      connector,
      cachedData: data,
      isConfigFromBacktest: false,
    });

    const firstDecision = await strategyApi.entry({
      direction: 'LONG',
      orderPlan: {
        qty: 1,
        stopLossPrice: 95,
        takeProfits: [{ rate: 1, price: 110 }],
      },
    });

    data.push(makeCandle(1_700_000_060_000, 105));

    const secondDecision = await strategyApi.entry({
      direction: 'LONG',
      orderPlan: {
        qty: 1,
        stopLossPrice: 95,
        takeProfits: [{ rate: 1, price: 115 }],
      },
    });

    expect(firstDecision.entryContext.timestamp).toBe(1_700_000_000_000);
    expect(firstDecision.entryContext.prices.currentPrice).toBe(100);
    expect(secondDecision.entryContext.timestamp).toBe(1_700_000_060_000);
    expect(secondDecision.entryContext.prices.currentPrice).toBe(105);
    expect(connector.kline).not.toHaveBeenCalled();
  });

  it('exit auto-builds timestamp and price from the current closed candle', async () => {
    const data = [makeCandle(1_700_000_000_000, 100)];
    const connector = {
      kline: jest.fn(),
      getPosition: jest.fn(),
    } as any;

    const strategyApi = createStrategyAPI({
      strategy: 'TrendLine' as any,
      symbol: 'TESTUSDT',
      interval: '15' as any,
      env: 'BACKTEST',
      connector,
      cachedData: data,
      isConfigFromBacktest: false,
    });

    const decision = await strategyApi.exit({
      direction: 'SHORT',
    });

    expect(decision).toEqual({
      kind: 'exit',
      code: 'TREND_LINE_SHORT_EXIT',
      closePlan: {
        direction: 'SHORT',
        price: 100,
        timestamp: 1_700_000_000_000,
      },
    });
  });

  it('exit uses the current closed candle when indicators are already materialized', async () => {
    const candle = makeCandle(1_700_000_000_000, 100);
    const data: any[] = [candle];
    const connector = {
      kline: jest.fn(),
      getPosition: jest.fn(),
    } as any;
    const indicatorsState = {
      setCurrentBar: jest.fn(),
      next: jest.fn(),
      onBar: jest.fn(),
      ensureInitializedWithCurrentBar: jest.fn(),
      snapshot: jest.fn(() => ({
        baseContext: {
          candle,
          prevCandle: null,
          raw: {},
          regime: {},
          structure: {},
          participation: {},
          relative: {},
          mtf: {},
        },
      })),
      latestNumber: jest.fn(() => undefined),
      isInitialized: jest.fn(() => true),
    } as any;

    const strategyApi = createStrategyAPI({
      strategy: 'TrendLine' as any,
      symbol: 'TESTUSDT',
      interval: '15' as any,
      env: 'BACKTEST',
      connector,
      cachedData: data,
      indicatorsState,
      isConfigFromBacktest: false,
    });

    strategyApi.getCurrentIndicatorsContext();
    await expect(strategyApi.exit({ direction: 'SHORT' })).resolves.toEqual({
      kind: 'exit',
      code: 'TREND_LINE_SHORT_EXIT',
      closePlan: {
        direction: 'SHORT',
        price: candle.close,
        timestamp: candle.timestamp,
      },
    });
    expect(indicatorsState.onBar).toHaveBeenCalledTimes(1);
    expect(indicatorsState.snapshot).toHaveBeenCalledTimes(1);
    expect(connector.kline).not.toHaveBeenCalled();
  });

  it('protect builds deterministic protection decision', () => {
    const data = [makeCandle(1_700_000_000_000, 100)];
    const connector = {
      kline: jest.fn(),
      getPosition: jest.fn(),
    } as any;

    const strategyApi = createStrategyAPI({
      strategy: 'TrendLine' as any,
      symbol: 'TESTUSDT',
      interval: '15' as any,
      env: 'BACKTEST',
      connector,
      cachedData: data,
      isConfigFromBacktest: false,
    });

    expect(
      strategyApi.protect({
        protectPlan: {
          direction: 'LONG',
          stopLossPrice: 101,
        },
      }),
    ).toEqual({
      kind: 'protect',
      code: 'TREND_LINE_LONG_PROTECT',
      protectPlan: {
        direction: 'LONG',
        stopLossPrice: 101,
      },
    });
  });

  it('createStateController manages local state, snapshots and hashes', () => {
    const data = [makeCandle(1_700_000_000_000, 100)];
    const connector = {
      kline: jest.fn(),
      getPosition: jest.fn(),
    } as any;
    const strategyApi = createStrategyAPI({
      strategy: 'TrendLine' as any,
      symbol: 'TESTUSDT',
      interval: '15' as any,
      env: 'BACKTEST',
      connector,
      cachedData: data,
      isConfigFromBacktest: false,
    });

    const controller = strategyApi.createStateController(
      'detector',
      () => ({ calls: 1 }),
      {
        snapshot: (state) => ({ calls: state.calls }),
      },
    );
    const initialHash = controller.hash();

    expect(controller.get()).toEqual({ calls: 1 });
    expect(controller.snapshot()).toEqual({ calls: 1 });

    controller.update((state) => {
      state.calls += 1;
    });

    expect(controller.get()).toEqual({ calls: 2 });
    expect(controller.snapshot()).toEqual({ calls: 2 });
    expect(controller.hash()).not.toBe(initialHash);

    controller.set({ calls: 10 });

    expect(controller.get()).toEqual({ calls: 10 });
    expect(controller.snapshot()).toEqual({ calls: 10 });
  });

  it('createStateController runs a compute function once per timestamp', () => {
    const data = [makeCandle(1_700_000_000_000, 100)];
    const connector = {
      kline: jest.fn(),
      getPosition: jest.fn(),
    } as any;
    const strategyApi = createStrategyAPI({
      strategy: 'TrendLine' as any,
      symbol: 'TESTUSDT',
      interval: '15' as any,
      env: 'BACKTEST',
      connector,
      cachedData: data,
      isConfigFromBacktest: false,
    });
    const controller = strategyApi.createStateController<
      { calls: number },
      number
    >('detector', () => ({ calls: 0 }));
    const compute = jest.fn((state: { calls: number }) => {
      state.calls += 1;
      return state.calls;
    });

    expect(controller.oncePerTimestamp(1_700_000_000_000, compute)).toBe(1);
    expect(controller.oncePerTimestamp(1_700_000_000_000, compute)).toBe(1);
    expect(controller.oncePerTimestamp(1_700_000_060_000, compute)).toBe(2);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('createStateController rejects invalid and non-monotonic timestamps by default', () => {
    const data = [makeCandle(1_700_000_000_000, 100)];
    const connector = {
      kline: jest.fn(),
      getPosition: jest.fn(),
    } as any;
    const strategyApi = createStrategyAPI({
      strategy: 'TrendLine' as any,
      symbol: 'TESTUSDT',
      interval: '15' as any,
      env: 'BACKTEST',
      connector,
      cachedData: data,
      isConfigFromBacktest: false,
    });
    const controller = strategyApi.createStateController<
      { calls: number },
      number
    >('detector', () => ({ calls: 0 }));

    expect(() => controller.oncePerTimestamp(Number.NaN, () => 0)).toThrow(
      /non-finite timestamp/,
    );

    controller.oncePerTimestamp(1_700_000_060_000, () => 1);

    expect(() =>
      controller.oncePerTimestamp(1_700_000_000_000, () => 2),
    ).toThrow(/non-monotonic timestamp/);
  });

  it('createStateController can opt out of monotonic timestamp checks', () => {
    const data = [makeCandle(1_700_000_000_000, 100)];
    const connector = {
      kline: jest.fn(),
      getPosition: jest.fn(),
    } as any;
    const strategyApi = createStrategyAPI({
      strategy: 'TrendLine' as any,
      symbol: 'TESTUSDT',
      interval: '15' as any,
      env: 'BACKTEST',
      connector,
      cachedData: data,
      isConfigFromBacktest: false,
    });
    const controller = strategyApi.createStateController<
      { calls: number },
      number
    >('detector', () => ({ calls: 0 }), { monotonic: false });

    controller.oncePerTimestamp(1_700_000_060_000, () => 1);

    expect(controller.oncePerTimestamp(1_700_000_000_000, () => 2)).toBe(2);
  });

  it('createStateController reuses shared replay state in replay environments', () => {
    const data = [makeCandle(1_700_000_000_000, 100)];
    const connector = {
      kline: jest.fn(),
      getPosition: jest.fn(),
    } as any;
    const createApi = () =>
      createStrategyAPI({
        strategy: 'TrendLine' as any,
        symbol: 'TESTUSDT',
        interval: '15' as any,
        env: 'PARITY',
        connector,
        cachedData: data,
        isConfigFromBacktest: false,
        sharedReplayKey: 'test-state:shared',
        getSharedReplayState: getSharedStrategyReplayState,
      });
    const first = createApi().createStateController<{ calls: number }, number>(
      'detector',
      () => ({ calls: 0 }),
    );
    const second = createApi().createStateController<{ calls: number }, number>(
      'detector',
      () => ({ calls: 100 }),
    );
    const secondCompute = jest.fn((state: { calls: number }) => {
      state.calls += 100;
      return state.calls;
    });

    expect(
      first.oncePerTimestamp(1_700_000_000_000, (state) => {
        state.calls += 1;
        return state.calls;
      }),
    ).toBe(1);
    expect(second.oncePerTimestamp(1_700_000_000_000, secondCompute)).toBe(1);
    expect(second.get()).toEqual({ calls: 1 });
    expect(secondCompute).not.toHaveBeenCalled();
  });

  it('createStateController reuses explicitly keyed CRON state', () => {
    const data = [makeCandle(1_700_000_000_000, 100)];
    const connector = {
      kline: jest.fn(),
      getPosition: jest.fn(),
    } as any;
    const createApi = () =>
      createStrategyAPI({
        strategy: 'TrendLine' as any,
        symbol: 'TESTUSDT',
        interval: '15' as any,
        env: 'CRON',
        connector,
        cachedData: data,
        isConfigFromBacktest: false,
        sharedReplayKey: 'test-state:cron',
        getSharedReplayState: getSharedStrategyReplayState,
      });
    const first = createApi().createStateController('detector', () => ({
      calls: 1,
    }));
    const second = createApi().createStateController('detector', () => ({
      calls: 2,
    }));

    expect(second.get()).toBe(first.get());
    expect(second.get()).toEqual({ calls: 1 });
  });

  it('createStateController separates shared state by config key', () => {
    const data = [makeCandle(1_700_000_000_000, 100)];
    const connector = {
      kline: jest.fn(),
      getPosition: jest.fn(),
    } as any;
    const strategyApi = createStrategyAPI({
      strategy: 'TrendLine' as any,
      symbol: 'TESTUSDT',
      interval: '15' as any,
      env: 'BACKTEST',
      connector,
      cachedData: data,
      isConfigFromBacktest: false,
      sharedReplayKey: 'test-state:configs',
      getSharedReplayState: getSharedStrategyReplayState,
    });
    const first = strategyApi.createStateController(
      'detector',
      () => ({
        calls: 1,
      }),
      {
        configKey: 'a',
      },
    );
    const second = strategyApi.createStateController(
      'detector',
      () => ({
        calls: 2,
      }),
      {
        configKey: 'b',
      },
    );

    expect(first.get()).toEqual({ calls: 1 });
    expect(second.get()).toEqual({ calls: 2 });
  });

  it('createStateController keeps local state when shared replay is disabled or unavailable', () => {
    const data = [makeCandle(1_700_000_000_000, 100)];
    const connector = {
      kline: jest.fn(),
      getPosition: jest.fn(),
    } as any;
    const sharedApi = createStrategyAPI({
      strategy: 'TrendLine' as any,
      symbol: 'TESTUSDT',
      interval: '15' as any,
      env: 'BACKTEST',
      connector,
      cachedData: data,
      isConfigFromBacktest: false,
      sharedReplayKey: 'test-state:disabled',
      getSharedReplayState: getSharedStrategyReplayState,
    });
    const first = sharedApi.createStateController(
      'detector',
      () => ({ calls: 1 }),
      { sharedReplay: false },
    );
    const second = sharedApi.createStateController(
      'detector',
      () => ({ calls: 2 }),
      { sharedReplay: false, configKey: 'isolated' },
    );
    const cronApi = createStrategyAPI({
      strategy: 'TrendLine' as any,
      symbol: 'TESTUSDT',
      interval: '15' as any,
      env: 'CRON',
      connector,
      cachedData: data,
      isConfigFromBacktest: false,
      sharedReplayKey: 'test-state:disabled',
      getSharedReplayState: getSharedStrategyReplayState,
    });
    const cronController = cronApi.createStateController('detector', () => ({
      calls: 3,
    }));

    expect(first.get()).toEqual({ calls: 1 });
    expect(second.get()).toEqual({ calls: 2 });
    expect(cronController.get()).toEqual({ calls: 3 });
  });

  it.each(['BACKTEST', 'PARITY', 'CRON'])(
    'createLastTradeController honors explicit enablement and the exact boundary in %s',
    (env) => {
      const strategyApi = createStrategyAPI({
        strategy: 'TrendLine' as any,
        symbol: 'TESTUSDT',
        interval: '15' as any,
        env,
        connector: {
          kline: jest.fn(),
          getPosition: jest.fn(),
        } as any,
        cachedData: [makeCandle(1_700_000_000_000, 100)],
      });
      const controller = strategyApi.createLastTradeController({
        enabled: true,
        cooldownMs: 10,
      });

      controller.markTrade(1_000);

      expect(controller.getLastTradeTimestamp()).toBe(1_000);
      expect(controller.isInCooldown(1_010)).toBe(true);
      expect(controller.isInCooldown(1_011)).toBe(false);
    },
  );

  it.each(['BACKTEST', 'PARITY'])(
    'createLastTradeController isolates %s APIs even when detector replay state is shared',
    (env) => {
      const createApi = () =>
        createStrategyAPI({
          strategy: 'TrendLine' as any,
          symbol: 'TESTUSDT',
          interval: '15' as any,
          env,
          connector: {
            kline: jest.fn(),
            getPosition: jest.fn(),
          } as any,
          cachedData: [makeCandle(1_700_000_000_000, 100)],
          sharedReplayKey: 'test-state:last-trade-isolated',
          getSharedReplayState: getSharedStrategyReplayState,
        });
      const first = createApi().createLastTradeController({
        enabled: true,
        cooldownMs: 10,
      });
      const second = createApi().createLastTradeController({
        enabled: true,
        cooldownMs: 10,
      });

      first.markTrade(1_000);

      expect(first.isInCooldown(1_005)).toBe(true);
      expect(second.getLastTradeTimestamp()).toBeNull();
      expect(second.isInCooldown(1_005)).toBe(false);
    },
  );

  it('createLastTradeController shares CRON lifecycle state and isolates different lifecycle keys', () => {
    const createApi = (sharedReplayKey?: string) =>
      createStrategyAPI({
        strategy: 'TrendLine' as any,
        symbol: 'TESTUSDT',
        interval: '15' as any,
        env: 'CRON',
        connector: {
          kline: jest.fn(),
          getPosition: jest.fn(),
        } as any,
        cachedData: [makeCandle(1_700_000_000_000, 100)],
        sharedReplayKey,
        getSharedReplayState: getSharedStrategyReplayState,
      });
    const first = createApi(
      'test-state:last-trade-cron:a',
    ).createLastTradeController({ enabled: true, cooldownMs: 10 });
    const rebuilt = createApi(
      'test-state:last-trade-cron:a',
    ).createLastTradeController({ enabled: true, cooldownMs: 10 });
    const differentLifecycle = createApi(
      'test-state:last-trade-cron:b',
    ).createLastTradeController({ enabled: true, cooldownMs: 10 });

    first.markTrade(1_000);

    expect(rebuilt.getLastTradeTimestamp()).toBe(1_000);
    expect(rebuilt.isInCooldown(1_010)).toBe(true);
    expect(differentLifecycle.getLastTradeTimestamp()).toBeNull();
  });

  it('createLastTradeController keeps one-shot CRON APIs local without a lifecycle key', () => {
    const createApi = () =>
      createStrategyAPI({
        strategy: 'TrendLine' as any,
        symbol: 'TESTUSDT',
        interval: '15' as any,
        env: 'CRON',
        connector: {
          kline: jest.fn(),
          getPosition: jest.fn(),
        } as any,
        cachedData: [makeCandle(1_700_000_000_000, 100)],
        getSharedReplayState: getSharedStrategyReplayState,
      });
    const first = createApi().createLastTradeController({
      enabled: true,
      cooldownMs: 10,
    });
    const second = createApi().createLastTradeController({
      enabled: true,
      cooldownMs: 10,
    });

    first.markTrade(1_000);

    expect(first.getLastTradeTimestamp()).toBe(1_000);
    expect(second.getLastTradeTimestamp()).toBeNull();
  });
});
