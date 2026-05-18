import chalk from 'chalk';
import { drawStatInCLI } from '@tradejs/node/cli';
import { calculateStatsFull } from '@tradejs/core/backtest';
import { createTestSuite, mergeConfigs } from '@tradejs/core/grid';
import { toJson } from '@tradejs/core/data';
import { getData, setData, redisKeys } from '@tradejs/infra/redis';
import { StrategyConfigGrid, TestStat } from '@tradejs/types';
import { BACKTEST_PRELOAD_DAYS } from '@tradejs/core/constants';
import {
  buildPreparedTestSuite,
  chunkTestSuiteBySymbol,
  createTimestamp,
  createTable,
  executeTestSuite,
  flags,
  getUnsupportedLiveProjectHookStages,
  interval,
  loadReplayStrategies,
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
    const { orderLog, positionLog } = await resolveResultArtifacts(result);
    if (!orderLog || !positionLog) {
      throw new Error(`Logs not found for test ${name}`);
    }

    const stat = calculateStatsFull(positionLog) as TestStat;
    if (!stat && result.stat.orders > 0) {
      throw new Error(
        `Position log is empty for test ${name} despite ${result.stat.orders} closed orders`,
      );
    }

    await setTestData(test, stat, orderLog);

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
    const { orderLog, positionLog } = await resolveResultArtifacts(result);
    if (!orderLog || !positionLog) {
      throw new Error(`Logs not found for ticker result ${name}`);
    }

    const stat = calculateStatsFull(positionLog) as TestStat;
    if (!stat && result.stat.orders > 0) {
      throw new Error(
        `Position log is empty for ticker result ${name} despite ${result.stat.orders} closed orders`,
      );
    }

    await setTestData(test, stat, orderLog);

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
  await persistTestSummariesIndex();

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

  await setData(
    redisKeys.backtestResults(userName, flags.config, timestamp),
    {
      config: flags.config,
      mode: 'config',
      user: userName,
      startedAt: new Date(getRunStartedAt()).toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationSeconds,
      results: topResults,
      resultsByTickers: getBestTickerResults(),
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

export {
  BACKTEST_PRELOAD_DAYS,
  chunkTestSuiteBySymbol,
  getUnsupportedLiveProjectHookStages,
  interval,
  loadReplayStrategies,
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

if (require.main === module) {
  void backtest();
}
