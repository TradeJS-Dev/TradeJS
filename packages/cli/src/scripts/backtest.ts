import chalk from 'chalk';
import ProgressBar from 'progress';
import { drawStatInCLI } from '@tradejs/node/cli';
import { warmBacktestIndicatorCache } from '@tradejs/node/backtest';
import { runWithConcurrency } from '@tradejs/core/async';
import { calculateStatsFull } from '@tradejs/core/backtest';
import { createTestSuite, mergeConfigs } from '@tradejs/core/grid';
import { toJson } from '@tradejs/core/data';
import { buildDefaultIndicatorPeriods } from '@tradejs/core/strategies';
import { getData, setData, redisKeys } from '@tradejs/infra/redis';
import { StrategyConfigGrid, TestStat, TestWorkerResult } from '@tradejs/types';
import { BACKTEST_PRELOAD_DAYS } from '@tradejs/core/constants';
import {
  effectiveParallel,
  buildPreparedTestSuite,
  chunkTestSuiteBySymbol,
  createTimestamp,
  createTable,
  executeTestSuite,
  flags,
  interval,
  isFastMode,
  loadRuntimeStrategyBacktestConfigs,
  mergePersistedTestSummaries,
  persistTestSummariesIndex,
  prepareRunEnvironment,
  printRunOutro,
  projectRoot,
  resolveResultArtifacts,
  resultArtifactsIoConcurrency,
  RuntimeStrategyBacktestConfig,
  setTestData,
  toStrategyConfigGrid,
  trackTopResult,
  updateBestTickerResult,
  userName,
} from '../lib/backtest/runnerCore';
import {
  normalizedArgv,
  resolveDefaultParallel,
  resolveDefaultWorkerHeapMb,
  resolveEffectiveParallel,
  resolveRequestedTestsLimit,
  resolveWorkerHeapMb,
} from '../lib/backtest/cliConfig';
import {
  getBestTickerResults,
  getRunCounters,
  getRunStartedAt,
  getTopResults,
  resetRunState,
} from '../lib/backtest/runState';

if (
  process.argv.some(
    (arg) => arg === '--live' || String(arg).startsWith('--live='),
  )
) {
  throw new Error(
    '`--live` was removed from `yarn backtest`. Use `yarn replay` instead.',
  );
}

const HEADERS_RESULTS = [
  chalk.blue('ID'),
  chalk.yellow('SYMBOL'),
  chalk.cyan('PROFIT'),
  chalk.cyan('ORDERS'),
  chalk.cyan('WIN/LOSS (%)'),
  chalk.cyan('RISK'),
  chalk.cyan('MAX DRAWDOWN (%)'),
];

const HEADERS_RESULTS_BY_TICKERS = [
  chalk.blue('ID'),
  chalk.yellow('SYMBOL'),
  chalk.cyan('PROFIT'),
  chalk.cyan('ORDERS'),
  chalk.cyan('WIN/LOSS (%)'),
  chalk.cyan('RISK'),
  chalk.cyan('MAX DRAWDOWN (%)'),
];

type LoadedBacktestConfig = {
  strategyName: string;
  strategyConfigGrid: StrategyConfigGrid;
};

type PersistedBacktestResultEntry = Pick<
  TestWorkerResult,
  'orderLogId' | 'stat'
> & {
  test: Pick<
    TestWorkerResult['test'],
    | 'userName'
    | 'name'
    | 'testId'
    | 'configId'
    | 'testSuiteId'
    | 'symbol'
    | 'strategyName'
    | 'strategyConfig'
    | 'connectorName'
    | 'options'
    | 'ml'
    | 'ai'
  >;
};

const formatDuration = (startedAt: number) => {
  const seconds = (Date.now() - startedAt) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = Math.round(seconds % 60);
  return `${minutes}m ${restSeconds}s`;
};

const buildWarmupPeriodsKey = (
  strategyConfig: Record<string, unknown> | undefined,
) => {
  const periods = buildDefaultIndicatorPeriods((strategyConfig ?? {}) as any);
  return JSON.stringify({
    maFast: periods.maFast ?? null,
    maMedium: periods.maMedium ?? null,
    maSlow: periods.maSlow ?? null,
    obvSma: periods.obvSma ?? null,
    atr: periods.atr ?? null,
    atrPctShort: periods.atrPctShort ?? null,
    atrPctLong: periods.atrPctLong ?? null,
    bb: periods.bb ?? null,
    bbStd: periods.bbStd ?? null,
    macdFast: periods.macdFast ?? null,
    macdSlow: periods.macdSlow ?? null,
    macdSignal: periods.macdSignal ?? null,
    levelLookback: periods.levelLookback ?? null,
    levelDelay: periods.levelDelay ?? null,
  });
};

export const toPersistedBacktestResultEntry = (
  result: TestWorkerResult,
): PersistedBacktestResultEntry => ({
  orderLogId: result.orderLogId,
  stat: result.stat,
  test: {
    userName: result.test.userName,
    name: result.test.name,
    testId: result.test.testId,
    testSuiteId: result.test.testSuiteId,
    configId: result.test.configId || undefined,
    symbol: result.test.symbol,
    strategyName: result.test.strategyName,
    strategyConfig: result.test.strategyConfig,
    connectorName: result.test.connectorName,
    options: result.test.options,
    ml: result.test.ml,
    ai: result.test.ai,
  },
});

export const toPersistedBacktestResultEntries = (
  results: TestWorkerResult[],
): PersistedBacktestResultEntry[] =>
  results.map((result) => toPersistedBacktestResultEntry(result));

const resolveRenderableStat = async (
  result: Parameters<typeof resolveResultArtifacts>[0],
): Promise<{
  stat: Partial<TestStat>;
  orderLog: Awaited<ReturnType<typeof resolveResultArtifacts>>['orderLog'];
  hasArtifacts: boolean;
}> => {
  const { test, stat: fallbackStat } = result;
  const { name } = test;
  const { orderLog, positionLog } = await resolveResultArtifacts(result);

  if (!orderLog || !positionLog) {
    console.log(
      chalk.yellow(
        `warning: logs not found for ${name}; using cached stat only`,
      ),
    );
    return {
      stat: fallbackStat,
      orderLog,
      hasArtifacts: false,
    };
  }

  const stat = calculateStatsFull(positionLog) as TestStat;
  if (!stat && fallbackStat.orders > 0) {
    throw new Error(
      `Position log is empty for ${name} despite ${fallbackStat.orders} closed orders`,
    );
  }

  return {
    stat: stat ?? fallbackStat,
    orderLog,
    hasArtifacts: true,
  };
};

export const warmIndicatorCacheForBacktest = async (
  testSuite: Parameters<typeof executeTestSuite>[0]['testSuite'],
) => {
  if (!testSuite.length) {
    return;
  }

  const startedAt = Date.now();
  const uniqueWarmupTests = Array.from(
    new Map(
      testSuite.map((test) => [
        [
          test.userName,
          test.connectorName,
          test.symbol,
          buildWarmupPeriodsKey(
            (test.strategyConfig ?? {}) as Record<string, unknown>,
          ),
        ].join(':'),
        test,
      ]),
    ).values(),
  );

  console.log(chalk.gray('indicator cache warmup:'));
  const bar = new ProgressBar(
    ':current/:total [:bar][:percent] :eta(s) :symbol :status',
    {
      total: uniqueWarmupTests.length,
      width: 20,
    },
  );
  const concurrency = Math.max(1, Math.min(effectiveParallel, 4));

  await runWithConcurrency(uniqueWarmupTests, concurrency, async (test) => {
    const result = await warmBacktestIndicatorCache(test);
    bar.tick(1, {
      symbol: chalk.yellow(test.symbol),
      status: result.cached
        ? chalk.gray('cached')
        : chalk.cyan(
            `replayed ${Math.max(0, result.totalCandles - result.replayStartIndex)}`,
          ),
    });
  });

  console.log('');
  console.log(
    chalk.gray(`indicator cache warmup: done in ${formatDuration(startedAt)}`),
  );
};

const isStrategyConfigGrid = (value: unknown): value is StrategyConfigGrid => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.values(value as Record<string, unknown>).every((item) =>
    Array.isArray(item),
  );
};

const loadBacktestConfig = async (): Promise<LoadedBacktestConfig> => {
  if (!flags.config) {
    throw new Error('Backtest config not send');
  }

  const strategyName = flags.config.split(':')[0];
  if (!strategyName) {
    throw new Error('Strategy name not found');
  }

  const backtestConfig = await getData(
    redisKeys.backtestConfig(userName, flags.config),
    null,
  );
  if (!backtestConfig) {
    throw new Error(`Backtest config "${flags.config}" not found`);
  }

  const strategyConfigGrid = backtestConfig as StrategyConfigGrid;
  if (!isStrategyConfigGrid(strategyConfigGrid)) {
    throw new Error(
      `Backtest config "${flags.config}" must include strategyName and strategyConfig grid`,
    );
  }

  return {
    strategyName,
    strategyConfigGrid,
  };
};

const saveAndPrintResults = async () => {
  const colorizedResults: string[][] = [];
  for await (const result of getTopResults()) {
    const { test } = result;
    const { symbol, name } = test;
    const rendered = isFastMode ? null : await resolveRenderableStat(result);
    const stat = rendered?.stat ?? result.stat;

    if (rendered) {
      const { orderLog, hasArtifacts } = rendered;
      if (hasArtifacts && orderLog) {
        await setTestData(test, stat, orderLog);
      }
    }

    colorizedResults.push([
      chalk.blue(name),
      chalk.yellow(symbol),
      ...drawStatInCLI(stat, [
        'netProfit',
        'orders',
        'winRate',
        'riskRewardRatio',
        'maxDrawdown',
      ]),
    ]);
  }

  console.log('');
  console.log('RESULTS:');
  console.log(createTable(HEADERS_RESULTS, colorizedResults));
  console.log('');
};

const saveAndPrintResultsByTickers = async () => {
  const colorizedResultsByTickers: string[][] = [];
  for await (const result of getBestTickerResults()) {
    const { test } = result;
    const { symbol, name } = test;
    const rendered = isFastMode ? null : await resolveRenderableStat(result);
    const stat = rendered?.stat ?? result.stat;

    if (rendered) {
      const { orderLog, hasArtifacts } = rendered;
      if (hasArtifacts && orderLog) {
        await setTestData(test, stat, orderLog);
      }
    }

    colorizedResultsByTickers.push([
      chalk.blue(name),
      chalk.yellow(symbol),
      ...drawStatInCLI(stat, [
        'netProfit',
        'orders',
        'winRate',
        'riskRewardRatio',
        'maxDrawdown',
      ]),
    ]);
  }

  console.log('');
  console.log('RESULTS BY TICKERS:');
  console.log(
    createTable(HEADERS_RESULTS_BY_TICKERS, colorizedResultsByTickers),
  );
  console.log('');
};

const finishBacktest = async () => {
  if (flags.tickers) {
    await saveAndPrintResults();
  } else {
    await saveAndPrintResultsByTickers();
  }
  if (!isFastMode) {
    await persistTestSummariesIndex();
  }

  const topResults = getTopResults();
  const bestConfig = topResults[0]?.test.strategyConfig;
  const mergedConfig = mergeConfigs(
    topResults.map(({ test: { strategyConfig } }) => strategyConfig),
  );

  printRunOutro();
  console.log(chalk.gray('BEST CONFIG:'));
  console.log(chalk.green(toJson(bestConfig, true)));
  console.log('');
  console.log(chalk.gray('MERGED CONFIG:'));
  console.log(chalk.blue(toJson(mergedConfig, true)));
  console.log('');

  const finishedAt = new Date();
  const { successTests, errorTests, errors } = getRunCounters();
  const durationSeconds = Number(
    ((Date.now() - getRunStartedAt()) / 1000).toFixed(2),
  );
  const timestamp = createTimestamp(finishedAt);

  if (!isFastMode) {
    await setData(
      redisKeys.backtestResults(userName, flags.config, timestamp),
      {
        config: flags.config,
        mode: 'config',
        user: userName,
        startedAt: new Date(getRunStartedAt()).toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationSeconds,
        results: toPersistedBacktestResultEntries(topResults),
        resultsByTickers: toPersistedBacktestResultEntries(
          getBestTickerResults(),
        ),
        resultsByStrategies: null,
        runtimeComparison: null,
        bestConfig,
        mergedConfig,
        successTests,
        errors,
        errorTests,
      },
      {
        expire: 0,
      },
    );
  }

  process.exit();
};

export const backtest = async () => {
  resetRunState();
  const config = await loadBacktestConfig();
  const preparedRun = await prepareRunEnvironment();
  if (!preparedRun || flags.updateOnly) {
    return;
  }

  const testSuite = await buildPreparedTestSuite({
    testSuite: createTestSuite(
      userName,
      preparedRun.tickers,
      config.strategyName,
      config.strategyConfigGrid,
      preparedRun.connectorName,
    ),
    window: preparedRun.window,
    preloadStart: preparedRun.preloadStart,
    isReplay: false,
  });
  if (!testSuite) {
    return;
  }

  await warmIndicatorCacheForBacktest(testSuite);
  await executeTestSuite({
    testSuite,
    window: preparedRun.window,
    preloadStart: preparedRun.preloadStart,
    onResult: (result) => {
      trackTopResult(result);
      updateBestTickerResult(result);
    },
    onFinish: finishBacktest,
  });
};

export const main = backtest;

export {
  BACKTEST_PRELOAD_DAYS,
  resolveRenderableStat,
  chunkTestSuiteBySymbol,
  interval,
  loadRuntimeStrategyBacktestConfigs,
  mergePersistedTestSummaries,
  normalizedArgv,
  projectRoot,
  resolveDefaultParallel,
  resolveDefaultWorkerHeapMb,
  resolveEffectiveParallel,
  resolveRequestedTestsLimit,
  resolveResultArtifacts,
  resolveWorkerHeapMb,
  resultArtifactsIoConcurrency,
  setTestData,
  toStrategyConfigGrid,
  userName,
};

export type { RuntimeStrategyBacktestConfig };
