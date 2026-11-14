/** @jest-environment node */
import type {
  Connector,
  KlineChartItem,
  Interval,
  KlineChartData,
  RuntimeLineage,
  Signal,
} from '@tradejs/types';
import {
  prepareMultiIntervalHistoricalReplay,
  resolveHistoricalReplayIntervals,
  type HistoricalReplayPreparationContext,
  type ReplayRuntimeStrategy,
} from '../historicalSignalsReplayPreparation';
import { executeHistoricalReplay } from '../historicalSignalsReplayExecution';
import { createPortfolioReplayConnector } from '../portfolioReplayConnector';
const minute = 60_000;
const candles = (times: number[]): KlineChartData =>
  times.map((t) => ({
    timestamp: t * minute,
    dt: new Date(t * minute).toISOString(),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1,
    turnover: 100,
  }));
const lineage: RuntimeLineage = {
  schemaVersion: 3,
  strategyRevision: 'sr1:1111111111111111',
  deploymentCompositionId: 'dc1:2222222222222222',
  strategyPackageVersion: '1.0.0',
  strategyDependencyVersions: { '@tradejs/core': '3.1.20' },
  runtimePackageVersion: '3.1.20',
};
const fixture = () => {
  const data = {
    '15': candles([-60, -45, -30, -15, 0, 15, 30, 45, 60]),
    '60': candles([-60, 0, 60]),
  };
  const market: Connector = {
    capabilities: { supportedUniverses: ['crypto'], defaultUniverse: 'crypto' },
    universe: 'crypto',
    kline: jest.fn(
      async ({ interval }) => data[interval === '60' ? '60' : '15'],
    ),
    listInstruments: jest.fn(),
    getState: jest.fn(),
    setState: jest.fn(),
    getPosition: jest.fn(),
    getPositions: jest.fn(),
    placeOrder: jest.fn(),
    setTakeProfits: jest.fn(),
    setStopLoss: jest.fn(),
    closePosition: jest.fn(),
    getTickers: jest.fn(),
  };
  const connector = createPortfolioReplayConnector(market);
  const events: string[] = [];
  const histories = new Map<string, KlineChartData>();
  const evaluations: Array<{
    interval: string;
    timestamp: number;
    ethTimestamp?: number;
  }> = [];
  const preparationAdapters = {
    progress: { tick: jest.fn() },
    display: { skipped: String, symbol: String },
    buildLineage: jest.fn(async () => lineage),
    releaseIndicatorsCache: jest.fn<void, [string]>(),
    releaseReplayCache: jest.fn<void, [string]>(),
  };
  const strategies = (['15', '60'] as const).map(
    (interval): ReplayRuntimeStrategy => ({
      strategyName: `Fixture${interval}`,
      strategyRevision: lineage.strategyRevision,
      deploymentCompositionId: lineage.deploymentCompositionId,
      strategyPackage: 'fixture',
      strategyPackageVersion: '1.0.0',
      strategyDependencyVersions: { '@tradejs/core': '3.1.20' },
      runtimePackageVersion: '3.1.20',
      strategyConfig: { INTERVAL: interval },
      strategyResults: {},
      strategyCreator: jest.fn(async (params) => {
        expect(params.config?.INTERVAL).toBe(interval);
        expect(params.connector).toBe(connector);
        histories.set(interval, params.data ?? []);
        return async (
          candle: KlineChartItem,
          _btc?: KlineChartItem,
          eth?: KlineChartItem,
        ) => {
          evaluations.push({
            interval,
            timestamp: candle.timestamp,
            ethTimestamp: eth?.timestamp,
          });
          events.push(`${interval}:${candle.timestamp / minute}`);
          return 'NO_SIGNAL';
        };
      }),
    }),
  );
  const references = (interval: Interval) => {
    const values = data[interval === '60' ? '60' : '15'];
    return {
      btcMarketData: values,
      ethMarketData: values,
      btcBinanceData: values,
      btcCoinbaseData: values,
    };
  };
  const context: HistoricalReplayPreparationContext = {
    userName: 'root',
    projectRoot: '/project',
    preparedRun: {
      connectorName: 'bybit',
      marketConnector: market,
      tickers: ['BTCUSDT'],
      instrumentsBySymbol: new Map(),
      window: { start: 0, end: 60 * minute, source: 'explicit' },
      preloadStart: -60 * minute,
    },
    interval: '15',
    connectorName: 'bybit',
    replayConnector: connector,
    strategies,
    references: references('15'),
  };
  return {
    context,
    references,
    events,
    connector,
    market,
    data,
    histories,
    evaluations,
    preparationAdapters,
  };
};
test('15 and 60 minute strategies share a clock and connector without exposing an unfinished hour', async () => {
  const f = fixture();
  const plan = await prepareMultiIntervalHistoricalReplay(
    f.context,
    f.preparationAdapters,
    async (i) => f.references(i),
  );
  const advance = jest.spyOn(f.connector, 'advanceMarket');
  const before = jest.fn(async () => {
    f.events.push('cycle');
    return undefined;
  });
  await executeHistoricalReplay(
    {
      plan,
      connector: f.connector,
      hookContext: {
        connector: f.connector,
        connectorName: 'bybit',
        userName: 'root',
        interval: '15',
        tickers: ['BTCUSDT'],
        runtimeStrategies: [],
      },
    },
    {
      clock: { now: () => 0 },
      progress: { enabled: false, tick: jest.fn() },
      display: { signals: String, aborted: String, timestamp: String },
      invokeBeforeSignals: before,
      invokeAfterSignals: jest.fn(),
      enrichSignal: jest.fn(),
      releaseIndicatorsCache: jest.fn(),
      releaseReplayCache: jest.fn(),
    },
  );
  expect(f.events).toEqual([
    'cycle',
    '15:0',
    'cycle',
    '15:15',
    'cycle',
    '15:30',
    'cycle',
    '15:45',
    '60:0',
    'cycle',
    '15:60',
  ]);
  expect(advance.mock.calls.map(([x]) => x.candle.timestamp / minute)).toEqual([
    0, 15, 30, 45, 60,
  ]);
  expect(f.market.kline).toHaveBeenCalledWith(
    expect.objectContaining({ interval: '60' }),
  );
  expect(plan.runtimeLineages).toHaveLength(2);
});

test('rejects a base timeframe larger than a strategy before loading data', async () => {
  const f = fixture();
  f.context.interval = '60';
  await expect(
    prepareMultiIntervalHistoricalReplay(
      f.context,
      {
        ...f.preparationAdapters,
        progress: { tick: jest.fn() },
        display: { skipped: String, symbol: String },
        buildLineage: jest.fn(async () => lineage),
      },
      async (i) => f.references(i),
    ),
  ).rejects.toThrow('multiples of the base timeframe');
  expect(f.market.kline).not.toHaveBeenCalled();
});

test('the public historical replay orchestration loads native hourly references', async () => {
  const f = fixture();
  jest.doMock('../cliConfig', () => ({
    replayProjectRoot: '/project',
    replayUserName: 'root',
  }));
  jest.doMock('@tradejs/node/cli', () => ({
    loadTradejsConfig: async () => ({}),
  }));
  jest.doMock('@tradejs/node/connectors', () => ({
    DEFAULT_CONNECTOR_NAME: 'bybit',
    getConnectorCreatorByName: async () => async () => f.market,
  }));
  jest.doMock('@tradejs/node/strategies', () => ({
    getStrategyCreator: async (name: string) =>
      f.context.strategies.find((s) => s.strategyName === name)
        ?.strategyCreator,
    enrichSignalWithBinanceMarketContext: jest.fn(),
  }));
  jest.doMock('@tradejs/node/runtimeStrategies', () => ({
    getRuntimeStrategyPackageMetadata: async () => ({
      strategyPackage: 'fixture',
      strategyPackageVersion: '1.0.0',
      strategyDependencyVersions: { '@tradejs/core': '3.1.20' },
      runtimePackageVersion: '3.1.20',
    }),
  }));
  jest.doMock('@tradejs/infra/redis', () => ({
    getData: async () => ({}),
    redisKeys: { strategyResults: () => 'fixture' },
  }));
  const { runHistoricalSignalsReplay } = await import(
    '../historicalSignalsReplay'
  );
  // Both strategy factories must see the same orchestration-owned connector.
  for (const strategy of f.context.strategies) {
    strategy.strategyCreator = async () => async () => 'NO_SIGNAL';
  }
  const result = await runHistoricalSignalsReplay({
    preparedRun: f.context.preparedRun,
    interval: '15',
    runtimeStrategies: f.context.strategies,
    showProgress: false,
  });
  expect(f.market.kline).toHaveBeenCalledWith(
    expect.objectContaining({ symbol: 'BTCUSDT', interval: '60' }),
  );
  expect(result.cycleCount).toBe(5);
});

const runPlan = async (
  f: ReturnType<typeof fixture>,
  plan: Awaited<ReturnType<typeof prepareMultiIntervalHistoricalReplay>>,
) =>
  executeHistoricalReplay(
    {
      plan,
      connector: f.connector,
      hookContext: {
        connector: f.connector,
        connectorName: 'bybit',
        userName: 'root',
        interval: '15',
        tickers: ['BTCUSDT'],
        runtimeStrategies: [],
      },
    },
    {
      clock: { now: () => 0 },
      progress: { enabled: false, tick: jest.fn() },
      display: { signals: String, aborted: String, timestamp: String },
      invokeBeforeSignals: jest.fn(),
      invokeAfterSignals: jest.fn(),
      enrichSignal: jest.fn(),
      releaseIndicatorsCache: jest.fn(),
      releaseReplayCache: jest.fn(),
    },
  );

test('passes aligned native ETH candles to higher-timeframe strategies', async () => {
  const f = fixture();
  const plan = await prepareMultiIntervalHistoricalReplay(
    f.context,
    f.preparationAdapters,
    async (interval) => f.references(interval),
  );
  await runPlan(f, plan);
  expect(
    f.evaluations.find((evaluation) => evaluation.interval === '60'),
  ).toEqual({ interval: '60', timestamp: 0, ethTimestamp: 0 });
});

test('starting inside an hour keeps the unfinished hour out of warmup and evaluates it after close', async () => {
  const f = fixture();
  f.context.preparedRun.window.start = 15 * minute;
  const plan = await prepareMultiIntervalHistoricalReplay(
    f.context,
    f.preparationAdapters,
    async (interval) => f.references(interval),
  );
  expect(
    f.histories.get('60')?.map((candle) => candle.timestamp / minute),
  ).toEqual([-60]);
  await runPlan(f, plan);
  expect(f.events).toContain('60:0');
  expect(plan.orderedTimestamps[0]).toBe(15 * minute);
});

test('rejects monthly candles mixed with fixed-duration intervals', () => {
  expect(() => resolveHistoricalReplayIntervals('15', ['15', 'M'])).toThrow(
    'calendar',
  );
});

test.each([{ times: [] }, { times: [-60, -45, -30, -15, 0, 15, 45, 60] }])(
  'requires a complete base market stream before scheduling higher-timeframe trading ($times)',
  async ({ times }) => {
    const f = fixture();
    f.data['15'] = candles(times);
    await expect(
      prepareMultiIntervalHistoricalReplay(
        f.context,
        f.preparationAdapters,
        async (interval) => f.references(interval),
      ),
    ).rejects.toThrow('Missing base replay candle');
  },
);

const delistedSymbolFixture = (baseTimes: number[]) => {
  const f = fixture();
  f.context.preparedRun.tickers.push('AGIUSDT');
  f.context.preparedRun.window.end = 120 * minute;
  f.context.delistings = new Map([['AGIUSDT', 60 * minute]]);
  f.data['15'] = candles([
    -60, -45, -30, -15, 0, 15, 30, 45, 60, 75, 90, 105, 120,
  ]);
  f.data['60'] = candles([-60, 0, 60, 120]);
  f.context.references = f.references('15');
  jest
    .mocked(f.market.kline)
    .mockImplementation(async ({ symbol, interval }) =>
      symbol === 'AGIUSDT' && interval === '15'
        ? candles(baseTimes)
        : f.data[interval === '60' ? '60' : '15'],
    );
  return f;
};

test('stops a delisted contract at the cutoff and continues both intervals for the other contract', async () => {
  const f = delistedSymbolFixture([-60, -45, -30, -15, 0, 15, 30, 45]);
  const evaluated: Array<[string, number]> = [];
  for (const strategy of f.context.strategies) {
    strategy.strategyCreator =
      async ({ symbol }) =>
      async (candle) => {
        evaluated.push([symbol, candle.timestamp / minute]);
        return 'NO_SIGNAL';
      };
  }
  const plan = await prepareMultiIntervalHistoricalReplay(
    f.context,
    f.preparationAdapters,
    async (interval) => f.references(interval),
  );
  const advance = jest.spyOn(f.connector, 'advanceMarket');
  await runPlan(f, plan);

  expect(
    advance.mock.calls
      .filter(([row]) => row.symbol === 'AGIUSDT')
      .map(([row]) => row.candle.timestamp / minute),
  ).toEqual([0, 15, 30, 45]);
  expect(evaluated.filter(([symbol]) => symbol === 'AGIUSDT')).toEqual([
    ['AGIUSDT', 0],
    ['AGIUSDT', 15],
    ['AGIUSDT', 30],
  ]);
  expect(
    evaluated.filter(([symbol, time]) => symbol === 'BTCUSDT' && time === 60),
  ).toHaveLength(2);
  expect(evaluated).toContainEqual(['BTCUSDT', 120]);
});

test('rejects a missing base candle before a confirmed delisting', async () => {
  const f = delistedSymbolFixture([-60, -45, -30, -15, 0, 15, 45]);
  await expect(
    prepareMultiIntervalHistoricalReplay(
      f.context,
      f.preparationAdapters,
      async (interval) => f.references(interval),
    ),
  ).rejects.toThrow('Missing base replay candle: AGIUSDT at 1800000');
});

test('reports an open position requiring settlement at delisting', async () => {
  const f = delistedSymbolFixture([-60, -45, -30, -15, 0, 15, 30, 45]);
  const baseStrategy = f.context.strategies[0];
  baseStrategy.strategyCreator =
    async ({ symbol }) =>
    async (candle) => {
      if (symbol === 'AGIUSDT' && candle.timestamp === 0) {
        await f.connector.placeOrder({
          symbol,
          timestamp: candle.timestamp,
          direction: 'LONG',
          price: 100,
          qty: 1,
        });
      }
      return 'NO_SIGNAL';
    };
  const plan = await prepareMultiIntervalHistoricalReplay(
    f.context,
    f.preparationAdapters,
    async (interval) => f.references(interval),
  );

  await expect(runPlan(f, plan)).rejects.toThrow(
    'Replay cannot settle an open position for AGIUSDT at delisting (3600000)',
  );
});

test('releases prepared base caches when higher-timeframe references fail', async () => {
  const f = fixture();
  await expect(
    prepareMultiIntervalHistoricalReplay(
      f.context,
      f.preparationAdapters,
      async () => {
        throw new Error('reference history failed');
      },
    ),
  ).rejects.toThrow('reference history failed');
  expect(f.preparationAdapters.releaseIndicatorsCache).toHaveBeenCalledTimes(1);
  expect(f.preparationAdapters.releaseReplayCache).toHaveBeenCalledWith(
    f.preparationAdapters.releaseIndicatorsCache.mock.calls[0][0],
  );
});

test('releases both partial native and completed base caches when a higher factory fails', async () => {
  const f = fixture();
  f.context.strategies[1].strategyCreator = async () => {
    throw new Error('factory failed');
  };
  await expect(
    prepareMultiIntervalHistoricalReplay(
      f.context,
      f.preparationAdapters,
      async (interval) => f.references(interval),
    ),
  ).rejects.toThrow('factory failed');
  expect(f.preparationAdapters.releaseIndicatorsCache).toHaveBeenCalledTimes(2);
  expect(f.preparationAdapters.releaseReplayCache).toHaveBeenCalledTimes(2);
});

test('records all entries and manual exits on the shared clock while retaining native signal time', async () => {
  const f = fixture();
  f.context.preparedRun.tickers = ['BTCUSDT', 'ETHUSDT'];
  f.context.preparedRun.window.end = 120 * minute;
  f.data['15'] = candles([
    -60, -45, -30, -15, 0, 15, 30, 45, 60, 75, 90, 105, 120,
  ]);
  f.data['60'] = candles([-60, 0, 60, 120]);
  f.context.references = f.references('15');
  for (const strategy of f.context.strategies) {
    const hourly = strategy.strategyConfig.INTERVAL === '60';
    const symbol = hourly ? 'ETHUSDT' : 'BTCUSDT';
    strategy.selection = { tickers: [symbol] };
    strategy.strategyCreator = async () => async (candle) => {
      const timestamp = candle.timestamp;
      if (timestamp === 0) {
        const signal: Signal = {
          signalId: `${symbol}:entry`,
          symbol,
          strategy: strategy.strategyName,
          interval: hourly ? '60' : '15',
          direction: 'LONG',
          timestamp,
          figures: {},
          indicators: {},
          prices: {
            currentPrice: 100,
            takeProfitPrice: 110,
            stopLossPrice: 95,
            riskRatio: 2,
          },
        };
        await f.connector.placeOrder({
          symbol,
          timestamp,
          direction: 'LONG',
          price: 100,
          qty: 1,
          signal,
        });
      } else if (timestamp === (hourly ? 60 : 90) * minute) {
        await f.connector.closePosition({
          symbol,
          timestamp,
          direction: 'LONG',
          price: 101,
        });
      }
      return 'NO_SIGNAL';
    };
  }
  const plan = await prepareMultiIntervalHistoricalReplay(
    f.context,
    f.preparationAdapters,
    async (interval) => f.references(interval),
  );
  await runPlan(f, plan);
  const artifacts = f.connector.getReplayArtifacts();
  expect(
    artifacts.orderLog.map((order) => [order.symbol, order.timestamp / minute]),
  ).toEqual([
    ['BTCUSDT', 0],
    ['ETHUSDT', 45],
    ['BTCUSDT', 90],
    ['ETHUSDT', 105],
  ]);
  expect(
    artifacts.positionLog.map((position) => position.close.timestamp / minute),
  ).toEqual([90, 105]);
  expect(artifacts.orderLog[1].signal?.timestamp).toBe(0);
});

test('waits for in-flight factories before releasing partial caches', async () => {
  const f = fixture();
  let release!: () => void;
  let markStarted!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const base = f.context.strategies[0];
  f.context.strategies = [
    {
      ...base,
      strategyName: 'SlowFactory',
      strategyCreator: async () => {
        markStarted();
        await gate;
        return async () => 'NO_SIGNAL';
      },
    },
    {
      ...base,
      strategyName: 'FailingFactory',
      strategyCreator: async () => {
        throw new Error('factory failed');
      },
    },
  ];
  const pending = prepareMultiIntervalHistoricalReplay(
    f.context,
    f.preparationAdapters,
    async (interval) => f.references(interval),
  );
  const rejected = expect(pending).rejects.toThrow('factory failed');
  await started;
  await new Promise<void>((resolve) => setImmediate(resolve));
  const prematureCleanup =
    f.preparationAdapters.releaseIndicatorsCache.mock.calls.length;
  release();
  await rejected;
  expect(prematureCleanup).toBe(0);
  expect(f.preparationAdapters.releaseIndicatorsCache).toHaveBeenCalledTimes(1);
  expect(f.preparationAdapters.releaseReplayCache).toHaveBeenCalledTimes(1);
});
