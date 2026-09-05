import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import {
  parseTestName,
  parseBacktestExecutionCosts,
  assertStrategyExecutionIsolation,
} from '@tradejs/core/backtest';
import { BACKTEST_PRELOAD_DAYS, TTL_1M } from '@tradejs/core/constants';
import { formatUnix } from '@tradejs/core/time';
import {
  readCachedBacktestArtifacts,
  writePersistedBacktestOrderLog,
} from '@tradejs/infra/backtestArtifacts';
import { getData, setData, redisKeys } from '@tradejs/infra/redis';
import { getRuntimeDeployment } from '@tradejs/node/runtimeStrategies';
import {
  BACKTEST_WARNING_CODES,
  Item,
  OrderLog,
  PositionLogData,
  RuntimeDeployment,
  Test,
  TestStat,
  TestSuite,
  TestWorkerResult,
} from '@tradejs/types';
import { createTable, createTimestamp, formatDuration } from '../runFormatting';
import { prepareMarketContextForRun } from '../marketContextPrepare';
import {
  loadReplayStrategies as loadReplayStrategiesShared,
  prepareRunEnvironment as prepareRunEnvironmentShared,
  type PreparedRunEnvironment,
  type ResolvedWindow,
} from '../runEnvironment';
import {
  loadRuntimeStrategyBacktestConfigs,
  toStrategyConfigGrid,
  type RuntimeStrategyBacktestConfig,
} from '../runtimeStrategyBacktest';
import {
  effectiveParallel,
  backtestEntryDelayBars,
  backtestPriceMode,
  flags,
  hasExplicitTestsLimit,
  interval,
  isFastMode,
  isUpdateOnlyRun,
  progressStep,
  projectRoot,
  resolveRequestedTestsLimit,
  resultArtifactsIoConcurrency,
  testItemTimeoutMs,
  testsLimit,
  testsSkip,
  userName,
  marketUniverse,
  workerHeapMb,
} from './cliConfig';
import { withBacktestRunDatasetMetadata } from './checkpoint';
import {
  getBestTickerResultForSymbol,
  getPersistedTestSummariesMap,
  getRunCounters,
  getRunStartedAt,
  getTestsStartedAt,
  getTopResults,
  getAggregateAverageProfit,
  getAggregateWinRate,
  getProgressStats,
  incrementErrorTests,
  incrementSuccessTests,
  markTestsStarted,
  recordResultAggregates,
  recordRunError,
  replaceTopResults,
  setBestTickerResultForSymbol,
  setPersistedTestSummary,
  setRuntimeCompareContext,
  type ErrorMessage,
} from './runState';
import { executeBacktestWorkerPool } from './workerPool';

const formatWindowDays = (startMs: number, endMs: number) => {
  const days = Math.max(0, (endMs - startMs) / (24 * 60 * 60 * 1000));
  return Number.isInteger(days) ? String(days) : days.toFixed(2);
};

const getResultAmount = (result: TestWorkerResult) => result.stat.amount ?? 0;
const getResultNetProfit = (result: TestWorkerResult) => {
  const stat = result.stat as typeof result.stat & { netProfit?: number };
  return Number(stat.netProfit ?? stat.profit ?? 0);
};

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
  if (!result?.test?.symbol || !result?.stat) {
    return false;
  }

  const previousResult = getBestTickerResultForSymbol(result.test.symbol);
  if (
    previousResult &&
    getResultNetProfit(previousResult) >= getResultNetProfit(result)
  ) {
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
  const maxSymbolGroupSize = Math.max(
    1,
    Number.parseInt(
      String(process.env.TRADEJS_BACKTEST_SYMBOL_GROUP_MAX_TESTS ?? '16'),
      10,
    ) || 16,
  );
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
    .flatMap(([, tests]) => {
      if (tests.length <= maxSymbolGroupSize) {
        return [tests];
      }

      const groups: TestSuite[] = [];
      for (let index = 0; index < tests.length; index += maxSymbolGroupSize) {
        groups.push(tests.slice(index, index + maxSymbolGroupSize));
      }
      return groups;
    });

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

const getLogsById = async (orderLogId: string) => {
  return (await readCachedBacktestArtifacts({
    userName,
    orderLogId,
    projectRoot,
  })) as {
    orderLog: OrderLog[] | null;
    positionLog: PositionLogData | null;
  };
};

export const resolveResultArtifacts = async (result: TestWorkerResult) =>
  getLogsById(result.orderLogId);

export const setTestData = async (
  test: Test,
  stat: Partial<TestStat>,
  orderLog: OrderLog[],
) => {
  const orderLogRef = await writePersistedBacktestOrderLog({
    userName: test.userName,
    strategyName: test.strategyName,
    testName: test.name,
    orderLog,
    projectRoot,
  });

  await Promise.all([
    setData(
      redisKeys.testOrders(test.userName, test.strategyName, test.name),
      orderLogRef,
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
      expire: TTL_1M,
    },
  );
};

export const loadReplayStrategies = async (): Promise<
  RuntimeStrategyBacktestConfig[]
> => loadReplayStrategiesShared(userName);

export const validateBacktestRuntimeDeployment = ({
  deployment,
  deploymentId,
}: {
  deployment: RuntimeDeployment | null;
  deploymentId?: string;
}) => {
  if (deploymentId && !deployment) {
    throw new Error(`Runtime deployment not found: ${deploymentId}`);
  }
  if (deployment && !deployment.enabled) {
    throw new Error(`Runtime deployment is disabled: ${deployment.id}`);
  }
  return deployment;
};

export const prepareRunEnvironment = async (
  strategyName?: string,
): Promise<PreparedRunEnvironment | null> => {
  const deployment = validateBacktestRuntimeDeployment({
    deployment: flags.deployment
      ? await getRuntimeDeployment({
          userName,
          projectRoot,
          deploymentId: String(flags.deployment),
        })
      : null,
    deploymentId:
      typeof flags.deployment === 'string' ? flags.deployment : undefined,
  });
  const runtimeStrategy = strategyName
    ? deployment?.strategies.find(
        (strategy) => strategy.strategyName === strategyName,
      )
    : undefined;
  const preparedRun = await prepareRunEnvironmentShared({
    connector: deployment?.connectorName ?? flags.connector,
    userName,
    tickers:
      flags.tickers ||
      runtimeStrategy?.selection?.tickers?.join(',') ||
      deployment?.tickers?.join(','),
    exclude: flags.exclude,
    tickersLimit: flags.tickersLimit,
    showTickersList: flags.showTickersList,
    days: flags.days,
    startTime: flags.startTime,
    endTime: flags.endTime,
    cacheOnly: flags.cacheOnly,
    interval,
    projectRoot,
    universe: marketUniverse,
    accountId: deployment?.accountId ?? flags.account,
    deploymentId: deployment?.id,
    assetClasses: deployment?.assetClasses,
    deployment,
  });
  if (!preparedRun) {
    return null;
  }

  setRuntimeCompareContext({
    connector: preparedRun.marketConnector,
    connectorName: preparedRun.connectorName,
    window: {
      start: preparedRun.window.start,
      end: preparedRun.window.end,
    },
  });

  return preparedRun;
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
  const executionCosts =
    flags.executionCosts == null
      ? undefined
      : parseBacktestExecutionCosts(JSON.parse(String(flags.executionCosts)));
  for (const test of testSuite)
    assertStrategyExecutionIsolation(test.strategyConfig);
  const aiEnabled = Boolean(flags.ai);
  const requestedTestsLimit = resolveRequestedTestsLimit({
    isLiveMode: isReplay,
    requestedLimit: testsLimit,
    hasExplicitLimit: hasExplicitTestsLimit,
  });
  const preparedSuite = testSuite
    .map((test) => ({
      ...test,
      interval,
      executionCosts: executionCosts ?? test.executionCosts,
      executionCostsCacheOnly: Boolean(flags.cacheOnly),
      strategyConfig: {
        ...test.strategyConfig,
        ENV: 'BACKTEST',
        INTERVAL: interval,
        MAKE_ORDERS: true,
        CLOSE_OPPOSITE_POSITIONS: false,
        BACKTEST_PRICE_MODE: backtestPriceMode,
        BACKTEST_ENTRY_DELAY_BARS: backtestEntryDelayBars,
      },
      options: {
        start: window.start,
        end: window.end,
      },
      ml: mlEnabled,
      ai: aiEnabled,
      researchTrace: Boolean(flags.researchTrace),
      fast: isFastMode,
      timeoutMs: testItemTimeoutMs,
    }))
    .slice(
      testsSkip,
      Number.isFinite(requestedTestsLimit)
        ? testsSkip + requestedTestsLimit
        : undefined,
    );

  if (!preparedSuite.length) {
    throw new Error(
      `No backtest tests selected (available=${testSuite.length}, skip=${testsSkip}, limit=${
        Number.isFinite(requestedTestsLimit) ? requestedTestsLimit : 'all'
      }).`,
    );
  }

  await prepareMarketContextForRun({
    mode: 'backtest',
    userName,
    projectRoot,
    symbols: preparedSuite.map((test) => test.symbol),
    universe: preparedSuite[0]?.universe,
    interval,
    startMs: window.start,
    endMs: window.end,
    preloadStartMs: preloadStart,
    cacheOnly: Boolean(flags.cacheOnly),
    aiEnabled,
    mlEnabled,
    strategyNames: Array.from(
      new Set(preparedSuite.map((test) => test.strategyName)),
    ),
    log: (message) => console.log(chalk.gray(message)),
  });

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
      `preload: ${formatUnix(preloadStart)} -> ${formatUnix(window.end)} (${BACKTEST_PRELOAD_DAYS}d preload)`,
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
  onInterrupt,
  onFinish,
  initialCompletedTests = 0,
  totalTests,
  backtestRunId,
}: {
  testSuite: TestSuite;
  window: ResolvedWindow;
  preloadStart: number;
  replayModeLabel?: string;
  onResult: (result: TestWorkerResult) => Promise<void> | void;
  onInterrupt?: (signal: 'SIGINT' | 'SIGTERM') => Promise<void> | void;
  onFinish: () => Promise<void>;
  initialCompletedTests?: number;
  totalTests?: number;
  backtestRunId?: string;
}) => {
  markTestsStarted();
  const { testerWorkerPath, testerNeedsTsRuntime } = resolveTesterWorker();
  const executableTestSuite = withBacktestRunDatasetMetadata({
    runId: backtestRunId,
    testSuite,
  });
  await executeBacktestWorkerPool({
    testSuite: executableTestSuite,
    userName,
    progressStep,
    workerHeapMb,
    testerWorkerPath,
    testerNeedsTsRuntime,
    introLines: buildRunIntroLines({
      testSuite: executableTestSuite,
      window,
      preloadStart,
      replayModeLabel,
    }),
    chunkTestSuite: (suite) => chunkTestSuiteBySymbol(suite, effectiveParallel),
    initialCompletedTests,
    totalTests,
    onInterrupt,
    onMessage: async (msg) => {
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
      recordResultAggregates(msg as TestWorkerResult);
      await onResult(msg as TestWorkerResult);
    },
    onWorkerError: (message) => {
      recordError({ error: message });
      console.error(chalk.red(message));
    },
    getProgressSnapshot: () => {
      const aggregate = getProgressStats();
      return {
        averageProfit: getAggregateAverageProfit(aggregate),
        tradesCount: aggregate.ordersSum,
        winRate: getAggregateWinRate(aggregate),
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
  const { successTests, errorTests, warningCounts } = getRunCounters();
  console.log(`${chalk.green('SUCCESS TESTS')}: ${successTests}`);
  console.log(`${chalk.red('ERRORS')}: ${errorTests}`);
  const takeProfitCrossedWarnings =
    warningCounts[BACKTEST_WARNING_CODES.TAKE_PROFIT_CROSSED_BEFORE_ENTRY] ?? 0;
  console.log(
    chalk.yellow(
      `WARNINGS (${BACKTEST_WARNING_CODES.TAKE_PROFIT_CROSSED_BEFORE_ENTRY}): ${takeProfitCrossedWarnings}`,
    ),
  );
  console.log('');
};

export {
  createTable,
  createTimestamp,
  effectiveParallel,
  flags,
  interval,
  isUpdateOnlyRun,
  isFastMode,
  loadRuntimeStrategyBacktestConfigs,
  projectRoot,
  resultArtifactsIoConcurrency,
  toStrategyConfigGrid,
  userName,
};

export type { RuntimeStrategyBacktestConfig };
