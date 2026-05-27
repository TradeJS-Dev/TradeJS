import {
  AiDatasetRow,
  Candle,
  Connector,
  ConnectorCreator,
  KlineChartData,
  RuntimeSignalEvaluationRecord,
  Signal,
  Test,
  TestingBox,
} from '@tradejs/types';
import { alignSortedCandlesByTimestamp } from '@tradejs/core/indicators';
import { buildDefaultIndicatorPeriods } from '@tradejs/core/strategies';
import { getBacktestPreloadStart } from '@tradejs/core/time';
import { appendAiDatasetRow } from '@tradejs/infra/ai';
import {
  appendMlDatasetRow,
  buildMlTrainingRow,
  trimMlTrainingRowWindows,
} from '@tradejs/infra/ml';
import { logger } from '@tradejs/infra/logger';
import { buildAiPayload } from './ai';
import { enrichSignalWithDerivativesContext } from './strategyHelpers/derivativesContext';
import { getStrategyCreator } from './strategy/manifests';
import { buildMlPayload } from './mlPayload';
import {
  BUILTIN_CONNECTOR_NAMES,
  getConnectorCreatorByName,
} from './connectorsRegistry';
import {
  materializeIndicatorCachePlan,
  planIndicatorCacheRestore,
} from './indicatorCache';
import { createTestConnector } from './testConnector';
import { getTradejsProjectCwd } from './tradejsConfig';

type TestingKlineCacheState = {
  coinKlineCache: Map<string, KlineChartData>;
  btcKlineCache: Map<string, KlineChartData>;
  btcBinanceKlineCache: Map<string, KlineChartData>;
  btcCoinbaseKlineCache: Map<string, KlineChartData>;
  preparedDataCache: Map<string, PreparedTestingData>;
  connectorCache: Map<string, Connector>;
};

type PreparedTestingData = {
  data: KlineChartData;
  btcData: KlineChartData;
  prevData: KlineChartData;
  btcPrevData: KlineChartData;
  testData: KlineChartData;
  btcTestData: KlineChartData;
  btcBinanceData: KlineChartData;
  btcCoinbaseData: KlineChartData;
};

export type BacktestIndicatorCacheWarmupResult = {
  cached: boolean;
  replayStartIndex: number;
  totalCandles: number;
  paramsHash: string;
  version: string;
};

type TestingProgressMessage = {
  progress: true;
  testName: string;
  symbol: string;
  strategyName: string;
  stage: string;
  candleIndex?: number;
  candleTotal?: number;
  elapsedMs: number;
  stageElapsedMs: number;
};

const createTestingKlineCacheState = (): TestingKlineCacheState => ({
  coinKlineCache: new Map<string, KlineChartData>(),
  btcKlineCache: new Map<string, KlineChartData>(),
  btcBinanceKlineCache: new Map<string, KlineChartData>(),
  btcCoinbaseKlineCache: new Map<string, KlineChartData>(),
  preparedDataCache: new Map<string, PreparedTestingData>(),
  connectorCache: new Map<string, Connector>(),
});

const testingKlineCacheStateByProjectRoot = new Map<
  string,
  TestingKlineCacheState
>();

const getTestingKlineCacheState = (
  cwd = getTradejsProjectCwd(),
): {
  projectRoot: string;
  state: TestingKlineCacheState;
} => {
  const projectRoot = getTradejsProjectCwd(cwd);
  let state = testingKlineCacheStateByProjectRoot.get(projectRoot);
  if (!state) {
    state = createTestingKlineCacheState();
    testingKlineCacheStateByProjectRoot.set(projectRoot, state);
  }

  return {
    projectRoot,
    state,
  };
};

const getKlineCacheKey = (params: {
  userName: string;
  connectorName: string;
  symbol: string;
  preloadStart: number;
  end: number;
  interval: string;
  cacheOnly: boolean;
}) => {
  const {
    userName,
    connectorName,
    symbol,
    preloadStart,
    end,
    interval,
    cacheOnly,
  } = params;
  return [
    userName,
    connectorName,
    symbol,
    preloadStart,
    end,
    interval,
    cacheOnly ? 1 : 0,
  ].join(':');
};

const getPreparedDataCacheKey = (params: {
  userName: string;
  connectorName: string;
  symbol: string;
  preloadStart: number;
  start: number;
  end: number;
  interval: string;
  btcBinanceConnectorName: string;
  btcCoinbaseConnectorName: string;
}) => {
  const {
    userName,
    connectorName,
    symbol,
    preloadStart,
    start,
    end,
    interval,
    btcBinanceConnectorName,
    btcCoinbaseConnectorName,
  } = params;

  return [
    userName,
    connectorName,
    symbol,
    preloadStart,
    start,
    end,
    interval,
    btcBinanceConnectorName,
    btcCoinbaseConnectorName,
  ].join(':');
};

const getConnectorCacheKey = (params: {
  userName: string;
  connectorName: string;
}) => [params.userName, params.connectorName].join(':');

const BACKTEST_INTERVAL = '15';
const BACKTEST_INTERVAL_MS = Number(BACKTEST_INTERVAL) * 60_000;

const deleteMapEntriesByPrefix = <T>(map: Map<string, T>, prefix: string) => {
  for (const key of map.keys()) {
    if (key.startsWith(prefix)) {
      map.delete(key);
    }
  }
};

const splitCandlesForTesting = (
  candles: KlineChartData,
  start: number,
  preloadStart: number,
): {
  prevData: KlineChartData;
  testData: KlineChartData;
} => {
  const prevData: KlineChartData = [];
  const testData: KlineChartData = [];

  for (const candle of candles) {
    if (candle.timestamp < preloadStart) continue;
    if (candle.timestamp < start) {
      prevData.push(candle);
    } else {
      testData.push(candle);
    }
  }

  return { prevData, testData };
};

const getCurrentOpenTimestamp = () =>
  Math.floor(Date.now() / BACKTEST_INTERVAL_MS) * BACKTEST_INTERVAL_MS;

const filterClosedAlignedCandles = (
  data: KlineChartData,
  btcData: KlineChartData,
): {
  data: KlineChartData;
  btcData: KlineChartData;
} => {
  const currentOpenTimestamp = getCurrentOpenTimestamp();
  const closedData: KlineChartData = [];
  const closedBtcData: KlineChartData = [];

  for (let index = 0; index < data.length; index += 1) {
    const candle = data[index];
    const btcCandle = btcData[index];
    if (!candle || !btcCandle || candle.timestamp >= currentOpenTimestamp) {
      continue;
    }
    closedData.push(candle);
    closedBtcData.push(btcCandle);
  }

  return {
    data: closedData,
    btcData: closedBtcData,
  };
};

const getCachedConnector = async (params: {
  state: TestingKlineCacheState;
  projectRoot: string;
  userName: string;
  connectorName: string;
}): Promise<Connector | undefined> => {
  const { state, projectRoot, userName, connectorName } = params;
  const cacheKey = getConnectorCacheKey({ userName, connectorName });
  const cachedConnector = state.connectorCache.get(cacheKey);
  if (cachedConnector) {
    return cachedConnector;
  }

  const connectorCreator = await getConnectorCreatorByName(
    connectorName,
    projectRoot,
  );
  if (!connectorCreator) {
    return undefined;
  }

  const connector = await (connectorCreator as ConnectorCreator)({
    userName,
  });
  state.connectorCache.set(cacheKey, connector);

  return connector;
};

export const resetTestingKlineCache = (cwd?: string) => {
  const normalizedCwd = String(cwd ?? '').trim();
  if (!normalizedCwd) {
    testingKlineCacheStateByProjectRoot.clear();
    return;
  }

  testingKlineCacheStateByProjectRoot.delete(
    getTradejsProjectCwd(normalizedCwd),
  );
};

export const releaseTestingSymbolCache = (params: {
  cwd?: string;
  userName: string;
  connectorName: string;
  symbol: string;
}) => {
  const { cwd, userName, connectorName, symbol } = params;
  const { state } = getTestingKlineCacheState(cwd);
  const symbolCacheKeyPrefix =
    [userName, connectorName, symbol].join(':') + ':';

  deleteMapEntriesByPrefix(state.coinKlineCache, symbolCacheKeyPrefix);
  deleteMapEntriesByPrefix(state.preparedDataCache, symbolCacheKeyPrefix);
};

const prepareTestingData = async (params: {
  state: TestingKlineCacheState;
  projectRoot: string;
  userName: string;
  connectorName: string;
  symbol: string;
  preloadStart: number;
  start: number;
  end: number;
}) => {
  const {
    state,
    projectRoot,
    userName,
    connectorName,
    symbol,
    preloadStart,
    start,
    end,
  } = params;
  const binanceConnector = await getCachedConnector({
    state,
    projectRoot,
    userName,
    connectorName: BUILTIN_CONNECTOR_NAMES.Binance,
  });
  const coinbaseConnector = await getCachedConnector({
    state,
    projectRoot,
    userName,
    connectorName: BUILTIN_CONNECTOR_NAMES.Coinbase,
  });

  const cacheOnly = true;
  const connector = await getCachedConnector({
    state,
    projectRoot,
    userName,
    connectorName,
  });
  if (!connector) {
    throw new Error(`Unknown connector: ${connectorName}`);
  }

  if (!binanceConnector || !coinbaseConnector) {
    logger.warn(
      'Binance/Coinbase connectors are unavailable. Reusing %s for BTC references.',
      connectorName,
    );
  }

  const interval = BACKTEST_INTERVAL;
  const coinCacheKey = getKlineCacheKey({
    userName,
    connectorName,
    symbol,
    preloadStart,
    end,
    interval,
    cacheOnly,
  });
  const btcCacheKey = getKlineCacheKey({
    userName,
    connectorName,
    symbol: 'BTCUSDT',
    preloadStart,
    end,
    interval,
    cacheOnly,
  });
  const btcBinanceConnectorName = binanceConnector
    ? BUILTIN_CONNECTOR_NAMES.Binance
    : connectorName;
  const btcCoinbaseConnectorName = coinbaseConnector
    ? BUILTIN_CONNECTOR_NAMES.Coinbase
    : connectorName;
  const btcBinanceCacheKey = getKlineCacheKey({
    userName,
    connectorName: btcBinanceConnectorName,
    symbol: 'BTCUSDT',
    preloadStart,
    end,
    interval,
    cacheOnly,
  });
  const btcCoinbaseCacheKey = getKlineCacheKey({
    userName,
    connectorName: btcCoinbaseConnectorName,
    symbol: 'BTCUSDT',
    preloadStart,
    end,
    interval,
    cacheOnly,
  });

  const cachedCoinData = state.coinKlineCache.get(coinCacheKey);
  const cachedBtcData = state.btcKlineCache.get(btcCacheKey);
  const cachedBtcBinanceData =
    state.btcBinanceKlineCache.get(btcBinanceCacheKey);
  const cachedBtcCoinbaseData =
    state.btcCoinbaseKlineCache.get(btcCoinbaseCacheKey);
  const preparedDataCacheKey = getPreparedDataCacheKey({
    userName,
    connectorName,
    symbol,
    preloadStart,
    start,
    end,
    interval,
    btcBinanceConnectorName,
    btcCoinbaseConnectorName,
  });

  const cachedPreparedData = state.preparedDataCache.get(preparedDataCacheKey);
  if (cachedPreparedData) {
    return cachedPreparedData;
  }

  const btcDataPromise: Promise<KlineChartData> = cachedBtcData
    ? Promise.resolve(cachedBtcData)
    : connector.kline({
        symbol: 'BTCUSDT',
        start: preloadStart,
        end,
        interval: BACKTEST_INTERVAL,
        silent: true,
        cacheOnly,
      });
  const btcBinanceDataPromise: Promise<KlineChartData> = cachedBtcBinanceData
    ? Promise.resolve(cachedBtcBinanceData)
    : btcBinanceCacheKey === btcCacheKey
      ? btcDataPromise
      : (binanceConnector ?? connector).kline({
          symbol: 'BTCUSDT',
          start: preloadStart,
          end,
          interval: BACKTEST_INTERVAL,
          silent: true,
          cacheOnly,
        });
  const btcCoinbaseDataPromise: Promise<KlineChartData> = cachedBtcCoinbaseData
    ? Promise.resolve(cachedBtcCoinbaseData)
    : btcCoinbaseCacheKey === btcCacheKey
      ? btcDataPromise
      : (coinbaseConnector ?? connector).kline({
          symbol: 'BTCUSDT',
          start: preloadStart,
          end,
          interval: BACKTEST_INTERVAL,
          silent: true,
          cacheOnly,
        });

  const [dataRaw, btcDataRaw, btcBinanceDataRaw, btcCoinbaseDataRaw] =
    await Promise.all([
      cachedCoinData
        ? Promise.resolve(cachedCoinData)
        : connector.kline({
            symbol,
            start: preloadStart,
            end,
            interval: BACKTEST_INTERVAL,
            silent: true,
            cacheOnly,
          }),
      btcDataPromise,
      btcBinanceDataPromise,
      btcCoinbaseDataPromise,
    ]);

  if (!cachedCoinData) {
    state.coinKlineCache.set(coinCacheKey, dataRaw);
  }
  if (!cachedBtcData) {
    state.btcKlineCache.set(btcCacheKey, btcDataRaw);
  }
  if (!cachedBtcBinanceData) {
    state.btcBinanceKlineCache.set(btcBinanceCacheKey, btcBinanceDataRaw);
  }
  if (!cachedBtcCoinbaseData) {
    state.btcCoinbaseKlineCache.set(btcCoinbaseCacheKey, btcCoinbaseDataRaw);
  }

  const aligned = alignSortedCandlesByTimestamp(dataRaw, btcDataRaw);
  const { data, btcData } = filterClosedAlignedCandles(
    aligned.alignedCoinCandles,
    aligned.alignedBtcCandles,
  );
  const { alignedBtcCandles: btcBinanceData } = alignSortedCandlesByTimestamp(
    data,
    btcBinanceDataRaw,
  );
  const { alignedBtcCandles: btcCoinbaseData } = alignSortedCandlesByTimestamp(
    data,
    btcCoinbaseDataRaw,
  );

  const { prevData, testData } = splitCandlesForTesting(
    data,
    start,
    preloadStart,
  );
  const { prevData: btcPrevData, testData: btcTestData } =
    splitCandlesForTesting(btcData, start, preloadStart);
  const preparedData = {
    data,
    btcData,
    prevData,
    btcPrevData,
    testData,
    btcTestData,
    btcBinanceData,
    btcCoinbaseData,
  };
  state.preparedDataCache.set(preparedDataCacheKey, preparedData);

  return preparedData;
};

export const warmBacktestIndicatorCache = async (
  test: Pick<
    Test,
    | 'userName'
    | 'symbol'
    | 'options'
    | 'strategyConfig'
    | 'connectorName'
    | 'name'
  >,
): Promise<BacktestIndicatorCacheWarmupResult> => {
  const { userName, symbol, options, strategyConfig, connectorName } = test;
  const start = options?.start;
  const end = options?.end;
  if (!start) {
    throw new Error('no start');
  }
  if (!end) {
    throw new Error('no end');
  }

  const preloadStart = getBacktestPreloadStart(start);
  const { projectRoot, state } = getTestingKlineCacheState();
  const preparedData = await prepareTestingData({
    state,
    projectRoot,
    userName,
    connectorName,
    symbol,
    preloadStart,
    start,
    end,
  });
  const periods = buildDefaultIndicatorPeriods((strategyConfig ?? {}) as any);
  try {
    const plan = await planIndicatorCacheRestore({
      provider: connectorName,
      symbol,
      interval: Number(BACKTEST_INTERVAL),
      periods,
      data: preparedData.data,
      btcData: preparedData.btcData,
      btcBinanceData: preparedData.btcBinanceData,
      btcCoinbaseData: preparedData.btcCoinbaseData,
    });

    await materializeIndicatorCachePlan({
      provider: connectorName,
      symbol,
      interval: Number(BACKTEST_INTERVAL),
      periods,
      data: preparedData.data,
      btcData: preparedData.btcData,
      btcBinanceData: preparedData.btcBinanceData,
      btcCoinbaseData: preparedData.btcCoinbaseData,
      paramsHash: plan.paramsHash,
      restoreState: plan.restoreState,
      replayStartIndex: plan.replayStartIndex,
      cached: plan.cached,
    });

    return {
      cached: plan.cached,
      replayStartIndex: plan.replayStartIndex,
      totalCandles: preparedData.data.length,
      paramsHash: plan.paramsHash,
      version: plan.version,
    };
  } finally {
    releaseTestingSymbolCache({
      userName,
      connectorName,
      symbol,
    });
  }
};

export const testing: TestingBox = async ({
  userName,
  symbol,
  options: { start, end },
  name,
  testId,
  testSuiteId,
  configId,
  strategyName,
  strategyConfig,
  connectorName,
  ml = false,
  ai = false,
  fast = false,
  collectReplaySignalEvaluations = false,
  chunkId = 'single',
  timeoutMs,
}) => {
  if (!start) {
    throw new Error('no start');
  }
  // TODO: Add explicit end validation (and consistent error handling) similar to start validation.
  const preloadStart = getBacktestPreloadStart(start);

  const startedAt = Date.now();
  let activeStageStartedAt = startedAt;
  let lastProgressSentAt = 0;
  let lastProgressSignature = '';
  let currentCandleIndex = 0;
  let totalCandles = 0;
  const formatTimeoutMessage = (stage: string) =>
    `Test ${name} (${symbol}) timed out after ${timeoutMs}ms during ${stage}`;
  const emitProgress = (
    stage: string,
    options: {
      force?: boolean;
      candleIndex?: number;
      candleTotal?: number;
    } = {},
  ) => {
    const now = Date.now();
    const candleIndex =
      typeof options.candleIndex === 'number'
        ? options.candleIndex
        : currentCandleIndex;
    const candleTotal =
      typeof options.candleTotal === 'number'
        ? options.candleTotal
        : totalCandles;
    const signature = [
      stage,
      candleIndex,
      candleTotal,
      Math.floor((now - activeStageStartedAt) / 5000),
    ].join(':');
    if (!options.force) {
      if (signature === lastProgressSignature) {
        return;
      }
      if (now - lastProgressSentAt < 4000) {
        return;
      }
    }

    lastProgressSentAt = now;
    lastProgressSignature = signature;
    process.send?.({
      progress: true,
      testName: name,
      symbol,
      strategyName,
      stage,
      candleIndex,
      candleTotal,
      elapsedMs: now - startedAt,
      stageElapsedMs: now - activeStageStartedAt,
    } satisfies TestingProgressMessage);
  };
  const getStageTimeoutMs = () => {
    if (!timeoutMs || timeoutMs <= 0) {
      return null;
    }

    return timeoutMs;
  };
  const throwIfTimedOut = (stage: string) => {
    if (getStageTimeoutMs() == null) {
      return;
    }

    emitProgress(stage);
  };
  const withTimeout = async <T>(
    stage: string,
    promise: Promise<T>,
  ): Promise<T> => {
    const stageTimeoutMs = getStageTimeoutMs();
    if (stageTimeoutMs == null) {
      return promise;
    }

    activeStageStartedAt = Date.now();
    emitProgress(stage, { force: true });

    return await new Promise<T>((resolve, reject) => {
      const heartbeat = setInterval(() => {
        emitProgress(stage);
      }, 5000);
      const timer = setTimeout(() => {
        clearInterval(heartbeat);
        reject(new Error(formatTimeoutMessage(stage)));
      }, stageTimeoutMs);

      promise.then(
        (value) => {
          clearInterval(heartbeat);
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearInterval(heartbeat);
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  };
  const runStage = <T>(stage: string, fn: () => Promise<T>): Promise<T> => {
    if (getStageTimeoutMs() == null) {
      return fn();
    }
    return withTimeout(stage, fn());
  };

  const { projectRoot, state } = getTestingKlineCacheState();

  const connector = await withTimeout(
    'connector init',
    getCachedConnector({
      state,
      projectRoot,
      userName,
      connectorName,
    }),
  );
  if (!connector) {
    throw new Error(`Unknown connector: ${connectorName}`);
  }
  const strategyCreator = await withTimeout(
    'strategy lookup',
    getStrategyCreator(strategyName, projectRoot),
  );
  if (!strategyCreator) {
    throw new Error(`Unknown strategy: ${strategyName}`);
  }
  const preparedData = await withTimeout(
    'kline preload',
    prepareTestingData({
      state,
      projectRoot,
      userName,
      connectorName,
      symbol,
      preloadStart,
      start,
      end,
    }),
  );

  if (!preparedData) {
    throw new Error('Prepared backtest data not available');
  }

  const {
    prevData,
    btcPrevData,
    testData,
    btcTestData,
    btcBinanceData,
    btcCoinbaseData,
  } = preparedData;
  const runtimePrevData = prevData.slice();
  const runtimeBtcPrevData = btcPrevData.slice();
  const interval = BACKTEST_INTERVAL;
  totalCandles = testData.length;

  const testConnector = createTestConnector(connector, {
    userName,
    mlEnabled: ml,
    aiEnabled: ai,
    fastMode: fast,
  });

  const strategy = await withTimeout(
    'strategy init',
    strategyCreator({
      userName,
      connectorName,
      config: strategyConfig,
      symbol,
      data: runtimePrevData,
      btcData: runtimeBtcPrevData,
      btcBinanceData,
      btcCoinbaseData,
      connector: testConnector,
    }),
  );

  const pendingMlPayloadBySignalId = new Map<
    string,
    ReturnType<typeof buildMlPayload>
  >();
  const pendingAiRowBySignalId = new Map<
    string,
    Omit<AiDatasetRow, 'profit'>
  >();
  const replaySignalEvaluations = collectReplaySignalEvaluations
    ? ([] as RuntimeSignalEvaluationRecord[])
    : null;

  const flushClosedResultsBatch = async () => {
    if (!ml && !ai) return;
    const batch = await testConnector.drainMlResultsBatch();
    if (!batch.length) return;

    for (const resultRecord of batch) {
      const payload = pendingMlPayloadBySignalId.get(resultRecord.signalId);
      if (payload) {
        pendingMlPayloadBySignalId.delete(resultRecord.signalId);

        const fullRow = buildMlTrainingRow(payload, {
          profit: resultRecord.profit,
        });
        const row = trimMlTrainingRowWindows(fullRow, 5);
        await appendMlDatasetRow({
          strategyName,
          chunkId,
          row,
        });
      }

      const aiRowBase = pendingAiRowBySignalId.get(resultRecord.signalId);
      if (aiRowBase) {
        pendingAiRowBySignalId.delete(resultRecord.signalId);
        await appendAiDatasetRow({
          strategyName,
          chunkId,
          row: {
            ...aiRowBase,
            profit: resultRecord.profit,
          },
        });
      }
    }
  };

  for (let candleIndex = 0; candleIndex < testData.length; candleIndex++) {
    if (candleIndex % 25 === 0) {
      throwIfTimedOut('candle loop');
    }
    currentCandleIndex = candleIndex + 1;
    emitProgress('candle loop', {
      force: candleIndex === 0 || currentCandleIndex === totalCandles,
    });

    const candle = testData[candleIndex];
    const btcCandle = btcTestData[candleIndex];

    // Process exits on the current candle first. Any position opened below
    // can only be closed starting from the next candle to avoid same-bar lookahead.
    await runStage('stop-loss check', () => testConnector.checkSl(candle));
    await runStage('take-profit check', () => testConnector.checkTp(candle));

    const signal = await runStage('strategy signal', () =>
      strategy(candle, btcCandle),
    );
    if (!signal || typeof signal === 'string') {
      if (replaySignalEvaluations) {
        replaySignalEvaluations.push({
          evaluationId: `${testId}:${strategyName}:${symbol}:${candle.timestamp}`,
          userName,
          strategy: strategyName,
          symbol,
          interval,
          timestamp: candle.timestamp,
          evaluatedAt: candle.timestamp,
          status: 'skip',
          reason:
            typeof signal === 'string' && signal.trim() ? signal : 'NO_SIGNAL',
        });
      }
    } else {
      if (replaySignalEvaluations) {
        replaySignalEvaluations.push({
          evaluationId: `${signal.signalId || testId}:${strategyName}:${symbol}:${signal.timestamp || candle.timestamp}`,
          userName,
          strategy: signal.strategy || strategyName,
          symbol: signal.symbol || symbol,
          interval: signal.interval || interval,
          timestamp:
            typeof signal.timestamp === 'number' &&
            Number.isFinite(signal.timestamp)
              ? signal.timestamp
              : candle.timestamp,
          evaluatedAt: candle.timestamp,
          status: 'signal',
          reason: signal.orderSkipReason || signal.orderStatus,
          signalId: signal.signalId,
          direction: signal.direction,
          orderStatus: signal.orderStatus,
          orderSkipReason: signal.orderSkipReason,
          aiAnalysis: signal.aiAnalysis ?? null,
          ml: signal.ml,
        });
      }
    }
    const shouldCapturePayload =
      signal && typeof signal !== 'string' && signal.signalId && (ml || ai);
    if (shouldCapturePayload) {
      await withTimeout(
        'derivatives context',
        enrichSignalWithDerivativesContext({
          signal: signal as Signal,
          env: 'BACKTEST',
        }),
      );
    }
    if (ml && signal && typeof signal !== 'string' && signal.signalId) {
      const payload = buildMlPayload({
        signal,
        context: {
          userName,
          testId,
          testSuiteId,
          testName: name,
          configId,
          symbol,
          strategyName,
          strategyConfig,
          connectorName,
        },
      });
      pendingMlPayloadBySignalId.set(signal.signalId, payload);
    }
    if (ai && signal && typeof signal !== 'string' && signal.signalId) {
      pendingAiRowBySignalId.set(signal.signalId, {
        signalId: signal.signalId,
        strategyName: signal.strategy || strategyName,
        symbol: signal.symbol || symbol,
        direction: signal.direction,
        timestamp: signal.timestamp,
        payload: buildAiPayload(signal as Signal),
        testId,
        testSuiteId,
        testName: name,
        configId,
        connectorName,
      });
    }
  }

  await withTimeout('flush closed results', flushClosedResultsBatch());

  const result = await withTimeout('collect result', testConnector.getResult());

  return replaySignalEvaluations
    ? {
        ...result,
        inlineReplaySignalEvaluations: replaySignalEvaluations,
      }
    : result;
};
