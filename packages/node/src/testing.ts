import {
  AiDatasetRow,
  BacktestDetectorOptimizedStrategy,
  Candle,
  Connector,
  ConnectorCreator,
  ExecutionCostModel,
  Interval,
  KlineChartData,
  KlineChartItem,
  RuntimeSignalEvaluationRecord,
  Signal,
  Test,
  TestingBox,
  TestingBoxResult,
} from '@tradejs/types';
import { alignSortedCandlesByTimestamp } from '@tradejs/core/indicators';
import { BACKTEST_EXECUTION_INTERVAL } from '@tradejs/core/constants';
import {
  releaseStrategyIndicatorsReplayCache,
  releaseStrategyReplayCache,
} from '@tradejs/core/strategies';
import { getBacktestPreloadStart } from '@tradejs/core/time';
import { appendAiDatasetRow } from '@tradejs/infra/ai';
import {
  appendMlDatasetRow,
  buildMlTrainingRow,
  trimMlTrainingRowWindows,
} from '@tradejs/infra/ml';
import { logger } from '@tradejs/infra/logger';
import { buildAiPayload } from './ai';
import { enrichSignalWithBinanceMarketContext } from './strategyHelpers/binanceMarketContext';
import { enrichSignalWithCoinMarketCapContext } from './strategyHelpers/coinMarketCapContext';
import { enrichSignalWithDerivativesContext } from './strategyHelpers/derivativesContext';
import { getStrategyCreator } from './strategy/manifests';
import { buildMlPayload } from './mlPayload';
import {
  BUILTIN_CONNECTOR_NAMES,
  getConnectorCreatorByName,
} from './connectorsRegistry';
import { createTestConnector } from './testConnector';
import { resolveExecutionCosts } from './executionCosts';
import { getTradejsProjectCwd } from './tradejsConfig';

type TestingKlineCacheState = {
  coinKlineCache: Map<string, KlineChartData>;
  btcKlineCache: Map<string, KlineChartData>;
  ethKlineCache: Map<string, KlineChartData>;
  btcBinanceKlineCache: Map<string, KlineChartData>;
  btcCoinbaseKlineCache: Map<string, KlineChartData>;
  preparedDataCache: Map<string, PreparedTestingData>;
  connectorCache: Map<string, Connector>;
};

type PreparedTestingData = {
  data: KlineChartData;
  btcData: KlineChartData;
  ethData: KlineChartData;
  prevData: KlineChartData;
  btcPrevData: KlineChartData;
  ethPrevData: KlineChartData;
  testData: KlineChartData;
  btcTestData: KlineChartData;
  ethTestData: KlineChartData;
  btcBinanceData: KlineChartData;
  btcCoinbaseData: KlineChartData;
  backtestExecutionInterval: Interval;
  backtestExecutionData: KlineChartData;
  backtestExecutionBtcData: KlineChartData;
  backtestExecutionDataByTimestamp: Map<number, KlineChartItem>;
  backtestExecutionBtcDataByTimestamp: Map<number, KlineChartItem>;
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

type TestingGroupResult = {
  test: Test;
  result: TestingBoxResult;
};

type BacktestDelayedEntryStrategy = BacktestDetectorOptimizedStrategy & {
  __tradejsFlushBacktestDelayedEntry?: (
    candle: Candle,
    btcCandle: Candle,
    ethCandle?: Candle,
  ) => Promise<string | Signal | undefined>;
};

const isBacktestEntryDelayControlCode = (value: unknown) =>
  typeof value === 'string' && value.startsWith('BACKTEST_ENTRY_DELAY_');

const CLOSED_RESULT_FLUSH_INTERVAL = 500;
const DEFAULT_STRATEGY_CANDLE_TIMEOUT_MS = 60_000;

const resolvePositiveInt = (value: unknown, fallback: number) => {
  const parsed = parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getStrategyCandleTimeoutMs = () =>
  resolvePositiveInt(
    process.env.BACKTEST_STRATEGY_CANDLE_TIMEOUT_MS,
    DEFAULT_STRATEGY_CANDLE_TIMEOUT_MS,
  );

const getEffectiveTimeoutMs = (
  baseTimeoutMs: number | undefined,
  stageTimeoutMs: number | null,
) => {
  const base =
    baseTimeoutMs && baseTimeoutMs > 0 ? Math.trunc(baseTimeoutMs) : null;
  const stage =
    stageTimeoutMs && stageTimeoutMs > 0 ? Math.trunc(stageTimeoutMs) : null;
  if (base == null) return stage;
  if (stage == null) return base;
  return Math.min(base, stage);
};

const buildCandleByTimestamp = (candles?: KlineChartData) =>
  new Map(
    (candles ?? [])
      .filter((candle) => typeof candle?.timestamp === 'number')
      .map((candle) => [candle.timestamp, candle]),
  ) as Map<number, KlineChartItem>;

type PendingAiDatasetRow = Omit<AiDatasetRow, 'payload' | 'profit'> & {
  signal: Signal;
};

const buildBacktestDatasetMetadata = ({
  backtestRunId,
  backtestTestKey,
  chunkId,
}: {
  backtestRunId?: string;
  backtestTestKey?: string;
  chunkId?: string;
}): Record<string, string> => {
  if (!backtestRunId || !backtestTestKey || !chunkId) {
    return {};
  }

  return {
    backtestRunId,
    backtestTestKey,
    backtestChunkId: chunkId,
  };
};

const cloneAiPayloadSignal = (signal: Signal): Signal => {
  const cloneValue = <T>(value: T): T => {
    if (value == null) {
      return value;
    }

    if (typeof structuredClone === 'function') {
      return structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value)) as T;
  };

  return {
    ...signal,
    figures: cloneValue(signal.figures),
    indicators: cloneValue(signal.indicators),
    additionalIndicators: cloneValue(signal.additionalIndicators),
  };
};

const buildReplaySignalEvaluationRecord = ({
  signal,
  testId,
  userName,
  strategyName,
  symbol,
  interval,
  candle,
}: {
  signal: Signal | string | null | undefined;
  testId: string;
  userName: string;
  strategyName: string;
  symbol: string;
  interval: Interval;
  candle: Candle;
}): RuntimeSignalEvaluationRecord => {
  if (!signal || typeof signal === 'string') {
    return {
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
    };
  }

  const signalTimestamp =
    typeof signal.timestamp === 'number' && Number.isFinite(signal.timestamp)
      ? signal.timestamp
      : candle.timestamp;

  return {
    evaluationId: `${signal.signalId || testId}:${strategyName}:${symbol}:${signalTimestamp}`,
    userName,
    strategy: signal.strategy || strategyName,
    symbol: signal.symbol || symbol,
    interval: signal.interval || interval,
    timestamp: signalTimestamp,
    evaluatedAt: candle.timestamp,
    status: 'signal',
    reason: signal.orderSkipReason || signal.orderStatus,
    signalId: signal.signalId,
    direction: signal.direction,
    orderStatus: signal.orderStatus,
    orderSkipReason: signal.orderSkipReason,
    aiAnalysis: signal.aiAnalysis ?? null,
    ml: signal.ml,
  };
};

const createTestingKlineCacheState = (): TestingKlineCacheState => ({
  coinKlineCache: new Map<string, KlineChartData>(),
  btcKlineCache: new Map<string, KlineChartData>(),
  ethKlineCache: new Map<string, KlineChartData>(),
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
  interval: Interval;
  cacheOnly: boolean;
  universe?: string;
  accountId?: string;
}) => {
  const {
    userName,
    connectorName,
    symbol,
    preloadStart,
    end,
    interval,
    cacheOnly,
    universe,
    accountId,
  } = params;
  return [
    userName,
    connectorName,
    universe ?? 'crypto',
    accountId ?? 'default',
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
  interval: Interval;
  btcBinanceConnectorName: string;
  btcCoinbaseConnectorName: string;
  backtestExecutionInterval: Interval;
  universe?: string;
  accountId?: string;
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
    backtestExecutionInterval,
    universe,
    accountId,
  } = params;

  return [
    userName,
    connectorName,
    universe ?? 'crypto',
    accountId ?? 'default',
    symbol,
    preloadStart,
    start,
    end,
    interval,
    backtestExecutionInterval,
    btcBinanceConnectorName,
    btcCoinbaseConnectorName,
  ].join(':');
};

const getConnectorCacheKey = (params: {
  userName: string;
  connectorName: string;
  universe?: string;
  accountId?: string;
}) =>
  [
    params.userName,
    params.connectorName,
    params.universe ?? 'crypto',
    params.accountId ?? 'default',
  ].join(':');

const BACKTEST_INTERVAL: Interval = '15';
const resolveBacktestExecutionInterval = (
  interval: Interval,
): Interval | null => {
  const normalized = String(interval);
  if (normalized === '15') {
    return BACKTEST_EXECUTION_INTERVAL as Interval;
  }
  if (normalized === '60') {
    return '15' as Interval;
  }
  return null;
};

const resolveIntervalMs = (interval: Interval) => {
  const intervalMinutes = Number(interval);
  return Number.isFinite(intervalMinutes) && intervalMinutes > 0
    ? intervalMinutes * 60_000
    : Number(BACKTEST_INTERVAL) * 60_000;
};

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

const getCurrentOpenTimestamp = (interval: Interval) => {
  const intervalMs = resolveIntervalMs(interval);
  return Math.floor(Date.now() / intervalMs) * intervalMs;
};

const filterClosedAlignedCandles = (
  data: KlineChartData,
  btcData: KlineChartData,
  interval: Interval,
): {
  data: KlineChartData;
  btcData: KlineChartData;
} => {
  const currentOpenTimestamp = getCurrentOpenTimestamp(interval);
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

const shouldLoadBacktestExecutionCandles = (interval: Interval) => {
  const executionInterval = resolveBacktestExecutionInterval(interval);
  if (!executionInterval) {
    return false;
  }
  const primaryMs = resolveIntervalMs(interval);
  const executionMs = resolveIntervalMs(executionInterval);
  return executionMs > 0 && executionMs < primaryMs;
};

const getCachedConnector = async (params: {
  state: TestingKlineCacheState;
  projectRoot: string;
  userName: string;
  connectorName: string;
  universe?: Test['universe'];
  accountId?: string;
  deploymentId?: string;
}): Promise<Connector | undefined> => {
  const {
    state,
    projectRoot,
    userName,
    connectorName,
    universe,
    accountId,
    deploymentId,
  } = params;
  const cacheKey = getConnectorCacheKey({
    userName,
    connectorName,
    universe,
    accountId,
  });
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
    universe,
    accountId,
    deploymentId,
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
  const connectorPrefix = [userName, connectorName].join(':') + ':';
  for (const cache of [state.coinKlineCache, state.preparedDataCache]) {
    for (const key of cache.keys()) {
      if (key.startsWith(connectorPrefix) && key.split(':').includes(symbol)) {
        cache.delete(key);
      }
    }
  }
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
  interval: Interval;
  universe?: Test['universe'];
  accountId?: string;
  deploymentId?: string;
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
    interval,
    universe = 'crypto',
    accountId,
    deploymentId,
  } = params;
  const binanceConnector =
    universe === 'crypto'
      ? await getCachedConnector({
          state,
          projectRoot,
          userName,
          connectorName: BUILTIN_CONNECTOR_NAMES.Binance,
        })
      : undefined;
  const coinbaseConnector =
    universe === 'crypto'
      ? await getCachedConnector({
          state,
          projectRoot,
          userName,
          connectorName: BUILTIN_CONNECTOR_NAMES.Coinbase,
        })
      : undefined;

  const cacheOnly = true;
  const connector = await getCachedConnector({
    state,
    projectRoot,
    userName,
    connectorName,
    universe,
    accountId,
    deploymentId,
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

  const coinCacheKey = getKlineCacheKey({
    userName,
    connectorName,
    symbol,
    preloadStart,
    end,
    interval,
    cacheOnly,
    universe,
    accountId,
  });
  const btcCacheKey = getKlineCacheKey({
    userName,
    connectorName,
    symbol: 'BTCUSDT',
    preloadStart,
    end,
    interval,
    cacheOnly,
    universe,
    accountId,
  });
  const ethCacheKey = getKlineCacheKey({
    userName,
    connectorName,
    symbol: 'ETHUSDT',
    preloadStart,
    end,
    interval,
    cacheOnly,
    universe,
    accountId,
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
    universe: 'crypto',
  });
  const btcCoinbaseCacheKey = getKlineCacheKey({
    userName,
    connectorName: btcCoinbaseConnectorName,
    symbol: 'BTCUSDT',
    preloadStart,
    end,
    interval,
    cacheOnly,
    universe: 'crypto',
  });

  const cachedCoinData = state.coinKlineCache.get(coinCacheKey);
  const cachedBtcData = state.btcKlineCache.get(btcCacheKey);
  const cachedEthData = state.ethKlineCache.get(ethCacheKey);
  const cachedBtcBinanceData =
    state.btcBinanceKlineCache.get(btcBinanceCacheKey);
  const cachedBtcCoinbaseData =
    state.btcCoinbaseKlineCache.get(btcCoinbaseCacheKey);
  const backtestExecutionInterval = resolveBacktestExecutionInterval(interval);
  const backtestExecutionCacheInterval = backtestExecutionInterval ?? interval;
  const shouldLoadExecutionCandles =
    backtestExecutionInterval != null &&
    shouldLoadBacktestExecutionCandles(interval);
  const executionCoinCacheKey = getKlineCacheKey({
    userName,
    connectorName,
    symbol,
    preloadStart,
    end,
    interval: backtestExecutionCacheInterval,
    cacheOnly,
    universe,
    accountId,
  });
  const executionBtcCacheKey = getKlineCacheKey({
    userName,
    connectorName,
    symbol: 'BTCUSDT',
    preloadStart,
    end,
    interval: backtestExecutionCacheInterval,
    cacheOnly,
    universe,
    accountId,
  });
  const cachedExecutionCoinData = shouldLoadExecutionCandles
    ? state.coinKlineCache.get(executionCoinCacheKey)
    : undefined;
  const cachedExecutionBtcData = shouldLoadExecutionCandles
    ? state.btcKlineCache.get(executionBtcCacheKey)
    : undefined;
  const preparedDataCacheKey = getPreparedDataCacheKey({
    userName,
    connectorName,
    symbol,
    preloadStart,
    start,
    end,
    interval,
    backtestExecutionInterval: backtestExecutionCacheInterval,
    btcBinanceConnectorName,
    btcCoinbaseConnectorName,
    universe,
    accountId,
  });

  const cachedPreparedData = state.preparedDataCache.get(preparedDataCacheKey);
  if (cachedPreparedData) {
    return cachedPreparedData;
  }

  const btcDataPromise: Promise<KlineChartData> =
    universe === 'tradfi'
      ? Promise.resolve([])
      : cachedBtcData
        ? Promise.resolve(cachedBtcData)
        : connector.kline({
            symbol: 'BTCUSDT',
            start: preloadStart,
            end,
            interval,
            silent: true,
            cacheOnly,
          });
  const ethDataPromise: Promise<KlineChartData> =
    universe === 'tradfi'
      ? Promise.resolve([])
      : cachedEthData
        ? Promise.resolve(cachedEthData)
        : connector.kline({
            symbol: 'ETHUSDT',
            start: preloadStart,
            end,
            interval,
            silent: true,
            cacheOnly,
          });
  const btcBinanceDataPromise: Promise<KlineChartData> =
    universe === 'tradfi'
      ? Promise.resolve([])
      : cachedBtcBinanceData
        ? Promise.resolve(cachedBtcBinanceData)
        : btcBinanceCacheKey === btcCacheKey
          ? btcDataPromise
          : (binanceConnector ?? connector).kline({
              symbol: 'BTCUSDT',
              start: preloadStart,
              end,
              interval,
              silent: true,
              cacheOnly,
            });
  const btcCoinbaseDataPromise: Promise<KlineChartData> =
    universe === 'tradfi'
      ? Promise.resolve([])
      : cachedBtcCoinbaseData
        ? Promise.resolve(cachedBtcCoinbaseData)
        : btcCoinbaseCacheKey === btcCacheKey
          ? btcDataPromise
          : (coinbaseConnector ?? connector).kline({
              symbol: 'BTCUSDT',
              start: preloadStart,
              end,
              interval,
              silent: true,
              cacheOnly,
            });
  const executionDataPromise: Promise<KlineChartData> =
    !shouldLoadExecutionCandles
      ? Promise.resolve([])
      : cachedExecutionCoinData
        ? Promise.resolve(cachedExecutionCoinData)
        : connector.kline({
            symbol,
            start: preloadStart,
            end,
            interval: backtestExecutionInterval!,
            silent: true,
            cacheOnly,
          });
  const executionBtcDataPromise: Promise<KlineChartData> =
    universe === 'tradfi' || !shouldLoadExecutionCandles
      ? Promise.resolve([])
      : cachedExecutionBtcData
        ? Promise.resolve(cachedExecutionBtcData)
        : connector.kline({
            symbol: 'BTCUSDT',
            start: preloadStart,
            end,
            interval: backtestExecutionInterval!,
            silent: true,
            cacheOnly,
          });

  const [
    dataRaw,
    btcDataRaw,
    ethDataRaw,
    btcBinanceDataRaw,
    btcCoinbaseDataRaw,
    executionDataRaw,
    executionBtcDataRaw,
  ] = await Promise.all([
    cachedCoinData
      ? Promise.resolve(cachedCoinData)
      : connector.kline({
          symbol,
          start: preloadStart,
          end,
          interval,
          silent: true,
          cacheOnly,
        }),
    btcDataPromise,
    ethDataPromise,
    btcBinanceDataPromise,
    btcCoinbaseDataPromise,
    executionDataPromise,
    executionBtcDataPromise,
  ]);

  if (!cachedCoinData) {
    state.coinKlineCache.set(coinCacheKey, dataRaw);
  }
  if (!cachedBtcData) {
    state.btcKlineCache.set(btcCacheKey, btcDataRaw);
  }
  if (!cachedEthData) {
    state.ethKlineCache.set(ethCacheKey, ethDataRaw);
  }
  if (!cachedBtcBinanceData) {
    state.btcBinanceKlineCache.set(btcBinanceCacheKey, btcBinanceDataRaw);
  }
  if (!cachedBtcCoinbaseData) {
    state.btcCoinbaseKlineCache.set(btcCoinbaseCacheKey, btcCoinbaseDataRaw);
  }
  if (shouldLoadExecutionCandles && !cachedExecutionCoinData) {
    state.coinKlineCache.set(executionCoinCacheKey, executionDataRaw);
  }
  if (shouldLoadExecutionCandles && !cachedExecutionBtcData) {
    state.btcKlineCache.set(executionBtcCacheKey, executionBtcDataRaw);
  }

  const aligned =
    universe === 'tradfi'
      ? { alignedCoinCandles: dataRaw, alignedBtcCandles: dataRaw }
      : alignSortedCandlesByTimestamp(dataRaw, btcDataRaw);
  const { data, btcData } = filterClosedAlignedCandles(
    aligned.alignedCoinCandles,
    aligned.alignedBtcCandles,
    interval,
  );
  const btcBinanceData =
    universe === 'tradfi'
      ? []
      : alignSortedCandlesByTimestamp(data, btcBinanceDataRaw)
          .alignedBtcCandles;
  const btcCoinbaseData =
    universe === 'tradfi'
      ? []
      : alignSortedCandlesByTimestamp(data, btcCoinbaseDataRaw)
          .alignedBtcCandles;
  const ethData =
    universe === 'tradfi'
      ? []
      : alignSortedCandlesByTimestamp(data, ethDataRaw).alignedBtcCandles;
  const alignedExecution = shouldLoadExecutionCandles
    ? universe === 'tradfi'
      ? {
          alignedCoinCandles: executionDataRaw,
          alignedBtcCandles: executionDataRaw,
        }
      : alignSortedCandlesByTimestamp(executionDataRaw, executionBtcDataRaw)
    : { alignedCoinCandles: [], alignedBtcCandles: [] };
  const { data: backtestExecutionData, btcData: backtestExecutionBtcData } =
    filterClosedAlignedCandles(
      alignedExecution.alignedCoinCandles,
      alignedExecution.alignedBtcCandles,
      backtestExecutionCacheInterval,
    );
  const backtestExecutionDataByTimestamp = buildCandleByTimestamp(
    backtestExecutionData,
  );
  const backtestExecutionBtcDataByTimestamp = buildCandleByTimestamp(
    backtestExecutionBtcData,
  );

  const { prevData, testData } = splitCandlesForTesting(
    data,
    start,
    preloadStart,
  );
  const { prevData: btcPrevData, testData: btcTestData } =
    splitCandlesForTesting(btcData, start, preloadStart);
  const { prevData: ethPrevData, testData: ethTestData } =
    splitCandlesForTesting(ethData, start, preloadStart);
  const preparedData = {
    data,
    btcData,
    ethData,
    prevData,
    btcPrevData,
    ethPrevData,
    testData,
    btcTestData,
    ethTestData,
    btcBinanceData,
    btcCoinbaseData,
    backtestExecutionInterval: backtestExecutionCacheInterval,
    backtestExecutionData,
    backtestExecutionBtcData,
    backtestExecutionDataByTimestamp,
    backtestExecutionBtcDataByTimestamp,
  };
  state.preparedDataCache.set(preparedDataCacheKey, preparedData);

  return preparedData;
};

export const canRunTestsInSharedCandleLoop = (tests: Test[]): boolean => {
  if (tests.length <= 1) {
    return false;
  }

  const first = tests[0];
  const firstStart = first.options?.start;
  const firstEnd = first.options?.end;
  return tests.every(
    (test) =>
      test.userName === first.userName &&
      test.connectorName === first.connectorName &&
      (test.universe ?? 'crypto') === (first.universe ?? 'crypto') &&
      (test.accountId ?? null) === (first.accountId ?? null) &&
      (test.deploymentId ?? null) === (first.deploymentId ?? null) &&
      test.symbol === first.symbol &&
      test.strategyName === first.strategyName &&
      test.options?.start === firstStart &&
      test.options?.end === firstEnd &&
      Boolean(test.ml) === Boolean(first.ml) &&
      Boolean(test.ai) === Boolean(first.ai) &&
      Boolean(test.fast) === Boolean(first.fast) &&
      Boolean(test.collectReplaySignalEvaluations) ===
        Boolean(first.collectReplaySignalEvaluations) &&
      (test.interval ?? BACKTEST_INTERVAL) ===
        (first.interval ?? BACKTEST_INTERVAL) &&
      (test.timeoutMs ?? null) === (first.timeoutMs ?? null),
  );
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
  universe = 'crypto',
  assetClass,
  instrument: requestedInstrument,
  accountId,
  deploymentId,
  policyProfileId,
  interval = BACKTEST_INTERVAL,
  ml = false,
  ai = false,
  fast = false,
  collectReplaySignalEvaluations = false,
  chunkId = 'single',
  backtestRunId,
  backtestTestKey,
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
  const strategyCandleTimeoutMs = getStrategyCandleTimeoutMs();
  const formatTimeoutMessage = (stage: string, stageTimeoutMs: number) =>
    `Test ${name} (${symbol}) timed out after ${stageTimeoutMs}ms during ${stage}`;
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
    stageTimeoutOverrideMs: number | null = null,
  ): Promise<T> => {
    const stageTimeoutMs = getEffectiveTimeoutMs(
      getStageTimeoutMs() ?? undefined,
      stageTimeoutOverrideMs,
    );
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
        reject(new Error(formatTimeoutMessage(stage, stageTimeoutMs)));
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
  const runStrategyCandleStage = <T>(
    stage: string,
    fn: () => Promise<T>,
  ): Promise<T> => withTimeout(stage, fn(), strategyCandleTimeoutMs);

  const { projectRoot, state } = getTestingKlineCacheState();

  const connector = await withTimeout(
    'connector init',
    getCachedConnector({
      state,
      projectRoot,
      userName,
      connectorName,
      universe,
      accountId,
      deploymentId,
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
      interval,
      universe,
      accountId,
      deploymentId,
    }),
  );

  if (!preparedData) {
    throw new Error('Prepared backtest data not available');
  }

  const {
    prevData,
    btcPrevData,
    ethPrevData,
    ethTestData,
    testData,
    btcTestData,
    btcBinanceData,
    btcCoinbaseData,
    backtestExecutionInterval,
    backtestExecutionData,
    backtestExecutionBtcData,
    backtestExecutionDataByTimestamp,
    backtestExecutionBtcDataByTimestamp,
  } = preparedData;
  const runtimePrevData = prevData.slice();
  const runtimeBtcPrevData = btcPrevData.slice();
  const runtimeEthData = [...ethPrevData, ...ethTestData];
  totalCandles = testData.length;

  const instrument = requestedInstrument;
  const { model: executionCostModel, fundingRates } =
    await resolveExecutionCosts({
      connector,
      symbol,
      config: strategyConfig,
      startTime: start,
      endTime: end,
      instrument,
    });

  const testConnector = createTestConnector(connector, {
    userName,
    mlEnabled: ml,
    aiEnabled: ai,
    fastMode: fast,
    executionCostModel,
    fundingRates,
  });

  const strategy = await withTimeout(
    'strategy init',
    strategyCreator({
      userName,
      connectorName,
      universe,
      assetClass: assetClass ?? instrument?.assetClass,
      instrument,
      accountId,
      deploymentId,
      policyProfileId,
      config: {
        ...strategyConfig,
        INTERVAL: interval,
      },
      symbol,
      data: runtimePrevData,
      btcData: runtimeBtcPrevData,
      ethData: runtimeEthData,
      btcBinanceData,
      btcCoinbaseData,
      backtestExecutionMarketData: {
        interval: backtestExecutionInterval,
        data: backtestExecutionData,
        btcData: backtestExecutionBtcData,
        dataByTimestamp: backtestExecutionDataByTimestamp,
        btcDataByTimestamp: backtestExecutionBtcDataByTimestamp,
      },
      connector: testConnector,
    }),
  );

  const pendingMlPayloadBySignalId = new Map<
    string,
    ReturnType<typeof buildMlPayload>
  >();
  const pendingAiRowBySignalId = new Map<string, PendingAiDatasetRow>();
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
        const row = {
          ...trimMlTrainingRowWindows(fullRow, 5),
          ...buildBacktestDatasetMetadata({
            backtestRunId,
            backtestTestKey,
            chunkId,
          }),
        };
        await appendMlDatasetRow({
          strategyName,
          chunkId,
          row,
        });
      }

      const aiRowBase = pendingAiRowBySignalId.get(resultRecord.signalId);
      if (aiRowBase) {
        pendingAiRowBySignalId.delete(resultRecord.signalId);
        const { signal: aiSignal, ...rowBase } = aiRowBase;
        await appendAiDatasetRow({
          strategyName,
          chunkId,
          row: {
            ...rowBase,
            payload: buildAiPayload(aiSignal),
            profit: resultRecord.profit,
            tradeResult: resultRecord.tradeResult,
          },
        });
      }
    }
  };
  const processSignal = async (
    signal: string | Signal | undefined,
    candle: Candle,
  ) => {
    if (isBacktestEntryDelayControlCode(signal)) {
      return;
    }

    if (replaySignalEvaluations) {
      replaySignalEvaluations.push(
        buildReplaySignalEvaluationRecord({
          signal,
          testId,
          userName,
          strategyName,
          symbol,
          interval,
          candle,
        }),
      );
    }
    const shouldCapturePayload =
      signal && typeof signal !== 'string' && signal.signalId && (ml || ai);
    if (shouldCapturePayload) {
      await withTimeout(
        'binance market context',
        enrichSignalWithBinanceMarketContext({
          signal: signal as Signal,
          env: 'BACKTEST',
        }),
      );
      await withTimeout(
        'coinmarketcap context',
        enrichSignalWithCoinMarketCapContext({
          signal: signal as Signal,
          env: 'BACKTEST',
          enabled: Boolean(ml || ai),
        }),
      );
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
        signal: cloneAiPayloadSignal(signal as Signal),
        testId,
        testSuiteId,
        testName: name,
        configId,
        connectorName,
        ...buildBacktestDatasetMetadata({
          backtestRunId,
          backtestTestKey,
          chunkId,
        }),
      });
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
    // Delayed entries are previous-bar signals filled on this bar, so they
    // must be live before this bar's TP/SL checks.
    const delayedSignal = await runStrategyCandleStage(
      'delayed entry',
      async () =>
        (
          strategy as BacktestDelayedEntryStrategy
        ).__tradejsFlushBacktestDelayedEntry?.(candle, btcCandle),
    );
    if (delayedSignal && typeof delayedSignal !== 'string') {
      await processSignal(delayedSignal, candle);
    }

    // Process exits on the current candle first. Any position opened below
    // can only be closed starting from the next candle to avoid same-bar lookahead.
    await runStage('exit checks', () => testConnector.checkExits(candle));

    const signal = await runStrategyCandleStage('strategy signal', () =>
      strategy(candle, btcCandle),
    );
    await processSignal(signal, candle);

    if ((candleIndex + 1) % CLOSED_RESULT_FLUSH_INTERVAL === 0) {
      await withTimeout('flush closed results', flushClosedResultsBatch());
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

export const testingGroupInSharedCandleLoop = async (
  tests: Test[],
): Promise<TestingGroupResult[]> => {
  if (!canRunTestsInSharedCandleLoop(tests)) {
    const results: TestingGroupResult[] = [];
    for (const test of tests) {
      const result = await testing(test);
      if (result) {
        results.push({ test, result });
      }
    }
    return results;
  }

  const first = tests[0];
  const {
    userName,
    symbol,
    options: { start, end },
    strategyName,
    connectorName,
    universe = 'crypto',
    accountId,
    deploymentId,
    interval = BACKTEST_INTERVAL,
    ml = false,
    ai = false,
    fast = false,
    collectReplaySignalEvaluations = false,
    chunkId = 'single',
    timeoutMs,
  } = first;
  if (!start) {
    throw new Error('no start');
  }

  const preloadStart = getBacktestPreloadStart(start);
  const startedAt = Date.now();
  let activeStageStartedAt = startedAt;
  let lastProgressSentAt = 0;
  let lastProgressSignature = '';
  let currentCandleIndex = 0;
  let totalCandles = 0;
  const strategyCandleTimeoutMs = getStrategyCandleTimeoutMs();
  const formatTimeoutMessage = (stage: string, stageTimeoutMs: number) =>
    `Test group ${strategyName}/${symbol} timed out after ${stageTimeoutMs}ms during ${stage}`;
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
      testName: first.name,
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
    stageTimeoutOverrideMs: number | null = null,
  ): Promise<T> => {
    const stageTimeoutMs = getEffectiveTimeoutMs(
      getStageTimeoutMs() ?? undefined,
      stageTimeoutOverrideMs,
    );
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
        reject(new Error(formatTimeoutMessage(stage, stageTimeoutMs)));
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
  const runStrategyCandleStage = <T>(
    stage: string,
    fn: () => Promise<T>,
  ): Promise<T> => withTimeout(stage, fn(), strategyCandleTimeoutMs);

  const { projectRoot, state } = getTestingKlineCacheState();
  const connector = await withTimeout(
    'connector init',
    getCachedConnector({
      state,
      projectRoot,
      userName,
      connectorName,
      universe,
      accountId,
      deploymentId,
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
      interval,
      universe,
      accountId,
      deploymentId,
    }),
  );
  if (!preparedData) {
    throw new Error('Prepared backtest data not available');
  }

  const {
    prevData,
    btcPrevData,
    ethPrevData,
    ethTestData,
    testData,
    btcTestData,
    btcBinanceData,
    btcCoinbaseData,
    backtestExecutionInterval,
    backtestExecutionData,
    backtestExecutionBtcData,
    backtestExecutionDataByTimestamp,
    backtestExecutionBtcDataByTimestamp,
  } = preparedData;
  totalCandles = testData.length;

  const sharedIndicatorsReplayKey = [
    'shared',
    userName,
    connectorName,
    strategyName,
    symbol,
    interval,
    start,
    end,
    chunkId,
  ].join(':');

  type Runner = {
    test: Test;
    strategy: BacktestDetectorOptimizedStrategy;
    testConnector: ReturnType<typeof createTestConnector>;
    pendingMlPayloadBySignalId: Map<string, ReturnType<typeof buildMlPayload>>;
    pendingAiRowBySignalId: Map<string, PendingAiDatasetRow>;
    replaySignalEvaluations: RuntimeSignalEvaluationRecord[] | null;
  };

  const runners: Runner[] = [];
  try {
    for (const test of tests) {
      const instrument = test.instrument;
      const { model: executionCostModel, fundingRates } =
        await resolveExecutionCosts({
          connector,
          symbol: test.symbol,
          config: test.strategyConfig,
          startTime: start,
          endTime: end,
          instrument,
        });
      const testConnector = createTestConnector(connector, {
        userName: test.userName,
        mlEnabled: test.ml,
        aiEnabled: test.ai,
        fastMode: test.fast,
        executionCostModel,
        fundingRates,
      });
      const strategy = (await withTimeout(
        'strategy init',
        strategyCreator({
          userName: test.userName,
          connectorName: test.connectorName,
          universe: test.universe ?? universe,
          assetClass: test.assetClass ?? instrument?.assetClass,
          instrument,
          accountId: test.accountId ?? accountId,
          deploymentId: test.deploymentId ?? deploymentId,
          policyProfileId: test.policyProfileId,
          config: {
            ...test.strategyConfig,
            INTERVAL: test.interval ?? interval,
          },
          symbol: test.symbol,
          data: prevData.slice(),
          btcData: btcPrevData.slice(),
          ethData: [...ethPrevData, ...ethTestData],
          btcBinanceData,
          btcCoinbaseData,
          backtestExecutionMarketData: {
            interval: backtestExecutionInterval,
            data: backtestExecutionData,
            btcData: backtestExecutionBtcData,
            dataByTimestamp: backtestExecutionDataByTimestamp,
            btcDataByTimestamp: backtestExecutionBtcDataByTimestamp,
          },
          connector: testConnector,
          sharedIndicatorsReplayKey,
        }),
      )) as BacktestDetectorOptimizedStrategy;

      runners.push({
        test,
        strategy,
        testConnector,
        pendingMlPayloadBySignalId: new Map(),
        pendingAiRowBySignalId: new Map(),
        replaySignalEvaluations: collectReplaySignalEvaluations ? [] : null,
      });
    }

    const flushClosedResultsBatch = async (runner: Runner) => {
      if (!runner.test.ml && !runner.test.ai) return;
      const batch = await runner.testConnector.drainMlResultsBatch();
      if (!batch.length) return;

      for (const resultRecord of batch) {
        const payload = runner.pendingMlPayloadBySignalId.get(
          resultRecord.signalId,
        );
        if (payload) {
          runner.pendingMlPayloadBySignalId.delete(resultRecord.signalId);

          const fullRow = buildMlTrainingRow(payload, {
            profit: resultRecord.profit,
          });
          const resolvedChunkId = runner.test.chunkId ?? 'single';
          const row = {
            ...trimMlTrainingRowWindows(fullRow, 5),
            ...buildBacktestDatasetMetadata({
              backtestRunId: runner.test.backtestRunId,
              backtestTestKey: runner.test.backtestTestKey,
              chunkId: resolvedChunkId,
            }),
          };
          await appendMlDatasetRow({
            strategyName: runner.test.strategyName,
            chunkId: resolvedChunkId,
            row,
          });
        }

        const aiRowBase = runner.pendingAiRowBySignalId.get(
          resultRecord.signalId,
        );
        if (aiRowBase) {
          runner.pendingAiRowBySignalId.delete(resultRecord.signalId);
          const { signal: aiSignal, ...rowBase } = aiRowBase;
          const resolvedChunkId = runner.test.chunkId ?? 'single';
          await appendAiDatasetRow({
            strategyName: runner.test.strategyName,
            chunkId: resolvedChunkId,
            row: {
              ...rowBase,
              payload: buildAiPayload(aiSignal),
              profit: resultRecord.profit,
              tradeResult: resultRecord.tradeResult,
            },
          });
        }
      }
    };
    const processRunnerSignal = async (
      runner: Runner,
      signal: string | Signal | undefined,
      candle: Candle,
    ) => {
      if (isBacktestEntryDelayControlCode(signal)) {
        return;
      }

      const { test } = runner;
      if (runner.replaySignalEvaluations) {
        runner.replaySignalEvaluations.push(
          buildReplaySignalEvaluationRecord({
            signal,
            testId: test.testId,
            userName: test.userName,
            strategyName: test.strategyName,
            symbol: test.symbol,
            interval: test.interval ?? interval,
            candle,
          }),
        );
      }

      const shouldCapturePayload =
        signal &&
        typeof signal !== 'string' &&
        signal.signalId &&
        (test.ml || test.ai);
      if (shouldCapturePayload) {
        await withTimeout(
          'binance market context',
          enrichSignalWithBinanceMarketContext({
            signal: signal as Signal,
            env: 'BACKTEST',
          }),
        );
        await withTimeout(
          'coinmarketcap context',
          enrichSignalWithCoinMarketCapContext({
            signal: signal as Signal,
            env: 'BACKTEST',
            enabled: Boolean(test.ml || test.ai),
          }),
        );
        await withTimeout(
          'derivatives context',
          enrichSignalWithDerivativesContext({
            signal: signal as Signal,
            env: 'BACKTEST',
          }),
        );
      }
      if (test.ml && signal && typeof signal !== 'string' && signal.signalId) {
        const payload = buildMlPayload({
          signal,
          context: {
            userName: test.userName,
            testId: test.testId,
            testSuiteId: test.testSuiteId,
            testName: test.name,
            configId: test.configId,
            symbol: test.symbol,
            strategyName: test.strategyName,
            strategyConfig: test.strategyConfig,
            connectorName: test.connectorName,
          },
        });
        runner.pendingMlPayloadBySignalId.set(signal.signalId, payload);
      }
      if (test.ai && signal && typeof signal !== 'string' && signal.signalId) {
        runner.pendingAiRowBySignalId.set(signal.signalId, {
          signalId: signal.signalId,
          strategyName: signal.strategy || test.strategyName,
          symbol: signal.symbol || test.symbol,
          direction: signal.direction,
          timestamp: signal.timestamp,
          signal: cloneAiPayloadSignal(signal as Signal),
          testId: test.testId,
          testSuiteId: test.testSuiteId,
          testName: test.name,
          configId: test.configId,
          connectorName: test.connectorName,
          ...buildBacktestDatasetMetadata({
            backtestRunId: test.backtestRunId,
            backtestTestKey: test.backtestTestKey,
            chunkId: test.chunkId ?? 'single',
          }),
        });
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
      const detectorNoSignalByKey = new Map<string, string>();

      for (const runner of runners) {
        const { test, testConnector, strategy } = runner;
        // Delayed entries are previous-bar signals filled on this bar, so they
        // must be live before this bar's TP/SL checks.
        const delayedSignal = await runStrategyCandleStage(
          'delayed entry',
          async () =>
            (
              strategy as BacktestDelayedEntryStrategy
            ).__tradejsFlushBacktestDelayedEntry?.(candle, btcCandle),
        );
        if (delayedSignal && typeof delayedSignal !== 'string') {
          await processRunnerSignal(runner, delayedSignal, candle);
        }
        await runStage('exit checks', () => testConnector.checkExits(candle));

        const detectorFanoutKey = strategy.detectorFanoutKey;
        const detectorSkipCode = detectorFanoutKey
          ? detectorNoSignalByKey.get(detectorFanoutKey)
          : undefined;
        const signal = await runStrategyCandleStage(
          detectorSkipCode ? 'strategy detector skip' : 'strategy signal',
          () =>
            detectorSkipCode &&
            strategy.canFastAdvanceDetectorNoSignal &&
            strategy.advanceDetectorNoSignal
              ? strategy.advanceDetectorNoSignal(
                  candle,
                  btcCandle,
                  detectorSkipCode,
                )
              : detectorSkipCode && strategy.skipDetectorNoSignal
                ? strategy.skipDetectorNoSignal(
                    candle,
                    btcCandle,
                    detectorSkipCode,
                  )
                : strategy(candle, btcCandle),
        );
        if (
          detectorFanoutKey &&
          strategy.detectorNoSignalSkipReason &&
          typeof signal === 'string' &&
          signal === strategy.detectorNoSignalSkipReason
        ) {
          detectorNoSignalByKey.set(detectorFanoutKey, signal);
        }
        await processRunnerSignal(runner, signal, candle);
      }

      if ((candleIndex + 1) % CLOSED_RESULT_FLUSH_INTERVAL === 0) {
        await withTimeout(
          'flush closed results',
          Promise.all(runners.map((runner) => flushClosedResultsBatch(runner))),
        );
      }
    }

    const results: TestingGroupResult[] = [];
    for (const runner of runners) {
      await withTimeout(
        'flush closed results',
        flushClosedResultsBatch(runner),
      );
      const result = await withTimeout(
        'collect result',
        runner.testConnector.getResult(),
      );
      results.push({
        test: runner.test,
        result: runner.replaySignalEvaluations
          ? {
              ...result,
              inlineReplaySignalEvaluations: runner.replaySignalEvaluations,
            }
          : result,
      });
    }

    return results;
  } finally {
    releaseStrategyIndicatorsReplayCache(sharedIndicatorsReplayKey);
    releaseStrategyReplayCache(sharedIndicatorsReplayKey);
  }
};
