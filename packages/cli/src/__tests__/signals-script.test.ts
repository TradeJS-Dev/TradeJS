export {};

const TTL_10D = 864_000;

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
  parallel?: number | string;
  chunk?: string;
  user: string;
  connector: string;
};

type Scenario = {
  flags: ScriptFlags;
  derivativesContextEnabled?: boolean;
  binanceMarketContextBackfillEnabled?: boolean;
  includeOpenCandle?: boolean;
  strategyConfig?: Record<string, unknown>;
  strategyResult?: unknown;
  projectHooks?: {
    beforeSignals?: (...args: any[]) => unknown;
    afterSignals?: (...args: any[]) => unknown;
  };
  strategyConfigs?: Array<{
    strategyName: string;
    config?: Record<string, unknown>;
    result?: unknown;
    runtimeCloseEvents?: unknown[];
  }>;
};

const INTERVAL_MS = 15 * 60_000;
const CURRENT_OPEN_TS = 1_700_000_100_000;
const CURRENT_TS = CURRENT_OPEN_TS + 60_000;
const CLOSED_1_TS = CURRENT_OPEN_TS - 2 * INTERVAL_MS;
const CLOSED_2_TS = CURRENT_OPEN_TS - INTERVAL_MS;
const PRELOAD_TS = CURRENT_TS - 7 * 24 * 60 * 60 * 1000;

const makeRedisKeys = () => ({
  strategies: (userName: string) => `users:${userName}:strategies`,
  storeSignal: (symbol: string, signalId: string) =>
    `store:signals:${symbol}:${signalId}`,
  runtimeSignalBucket: (
    userName: string,
    dayKey: string,
    strategyName: string,
  ) => `users:${userName}:runtime:signals:days:${dayKey}:${strategyName}`,
  runtimeSignalEvaluationBucket: (
    userName: string,
    dayKey: string,
    strategyName: string,
  ) =>
    `users:${userName}:runtime:signal-evaluations:days:${dayKey}:${strategyName}`,
  runtimeSignalEvaluationStatsBucket: (
    userName: string,
    dayKey: string,
    strategyName: string,
  ) =>
    `users:${userName}:runtime:signal-evaluation-stats:days:${dayKey}:${strategyName}`,
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
  const setHashJsonField = jest.fn(async () => null);
  const incrHashFields = jest.fn(async () => null);
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const connector = {
    kline: jest.fn(async ({ symbol }: { symbol: string }) => {
      const timestamps =
        scenario.includeOpenCandle === false
          ? [CLOSED_1_TS, CLOSED_2_TS]
          : [CLOSED_1_TS, CLOSED_2_TS, CURRENT_OPEN_TS];
      if (symbol === 'BTCUSDT') {
        return timestamps.map((timestamp, index) =>
          makeCandle(timestamp, 100 + index),
        );
      }
      return timestamps.map((timestamp, index) =>
        makeCandle(timestamp, 10 + index),
      );
    }),
  };
  const strategyCreatorMap = new Map<string, jest.Mock>();
  const strategyFnMap = new Map<string, jest.Mock>();

  for (const { strategyName, result, runtimeCloseEvents } of strategyEntries) {
    const strategySignal = {
      signalId: `${strategyName}-sig`,
      strategy: strategyName,
      symbol: 'ETHUSDT',
      interval: '15',
      direction: 'LONG',
      timestamp: CLOSED_2_TS,
      prices: { currentPrice: 11 },
      figures: {},
      indicators: {},
      additionalIndicators: {},
    };
    let strategyCreatorParams: any;
    const strategyFn = jest.fn(async () => {
      for (const event of runtimeCloseEvents ?? []) {
        strategyCreatorParams?.onRuntimeClose?.(event);
      }
      return result ?? strategySignal;
    });
    const strategyCreator = jest.fn(async (params: any) => {
      strategyCreatorParams = params;
      return strategyFn;
    });
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
  const sendRuntimeCloseNotificationsToTG = jest.fn(async () => null);
  const loadTradejsConfig = jest.fn(async () => ({
    hooks: scenario.projectHooks ?? {},
  }));
  const runWithConcurrency = jest.fn(
    async <T>(items: T[], _limit: number, worker: (item: T) => Promise<void>) =>
      Promise.all(items.map(worker)),
  );
  const getTimestamp = jest.fn((days?: number) =>
    typeof days === 'number' && days > 0 ? PRELOAD_TS : CURRENT_TS,
  );
  const getRuntimeStorageDayKey = jest.fn(() => '1970-01-01');
  const progressTick = jest.fn();
  const backfillDerivativesContextForSignals = jest.fn(async () => ({
    skipped: false,
    rows: 12,
    matchedSymbols: 2,
    unmatchedSymbols: 0,
    failedWindows: 0,
    skippedWindows: 0,
  }));
  const shouldBackfillDerivativesContextForSignals = jest.fn(
    ({ cacheOnly }: { cacheOnly: boolean }) =>
      !cacheOnly && Boolean(scenario.derivativesContextEnabled),
  );
  const backfillBinanceMarketContextForSignals = jest.fn(async () => ({
    skipped: false,
    tradeFlowRows: 0,
    depthRows: 0,
    breadthRows: 0,
    skippedSymbols: 0,
  }));
  const shouldBackfillBinanceMarketContextForSignals = jest.fn(
    ({ cacheOnly }: { cacheOnly: boolean }) =>
      !cacheOnly && Boolean(scenario.binanceMarketContextBackfillEnabled),
  );
  const enrichSignalWithBinanceMarketContext = jest.fn(async (params: any) => {
    params.signal.additionalIndicators = {
      ...(params.signal.additionalIndicators ?? {}),
      baseContext: {
        ...(params.signal.additionalIndicators?.baseContext ?? {}),
        relative: {
          marketReferences: {
            source: 'binance_reference_market',
            primaryReferenceSymbol: 'BTCUSDT',
          },
        },
      },
    };
    return true;
  });
  const enrichSignalWithGlobalMarketContext = jest.fn(async (params: any) => {
    params.signal.additionalIndicators = {
      ...(params.signal.additionalIndicators ?? {}),
      baseContext: {
        ...(params.signal.additionalIndicators?.baseContext ?? {}),
        relative: {
          ...(params.signal.additionalIndicators?.baseContext?.relative ?? {}),
          btcDominance: {
            source: 'coingecko_global',
            stale: false,
            btcDominancePct: 55,
            altLiquidityRegime: 'neutral',
          },
        },
      },
    };
    return true;
  });

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
    sendRuntimeCloseNotificationsToTG,
    sendToTG,
  }));

  jest.doMock('@tradejs/core/async', () => ({
    runWithConcurrency,
  }));

  jest.doMock('@tradejs/node/strategies', () => ({
    enrichSignalWithBinanceMarketContext,
    enrichSignalWithGlobalMarketContext,
    getStrategyCreator,
  }));

  jest.doMock('@tradejs/core/time', () => ({
    getTimestamp,
    getRuntimeStorageDayKey,
  }));

  jest.doMock('@tradejs/infra/logger', () => ({
    logger,
  }));

  jest.doMock('@tradejs/infra/redis', () => ({
    getData,
    getKeys,
    incrHashFields,
    redisKeys,
    setData,
    setHashJsonField,
  }));

  jest.doMock('../lib/derivativesContextBackfill', () => ({
    backfillDerivativesContextForSignals,
    shouldBackfillDerivativesContextForSignals,
  }));

  jest.doMock('../lib/binanceMarketContextBackfill', () => ({
    backfillBinanceMarketContextForSignals,
    shouldBackfillBinanceMarketContextForSignals,
  }));

  const prevNodeEnv = process.env.NODE_ENV;
  (process.env as any).NODE_ENV = 'test';
  const signalsScriptModule = await import('../scripts/signals');
  (process.env as any).NODE_ENV = prevNodeEnv;

  return {
    signals: signalsScriptModule.signals,
    mocks: {
      backfillDerivativesContextForSignals,
      backfillBinanceMarketContextForSignals,
      enrichSignalWithBinanceMarketContext,
      connector,
      getData,
      getKeys,
      getStrategyCreator,
      getTickers,
      incrHashFields,
      loadTradejsConfig,
      logger,
      makeScreenshots,
      progressTick,
      redisKeys,
      runWithConcurrency,
      sendRuntimeCloseNotificationsToTG,
      sendToTG,
      setData,
      setHashJsonField,
      shouldBackfillBinanceMarketContextForSignals,
      shouldBackfillDerivativesContextForSignals,
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

  it('stores canonical signal payload plus bucketed runtime references', async () => {
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
    });

    await signals();

    expect(mocks.strategyFnMap.get('TrendLine')).toHaveBeenCalledWith(
      expect.objectContaining({ timestamp: CLOSED_2_TS, close: 11 }),
      expect.objectContaining({ timestamp: CLOSED_2_TS, close: 101 }),
    );
    expect(mocks.setData).toHaveBeenCalledWith(
      mocks.redisKeys.storeSignal('ETHUSDT', 'TrendLine-sig'),
      expect.objectContaining({
        signalId: 'TrendLine-sig',
        symbol: 'ETHUSDT',
      }),
      { expire: TTL_10D },
    );
    expect(mocks.setHashJsonField).toHaveBeenCalledWith(
      mocks.redisKeys.runtimeSignalBucket('root', '1970-01-01', 'TrendLine'),
      'TrendLine-sig',
      {
        signalId: 'TrendLine-sig',
        symbol: 'ETHUSDT',
        strategy: 'TrendLine',
        timestamp: CLOSED_2_TS,
      },
      { expire: TTL_10D },
    );
    expect(mocks.setHashJsonField).toHaveBeenCalledWith(
      mocks.redisKeys.runtimeSignalEvaluationBucket(
        'root',
        '1970-01-01',
        'TrendLine',
      ),
      `TrendLine:ETHUSDT:${CLOSED_2_TS}`,
      expect.objectContaining({
        evaluationId: `TrendLine:ETHUSDT:${CLOSED_2_TS}`,
        strategy: 'TrendLine',
        symbol: 'ETHUSDT',
        timestamp: CLOSED_2_TS,
        status: 'signal',
        signalId: 'TrendLine-sig',
        direction: 'LONG',
      }),
      { expire: TTL_10D },
    );
    expect(mocks.incrHashFields).toHaveBeenCalledWith(
      mocks.redisKeys.runtimeSignalEvaluationStatsBucket(
        'root',
        '1970-01-01',
        'TrendLine',
      ),
      {
        evaluated: 1,
        signals: 1,
      },
      { expire: TTL_10D },
    );
  });

  it('evaluates tickers with four signal workers by default', async () => {
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
    });

    await signals();

    expect(mocks.runWithConcurrency).toHaveBeenCalledWith(
      ['ETHUSDT'],
      4,
      expect.any(Function),
    );
  });

  it('does not limit signal tickers when tickersLimit is omitted', async () => {
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
    });

    await signals();

    expect(mocks.getTickers).toHaveBeenCalledWith(
      expect.any(Object),
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });

  it('allows overriding signal worker count', async () => {
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
        parallel: 2,
        user: 'root',
        connector: 'bybit',
      },
    });

    await signals();

    expect(mocks.runWithConcurrency).toHaveBeenCalledWith(
      ['ETHUSDT'],
      2,
      expect.any(Function),
    );
  });

  it('uses the latest closed candle even when cache-only data has no forming candle', async () => {
    const { signals, mocks } = await loadScript({
      includeOpenCandle: false,
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
    });

    await signals();

    expect(mocks.strategyFnMap.get('TrendLine')).toHaveBeenCalledWith(
      expect.objectContaining({ timestamp: CLOSED_2_TS, close: 11 }),
      expect.objectContaining({ timestamp: CLOSED_2_TS, close: 101 }),
    );
  });

  it('treats strategy config with ENABLE=false as inactive for signals', async () => {
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
          strategyName: 'TrendLine',
          config: {
            INTERVAL: '15',
            ENABLE: false,
          },
        },
        {
          strategyName: 'TrendShift',
          config: {
            INTERVAL: '15',
          },
        },
      ],
    });

    await signals();

    expect(mocks.getStrategyCreator).toHaveBeenCalledTimes(1);
    expect(mocks.getStrategyCreator).toHaveBeenCalledWith(
      'TrendShift',
      expect.any(String),
    );
    expect(mocks.strategyFnMap.get('TrendLine')).not.toHaveBeenCalled();
    expect(mocks.strategyFnMap.get('TrendShift')).toHaveBeenCalled();
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'Skip inactive strategy config by ENABLE=false: %s',
      'TrendLine',
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('loaded strategies (user=root): TrendShift'),
    );
  });

  it('stores AI and ML gate metadata in evaluation buckets and stats', async () => {
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
        timestamp: CLOSED_2_TS,
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

    expect(mocks.setHashJsonField).toHaveBeenCalledWith(
      mocks.redisKeys.runtimeSignalEvaluationBucket(
        'root',
        '1970-01-01',
        'TrendLine',
      ),
      `TrendLine:ETHUSDT:${CLOSED_2_TS}`,
      expect.objectContaining({
        orderStatus: 'skipped',
        orderSkipReason: 'AI_QUALITY_BELOW_MIN (0 < 4)',
        aiAnalysis,
        ml,
      }),
      { expire: TTL_10D },
    );
    expect(mocks.incrHashFields).toHaveBeenCalledWith(
      mocks.redisKeys.runtimeSignalEvaluationStatsBucket(
        'root',
        '1970-01-01',
        'TrendLine',
      ),
      {
        evaluated: 1,
        signals: 1,
        'reason:skip from AI:MIN_AI_QUALITY': 1,
      },
      { expire: TTL_10D },
    );
  });

  it('stores routine NO_SIGNAL skips only in stats buckets', async () => {
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
      strategyResult: 'NO_SIGNAL',
    });

    await signals();

    expect(mocks.setHashJsonField).not.toHaveBeenCalled();
    expect(mocks.incrHashFields).toHaveBeenCalledWith(
      mocks.redisKeys.runtimeSignalEvaluationStatsBucket(
        'root',
        '1970-01-01',
        'TrendLine',
      ),
      {
        evaluated: 1,
        'reason:skip from core:NO_SIGNAL': 1,
      },
      { expire: TTL_10D },
    );
  });

  it('stores core skip reasons only in stats buckets', async () => {
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
      strategyResult: 'TRENDLINE_TIMING:WAIT_RETEST',
    });

    await signals();

    expect(mocks.setHashJsonField).not.toHaveBeenCalled();
    expect(mocks.incrHashFields).toHaveBeenCalledWith(
      mocks.redisKeys.runtimeSignalEvaluationStatsBucket(
        'root',
        '1970-01-01',
        'TrendLine',
      ),
      {
        evaluated: 1,
        'reason:skip from core:TRENDLINE_TIMING:WAIT_RETEST': 1,
      },
      { expire: TTL_10D },
    );
  });

  it('logs aggregated skip stats with normalized reasons', async () => {
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
      strategyConfigs: [
        {
          strategyName: 'AdaptiveMomentumRibbon',
          result: {
            signalId: 'amr-sig',
            strategy: 'AdaptiveMomentumRibbon',
            symbol: 'ETHUSDT',
            interval: '15',
            direction: 'LONG',
            timestamp: CLOSED_2_TS,
            orderStatus: 'skipped',
            orderSkipReason: 'AI_QUALITY_BELOW_MIN (2 < 3)',
            prices: { currentPrice: 11 },
            figures: {},
            indicators: {},
            additionalIndicators: {},
          },
        },
        {
          strategyName: 'TrendLine',
          result: 'TRENDLINE_TIMING:WAIT_RETEST',
        },
      ],
    });

    await signals();

    expect(mocks.logger.info).toHaveBeenCalledWith('skip stats:');
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'AdaptiveMomentumRibbon: evaluated=1, signals=1',
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      '  skip from AI / MIN_AI_QUALITY: 1',
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'TrendLine: evaluated=1, signals=0',
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      '  skip from core / TRENDLINE_TIMING:WAIT_RETEST: 1',
    );
  });

  it('builds screenshots only for Telegram-deliverable signals', async () => {
    const { signals, mocks } = await loadScript({
      flags: {
        timeframe: 15,
        makeOrders: true,
        notify: true,
        skipScreenshots: false,
        updateOnly: false,
        cacheOnly: true,
        showTickersList: false,
        showSkipStats: false,
        user: 'root',
        connector: 'bybit',
      },
      strategyConfigs: [
        {
          strategyName: 'AdaptiveMomentumRibbon',
          result: {
            signalId: 'amr-sig',
            strategy: 'AdaptiveMomentumRibbon',
            symbol: 'ETHUSDT',
            interval: '15',
            direction: 'LONG',
            timestamp: CLOSED_2_TS,
            orderStatus: 'skipped',
            orderSkipReason: 'AI_QUALITY_BELOW_MIN (2 < 3)',
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
            timestamp: CLOSED_2_TS,
            orderStatus: 'completed',
            prices: { currentPrice: 11 },
            figures: {},
            indicators: {},
            additionalIndicators: {},
          },
        },
      ],
    });

    await signals();

    expect(mocks.makeScreenshots).toHaveBeenCalledTimes(1);
    expect(mocks.makeScreenshots).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          signalId: 'trend-sig',
          orderStatus: 'completed',
        }),
      ],
      '15',
      'root',
    );
    expect(mocks.sendToTG).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          signalId: 'trend-sig',
          orderStatus: 'completed',
        }),
      ],
      '15',
      'root',
    );
  });

  it('sends runtime close notifications during the Telegram delivery stage', async () => {
    const closeEvent = {
      userName: 'root',
      strategy: 'TrendLine',
      openedByStrategy: 'TrendLine',
      symbol: 'ETHUSDT',
      direction: 'LONG',
      code: 'CLOSE_BY_SIGNAL',
      orderId: 'ord-1',
      qty: 1,
      entryPrice: 100,
      entryTimestamp: CLOSED_1_TS,
      exitPrice: 101,
      exitTimestamp: CLOSED_2_TS,
      closedPnl: 1,
      exitType: 'exit',
    };
    const { signals, mocks } = await loadScript({
      flags: {
        timeframe: 15,
        makeOrders: true,
        notify: true,
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
          strategyName: 'TrendLine',
          result: 'CLOSE_BY_SIGNAL',
          runtimeCloseEvents: [closeEvent],
        },
      ],
    });

    await signals();

    expect(mocks.strategyCreatorMap.get('TrendLine')).toHaveBeenCalledWith(
      expect.objectContaining({
        onRuntimeClose: expect.any(Function),
      }),
    );
    expect(mocks.sendToTG).toHaveBeenCalledWith([], '15', 'root');
    expect(mocks.sendRuntimeCloseNotificationsToTG).toHaveBeenCalledWith(
      [closeEvent],
      'root',
    );
    expect(mocks.sendToTG.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sendRuntimeCloseNotificationsToTG.mock.invocationCallOrder[0],
    );
  });

  it('skips screenshot generation when Telegram delivery is disabled', async () => {
    const { signals, mocks } = await loadScript({
      flags: {
        timeframe: 15,
        makeOrders: false,
        notify: false,
        skipScreenshots: false,
        updateOnly: false,
        cacheOnly: true,
        showTickersList: false,
        showSkipStats: false,
        user: 'root',
        connector: 'bybit',
      },
    });

    await signals();

    expect(mocks.makeScreenshots).not.toHaveBeenCalled();
    expect(mocks.sendToTG).not.toHaveBeenCalled();
    expect(mocks.sendRuntimeCloseNotificationsToTG).not.toHaveBeenCalled();
  });

  it('backfills derivatives context for signals and logs timings', async () => {
    const { signals, mocks } = await loadScript({
      derivativesContextEnabled: true,
      flags: {
        timeframe: 15,
        makeOrders: false,
        notify: false,
        skipScreenshots: true,
        updateOnly: true,
        cacheOnly: false,
        showTickersList: false,
        showSkipStats: false,
        user: 'root',
        connector: 'bybit',
      },
    });

    await signals();

    expect(
      mocks.shouldBackfillDerivativesContextForSignals,
    ).toHaveBeenCalledWith({
      cacheOnly: false,
    });
    expect(mocks.backfillDerivativesContextForSignals).toHaveBeenCalledWith({
      userName: 'root',
      symbols: ['ETHUSDT'],
      startMs: CURRENT_TS,
      endMs: CURRENT_TS,
      preloadStartMs: PRELOAD_TS,
    });
    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.stringMatching(/^tickers load: done in /),
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.stringMatching(/^update bybit: done in /),
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.stringMatching(/^derivatives context backfill: done in /),
    );
  });

  it('prepares Binance market context for signals before updateOnly return', async () => {
    const { signals, mocks } = await loadScript({
      binanceMarketContextBackfillEnabled: true,
      flags: {
        timeframe: 15,
        makeOrders: false,
        notify: false,
        skipScreenshots: true,
        updateOnly: true,
        cacheOnly: false,
        showTickersList: false,
        showSkipStats: false,
        user: 'root',
        connector: 'bybit',
      },
    });

    await signals();

    expect(
      mocks.shouldBackfillBinanceMarketContextForSignals,
    ).toHaveBeenCalledWith({
      cacheOnly: false,
    });
    expect(mocks.backfillBinanceMarketContextForSignals).toHaveBeenCalledWith({
      userName: 'root',
      projectRoot: expect.any(String),
      symbols: ['ETHUSDT'],
      interval: '15',
      startMs: CURRENT_TS,
      endMs: CURRENT_TS,
      preloadStartMs: PRELOAD_TS,
    });
    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.stringMatching(/^binance market context backfill: done in /),
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
    expect(mocks.setHashJsonField).not.toHaveBeenCalled();
    expect(mocks.incrHashFields).not.toHaveBeenCalled();
    expect(afterSignals).toHaveBeenCalledTimes(1);
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'signals aborted before ticker evaluation: %s',
      'GLOBAL_UNREALIZED_PNL_TARGET_REACHED_CLOSE_ALL',
    );
  });
});
