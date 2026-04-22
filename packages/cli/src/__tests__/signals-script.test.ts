export {};

const TTL_1M = 2_600_000;

type ScriptFlags = {
  tickers?: string;
  exclude?: string;
  tickersLimit?: number;
  timeframe: number;
  makeOrders: boolean;
  notify: boolean;
  skipScreenshots: boolean;
  updateOnly: boolean;
  cacheOnly: boolean;
  showTickersList: boolean;
  showSkipStats: boolean;
  chunk?: string;
  user: string;
  connector: string;
  points?: string;
  offset?: string;
};

type Scenario = {
  flags: ScriptFlags;
  strategyConfig?: Record<string, unknown>;
  existingSignalKeys?: string[];
  strategyResult?: unknown;
  projectHooks?: {
    beforeSignals?: (...args: any[]) => unknown;
    afterSignals?: (...args: any[]) => unknown;
  };
  strategyConfigs?: Array<{
    strategyName: string;
    config?: Record<string, unknown>;
    result?: unknown;
  }>;
};

const makeRedisKeys = () => ({
  strategies: (userName: string) => `users:${userName}:strategies`,
  signal: (symbol: string, signalId: string) => `signals:${symbol}:${signalId}`,
  signalsBySymbol: (symbol: string) => `signals:${symbol}:`,
  storeSignal: (symbol: string, signalId: string) =>
    `store:signals:${symbol}:${signalId}`,
  runtimeSignal: (userName: string, signalId: string) =>
    `users:${userName}:runtime:signals:${signalId}`,
  runtimeSignalEvaluation: (userName: string, evaluationId: string) =>
    `users:${userName}:runtime:signal-evaluations:${evaluationId}`,
});

const makeCandle = (timestamp: number, close: number) => ({
  timestamp,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
});

const loadScript = async (scenario: Scenario) => {
  jest.resetModules();

  const redisKeys = makeRedisKeys();
  const strategyEntries = scenario.strategyConfigs ?? [
    {
      strategyName: 'TrendLine',
      config: scenario.strategyConfig,
      result: scenario.strategyResult,
    },
  ];
  const strategyConfigKeys = strategyEntries.map(
    ({ strategyName }) => `users:root:strategies:${strategyName}:config`,
  );
  const getKeys = jest.fn(async (key: string) => {
    if (key === `${redisKeys.strategies('root')}:`) {
      return strategyConfigKeys;
    }
    if (key === redisKeys.signalsBySymbol('ETHUSDT')) {
      return scenario.existingSignalKeys ?? [];
    }
    return [];
  });
  const strategyConfigMap = new Map(
    strategyEntries.map(({ strategyName, config }) => [
      `users:root:strategies:${strategyName}:config`,
      config ?? { INTERVAL: '15' },
    ]),
  );
  const getData = jest.fn(async (key: string, fallback: any) => {
    if (strategyConfigMap.has(key)) {
      return strategyConfigMap.get(key);
    }
    return fallback;
  });
  const setData = jest.fn(async () => null);
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const connector = {
    kline: jest.fn(async ({ symbol }: { symbol: string }) => {
      if (symbol === 'BTCUSDT') {
        return [makeCandle(1000, 100), makeCandle(2000, 101)];
      }
      return [makeCandle(1000, 10), makeCandle(2000, 11)];
    }),
  };
  const strategyCreatorMap = new Map<string, jest.Mock>();
  const strategyFnMap = new Map<string, jest.Mock>();

  for (const { strategyName, result } of strategyEntries) {
    const strategySignal = {
      signalId: `${strategyName}-sig`,
      strategy: strategyName,
      symbol: 'ETHUSDT',
      interval: '15',
      direction: 'LONG',
      timestamp: 2000,
      prices: { currentPrice: 11 },
      figures: {},
      indicators: {},
      additionalIndicators: {},
    };
    const strategyFn = jest.fn(async () => result ?? strategySignal);
    const strategyCreator = jest.fn(async () => strategyFn);
    strategyFnMap.set(strategyName, strategyFn);
    strategyCreatorMap.set(strategyName, strategyCreator);
  }

  const getStrategyCreator = jest.fn(async (strategyName: string) =>
    strategyCreatorMap.get(strategyName),
  );
  const getTickers = jest.fn(async () => ['ETHUSDT']);
  const update = jest.fn(async () => null);
  const makeScreenshots = jest.fn(async () => null);
  const sendToTG = jest.fn(async () => null);
  const loadTradejsConfig = jest.fn(async () => ({
    hooks: scenario.projectHooks ?? {},
  }));
  const runWithConcurrency = jest.fn(
    async <T>(items: T[], _limit: number, worker: (item: T) => Promise<void>) =>
      Promise.all(items.map(worker)),
  );
  const getTimestamp = jest.fn(() => 2000);
  const progressTick = jest.fn();

  jest.doMock('args', () => ({
    __esModule: true,
    default: {
      option: jest.fn(),
      parse: jest.fn(() => scenario.flags),
    },
  }));

  jest.doMock('progress', () => ({
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      tick: progressTick,
    })),
  }));

  jest.doMock('chalk', () => ({
    __esModule: true,
    default: {
      yellow: (value: string) => value,
      cyan: (value: string | number) => String(value),
      gray: (value: string) => value,
    },
  }));

  jest.doMock('@tradejs/node/connectors', () => ({
    DEFAULT_CONNECTOR_NAME: 'bybit',
    getConnectorCreatorByName: jest.fn(async () => async () => connector),
    resolveConnectorName: jest.fn(async () => 'bybit'),
  }));

  jest.doMock('@tradejs/connectors', () => ({
    ConnectorNames: {
      Binance: 'Binance',
      Coinbase: 'Coinbase',
    },
  }));

  jest.doMock('@tradejs/node/cli', () => ({
    getTickers,
    loadTradejsConfig,
    update,
    makeScreenshots,
    sendToTG,
  }));

  jest.doMock('@tradejs/core/async', () => ({
    runWithConcurrency,
  }));

  jest.doMock('@tradejs/node/strategies', () => ({
    getStrategyCreator,
  }));

  jest.doMock('@tradejs/core/time', () => ({
    getTimestamp,
  }));

  jest.doMock('@tradejs/infra/logger', () => ({
    logger,
  }));

  jest.doMock('@tradejs/infra/redis', () => ({
    getData,
    getKeys,
    redisKeys,
    setData,
  }));

  const prevNodeEnv = process.env.NODE_ENV;
  (process.env as any).NODE_ENV = 'test';
  const signalsScriptModule = await import('../scripts/signals');
  (process.env as any).NODE_ENV = prevNodeEnv;

  return {
    signals: signalsScriptModule.signals,
    mocks: {
      connector,
      getData,
      getKeys,
      getStrategyCreator,
      getTickers,
      logger,
      loadTradejsConfig,
      makeScreenshots,
      progressTick,
      redisKeys,
      runWithConcurrency,
      sendToTG,
      setData,
      strategyCreatorMap,
      strategyFnMap,
      update,
    },
  };
};

describe('signals script', () => {
  const exitSpy = jest
    .spyOn(process, 'exit')
    .mockImplementation((() => undefined) as any);
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    exitSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('re-evaluates symbol even when previous signal keys exist', async () => {
    const { signals, mocks } = await loadScript({
      flags: {
        timeframe: 15,
        makeOrders: false,
        notify: false,
        skipScreenshots: true,
        updateOnly: false,
        cacheOnly: true,
        showTickersList: false,
        showSkipStats: false,
        user: 'root',
        connector: 'bybit',
      },
      existingSignalKeys: ['signals:ETHUSDT:old-signal'],
    });

    await signals();

    expect(mocks.getStrategyCreator).toHaveBeenCalledWith(
      'TrendLine',
      expect.any(String),
    );
    expect(mocks.strategyCreatorMap.get('TrendLine')).toHaveBeenCalledTimes(1);
    expect(mocks.strategyFnMap.get('TrendLine')).toHaveBeenCalledTimes(1);
    expect(mocks.setData).toHaveBeenCalledWith(
      mocks.redisKeys.signal('ETHUSDT', 'TrendLine-sig'),
      expect.objectContaining({
        signalId: 'TrendLine-sig',
        symbol: 'ETHUSDT',
      }),
      { expire: expect.any(Number) },
    );
    expect(mocks.setData).toHaveBeenCalledWith(
      mocks.redisKeys.storeSignal('ETHUSDT', 'TrendLine-sig'),
      expect.objectContaining({
        signalId: 'TrendLine-sig',
        symbol: 'ETHUSDT',
      }),
      { expire: expect.any(Number) },
    );
    expect(mocks.setData).toHaveBeenCalledWith(
      mocks.redisKeys.runtimeSignal('root', 'TrendLine-sig'),
      expect.objectContaining({
        signalId: 'TrendLine-sig',
        symbol: 'ETHUSDT',
      }),
      { expire: TTL_1M },
    );
    expect(mocks.setData).toHaveBeenCalledWith(
      mocks.redisKeys.runtimeSignalEvaluation('root', 'TrendLine:ETHUSDT:2000'),
      expect.objectContaining({
        evaluationId: 'TrendLine:ETHUSDT:2000',
        strategy: 'TrendLine',
        symbol: 'ETHUSDT',
        timestamp: 2000,
        status: 'signal',
        signalId: 'TrendLine-sig',
        direction: 'LONG',
      }),
      { expire: TTL_1M },
    );
    expect(mocks.getKeys).not.toHaveBeenCalledWith(
      mocks.redisKeys.signalsBySymbol('ETHUSDT'),
    );
  });

  it('snapshots AI and ML gate payloads in runtime signal evaluations', async () => {
    const aiAnalysis = {
      direction: null,
      quality: 3,
      comment: 'reject',
    };
    const ml = {
      probability: 0.42,
      threshold: 0.5,
      passed: false,
    };
    const { signals, mocks } = await loadScript({
      flags: {
        timeframe: 15,
        makeOrders: true,
        notify: false,
        skipScreenshots: true,
        updateOnly: false,
        cacheOnly: true,
        showTickersList: false,
        showSkipStats: false,
        user: 'root',
        connector: 'bybit',
      },
      strategyResult: {
        signalId: 'TrendLine-sig',
        strategy: 'TrendLine',
        symbol: 'ETHUSDT',
        interval: '15',
        direction: 'LONG',
        timestamp: 2000,
        orderStatus: 'skipped',
        orderSkipReason: 'AI_QUALITY_BELOW_MIN (0 < 4)',
        aiAnalysis,
        ml,
        prices: { currentPrice: 11 },
        figures: {},
        indicators: {},
        additionalIndicators: {},
      },
    });

    await signals();

    expect(mocks.setData).toHaveBeenCalledWith(
      mocks.redisKeys.runtimeSignalEvaluation('root', 'TrendLine:ETHUSDT:2000'),
      expect.objectContaining({
        evaluationId: 'TrendLine:ETHUSDT:2000',
        status: 'signal',
        orderStatus: 'skipped',
        orderSkipReason: 'AI_QUALITY_BELOW_MIN (0 < 4)',
        aiAnalysis,
        ml,
      }),
      { expire: TTL_1M },
    );
  });

  it('logs aggregated skip stats when enabled', async () => {
    const { signals, mocks } = await loadScript({
      flags: {
        timeframe: 15,
        makeOrders: false,
        notify: false,
        skipScreenshots: true,
        updateOnly: false,
        cacheOnly: true,
        showTickersList: false,
        showSkipStats: true,
        user: 'root',
        connector: 'bybit',
      },
      strategyResult: 'TRENDLINE_TIMING:WAIT_RETEST',
    });

    await signals();

    expect(mocks.logger.info).toHaveBeenCalledWith('skip stats:');
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'TrendLine: evaluated=1, signals=0',
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      '  skip from core / TRENDLINE_TIMING:WAIT_RETEST: 1',
    );
    expect(mocks.setData).toHaveBeenCalledWith(
      mocks.redisKeys.runtimeSignalEvaluation('root', 'TrendLine:ETHUSDT:2000'),
      expect.objectContaining({
        evaluationId: 'TrendLine:ETHUSDT:2000',
        strategy: 'TrendLine',
        symbol: 'ETHUSDT',
        timestamp: 2000,
        status: 'skip',
        reason: 'TRENDLINE_TIMING:WAIT_RETEST',
      }),
      { expire: TTL_1M },
    );
  });

  it('logs gate skip stats for skipped signals by source', async () => {
    const { signals, mocks } = await loadScript({
      flags: {
        timeframe: 15,
        makeOrders: true,
        notify: false,
        skipScreenshots: true,
        updateOnly: false,
        cacheOnly: true,
        showTickersList: false,
        showSkipStats: true,
        user: 'root',
        connector: 'bybit',
      },
      strategyResult: {
        signalId: 'TrendLine-sig',
        strategy: 'TrendLine',
        symbol: 'ETHUSDT',
        interval: '15',
        direction: 'LONG',
        timestamp: 2000,
        orderStatus: 'skipped',
        orderSkipReason: 'AI_QUALITY_BELOW_MIN (2 < 3)',
        prices: { currentPrice: 11 },
        figures: {},
        indicators: {},
        additionalIndicators: {},
      },
    });

    await signals();

    expect(mocks.logger.info).toHaveBeenCalledWith(
      'TrendLine: evaluated=1, signals=1',
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      '  skip from AI / MIN_AI_QUALITY: 1',
    );
  });

  it('logs ML unavailable skip stats by source', async () => {
    const { signals, mocks } = await loadScript({
      flags: {
        timeframe: 15,
        makeOrders: true,
        notify: false,
        skipScreenshots: true,
        updateOnly: false,
        cacheOnly: true,
        showTickersList: false,
        showSkipStats: true,
        user: 'root',
        connector: 'bybit',
      },
      strategyResult: {
        signalId: 'TrendLine-sig',
        strategy: 'TrendLine',
        symbol: 'ETHUSDT',
        interval: '15',
        direction: 'LONG',
        timestamp: 2000,
        orderStatus: 'skipped',
        orderSkipReason: 'ML_RESULT_UNAVAILABLE',
        prices: { currentPrice: 11 },
        figures: {},
        indicators: {},
        additionalIndicators: {},
      },
    });

    await signals();

    expect(mocks.logger.info).toHaveBeenCalledWith(
      'TrendLine: evaluated=1, signals=1',
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      '  skip from ML / RESULT_UNAVAILABLE: 1',
    );
  });

  it('collects signals from multiple strategies for the same symbol', async () => {
    const { signals, mocks } = await loadScript({
      flags: {
        timeframe: 15,
        makeOrders: false,
        notify: false,
        skipScreenshots: true,
        updateOnly: false,
        cacheOnly: true,
        showTickersList: false,
        showSkipStats: false,
        user: 'root',
        connector: 'bybit',
      },
      strategyConfigs: [
        {
          strategyName: 'ReverseTrendLine',
          result: {
            signalId: 'rev-sig',
            strategy: 'ReverseTrendLine',
            symbol: 'ETHUSDT',
            interval: '15',
            direction: 'SHORT',
            timestamp: 2000,
            prices: { currentPrice: 11 },
            figures: {},
            indicators: {},
            additionalIndicators: {},
          },
        },
        {
          strategyName: 'TrendLine',
          result: {
            signalId: 'trend-sig',
            strategy: 'TrendLine',
            symbol: 'ETHUSDT',
            interval: '15',
            direction: 'LONG',
            timestamp: 2000,
            prices: { currentPrice: 11 },
            figures: {},
            indicators: {},
            additionalIndicators: {},
          },
        },
      ],
    });

    await signals();

    expect(mocks.strategyFnMap.get('ReverseTrendLine')).toHaveBeenCalledTimes(
      1,
    );
    expect(mocks.strategyFnMap.get('TrendLine')).toHaveBeenCalledTimes(1);
    expect(mocks.setData).toHaveBeenCalledWith(
      mocks.redisKeys.signal('ETHUSDT', 'rev-sig'),
      expect.objectContaining({ signalId: 'rev-sig' }),
      { expire: expect.any(Number) },
    );
    expect(mocks.setData).toHaveBeenCalledWith(
      mocks.redisKeys.signal('ETHUSDT', 'trend-sig'),
      expect.objectContaining({ signalId: 'trend-sig' }),
      { expire: expect.any(Number) },
    );
    expect(mocks.setData).toHaveBeenCalledWith(
      mocks.redisKeys.runtimeSignal('root', 'rev-sig'),
      expect.objectContaining({ signalId: 'rev-sig' }),
      { expire: TTL_1M },
    );
    expect(mocks.setData).toHaveBeenCalledWith(
      mocks.redisKeys.runtimeSignal('root', 'trend-sig'),
      expect.objectContaining({ signalId: 'trend-sig' }),
      { expire: TTL_1M },
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'Signal found %s by strategy %s',
      'ETHUSDT',
      'ReverseTrendLine',
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'Signal found %s by strategy %s',
      'ETHUSDT',
      'TrendLine',
    );
  });

  it('aborts ticker evaluation when beforeSignals hook requests it', async () => {
    const beforeSignals = jest.fn(async () => ({
      abort: true,
      reason: 'GLOBAL_UNREALIZED_PNL_TARGET_REACHED_CLOSE_ALL',
    }));
    const afterSignals = jest.fn(async () => {});
    const { signals, mocks } = await loadScript({
      flags: {
        timeframe: 15,
        makeOrders: false,
        notify: false,
        skipScreenshots: true,
        updateOnly: false,
        cacheOnly: true,
        showTickersList: false,
        showSkipStats: false,
        user: 'root',
        connector: 'bybit',
      },
      projectHooks: {
        beforeSignals,
        afterSignals,
      },
    });

    await signals();

    expect(beforeSignals).toHaveBeenCalledTimes(1);
    expect(mocks.strategyCreatorMap.get('TrendLine')).toHaveBeenCalledTimes(0);
    expect(mocks.strategyFnMap.get('TrendLine')).toHaveBeenCalledTimes(0);
    expect(mocks.progressTick).not.toHaveBeenCalled();
    expect(mocks.setData).not.toHaveBeenCalled();
    expect(afterSignals).toHaveBeenCalledTimes(1);
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'signals aborted before ticker evaluation: %s',
      'GLOBAL_UNREALIZED_PNL_TARGET_REACHED_CLOSE_ALL',
    );
  });
});
