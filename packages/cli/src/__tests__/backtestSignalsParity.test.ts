/** @jest-environment node */

import {
  Candle,
  RuntimeSignalEvaluationRecord,
  Signal,
  Test,
} from '@tradejs/types';

const INTERVAL_MS = 15 * 60_000;
const CURRENT_OPEN_TS = 1_700_000_100_000;
const CURRENT_TS = CURRENT_OPEN_TS + 60_000;
const PRELOAD_TS = CURRENT_OPEN_TS - 3 * INTERVAL_MS;
const CLOSED_1_TS = CURRENT_OPEN_TS - 2 * INTERVAL_MS;
const CLOSED_2_TS = CURRENT_OPEN_TS - INTERVAL_MS;

type StrategyTranscript = {
  initDataTimestamps: number[];
  initBtcDataTimestamps: number[];
  initEthDataTimestamps: number[];
  initConfig?: Record<string, unknown>;
  connectorFlags?: {
    replay: boolean;
    test: boolean;
  };
  sharedIndicatorsReplayKey?: string;
  calls: Array<{
    candle: Candle;
    btcCandle: Candle;
    result: StrategyCallResult;
  }>;
};

type StrategyCallResult =
  | {
      status: 'skip';
      reason: string;
    }
  | {
      status: 'signal';
      signal: SignalSnapshot;
    };

type SignalSnapshot = {
  signalId: string;
  strategy: string;
  symbol: string;
  interval: string;
  direction: string;
  signalTimestamp: number;
  currentPrice: number;
};

type SignalParityRow = SignalSnapshot & {
  evaluatedCandleTimestamp: number;
  evaluatedCandleClose: number;
  evaluatedBtcCandleTimestamp: number;
};

const makeCandle = (timestamp: number, close: number): Candle => ({
  timestamp,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: 1_000,
  turnover: close * 1_000,
});

const coinCandles = [
  makeCandle(PRELOAD_TS, 10),
  makeCandle(CLOSED_1_TS, 11),
  makeCandle(CLOSED_2_TS, 12),
  makeCandle(CURRENT_OPEN_TS, 13),
];

const btcCandles = [
  makeCandle(PRELOAD_TS, 100),
  makeCandle(CLOSED_1_TS, 101),
  makeCandle(CLOSED_2_TS, 102),
  makeCandle(CURRENT_OPEN_TS, 103),
];

const sortRows = <T>(rows: T[]): T[] =>
  [...rows].sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  );

const expectSameRowsBothWays = <T>(
  leftName: string,
  leftRows: T[],
  rightName: string,
  rightRows: T[],
) => {
  const countRows = (rows: T[]) => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = JSON.stringify(row);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  const leftCounts = countRows(leftRows);
  const rightCounts = countRows(rightRows);

  const diffRows = (
    sourceRows: T[],
    sourceCounts: Map<string, number>,
    targetCounts: Map<string, number>,
  ) => {
    const emittedCounts = new Map<string, number>();
    return sourceRows.filter((row) => {
      const key = JSON.stringify(row);
      const excess =
        (sourceCounts.get(key) ?? 0) - (targetCounts.get(key) ?? 0);
      const emitted = emittedCounts.get(key) ?? 0;
      if (emitted >= excess) {
        return false;
      }
      emittedCounts.set(key, emitted + 1);
      return true;
    });
  };

  const leftOnly = sortRows(diffRows(leftRows, leftCounts, rightCounts));
  const rightOnly = sortRows(diffRows(rightRows, rightCounts, leftCounts));

  expect({
    [`${leftName}Only`]: leftOnly,
    [`${rightName}Only`]: rightOnly,
  }).toEqual({
    [`${leftName}Only`]: [],
    [`${rightName}Only`]: [],
  });
};

const toSignalSnapshot = (signal: Signal): SignalSnapshot => ({
  signalId: signal.signalId,
  strategy: signal.strategy,
  symbol: signal.symbol,
  interval: signal.interval,
  direction: signal.direction,
  signalTimestamp: signal.timestamp,
  currentPrice: signal.prices.currentPrice,
});

const normalizeEffectiveLastEvaluation = (transcript: StrategyTranscript) => {
  const lastCall = transcript.calls.at(-1);
  if (!lastCall) {
    throw new Error('Strategy was not evaluated');
  }

  return {
    historyBeforeLast: [
      ...transcript.initDataTimestamps,
      ...transcript.calls.slice(0, -1).map(({ candle }) => candle.timestamp),
    ],
    btcHistoryBeforeLast: [
      ...transcript.initBtcDataTimestamps,
      ...transcript.calls
        .slice(0, -1)
        .map(({ btcCandle }) => btcCandle.timestamp),
    ],
    candle: {
      timestamp: lastCall.candle.timestamp,
      close: lastCall.candle.close,
    },
    btcCandle: {
      timestamp: lastCall.btcCandle.timestamp,
      close: lastCall.btcCandle.close,
    },
  };
};

const normalizeSignalRows = (
  transcript: StrategyTranscript,
): SignalParityRow[] =>
  sortRows(
    transcript.calls.flatMap(({ candle, btcCandle, result }) =>
      result.status === 'signal'
        ? [
            {
              ...result.signal,
              evaluatedCandleTimestamp: candle.timestamp,
              evaluatedCandleClose: candle.close,
              evaluatedBtcCandleTimestamp: btcCandle.timestamp,
            },
          ]
        : [],
    ),
  );

const normalizeSignalEvaluationRows = (
  evaluations: RuntimeSignalEvaluationRecord[],
) =>
  sortRows(
    evaluations
      .filter((evaluation) => evaluation.status === 'signal')
      .map((evaluation) => ({
        strategy: evaluation.strategy,
        symbol: evaluation.symbol,
        interval: evaluation.interval,
        direction: evaluation.direction,
        signalId: evaluation.signalId,
        signalTimestamp: evaluation.timestamp,
        status: evaluation.status,
      })),
  );

const makeSignal = (candle: Candle): Signal =>
  ({
    signalId: `parity-signal-${candle.timestamp}`,
    strategy: 'ParityStrategy',
    symbol: 'ETHUSDT',
    interval: '15',
    direction: 'LONG',
    timestamp: candle.timestamp,
    prices: {
      currentPrice: candle.close,
      takeProfitPrice: candle.close + 2,
      stopLossPrice: candle.close - 1,
      riskRatio: 2,
    },
    figures: {},
    indicators: {},
    additionalIndicators: {},
  }) as Signal;

const attachBinanceParityBaseContext = async ({
  signal,
}: {
  signal: Signal;
}) => {
  signal.additionalIndicators = {
    ...(signal.additionalIndicators ?? {}),
    baseContext: {
      ...(signal.additionalIndicators?.baseContext ?? {}),
      participation: {
        tradeFlow: {
          source: 'binance_agg_trades',
          interval: '15m',
          asOfTs: signal.timestamp,
          ageMs: 0,
          stale: false,
          trades: 12,
          buyPressurePct: 0.6,
          buyBaseVolume: 6,
          sellBaseVolume: 4,
          buyQuoteVolume: 600,
          sellQuoteVolume: 400,
          netBaseDelta: 2,
          netQuoteDelta: 200,
        },
      },
      relative: {
        marketBreadth: {
          source: 'binance_klines',
          universe: 'binance_top30_usdt',
          interval: '15m',
          asOfTs: signal.timestamp,
          ageMs: 0,
          stale: false,
          symbolsCount: 30,
          advancers: 20,
          decliners: 8,
          unchanged: 2,
          advanceDeclineRatio: 2.5,
          pctAboveMa20: 0.6,
          pctAboveMa50: 0.55,
          equalWeightedReturn: 0.01,
          volumeWeightedReturn: 0.02,
          dispersion: 0.03,
        },
        marketReferences: {
          source: 'binance_reference_market',
          primaryReferenceSymbol: 'BTCUSDT',
          referenceSymbols: ['BTCUSDT', 'ETHUSDT'],
          tradeFlowBySymbol: {
            BTCUSDT: {
              source: 'binance_agg_trades',
              interval: '15m',
              asOfTs: signal.timestamp,
              ageMs: 0,
              stale: false,
              trades: 12,
              buyPressurePct: 0.6,
              buyBaseVolume: 6,
              sellBaseVolume: 4,
              buyQuoteVolume: 600,
              sellQuoteVolume: 400,
              netBaseDelta: 2,
              netQuoteDelta: 200,
            },
          },
          depthBySymbol: {},
        },
      },
    },
  };
  return true;
};

const createTranscriptStrategy = (transcript: StrategyTranscript) => {
  const strategy = jest.fn(async (candle: Candle, btcCandle: Candle) => {
    const signal =
      candle.timestamp === CLOSED_2_TS ? makeSignal(candle) : 'NO_SIGNAL';
    transcript.calls.push({
      candle,
      btcCandle,
      result:
        typeof signal === 'string'
          ? { status: 'skip', reason: signal }
          : { status: 'signal', signal: toSignalSnapshot(signal) },
    });
    return signal;
  });

  return jest.fn(async (params: any) => {
    transcript.initDataTimestamps = (params.data ?? []).map(
      (candle: Candle) => candle.timestamp,
    );
    transcript.initBtcDataTimestamps = (params.btcData ?? []).map(
      (candle: Candle) => candle.timestamp,
    );
    transcript.initEthDataTimestamps = (params.ethData ?? []).map(
      (candle: Candle) => candle.timestamp,
    );
    transcript.initConfig = params.config;
    transcript.connectorFlags = {
      replay: Boolean(params.connector?.__tradejsReplayConnector),
      test: Boolean(params.connector?.__tradejsTestConnector),
    };
    transcript.sharedIndicatorsReplayKey = params.sharedIndicatorsReplayKey;
    return strategy;
  });
};

const createEmptyTranscript = (): StrategyTranscript => ({
  initDataTimestamps: [],
  initBtcDataTimestamps: [],
  initEthDataTimestamps: [],
  calls: [],
});

const createBacktestCase = (): Test =>
  ({
    userName: 'root',
    symbol: 'ETHUSDT',
    options: { start: CLOSED_1_TS, end: CURRENT_TS },
    name: 'ETHUSDT_parity_1',
    testId: 'parity-test',
    testSuiteId: 'parity-suite',
    strategyName: 'ParityStrategy',
    strategyConfig: { INTERVAL: '15' },
    connectorName: 'ByBit',
    interval: '15',
    ai: true,
    collectReplaySignalEvaluations: true,
  }) as Test;

const runBacktestPath = async () => {
  jest.resetModules();

  const transcript = createEmptyTranscript();
  const strategyCreator = createTranscriptStrategy(transcript);
  const connector = {
    kline: jest.fn(async ({ symbol }: { symbol: string }) =>
      symbol === 'BTCUSDT' ? btcCandles : coinCandles,
    ),
  };
  const testConnector = {
    checkExits: jest.fn().mockResolvedValue(undefined),
    drainMlResultsBatch: jest.fn().mockResolvedValue([]),
    getResult: jest.fn().mockResolvedValue({
      orderLogId: 'parity-log',
      stat: { amount: 100, profit: 0, orders: 0 },
    }),
  };
  const enrichedSignals: Signal[] = [];
  const buildAiPayload = jest.fn((signal: Signal) => ({
    signal,
    additionalIndicators: signal.additionalIndicators,
  }));

  jest.doMock('../../../node/src/tradejsConfig', () => ({
    getTradejsProjectCwd: () => '/tmp/tradejs-parity',
  }));
  jest.doMock('../../../node/src/connectorsRegistry', () => ({
    BUILTIN_CONNECTOR_NAMES: {
      ByBit: 'ByBit',
      Binance: 'Binance',
      Coinbase: 'Coinbase',
    },
    getConnectorCreatorByName: jest.fn(async () => async () => connector),
  }));
  jest.doMock('../../../node/src/strategy/manifests', () => ({
    getStrategyCreator: jest.fn(async () => strategyCreator),
  }));
  jest.doMock('../../../node/src/testConnector', () => ({
    createTestConnector: jest.fn(() => testConnector),
  }));
  jest.doMock('../../../node/src/strategyHelpers/derivativesContext', () => ({
    enrichSignalWithDerivativesContext: jest.fn(async () => true),
  }));
  jest.doMock('../../../node/src/strategyHelpers/binanceMarketContext', () => ({
    enrichSignalWithBinanceMarketContext: jest.fn(async (params) => {
      await attachBinanceParityBaseContext(params);
      enrichedSignals.push(params.signal);
      return true;
    }),
  }));
  jest.doMock('../../../node/src/strategyHelpers/globalMarketContext', () => ({
    enrichSignalWithGlobalMarketContext: jest.fn(async () => false),
  }));
  jest.doMock('../../../node/src/ai', () => ({
    buildAiPayload,
  }));
  jest.doMock('../../../node/src/mlPayload', () => ({
    buildMlPayload: jest.fn(),
  }));
  jest.doMock('@tradejs/core/indicators', () => ({
    alignSortedCandlesByTimestamp: (coin: Candle[], btc: Candle[]) => ({
      alignedCoinCandles: coin,
      alignedBtcCandles: btc,
    }),
  }));
  jest.doMock('@tradejs/core/strategies', () => ({
    releaseStrategyIndicatorsReplayCache: jest.fn(),
    releaseStrategyReplayCache: jest.fn(),
  }));
  jest.doMock('@tradejs/core/time', () => ({
    getBacktestPreloadStart: (start: number) => start - INTERVAL_MS,
  }));
  jest.doMock('@tradejs/infra/ai', () => ({
    appendAiDatasetRow: jest.fn(),
  }));
  jest.doMock('@tradejs/infra/ml', () => ({
    appendMlDatasetRow: jest.fn(),
    buildMlTrainingRow: jest.fn(),
    trimMlTrainingRowWindows: jest.fn((row) => row),
  }));
  jest.doMock('@tradejs/infra/logger', () => ({
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  }));

  const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(CURRENT_TS);
  const { resetTestingKlineCache, testing } = await import(
    '@tradejs/node/backtest'
  );

  try {
    resetTestingKlineCache();
    const result = await testing(createBacktestCase());
    return {
      transcript,
      evaluations: (result as any).inlineReplaySignalEvaluations,
      enrichedSignals,
    };
  } finally {
    dateSpy.mockRestore();
  }
};

const runSignalsPath = async () => {
  jest.resetModules();

  const transcript = createEmptyTranscript();
  const strategyCreator = createTranscriptStrategy(transcript);
  const connector = {
    kline: jest.fn(async ({ symbol }: { symbol: string }) =>
      symbol === 'BTCUSDT' ? btcCandles : coinCandles,
    ),
  };
  const setDataMock = jest.fn(async () => null);
  const setHashJsonField = jest.fn(async () => null);

  jest.doMock('args', () => ({
    __esModule: true,
    default: {
      option: jest.fn(),
      parse: jest.fn(() => ({
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
      })),
    },
  }));
  jest.doMock('progress', () => ({
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({ tick: jest.fn() })),
  }));
  jest.doMock('chalk', () => ({
    __esModule: true,
    default: {
      yellow: (value: string) => value,
      cyan: (value: string | number) => String(value),
      gray: (value: string) => value,
    },
  }));
  jest.doMock('@tradejs/connectors', () => ({
    ConnectorNames: {
      Binance: 'Binance',
      Coinbase: 'Coinbase',
    },
  }));
  jest.doMock('@tradejs/node/connectors', () => ({
    DEFAULT_CONNECTOR_NAME: 'bybit',
    getConnectorCreatorByName: jest.fn(async () => async () => connector),
    resolveConnectorName: jest.fn(async () => 'bybit'),
  }));
  jest.doMock('@tradejs/node/cli', () => ({
    getTickers: jest.fn(async () => ['ETHUSDT']),
    loadTradejsConfig: jest.fn(async () => ({ hooks: {} })),
    makeScreenshots: jest.fn(),
    sendToTG: jest.fn(),
    update: jest.fn(),
  }));
  jest.doMock('@tradejs/node/strategies', () => ({
    enrichSignalWithBinanceMarketContext: jest.fn(
      attachBinanceParityBaseContext,
    ),
    enrichSignalWithGlobalMarketContext: jest.fn(async () => false),
    getStrategyCreator: jest.fn(async () => strategyCreator),
  }));
  jest.doMock('@tradejs/core/async', () => ({
    runWithConcurrency: jest.fn(
      async <T>(
        items: T[],
        _limit: number,
        worker: (item: T) => Promise<void>,
      ) => Promise.all(items.map(worker)),
    ),
  }));
  jest.doMock('@tradejs/core/constants', () => ({
    SIGNALS_CLI_PRELOAD_DAYS: 7,
    TTL_10D: 864_000,
  }));
  jest.doMock('@tradejs/core/indicators', () => ({
    alignSortedCandlesByTimestamp: (coin: Candle[], btc: Candle[]) => ({
      alignedCoinCandles: coin,
      alignedBtcCandles: btc,
    }),
  }));
  jest.doMock('@tradejs/core/time', () => ({
    getTimestamp: (days?: number) =>
      typeof days === 'number' && days > 0 ? PRELOAD_TS : CURRENT_TS,
  }));
  jest.doMock('@tradejs/infra/logger', () => ({
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  }));
  jest.doMock('@tradejs/infra/redis', () => ({
    getData: jest.fn(),
    getKeys: jest.fn(),
    incrHashFields: jest.fn(),
    redisKeys: {
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
    },
    setData: setDataMock,
    setHashJsonField,
  }));
  jest.doMock('../lib/derivativesContextBackfill', () => ({
    backfillDerivativesContextForSignals: jest.fn(),
    shouldBackfillDerivativesContextForSignals: jest.fn(() => false),
  }));
  jest.doMock('../lib/runtimeRedis', () => ({
    isRuntimeStrategyEnabled: jest.fn(() => true),
    loadRuntimeStrategyConfigs: jest.fn(async () => [
      {
        key: 'users:root:strategies:ParityStrategy:config',
        strategyName: 'ParityStrategy',
        strategyConfig: { INTERVAL: '15' },
      },
    ]),
  }));
  jest.doMock('../lib/runtimeSignalsStorage', () => {
    const actual = jest.requireActual('../lib/runtimeSignalsStorage');
    return {
      ...actual,
      getRuntimeStorageDayKey: jest.fn(() => '2026-05-29'),
    };
  });

  const prevNodeEnv = process.env.NODE_ENV;
  (process.env as any).NODE_ENV = 'test';
  const { signals } = await import('../scripts/signals');
  (process.env as any).NODE_ENV = prevNodeEnv;

  await signals();

  return {
    transcript,
    storedSignals: (setDataMock.mock.calls as unknown[][])
      .filter(([key]) => String(key).startsWith('store:signals:'))
      .map((call) => call[1]) as Signal[],
    storedEvaluations: (setHashJsonField.mock.calls as unknown[][])
      .filter(([key]) => String(key).includes(':runtime:signal-evaluations:'))
      .map((call) => call[2]) as RuntimeSignalEvaluationRecord[],
  };
};

const runReplayPath = async () => {
  jest.resetModules();

  const transcript = createEmptyTranscript();
  const strategyCreator = createTranscriptStrategy(transcript);
  const connector = {
    name: 'bybit',
    kline: jest.fn(async ({ symbol, end }: { symbol: string; end?: number }) =>
      (symbol === 'BTCUSDT' ? btcCandles : coinCandles).filter(
        (candle) => end == null || candle.timestamp <= end,
      ),
    ),
    getState: jest.fn(async () => ({})),
    setState: jest.fn(async () => undefined),
    getPosition: jest.fn(async () => null),
    getPositions: jest.fn(async () => []),
    placeOrder: jest.fn(async () => true),
    setTakeProfits: jest.fn(async () => true),
    setStopLoss: jest.fn(async () => true),
    closePosition: jest.fn(async () => true),
    getTickers: jest.fn(async () => ['ETHUSDT']),
  };

  jest.doMock('args', () => ({
    __esModule: true,
    default: {
      example: jest.fn(),
      option: jest.fn(),
      parse: jest.fn(() => ({
        timeframe: 15,
        user: 'root',
        connector: 'bybit',
      })),
    },
  }));
  jest.doMock('progress', () => ({
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({ tick: jest.fn() })),
  }));
  jest.doMock('chalk', () => ({
    __esModule: true,
    default: {
      blue: (value: string) => value,
      yellow: (value: string | number) => String(value),
      cyan: (value: string | number) => String(value),
      green: (value: string | number) => String(value),
      magenta: (value: string | number) => String(value),
      gray: (value: string | number) => String(value),
    },
  }));
  jest.doMock('@tradejs/node/connectors', () => ({
    DEFAULT_CONNECTOR_NAME: 'bybit',
    getConnectorCreatorByName: jest.fn(async () => async () => connector),
  }));
  jest.doMock('@tradejs/node/cli', () => ({
    loadTradejsConfig: jest.fn(async () => ({ hooks: {} })),
  }));
  jest.doMock('@tradejs/node/strategies', () => ({
    enrichSignalWithBinanceMarketContext: jest.fn(
      attachBinanceParityBaseContext,
    ),
    enrichSignalWithGlobalMarketContext: jest.fn(async () => false),
    getStrategyCreator: jest.fn(async () => strategyCreator),
  }));
  jest.doMock('@tradejs/core/backtest', () => ({
    calculateStatsFull: jest.fn(() => ({
      orders: 0,
      wins: 0,
      losses: 0,
      netProfit: 0,
      amount: 0,
    })),
  }));
  jest.doMock('@tradejs/core/indicators', () => ({
    alignSortedCandlesByTimestamp: (coin: Candle[], btc: Candle[]) => ({
      alignedCoinCandles: coin,
      alignedBtcCandles: btc,
    }),
  }));
  jest.doMock('@tradejs/core/strategies', () => ({
    releaseStrategyIndicatorsReplayCache: jest.fn(),
    releaseStrategyReplayCache: jest.fn(),
  }));
  jest.doMock('@tradejs/core/time', () => ({
    formatUnix: (timestamp: number) => String(timestamp),
  }));
  jest.doMock('@tradejs/infra/logger', () => ({
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  }));
  jest.doMock('../lib/cliArgs', () => ({
    normalizeCliArgv: (argv: string[]) => argv,
  }));

  const { runHistoricalSignalsReplay } = await import(
    '../lib/replay/historicalSignalsReplay'
  );
  const result = await runHistoricalSignalsReplay({
    preparedRun: {
      connectorName: 'bybit',
      marketConnector: connector as any,
      tickers: ['ETHUSDT'],
      window: {
        start: CLOSED_1_TS,
        end: CLOSED_2_TS,
        source: 'test',
      },
      preloadStart: PRELOAD_TS,
    },
    interval: '15',
    runtimeStrategies: [
      {
        strategyName: 'ParityStrategy',
        strategyConfig: {
          AI_ENABLED: true,
          AI_MODE: 'gate',
          MIN_AI_QUALITY: 4,
          ENV: 'CRON',
          INTERVAL: '60',
          MAKE_ORDERS: false,
        },
      },
    ],
  });

  return {
    transcript,
    result,
    signals: result.signals,
  };
};

describe('backtest/signals runtime parity', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('evaluates the same latest closed candle with the same effective history', async () => {
    const backtestRun = await runBacktestPath();
    const signalsRun = await runSignalsPath();

    expect(normalizeEffectiveLastEvaluation(backtestRun.transcript)).toEqual(
      normalizeEffectiveLastEvaluation(signalsRun.transcript),
    );

    expectSameRowsBothWays(
      'backtest',
      normalizeSignalRows(backtestRun.transcript),
      'signals',
      normalizeSignalRows(signalsRun.transcript),
    );

    expectSameRowsBothWays(
      'backtestEvaluations',
      normalizeSignalEvaluationRows(backtestRun.evaluations),
      'signalsEvaluations',
      normalizeSignalEvaluationRows(signalsRun.storedEvaluations),
    );

    expect(backtestRun.evaluations).toEqual([
      expect.objectContaining({
        strategy: 'ParityStrategy',
        symbol: 'ETHUSDT',
        timestamp: CLOSED_1_TS,
        status: 'skip',
        reason: 'NO_SIGNAL',
      }),
      expect.objectContaining({
        strategy: 'ParityStrategy',
        symbol: 'ETHUSDT',
        timestamp: CLOSED_2_TS,
        status: 'signal',
        signalId: `parity-signal-${CLOSED_2_TS}`,
      }),
    ]);
    expect(signalsRun.storedEvaluations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          strategy: 'ParityStrategy',
          symbol: 'ETHUSDT',
          timestamp: CLOSED_2_TS,
          evaluatedAt: expect.any(Number),
          status: 'signal',
          signalId: `parity-signal-${CLOSED_2_TS}`,
        }),
      ]),
    );
    expect(signalsRun.storedSignals.map(toSignalSnapshot)).toEqual([
      {
        signalId: `parity-signal-${CLOSED_2_TS}`,
        strategy: 'ParityStrategy',
        symbol: 'ETHUSDT',
        interval: '15',
        direction: 'LONG',
        signalTimestamp: CLOSED_2_TS,
        currentPrice: 12,
      },
    ]);
    expect(backtestRun.enrichedSignals).toHaveLength(1);
    expect(
      backtestRun.enrichedSignals[0]?.additionalIndicators?.baseContext,
    ).toEqual(signalsRun.storedSignals[0]?.additionalIndicators?.baseContext);
  });

  it('evaluates historical replay with the same effective history and enriched signal payload', async () => {
    const backtestRun = await runBacktestPath();
    const replayRun = await runReplayPath();

    expect(normalizeEffectiveLastEvaluation(backtestRun.transcript)).toEqual(
      normalizeEffectiveLastEvaluation(replayRun.transcript),
    );

    expectSameRowsBothWays(
      'backtest',
      normalizeSignalRows(backtestRun.transcript),
      'replay',
      normalizeSignalRows(replayRun.transcript),
    );

    expect(replayRun.transcript.initConfig).toEqual({
      AI_ENABLED: true,
      AI_MODE: 'gate',
      MIN_AI_QUALITY: 4,
      ENV: 'PARITY',
      INTERVAL: '15',
      MAKE_ORDERS: true,
      RECORD_RUNTIME_TRADES: false,
    });
    expect(replayRun.transcript.connectorFlags).toEqual({
      replay: true,
      test: true,
    });
    expect(replayRun.transcript.sharedIndicatorsReplayKey).toBe(
      `replay:root:bybit:ETHUSDT:15:${CLOSED_1_TS}:${CLOSED_2_TS}`,
    );
    expect(replayRun.signals.map(toSignalSnapshot)).toEqual([
      {
        signalId: `parity-signal-${CLOSED_2_TS}`,
        strategy: 'ParityStrategy',
        symbol: 'ETHUSDT',
        interval: '15',
        direction: 'LONG',
        signalTimestamp: CLOSED_2_TS,
        currentPrice: 12,
      },
    ]);
    expect(replayRun.signals[0]?.additionalIndicators?.baseContext).toEqual(
      backtestRun.enrichedSignals[0]?.additionalIndicators?.baseContext,
    );
  });
});
