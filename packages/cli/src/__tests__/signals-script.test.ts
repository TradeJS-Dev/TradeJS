import { createSignalsStrategyLifecycle } from '../lib/signals/runtimeLifecycle';
import type { RuntimeDeployment } from '@tradejs/types';

const TTL_3D = 259_200;

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
  universe?: 'crypto' | 'tradfi';
  account?: string;
  deployment?: string;
  watch?: boolean;
};

type Scenario = {
  flags: ScriptFlags;
  deployment?: RuntimeDeployment | null;
  derivativesContextEnabled?: boolean;
  binanceMarketContextBackfillEnabled?: boolean;
  coinMarketCapContextBackfillEnabled?: boolean;
  includeOpenCandle?: boolean;
  simulateRuntimeAppend?: boolean;
  tickers?: string[];
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
  strategyResults: (userName: string, strategyName: string) =>
    `users:${userName}:strategy-results:${strategyName}`,
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
  runtimeLineageScopeBucket: (userName: string, dayKey: string) =>
    `users:${userName}:runtime:lineage-scopes:days:${dayKey}`,
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
  const getHashJsonField = jest.fn(async () => null);
  const getHashJsonValues = jest.fn(async () => []);
  const setHashJsonField = jest.fn(
    async (_key: string, _field: string, _data: unknown, _options?: unknown) =>
      null,
  );
  const setHashJsonFields = jest.fn(
    async (
      key: string,
      entries: Array<{ field: string; data: unknown }>,
      options: unknown,
    ) => {
      for (const { field, data } of entries) {
        await setHashJsonField(key, field, data, options);
      }
    },
  );
  const incrHashFields = jest.fn(async () => null);
  const releaseStrategyReplayCache = jest.fn();
  const logger = {
    info: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const listInstruments = jest.fn(
    async ({ universe }: { universe: string }) => [
      {
        provider: 'bybit',
        symbol: 'ETHUSDT',
        kind: 'perpetual',
        assetClass: universe === 'tradfi' ? 'equity' : 'crypto',
        universe,
        status: 'trading',
      },
    ],
  );
  let cycleTimestampOffset = 0;
  const connector = {
    kline: jest.fn(async ({ symbol }: { symbol: string }) => {
      const timestamps =
        scenario.includeOpenCandle === false
          ? [
              CLOSED_1_TS + cycleTimestampOffset,
              CLOSED_2_TS + cycleTimestampOffset,
            ]
          : [
              CLOSED_1_TS + cycleTimestampOffset,
              CLOSED_2_TS + cycleTimestampOffset,
              CURRENT_OPEN_TS + cycleTimestampOffset,
            ];
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
  const connectorCreator = jest.fn(async (config: Record<string, unknown>) => ({
    ...connector,
    capabilities: {
      supportedUniverses: ['crypto', 'tradfi'],
      defaultUniverse: 'crypto',
    },
    universe: config.universe ?? 'crypto',
    accountId: config.accountId,
    deploymentId: config.deploymentId,
    listInstruments,
  }));
  const getRuntimeDeployment = jest.fn(async () => scenario.deployment ?? null);
  const saveRuntimeDeploymentHeartbeat = jest.fn(async () => undefined);
  const strategyCreatorMap = new Map<string, jest.Mock>();
  const strategyFnMap = new Map<string, jest.Mock>();
  const strategyHistoryLengths = new Map<
    string,
    Array<{ data: number; btcData: number; ethData: number }>
  >();

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
    const strategyFn = jest.fn(
      async (candle: any, btcCandle: any, ethCandle: any) => {
        const historyLengths = strategyHistoryLengths.get(strategyName) ?? [];
        historyLengths.push({
          data: strategyCreatorParams?.data?.length ?? 0,
          btcData: strategyCreatorParams?.btcData?.length ?? 0,
          ethData: strategyCreatorParams?.ethData?.length ?? 0,
        });
        strategyHistoryLengths.set(strategyName, historyLengths);
        if (scenario.simulateRuntimeAppend) {
          strategyCreatorParams?.data?.push(candle);
          strategyCreatorParams?.btcData?.push(btcCandle);
          strategyCreatorParams?.ethData?.push(ethCandle);
        }
        for (const event of runtimeCloseEvents ?? []) {
          strategyCreatorParams?.onRuntimeClose?.(event);
        }
        return result ?? strategySignal;
      },
    );
    const strategyCreator = jest.fn(async (params: any) => {
      strategyCreatorParams = params;
      return strategyFn;
    });
    strategyFnMap.set(strategyName, strategyFn);
    strategyCreatorMap.set(strategyName, strategyCreator);
  }

  const getStrategyCreator = jest.fn(
    async (strategyName: string, _projectRoot?: string) =>
      strategyCreatorMap.get(strategyName),
  );
  const getTickers = jest.fn(async () => scenario.tickers ?? ['ETHUSDT']);
  const update = jest.fn(async () => null);
  const makeScreenshots = jest.fn(async () => null);
  const sendToTG = jest.fn(async () => null);
  const sendTextToTG = jest.fn(async () => null);
  const sendRuntimeCloseNotificationsToTG = jest.fn(async () => null);
  const loadTradejsConfig = jest.fn(async () => ({
    hooks: scenario.projectHooks ?? {},
  }));
  const runWithConcurrency = jest.fn(
    async <T>(
      items: T[],
      limit: number,
      worker: (item: T) => Promise<void>,
    ) => {
      if (limit === 1) {
        for (const item of items) {
          await worker(item);
        }
        return;
      }
      await Promise.all(items.map(worker));
    },
  );
  const getTimestamp = jest.fn((days?: number) =>
    typeof days === 'number' && days > 0
      ? PRELOAD_TS + cycleTimestampOffset
      : CURRENT_TS + cycleTimestampOffset,
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
  const backfillCoinMarketCapContextForSignals = jest.fn(async () => ({
    globalRows: 1,
    referenceRows: 2,
    exchangeLiquidityRows: 1,
    fearGreedRows: 1,
  }));
  const shouldBackfillCoinMarketCapContextForSignals = jest.fn(
    ({ cacheOnly }: { cacheOnly: boolean }) =>
      !cacheOnly && Boolean(scenario.coinMarketCapContextBackfillEnabled),
  );
  const enrichSignalWithBinanceMarketContext = jest.fn(async (params: any) => {
    params.signal.additionalIndicators = {
      ...(params.signal.additionalIndicators ?? {}),
      baseContext: {
        ...(params.signal.additionalIndicators?.baseContext ?? {}),
        relative: {
          referenceTradeFlow: {
            source: 'binance_reference_market',
            primaryReferenceSymbol: 'BTCUSDT',
          },
        },
      },
    };
    return true;
  });
  const enrichSignalWithCoinMarketCapContext = jest.fn(async (params: any) => {
    params.signal.additionalIndicators = {
      ...(params.signal.additionalIndicators ?? {}),
      baseContext: {
        ...(params.signal.additionalIndicators?.baseContext ?? {}),
        relative: {
          ...(params.signal.additionalIndicators?.baseContext?.relative ?? {}),
          cmcGlobal: {
            source: 'coinmarketcap_global',
            interval: '1d',
            asOfTs: params.signal.timestamp,
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
    getConnectorCreatorByName: jest.fn(async () => connectorCreator),
    resolveConnectorName: jest.fn(async () => 'bybit'),
  }));

  jest.doMock('@tradejs/infra/tradingAccounts', () => ({
    resolveTradingAccount: jest.fn(
      async ({ accountId }: { accountId?: string }) =>
        accountId ? { id: accountId } : null,
    ),
  }));
  jest.doMock('@tradejs/infra/runtimeDeployments', () => ({
    getRuntimeDeployment,
    saveRuntimeDeploymentHeartbeat,
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
    sendTextToTG,
    sendToTG,
  }));

  jest.doMock('@tradejs/core/async', () => ({
    runWithConcurrency,
  }));

  jest.doMock('@tradejs/core/strategies', () => ({
    releaseStrategyReplayCache,
  }));

  jest.doMock('@tradejs/node/strategies', () => ({
    enrichSignalWithBinanceMarketContext,
    enrichSignalWithCoinMarketCapContext,
    getStrategyCreator,
  }));

  jest.doMock('@tradejs/node/runtimeStrategies', () => ({
    loadResolvedRuntimeStrategies: jest.fn(
      async ({
        deployment,
        projectRoot,
      }: {
        deployment?: RuntimeDeployment | null;
        projectRoot: string;
      }) => {
        const resolved = await Promise.all(
          strategyEntries.map(async ({ strategyName }) => {
            const strategyConfig = await getData(
              `users:root:strategies:${strategyName}:config`,
              { INTERVAL: '15' },
            );
            if (strategyConfig.ENABLE === false) {
              logger.info(
                'Skip inactive strategy config by ENABLE=false: %s',
                strategyName,
              );
              return null;
            }
            return {
              strategyName,
              configId: 'config',
              controlState: 'active',
              interval: String(
                strategyConfig.INTERVAL ?? deployment?.interval ?? '15',
              ),
              universe:
                strategyConfig.UNIVERSE ?? deployment?.universe ?? 'crypto',
              accountId:
                deployment?.accountId ?? strategyConfig.ACCOUNT_ID ?? undefined,
              strategyCreator: await getStrategyCreator(
                strategyName,
                projectRoot,
              ),
              sourceStrategyConfig: strategyConfig,
              strategyConfig,
              strategyResults: {},
            };
          }),
        );
        return resolved.filter(Boolean);
      },
    ),
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
    getHashJsonField,
    getHashJsonValues,
    incrHashFields,
    redisKeys,
    setData,
    setHashJsonField,
    setHashJsonFields,
  }));

  jest.doMock('@tradejs/infra/timescale/marketContext', () => ({
    ...jest.requireActual('@tradejs/infra/timescale/marketContext'),
    ensureMarketContextSchemas: jest.fn(async () => undefined),
  }));

  jest.doMock('../lib/derivativesContextBackfill', () => ({
    backfillDerivativesContextForSignals,
    shouldBackfillDerivativesContextForSignals,
  }));

  jest.doMock('../lib/binanceMarketContextBackfill', () => ({
    backfillBinanceMarketContextForBacktest: jest.fn(),
    backfillBinanceMarketContextForReplay: jest.fn(),
    backfillBinanceMarketContextForSignals,
    shouldBackfillBinanceMarketContextForBacktest: jest.fn(() => false),
    shouldBackfillBinanceMarketContextForReplay: jest.fn(() => false),
    shouldBackfillBinanceMarketContextForSignals,
  }));

  jest.doMock('../lib/coinMarketCapContextBackfill', () => ({
    backfillCoinMarketCapContextForBacktest: jest.fn(),
    backfillCoinMarketCapContextForReplay: jest.fn(),
    backfillCoinMarketCapContextForSignals,
    shouldBackfillCoinMarketCapContextForBacktest: jest.fn(() => false),
    shouldBackfillCoinMarketCapContextForReplay: jest.fn(() => false),
    shouldBackfillCoinMarketCapContextForSignals,
  }));

  const prevNodeEnv = process.env.NODE_ENV;
  (process.env as any).NODE_ENV = 'test';
  const signalsScriptModule = await import('../scripts/signals');
  (process.env as any).NODE_ENV = prevNodeEnv;

  return {
    createSignalsSession: signalsScriptModule.createSignalsSession,
    signals: signalsScriptModule.signals,
    signalsConfiguredScopesOnce:
      signalsScriptModule.signalsConfiguredScopesOnce,
    mocks: {
      backfillDerivativesContextForSignals,
      backfillBinanceMarketContextForSignals,
      backfillCoinMarketCapContextForSignals,
      enrichSignalWithBinanceMarketContext,
      connector,
      connectorCreator,
      getRuntimeDeployment,
      getData,
      getKeys,
      getHashJsonValues,
      getTimestamp,
      getStrategyCreator,
      getTickers,
      incrHashFields,
      loadTradejsConfig,
      logger,
      listInstruments,
      makeScreenshots,
      progressTick,
      releaseStrategyReplayCache,
      redisKeys,
      runWithConcurrency,
      sendRuntimeCloseNotificationsToTG,
      sendTextToTG,
      sendToTG,
      saveRuntimeDeploymentHeartbeat,
      setData,
      setHashJsonField,
      setHashJsonFields,
      shouldBackfillBinanceMarketContextForSignals,
      shouldBackfillCoinMarketCapContextForSignals,
      shouldBackfillDerivativesContextForSignals,
      strategyCreatorMap,
      strategyConfigMap,
      strategyFnMap,
      strategyHistoryLengths,
      advanceCycle: () => {
        cycleTimestampOffset += INTERVAL_MS;
      },
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
    delete process.env.RUNTIME_SIGNAL_RETENTION_DAYS;
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
      expect.objectContaining({ timestamp: CLOSED_2_TS, close: 11 }),
    );
    expect(mocks.setData).toHaveBeenCalledWith(
      mocks.redisKeys.storeSignal('ETHUSDT', 'TrendLine-sig'),
      expect.objectContaining({
        signalId: 'TrendLine-sig',
        symbol: 'ETHUSDT',
      }),
      { expire: TTL_3D },
    );
    const storedSignal = (mocks.setData.mock.calls as unknown[][]).find(
      ([key]) =>
        key === mocks.redisKeys.storeSignal('ETHUSDT', 'TrendLine-sig'),
    )?.[1];
    expect(storedSignal).not.toHaveProperty('figures');
    expect(storedSignal).not.toHaveProperty('indicators');
    expect(storedSignal).not.toHaveProperty('additionalIndicators');
    expect(mocks.setHashJsonField).toHaveBeenCalledWith(
      mocks.redisKeys.runtimeSignalBucket('root', '1970-01-01', 'TrendLine'),
      'TrendLine-sig',
      {
        signalId: 'TrendLine-sig',
        symbol: 'ETHUSDT',
        strategy: 'TrendLine',
        timestamp: CLOSED_2_TS,
      },
      { expire: TTL_3D },
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
      { expire: TTL_3D },
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
      { expire: TTL_3D },
    );
  });

  it('uses configured runtime signal retention ttl for signal storage', async () => {
    process.env.RUNTIME_SIGNAL_RETENTION_DAYS = '1';
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

    expect(mocks.setData).toHaveBeenCalledWith(
      mocks.redisKeys.storeSignal('ETHUSDT', 'TrendLine-sig'),
      expect.objectContaining({ signalId: 'TrendLine-sig' }),
      { expire: 86_400 },
    );
    expect(mocks.setHashJsonField).toHaveBeenCalledWith(
      mocks.redisKeys.runtimeSignalBucket('root', '1970-01-01', 'TrendLine'),
      'TrendLine-sig',
      expect.objectContaining({ signalId: 'TrendLine-sig' }),
      { expire: 86_400 },
    );
    expect(mocks.incrHashFields).toHaveBeenCalledWith(
      mocks.redisKeys.runtimeSignalEvaluationStatsBucket(
        'root',
        '1970-01-01',
        'TrendLine',
      ),
      expect.objectContaining({ evaluated: 1, signals: 1 }),
      { expire: 86_400 },
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
      expect.objectContaining({ timestamp: CLOSED_2_TS, close: 11 }),
    );
  });

  it('initializes strategy state from previous closed candles before evaluating the latest closed candle', async () => {
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

    expect(mocks.strategyCreatorMap.get('TrendLine')).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [makeCandle(CLOSED_1_TS, 10)],
        btcData: [makeCandle(CLOSED_1_TS, 100)],
      }),
    );
    expect(
      mocks.strategyCreatorMap.get('TrendLine')?.mock.calls[0]?.[0],
    ).not.toHaveProperty('sharedStrategyStateKey');
    expect(mocks.strategyFnMap.get('TrendLine')).toHaveBeenCalledWith(
      expect.objectContaining({ timestamp: CLOSED_2_TS, close: 11 }),
      expect.objectContaining({ timestamp: CLOSED_2_TS, close: 101 }),
      expect.objectContaining({ timestamp: CLOSED_2_TS, close: 11 }),
    );
  });

  it('passes runtime lineage into the strategy before evaluating the signal', async () => {
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
    });

    await signals();

    const creatorParams =
      mocks.strategyCreatorMap.get('TrendLine')?.mock.calls[0]?.[0];
    expect(creatorParams).toEqual(
      expect.objectContaining({
        runtimeLineage: expect.objectContaining({
          schemaVersion: 1,
          gateFingerprint: expect.any(String),
          configFingerprint: expect.any(String),
          contextFingerprint: expect.any(String),
        }),
      }),
    );
  });

  it('loads primary BTC/ETH history once per cycle and reuses warmup arrays across strategies', async () => {
    const { signals, mocks } = await loadScript({
      tickers: ['SOLUSDT', 'XRPUSDT'],
      flags: {
        timeframe: 15,
        parallel: 1,
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
        { strategyName: 'TrendLine' },
        { strategyName: 'TrendShift' },
      ],
      simulateRuntimeAppend: true,
    });

    await signals();

    const loadedSymbols = (
      mocks.connector.kline.mock.calls as Array<[{ symbol: string }]>
    ).map(([params]) => params.symbol);
    expect(loadedSymbols.filter((symbol) => symbol === 'BTCUSDT')).toHaveLength(
      3,
    );
    expect(loadedSymbols.filter((symbol) => symbol === 'ETHUSDT')).toHaveLength(
      1,
    );
    expect(loadedSymbols.filter((symbol) => symbol === 'SOLUSDT')).toHaveLength(
      1,
    );
    expect(loadedSymbols.filter((symbol) => symbol === 'XRPUSDT')).toHaveLength(
      1,
    );

    const trendLineParams =
      mocks.strategyCreatorMap.get('TrendLine')?.mock.calls[0]?.[0];
    const trendShiftParams =
      mocks.strategyCreatorMap.get('TrendShift')?.mock.calls[0]?.[0];
    expect(trendLineParams.data).toBe(trendShiftParams.data);
    expect(trendLineParams.btcData).toBe(trendShiftParams.btcData);
    expect(trendLineParams.ethData).toBe(trendShiftParams.ethData);
    expect(mocks.strategyHistoryLengths.get('TrendLine')?.[0]).toEqual({
      data: 1,
      btcData: 1,
      ethData: 1,
    });
    expect(mocks.strategyHistoryLengths.get('TrendShift')?.[0]).toEqual({
      data: 1,
      btcData: 1,
      ethData: 1,
    });
    expect(trendLineParams.data).toEqual([makeCandle(CLOSED_1_TS, 10)]);
    expect(trendLineParams.btcData).toEqual([makeCandle(CLOSED_1_TS, 100)]);
  });

  it('uses one config snapshot per cycle and applies changes on the next candle', async () => {
    const { createSignalsSession, signals, mocks } = await loadScript({
      tickers: ['SOLUSDT', 'XRPUSDT'],
      strategyConfig: { INTERVAL: '15', CUSTOM_THRESHOLD: 1 },
      deployment: {
        id: 'crypto-live',
        label: 'Crypto live',
        connectorName: 'bybit',
        provider: 'bybit',
        accountId: 'crypto-main',
        universe: 'crypto',
        interval: '15',
        enabled: true,
        tickers: ['SOLUSDT', 'XRPUSDT'],
        strategies: [
          {
            strategyName: 'TrendLine',
            policyProfileId: 'default',
            enabled: true,
            config: { CUSTOM_THRESHOLD: 99 },
          },
        ],
      },
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
        deployment: 'crypto-live',
      },
    });
    const lifecycle = createSignalsStrategyLifecycle({
      intervalMs: INTERVAL_MS,
      maxLiveBars: 100,
      releaseState: mocks.releaseStrategyReplayCache,
    });
    const session = await createSignalsSession(lifecycle);

    await signals({ session });

    const strategyConfigKey = 'users:root:strategies:TrendLine:config';
    expect(
      mocks.getData.mock.calls.filter(([key]) => key === strategyConfigKey),
    ).toHaveLength(1);
    for (const [params] of mocks.strategyCreatorMap.get('TrendLine')!.mock
      .calls) {
      expect(params.runtimeConfigSnapshot.userConfig).toEqual({
        INTERVAL: '15',
        CUSTOM_THRESHOLD: 1,
      });
    }

    mocks.strategyConfigMap.set(strategyConfigKey, {
      INTERVAL: '15',
      CUSTOM_THRESHOLD: 2,
    });
    mocks.advanceCycle();
    await signals({ session });

    expect(mocks.strategyCreatorMap.get('TrendLine')).toHaveBeenLastCalledWith(
      expect.objectContaining({
        runtimeConfigSnapshot: {
          userConfig: {
            INTERVAL: '15',
            CUSTOM_THRESHOLD: 2,
          },
          symbolResultConfig: null,
        },
        config: expect.objectContaining({ CUSTOM_THRESHOLD: 2 }),
      }),
    );
    expect(
      mocks.strategyCreatorMap.get('TrendLine')!.mock.calls.at(-1)?.[0].config,
    ).not.toEqual(expect.objectContaining({ CUSTOM_THRESHOLD: 99 }));
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'Rebuilt signals strategy state (%s): %s %s',
      'config',
      'TrendLine',
      expect.any(String),
    );
  });

  it('reuses session state and skips duplicate candle evaluation', async () => {
    const { createSignalsSession, signals, mocks } = await loadScript({
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
    const lifecycle = createSignalsStrategyLifecycle({
      intervalMs: INTERVAL_MS,
      maxLiveBars: 100,
    });
    const session = await createSignalsSession(lifecycle);

    await signals({ session });
    await signals({ session });

    expect(mocks.strategyCreatorMap.get('TrendLine')).toHaveBeenCalledTimes(1);
    expect(mocks.strategyFnMap.get('TrendLine')).toHaveBeenCalledTimes(1);
    expect(mocks.setData).toHaveBeenCalledTimes(1);
  });

  it('binds a TradFi daemon session to its deployment and account', async () => {
    const runtimeDeployment: RuntimeDeployment = {
      id: 'tradfi-live',
      label: 'TradFi Live',
      connectorName: 'bybit',
      provider: 'bybit',
      accountId: 'tradfi-main',
      universe: 'tradfi',
      interval: '15',
      enabled: true,
      tickers: ['ETHUSDT'],
      assetClasses: ['equity'],
      strategies: [
        {
          strategyName: 'TrendLine',
          policyProfileId: 'tradfi',
          enabled: true,
          config: { DEPLOYMENT_ONLY: true },
        },
      ],
    };
    const { createSignalsSession, signals, mocks } = await loadScript({
      deployment: runtimeDeployment,
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
        deployment: 'tradfi-live',
      },
    });
    const lifecycle = createSignalsStrategyLifecycle({
      intervalMs: INTERVAL_MS,
      maxLiveBars: 100,
    });

    const session = await createSignalsSession(lifecycle);
    await signals({ session });

    expect(mocks.getRuntimeDeployment).toHaveBeenCalledWith(
      'root',
      'tradfi-live',
    );
    expect(mocks.connectorCreator).toHaveBeenCalledWith({
      userName: 'root',
      universe: 'tradfi',
      accountId: 'tradfi-main',
      deploymentId: 'tradfi-live',
    });
    expect(mocks.getTickers).toHaveBeenCalledWith(
      expect.any(Object),
      'ETHUSDT',
      undefined,
      undefined,
      undefined,
      { universe: 'tradfi', assetClasses: ['equity'] },
    );
    expect(mocks.listInstruments).toHaveBeenCalledWith({
      universe: 'tradfi',
      assetClasses: ['equity'],
      symbols: ['ETHUSDT'],
    });
    expect(
      mocks.connector.kline.mock.calls.map(([params]) => params.symbol),
    ).toEqual(['ETHUSDT']);
    expect(mocks.strategyCreatorMap.get('TrendLine')).toHaveBeenCalledWith(
      expect.objectContaining({
        universe: 'tradfi',
        assetClass: 'equity',
        accountId: 'tradfi-main',
        deploymentId: 'tradfi-live',
        btcData: [],
        ethData: [],
        config: expect.objectContaining({
          INTERVAL: '15',
        }),
      }),
    );
    const strategyParams =
      mocks.strategyCreatorMap.get('TrendLine')!.mock.calls[0][0];
    expect(strategyParams.config).not.toHaveProperty('DEPLOYMENT_ONLY');
    expect(strategyParams.config).not.toHaveProperty('POLICY_PROFILE_ID');
    expect(mocks.saveRuntimeDeploymentHeartbeat).toHaveBeenCalledWith(
      'root',
      expect.objectContaining({
        deploymentId: 'tradfi-live',
        status: 'running',
      }),
    );
  });

  it('derives a versioned one-shot scope from the release config', async () => {
    const { signalsConfiguredScopesOnce, mocks } = await loadScript({
      strategyConfig: { INTERVAL: '60', UNIVERSE: 'crypto' },
      deployment: {
        id: 'doubletap-forward',
        label: 'DoubleTap forward',
        connectorName: 'bybit',
        provider: 'bybit',
        accountId: 'crypto-main',
        universe: 'tradfi',
        interval: '5',
        enabled: true,
        strategies: [
          {
            strategyName: 'TrendLine',
            releaseVersion: 2,
            controlState: 'active',
          },
        ],
      },
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
        deployment: 'doubletap-forward',
      },
    });

    await signalsConfiguredScopesOnce();

    expect(mocks.strategyCreatorMap.get('TrendLine')).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'crypto-main',
        universe: 'crypto',
        config: expect.objectContaining({ INTERVAL: '60' }),
      }),
    );
  });

  it('rejects missing and interval-mismatched deployments before connector creation', async () => {
    const missing = await loadScript({
      deployment: null,
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
        deployment: 'missing',
      },
    });
    await expect(
      missing.createSignalsSession(
        createSignalsStrategyLifecycle({
          intervalMs: INTERVAL_MS,
          maxLiveBars: 100,
        }),
      ),
    ).rejects.toThrow('Runtime deployment not found: missing');
    expect(missing.mocks.connectorCreator).not.toHaveBeenCalled();

    const mismatch = await loadScript({
      deployment: {
        id: 'tradfi-live',
        label: 'TradFi',
        connectorName: 'bybit',
        provider: 'bybit',
        accountId: 'tradfi-main',
        universe: 'tradfi',
        interval: '60',
        enabled: true,
        strategies: [],
      },
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
        deployment: 'tradfi-live',
      },
    });
    await expect(
      mismatch.createSignalsSession(
        createSignalsStrategyLifecycle({
          intervalMs: INTERVAL_MS,
          maxLiveBars: 100,
        }),
      ),
    ).rejects.toThrow('requires timeframe 60; received 15');
    expect(mismatch.mocks.connectorCreator).not.toHaveBeenCalled();
  });

  it('advances session state with a disposable runtime on the next candle', async () => {
    const { createSignalsSession, signals, mocks } = await loadScript({
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
    const lifecycle = createSignalsStrategyLifecycle({
      intervalMs: INTERVAL_MS,
      maxLiveBars: 100,
    });
    const session = await createSignalsSession(lifecycle);

    await signals({ session });
    const nextCurrentTimestamp = CURRENT_TS + INTERVAL_MS;
    mocks.getTimestamp.mockImplementation((days?: number) =>
      typeof days === 'number' && days > 0
        ? PRELOAD_TS + INTERVAL_MS
        : nextCurrentTimestamp,
    );
    mocks.connector.kline.mockImplementation(
      async ({ symbol }: { symbol: string }) => {
        const timestamps = [
          CLOSED_1_TS,
          CLOSED_2_TS,
          CURRENT_OPEN_TS,
          CURRENT_OPEN_TS + INTERVAL_MS,
        ];
        const base = symbol === 'BTCUSDT' ? 100 : 10;
        return timestamps.map((timestamp, index) =>
          makeCandle(timestamp, base + index),
        );
      },
    );

    await signals({ session });

    expect(mocks.strategyCreatorMap.get('TrendLine')).toHaveBeenCalledTimes(2);
    expect(mocks.strategyCreatorMap.get('TrendLine')).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sharedStrategyStateKey: 'bybit:ETHUSDT:15:TrendLine',
      }),
    );
    expect(mocks.strategyFnMap.get('TrendLine')).toHaveBeenCalledTimes(2);
    expect(mocks.strategyFnMap.get('TrendLine')).toHaveBeenLastCalledWith(
      expect.objectContaining({ timestamp: CURRENT_OPEN_TS, close: 12 }),
      expect.objectContaining({ timestamp: CURRENT_OPEN_TS, close: 102 }),
      expect.objectContaining({ timestamp: CURRENT_OPEN_TS, close: 12 }),
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
      { expire: TTL_3D },
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
      { expire: TTL_3D },
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

    expect(
      (mocks.setHashJsonField.mock.calls as unknown[][]).filter(([key]) =>
        String(key).includes(':runtime:signal-evaluations:'),
      ),
    ).toHaveLength(0);
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
      { expire: TTL_3D },
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

    expect(
      (mocks.setHashJsonField.mock.calls as unknown[][]).filter(([key]) =>
        String(key).includes(':runtime:signal-evaluations:'),
      ),
    ).toHaveLength(0);
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
      { expire: TTL_3D },
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
            figures: {
              lines: [
                {
                  id: 'trade-pattern',
                  points: [
                    { timestamp: CLOSED_1_TS, value: 10 },
                    { timestamp: CLOSED_2_TS, value: 11 },
                  ],
                },
              ],
              annotations: [
                {
                  id: 'trade-evidence',
                  point: { timestamp: CLOSED_2_TS, value: 11 },
                  title: 'Breakout LONG',
                  items: ['Score: 4 / 3'],
                },
              ],
            },
            indicators: { maFast: [10, 11] },
            additionalIndicators: {
              patternContext: { confirmed: true },
            },
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
    const storedTradeSignalCallIndex = (
      mocks.setData.mock.calls as unknown[][]
    ).findIndex(
      ([key]) => key === mocks.redisKeys.storeSignal('ETHUSDT', 'trend-sig'),
    );
    const storedTradeSignal = (mocks.setData.mock.calls as unknown[][])[
      storedTradeSignalCallIndex
    ]?.[1];
    expect(storedTradeSignal).toEqual(
      expect.objectContaining({
        figures: {
          lines: [
            {
              id: 'trade-pattern',
              points: [
                { timestamp: CLOSED_1_TS, value: 10 },
                { timestamp: CLOSED_2_TS, value: 11 },
              ],
            },
          ],
          annotations: [
            {
              id: 'trade-evidence',
              point: { timestamp: CLOSED_2_TS, value: 11 },
              title: 'Breakout LONG',
              items: ['Score: 4 / 3'],
            },
          ],
        },
        indicators: { maFast: [10, 11] },
        additionalIndicators: expect.objectContaining({
          patternContext: { confirmed: true },
        }),
      }),
    );
    expect(
      mocks.setData.mock.invocationCallOrder[storedTradeSignalCallIndex],
    ).toBeLessThan(mocks.makeScreenshots.mock.invocationCallOrder[0]);
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

  it('logs strategy evaluation duration', async () => {
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

    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.stringMatching(/^strategy evaluation: done in /),
    );
  });

  it('sends a separate Telegram warning when signals run exceeds ten minutes', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000);
    try {
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
      });

      nowSpy.mockReturnValueOnce(1_000);
      nowSpy.mockReturnValue(602_000);
      await signals();

      expect(mocks.sendTextToTG).toHaveBeenCalledWith(
        expect.stringContaining('Slow yarn signals run'),
        { userName: 'root' },
      );
      expect(mocks.sendTextToTG).toHaveBeenCalledWith(
        expect.stringContaining('Duration: <b>601.0s</b>'),
        { userName: 'root' },
      );
      expect(mocks.sendTextToTG).toHaveBeenCalledWith(
        expect.stringContaining('Threshold: <b>600.0s</b>'),
        { userName: 'root' },
      );
    } finally {
      nowSpy.mockRestore();
    }
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
      preloadStartMs: undefined,
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
      preloadStartMs: undefined,
    });
    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.stringMatching(/^binance market context backfill: done in /),
    );
  });

  it('prepares CMC context for signals with its bounded live warmup', async () => {
    const { signals, mocks } = await loadScript({
      coinMarketCapContextBackfillEnabled: true,
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
      mocks.shouldBackfillCoinMarketCapContextForSignals,
    ).toHaveBeenCalledWith({
      cacheOnly: false,
    });
    expect(mocks.backfillCoinMarketCapContextForSignals).toHaveBeenCalledWith({
      userName: 'root',
      startMs: CURRENT_TS,
      endMs: CURRENT_TS,
      preloadStartMs: undefined,
    });
    expect(mocks.update).toHaveBeenCalledWith(
      expect.any(Object),
      '15',
      ['ETHUSDT'],
      60,
      expect.objectContaining({ connectorLabel: 'bybit' }),
    );
    expect(mocks.update).not.toHaveBeenCalledWith(
      expect.anything(),
      '5',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.stringMatching(
        /^coinmarketcap historical context backfill: done in /,
      ),
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
