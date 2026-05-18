const ListIt = require('list-it');
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { format } from 'date-fns';
import { ConnectorNames } from '@tradejs/connectors';
import {
  DEFAULT_CONNECTOR_NAME,
  getConnectorCreatorByName,
  resolveConnectorName,
} from '@tradejs/node/connectors';
import { getTickers, update } from '@tradejs/node/cli';
import { parseTestName } from '@tradejs/core/backtest';
import { runWithConcurrency } from '@tradejs/core/async';
import {
  BACKTEST_DEFAULT_DAYS,
  BACKTEST_PRELOAD_DAYS,
  TTL_1M,
} from '@tradejs/core/constants';
import {
  formatUnix,
  getBacktestPreloadStart,
  getTimestamp,
} from '@tradejs/core/time';
import { getData, setData, redisKeys } from '@tradejs/infra/redis';
import {
  Connector,
  ConnectorCreator,
  Interval,
  Item,
  OrderLog,
  PositionLogData,
  StrategyConfig,
  StrategyConfigGrid,
  Test,
  TestStat,
  TestSuite,
  TestWorkerResult,
} from '@tradejs/types';
import {
  backfillDerivativesContextForBacktest,
  shouldBackfillDerivativesContextForBacktest,
} from '../derivativesContextBackfill';
import { loadRuntimeStrategyConfigs } from '../runtimeRedis';
import { resolveTimeWindow } from '../timeWindow';
import {
  effectiveParallel,
  flags,
  hasExplicitTestsLimit,
  interval,
  isUpdateOnlyRun,
  progressStep,
  projectRoot,
  resolveRequestedTestsLimit,
  resultArtifactsIoConcurrency,
  testItemTimeoutMs,
  testsLimit,
  testsSkip,
  userName,
  workerHeapMb,
} from './cliConfig';
import {
  getBestTickerResultForSymbol,
  getPersistedTestSummariesMap,
  getRunCounters,
  getRunStartedAt,
  getTestsStartedAt,
  getTopResults,
  incrementErrorTests,
  incrementSuccessTests,
  markTestsStarted,
  recordRunError,
  replaceTopResults,
  setBestTickerResultForSymbol,
  setPersistedTestSummary,
  setRuntimeCompareContext,
  type ErrorMessage,
} from './runState';
import { executeBacktestWorkerPool } from './workerPool';

export type ResolvedWindow = {
  start: number;
  end: number;
  source: string;
};

export type PreparedRunEnvironment = {
  connectorName: string;
  marketConnector: Connector;
  tickers: string[];
  window: ResolvedWindow;
  preloadStart: number;
};

export type RuntimeStrategyBacktestConfig = {
  strategyName: string;
  strategyConfig: StrategyConfig;
  backtestConfig: StrategyConfigGrid;
};

const createListIt = () =>
  new ListIt({
    autoAlign: true,
    headerUnderline: true,
  });

export const createTable = (headers: string[], rows: string[][]) =>
  createListIt().setHeaderRow(headers).d(rows).toString();

export const createTimestamp = (date: Date) => format(date, 'yyyyMMddHHmm');

const formatDuration = (startedAt: number) => {
  const seconds = (Date.now() - startedAt) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = Math.round(seconds % 60);
  return `${minutes}m ${restSeconds}s`;
};

const formatWindowDays = (startMs: number, endMs: number) => {
  const days = Math.max(0, (endMs - startMs) / (24 * 60 * 60 * 1000));
  return Number.isInteger(days) ? String(days) : days.toFixed(2);
};

const timeOperation = async <T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const startedAt = Date.now();
  try {
    return await operation();
  } finally {
    console.log(chalk.gray(`${label}: done in ${formatDuration(startedAt)}`));
  }
};

const isGoodTest = (result: TestWorkerResult) =>
  result.stat?.orders > 5 && result.stat?.profit > 10;

const getResultAmount = (result: TestWorkerResult) => result.stat.amount ?? 0;

const recordError = (error: ErrorMessage) => {
  recordRunError(error);
};

const insertTopResult = (
  currentResults: TestWorkerResult[],
  nextResult: TestWorkerResult,
  limit: number,
) => {
  if (limit <= 0) {
    return {
      results: [] as TestWorkerResult[],
      added: false,
    };
  }

  const nextResults = [...currentResults];
  const nextAmount = getResultAmount(nextResult);
  let insertIndex = nextResults.length;

  for (let index = 0; index < nextResults.length; index += 1) {
    if (nextAmount > getResultAmount(nextResults[index])) {
      insertIndex = index;
      break;
    }
  }

  if (insertIndex === nextResults.length && nextResults.length >= limit) {
    return {
      results: currentResults,
      added: false,
    };
  }

  nextResults.splice(insertIndex, 0, nextResult);
  if (nextResults.length > limit) {
    nextResults.length = limit;
  }

  return {
    results: nextResults,
    added: nextResults.some(
      (candidate) => candidate.test.name === nextResult.test.name,
    ),
  };
};

const updateTopResults = (nextResults: TestWorkerResult[]) => {
  replaceTopResults(nextResults);
};

export const updateBestTickerResult = (result: TestWorkerResult) => {
  if (!isGoodTest(result)) {
    return false;
  }

  const previousResult = getBestTickerResultForSymbol(result.test.symbol);
  if (previousResult && previousResult.stat.profit >= result.stat.profit) {
    return false;
  }

  setBestTickerResultForSymbol(result.test.symbol, result);

  return true;
};

export const chunkTestSuiteBySymbol = (
  testSuite: TestSuite,
  requestedChunks: number,
): TestSuite[] => {
  if (!testSuite.length) {
    return [];
  }

  const chunkCount = Math.max(1, Math.min(requestedChunks, testSuite.length));
  const testsBySymbol = new Map<string, TestSuite>();

  for (const test of testSuite) {
    const existing = testsBySymbol.get(test.symbol);
    if (existing) {
      existing.push(test);
      continue;
    }
    testsBySymbol.set(test.symbol, [test]);
  }

  const symbolGroups = Array.from(testsBySymbol.entries())
    .sort(([leftSymbol, leftTests], [rightSymbol, rightTests]) => {
      if (rightTests.length !== leftTests.length) {
        return rightTests.length - leftTests.length;
      }
      return leftSymbol.localeCompare(rightSymbol);
    })
    .map(([, tests]) => tests);

  const workerCount = Math.min(chunkCount, symbolGroups.length);
  const chunks = Array.from({ length: workerCount }, () => [] as TestSuite);
  const chunkSizes = new Array(workerCount).fill(0);

  for (const tests of symbolGroups) {
    let targetIndex = 0;
    for (let index = 1; index < chunks.length; index += 1) {
      if (chunkSizes[index] < chunkSizes[targetIndex]) {
        targetIndex = index;
      }
    }

    chunks[targetIndex].push(...tests);
    chunkSizes[targetIndex] += tests.length;
  }

  return chunks.filter((chunk) => chunk.length > 0);
};

export const toStrategyConfigGrid = (
  strategyConfig: StrategyConfig,
): StrategyConfigGrid =>
  Object.fromEntries(
    Object.entries(strategyConfig).map(([key, value]) => [key, [value]]),
  );

export const loadRuntimeStrategyBacktestConfigs = async (
  userName: string,
): Promise<RuntimeStrategyBacktestConfig[]> => {
  const configs = await loadRuntimeStrategyConfigs(userName, {
    onInvalidConfig: (key) => {
      console.log(chalk.yellow(`Skip invalid runtime strategy config: ${key}`));
    },
  });

  return configs.map(({ strategyName, strategyConfig }) => ({
    strategyName,
    strategyConfig,
    backtestConfig: toStrategyConfigGrid(strategyConfig),
  }));
};

export const mergePersistedTestSummaries = (
  existing: Item[] | null | undefined,
  persisted: Map<string, Item>,
) => {
  const mergedByKey = new Map<string, Item>();

  for (const item of existing || []) {
    const strategyName =
      typeof item?.data?.strategyName === 'string'
        ? item.data.strategyName
        : '';
    if (!strategyName || typeof item?.value !== 'string') {
      continue;
    }
    mergedByKey.set(`${strategyName}:${item.value}`, item);
  }

  for (const [key, item] of persisted) {
    mergedByKey.set(key, item);
  }

  return [...mergedByKey.values()];
};

const resolveBacktestConnectorName = async (
  value: unknown,
): Promise<string> => {
  const connectorName = await resolveConnectorName(value, projectRoot);
  if (connectorName) {
    return connectorName;
  }

  console.log(
    chalk.yellow(
      `Unknown connector "${String(value || '').trim() || String(value)}". Fallback to ${DEFAULT_CONNECTOR_NAME}.`,
    ),
  );
  return DEFAULT_CONNECTOR_NAME;
};

const getLogsById = async (orderLogId: string) => {
  const [orderLog, positionLog] = (await Promise.all([
    getData(redisKeys.cacheOrders(userName, orderLogId), null),
    getData(redisKeys.cachePositions(userName, orderLogId), null),
  ])) as [OrderLog[], PositionLogData];

  return { orderLog, positionLog };
};

export const resolveResultArtifacts = async (result: TestWorkerResult) =>
  getLogsById(result.orderLogId);

export const setTestData = async (
  test: Test,
  stat: Partial<TestStat>,
  orderLog: OrderLog[],
) => {
  await Promise.all([
    setData(
      redisKeys.testOrders(test.userName, test.strategyName, test.name),
      orderLog,
      {
        expire: TTL_1M,
      },
    ),
    setData(
      redisKeys.testConfig(test.userName, test.strategyName, test.name),
      test,
      {
        expire: TTL_1M,
      },
    ),
    setData(
      redisKeys.testStat(test.userName, test.strategyName, test.name),
      stat,
      {
        expire: TTL_1M,
      },
    ),
  ]);

  const { testId } = parseTestName(test.name);
  setPersistedTestSummary(`${test.strategyName}:${test.name}`, {
    value: test.name,
    label: `${test.symbol}_${testId}`,
    description: `${stat.netProfit || 0}$`,
    data: {
      netProfit: stat.netProfit || 0,
      strategyName: test.strategyName,
    },
  });
};

export const persistTestSummariesIndex = async () => {
  const existing = (await getData(redisKeys.testSummaries(userName), [])) as
    | Item[]
    | null;
  await setData(
    redisKeys.testSummaries(userName),
    mergePersistedTestSummaries(existing, getPersistedTestSummariesMap()),
    {
      expire: 0,
    },
  );
};

export const loadReplayStrategies = async (): Promise<
  RuntimeStrategyBacktestConfig[]
> => {
  const runtimeStrategies = await loadRuntimeStrategyBacktestConfigs(userName);
  if (!runtimeStrategies.length) {
    console.log(
      chalk.yellow(
        `No active runtime strategy configs found by users:${userName}:strategies:*:config`,
      ),
    );
    return [];
  }

  return runtimeStrategies;
};

export const prepareRunEnvironment =
  async (): Promise<PreparedRunEnvironment | null> => {
    const connectorName = await resolveBacktestConnectorName(flags.connector);
    const connectorFactory = await getConnectorCreatorByName(
      connectorName,
      projectRoot,
    );
    if (!connectorFactory) {
      throw new Error(`Connector "${connectorName}" is not registered`);
    }
    const marketConnector = await (connectorFactory as ConnectorCreator)({
      userName: flags.user,
    });
    const tickers = await timeOperation('tickers load', () =>
      getTickers(
        marketConnector,
        flags.tickers,
        flags.exclude,
        flags.tickersLimit,
      ),
    );

    if (flags.showTickersList) {
      console.log(chalk.gray(JSON.stringify(tickers.sort(), null, 2)));
      return null;
    }

    const window = resolveTimeWindow({
      days: flags.days,
      startTime: flags.startTime,
      endTime: flags.endTime,
      defaultStartMs: getTimestamp(BACKTEST_DEFAULT_DAYS),
      defaultEndMs: getTimestamp(),
    });
    const preloadStart = getBacktestPreloadStart(
      window.start,
      BACKTEST_PRELOAD_DAYS,
    );

    if (!flags.cacheOnly) {
      await timeOperation(`update ${connectorName}`, () =>
        update(marketConnector, interval, tickers, undefined, {
          connectorLabel: connectorName,
          preloadStart,
          preloadEnd: window.end,
        }),
      );

      const binanceConnectorCreator = await getConnectorCreatorByName(
        ConnectorNames.Binance,
        projectRoot,
      );
      const coinbaseConnectorCreator = await getConnectorCreatorByName(
        ConnectorNames.Coinbase,
        projectRoot,
      );
      if (!binanceConnectorCreator || !coinbaseConnectorCreator) {
        throw new Error('Binance/Coinbase connectors are required');
      }

      const binanceConnector = await (
        binanceConnectorCreator as ConnectorCreator
      )({
        userName: flags.user,
      });
      const coinbaseConnector = await (
        coinbaseConnectorCreator as ConnectorCreator
      )({
        userName: flags.user,
      });
      await timeOperation(`update ${ConnectorNames.Binance}`, () =>
        update(binanceConnector, interval, ['BTCUSDT'], undefined, {
          connectorLabel: ConnectorNames.Binance,
          preloadStart,
          preloadEnd: window.end,
        }),
      );
      await timeOperation(`update ${ConnectorNames.Coinbase}`, () =>
        update(coinbaseConnector, interval, ['BTCUSDT'], undefined, {
          connectorLabel: ConnectorNames.Coinbase,
          preloadStart,
          preloadEnd: window.end,
        }),
      );
    }

    setRuntimeCompareContext({
      connector: marketConnector,
      connectorName,
      window: {
        start: window.start,
        end: window.end,
      },
    });

    return {
      connectorName,
      marketConnector,
      tickers,
      window,
      preloadStart,
    };
  };

export const buildPreparedTestSuite = async ({
  testSuite,
  window,
  preloadStart,
  isReplay,
}: {
  testSuite: TestSuite;
  window: ResolvedWindow;
  preloadStart: number;
  isReplay: boolean;
}): Promise<TestSuite | null> => {
  const mlEnabled = Boolean(flags.ml);
  const aiEnabled = Boolean(flags.ai);
  const requestedTestsLimit = resolveRequestedTestsLimit({
    isLiveMode: isReplay,
    requestedLimit: testsLimit,
    hasExplicitLimit: hasExplicitTestsLimit,
  });
  const preparedSuite = testSuite
    .map((test) => ({
      ...test,
      options: {
        start: window.start,
        end: window.end,
      },
      ml: mlEnabled,
      ai: aiEnabled,
      timeoutMs: testItemTimeoutMs,
    }))
    .slice(
      testsSkip,
      Number.isFinite(requestedTestsLimit)
        ? testsSkip + requestedTestsLimit
        : undefined,
    );

  if (!preparedSuite.length) {
    console.log(
      chalk.yellow(
        `No tests selected (skip=${testsSkip}, limit=${
          Number.isFinite(requestedTestsLimit) ? requestedTestsLimit : 'all'
        }).`,
      ),
    );
    return null;
  }

  if (
    shouldBackfillDerivativesContextForBacktest({
      aiEnabled,
      cacheOnly: Boolean(flags.cacheOnly),
      mlEnabled,
    })
  ) {
    await timeOperation('derivatives context backfill', () =>
      backfillDerivativesContextForBacktest({
        userName,
        symbols: preparedSuite.map((test) => test.symbol),
        startMs: window.start,
        endMs: window.end,
        preloadStartMs: preloadStart,
      }),
    );
  }

  return preparedSuite;
};

export const trackTopResult = (result: TestWorkerResult) => {
  const currentTopResults = getTopResults();
  const nextTopResults = insertTopResult(currentTopResults, result, flags.top);
  if (nextTopResults.added || currentTopResults !== nextTopResults.results) {
    updateTopResults(nextTopResults.results);
  }
};

const buildRunIntroLines = ({
  testSuite,
  window,
  preloadStart,
  replayModeLabel,
}: {
  testSuite: TestSuite;
  window: ResolvedWindow;
  preloadStart: number;
  replayModeLabel?: string;
}) => {
  const lines = [chalk.yellow(`tests: ${testSuite.length}`)];
  if (replayModeLabel) {
    lines.push(chalk.gray(replayModeLabel));
  }
  lines.push(
    chalk.gray(`parallel: ${effectiveParallel}, workerHeapMb: ${workerHeapMb}`),
  );
  lines.push(
    chalk.gray(
      `window: ${formatUnix(window.start)} -> ${formatUnix(window.end)} (${formatWindowDays(window.start, window.end)}d, ${window.source})`,
    ),
  );
  lines.push(
    chalk.gray(
      `preload: ${formatUnix(preloadStart)} -> ${formatUnix(window.end)} (${BACKTEST_PRELOAD_DAYS}d warmup)`,
    ),
  );
  return lines;
};

const resolveTesterWorker = () => {
  const testerWorkerPathCandidates = [
    path.resolve(__dirname, './workers/testerWorker.js'),
    path.resolve(__dirname, '../workers/testerWorker.js'),
    path.resolve(__dirname, '../../workers/testerWorker.js'),
    path.resolve(__dirname, '../../../dist/workers/testerWorker.js'),
    path.resolve(__dirname, '../../workers/testerWorker.ts'),
  ];
  const testerWorkerPath = testerWorkerPathCandidates.find((candidate) =>
    fs.existsSync(candidate),
  );
  if (!testerWorkerPath) {
    throw new Error(
      `Tester worker file not found. Checked: ${testerWorkerPathCandidates.join(', ')}`,
    );
  }

  return {
    testerWorkerPath,
    testerNeedsTsRuntime: testerWorkerPath.endsWith('.ts'),
  };
};

export const executeTestSuite = async ({
  testSuite,
  window,
  preloadStart,
  replayModeLabel,
  onResult,
  onFinish,
}: {
  testSuite: TestSuite;
  window: ResolvedWindow;
  preloadStart: number;
  replayModeLabel?: string;
  onResult: (result: TestWorkerResult) => void;
  onFinish: () => Promise<void>;
}) => {
  markTestsStarted();
  const { testerWorkerPath, testerNeedsTsRuntime } = resolveTesterWorker();
  await executeBacktestWorkerPool({
    testSuite,
    userName,
    progressStep,
    workerHeapMb,
    testerWorkerPath,
    testerNeedsTsRuntime,
    introLines: buildRunIntroLines({
      testSuite,
      window,
      preloadStart,
      replayModeLabel,
    }),
    chunkTestSuite: (suite) => chunkTestSuiteBySymbol(suite, effectiveParallel),
    onMessage: (msg) => {
      if (msg.error) {
        incrementErrorTests();
        recordError({
          id: msg.id,
          error: msg.error,
          payload: msg,
        });

        console.error(
          chalk.red(`Error in test #${msg.id}: ${JSON.stringify(msg)}`),
        );
        return;
      }

      incrementSuccessTests();
      onResult(msg as TestWorkerResult);
    },
    onWorkerError: (message) => {
      recordError({ error: message });
      console.error(chalk.red(message));
    },
    getProgressSnapshot: () => {
      const bestResult = getTopResults()[0];
      return {
        symbol: bestResult?.test.symbol || '-',
        profit: bestResult?.stat.profit || 0,
      };
    },
    onFinish,
  });
};

export const printRunOutro = () => {
  console.log(
    chalk.gray(`tests run: done in ${formatDuration(getTestsStartedAt())}`),
  );
  console.log(
    chalk.gray(`backtest total: done in ${formatDuration(getRunStartedAt())}`),
  );
  console.log('');
  const { successTests, errorTests } = getRunCounters();
  console.log(`${chalk.green('SUCCESS TESTS')}: ${successTests}`);
  console.log(`${chalk.red('ERRORS')}: ${errorTests}`);
  console.log('');
};

export {
  effectiveParallel,
  flags,
  interval,
  isUpdateOnlyRun,
  projectRoot,
  resultArtifactsIoConcurrency,
  userName,
};
