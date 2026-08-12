import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { calculateStatsFull } from '@tradejs/core/backtest';
import { createTestSuite, mergeConfigs } from '@tradejs/core/grid';
import { toJson } from '@tradejs/core/data';
import { getData, setData, redisKeys } from '@tradejs/infra/redis';
import {
  Interval,
  StrategyConfigGrid,
  TestStat,
  TestSuite,
  TestWorkerResult,
} from '@tradejs/types';
import { BACKTEST_PRELOAD_DAYS, TTL_1M } from '@tradejs/core/constants';
import {
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
  backtestEntryDelayBars,
  backtestPriceMode,
  resolveDefaultParallel,
  resolveDefaultWorkerHeapMb,
  resolveEffectiveParallel,
  resolveBacktestEntryDelayBars,
  resolveBacktestPriceMode,
  resolveRequestedTestsLimit,
  resolveWorkerHeapMb,
} from '../lib/backtest/cliConfig';
import {
  getBestTickerResults,
  getAggregateAverageProfit,
  getAggregateWinRate,
  getRunCounters,
  getRunStartedAt,
  getTopConfigResultBuckets,
  getTopResults,
  incrementSuccessTests,
  recordResultAggregates,
  resetRunState,
} from '../lib/backtest/runState';
import {
  BacktestCheckpointResult,
  BacktestRunManifest,
  createBacktestRunManifest,
  filterCompletedBacktestResultsForSuite,
  filterRemainingBacktestTests,
  loadBacktestCheckpointResults,
  loadBacktestRunManifest,
  markBacktestRunStatus,
  resolveBacktestRunIdForContinue,
  saveBacktestCheckpointResult,
} from '../lib/backtest/checkpoint';
import { prepareMarketContextForRun } from '../lib/marketContextPrepare';

if (
  process.argv.some(
    (arg) => arg === '--live' || String(arg).startsWith('--live='),
  )
) {
  throw new Error(
    '`--live` was removed from `yarn backtest`. Use `yarn replay` instead.',
  );
}

type LoadedBacktestConfig = {
  strategyName: string;
  strategyConfigGrid: StrategyConfigGrid;
};

type BacktestReportRow = {
  id: string;
  symbol: string;
  configId: string;
  netProfit: number;
  orders: number;
  winRate: number;
  riskRewardRatio: number | null;
  maxDrawdown: number;
};

type PersistedBacktestResultEntry = Pick<
  TestWorkerResult,
  'orderLogId' | 'stat' | 'executionCostModel' | 'researchTraceSummary'
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
    | 'universe'
    | 'assetClass'
    | 'accountId'
    | 'deploymentId'
    | 'policyProfileId'
    | 'options'
    | 'ml'
    | 'ai'
  >;
};

export const toPersistedBacktestResultEntry = (
  result: TestWorkerResult,
): PersistedBacktestResultEntry => ({
  orderLogId: result.orderLogId,
  stat: result.stat,
  executionCostModel: result.executionCostModel,
  researchTraceSummary: result.researchTraceSummary,
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
    universe: result.test.universe,
    assetClass: result.test.assetClass,
    accountId: result.test.accountId,
    deploymentId: result.test.deploymentId,
    policyProfileId: result.test.policyProfileId,
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

const toFiniteNumber = (value: unknown, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const toReportRow = (
  result: TestWorkerResult,
  stat: Partial<TestStat>,
): BacktestReportRow => ({
  id: result.test.name,
  symbol: result.test.symbol,
  configId: result.test.configId || '',
  netProfit: toFiniteNumber(
    (stat as Partial<TestStat> & { profit?: number }).netProfit ??
      (stat as Partial<TestStat> & { profit?: number }).profit,
  ),
  orders: toFiniteNumber(stat.orders),
  winRate: toFiniteNumber(stat.winRate),
  riskRewardRatio:
    stat.riskRewardRatio == null ? null : toFiniteNumber(stat.riskRewardRatio),
  maxDrawdown: toFiniteNumber(stat.maxDrawdown),
});

const collectReportRows = async (
  results: TestWorkerResult[],
): Promise<BacktestReportRow[]> => {
  const rows: BacktestReportRow[] = [];
  for (const result of results) {
    const rendered = isFastMode ? null : await resolveRenderableStat(result);
    const stat = rendered?.stat ?? result.stat;

    if (rendered) {
      const { orderLog, hasArtifacts } = rendered;
      if (hasArtifacts && orderLog) {
        await setTestData(result.test, stat, orderLog);
      }
    }

    rows.push(toReportRow(result, stat));
  }
  return rows;
};

const escapeMdCell = (value: unknown) =>
  String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '<br>');

const formatMoney = (value: number) => `${value.toFixed(2)}$`;
const formatPercent = (value: number) => `${value.toFixed(1)}%`;
const formatRatio = (value: number | null) =>
  value == null ? '-' : value.toFixed(2);

const createMarkdownTable = (headers: string[], rows: unknown[][]) => {
  const header = `| ${headers.map(escapeMdCell).join(' |')} |`;
  const separator = `| ${headers.map(() => '---').join(' |')} |`;
  const body = rows.map((row) => `| ${row.map(escapeMdCell).join(' |')} |`);
  return [header, separator, ...body].join('\n');
};

const renderReportRowsTable = (rows: BacktestReportRow[]) =>
  createMarkdownTable(
    ['ID', 'Symbol', 'Config', 'P&L', 'Orders', 'Winrate', 'Risk', 'Max DD'],
    rows.map((row) => [
      row.id,
      row.symbol,
      row.configId || '-',
      formatMoney(row.netProfit),
      row.orders,
      formatPercent(row.winRate),
      formatRatio(row.riskRewardRatio),
      formatPercent(row.maxDrawdown),
    ]),
  );

const safeFileToken = (value: string) =>
  value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'backtest';

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

const hasSingleSymbol = (
  testSuite: Parameters<typeof executeTestSuite>[0]['testSuite'],
) => new Set(testSuite.map((test) => test.symbol)).size === 1;

const writeBacktestMarkdownReport = async ({
  timestamp,
  testSuite,
  topRows,
  bestTickerRows,
  bestConfig,
  mergedConfig,
  useConfigAverageRanking,
  durationSeconds,
}: {
  timestamp: string;
  testSuite: Parameters<typeof executeTestSuite>[0]['testSuite'];
  topRows: BacktestReportRow[];
  bestTickerRows: BacktestReportRow[];
  bestConfig: unknown;
  mergedConfig: unknown;
  useConfigAverageRanking: boolean;
  durationSeconds: number;
}) => {
  const outputDir = path.resolve(projectRoot, 'data/backtests/output');
  await fs.promises.mkdir(outputDir, { recursive: true });

  const outputPath = path.join(
    outputDir,
    `${timestamp}-${safeFileToken(flags.config)}.md`,
  );
  const { successTests, errorTests, errors } = getRunCounters();
  const topConfigBuckets = getTopConfigResultBuckets(flags.top);

  const lines = [
    `# Backtest ${flags.config}`,
    '',
    '## Summary',
    '',
    createMarkdownTable(
      ['Metric', 'Value'],
      [
        ['Config', flags.config],
        ['User', userName],
        ['Connector', flags.connector],
        ['Interval', String(interval)],
        ['Tests planned', testSuite.length],
        ['Success tests', successTests],
        ['Errors', errorTests],
        ['Duration', `${durationSeconds.toFixed(2)}s`],
        ['Started at', new Date(getRunStartedAt()).toISOString()],
        ['Finished at', new Date().toISOString()],
        [
          'Ranking mode',
          useConfigAverageRanking
            ? 'avg P&L by config'
            : 'single-symbol top tests',
        ],
        ['Command', `\`${process.argv.join(' ')}\``],
      ],
    ),
    '',
    '## Config Ranking',
    '',
    topConfigBuckets.length
      ? createMarkdownTable(
          ['Config', 'Avg P&L', 'Winrate', 'Tests'],
          topConfigBuckets.map((bucket) => [
            bucket.configId,
            formatMoney(getAggregateAverageProfit(bucket)),
            formatPercent(getAggregateWinRate(bucket)),
            bucket.count,
          ]),
        )
      : '_No config ranking data._',
    '',
    '## Top Results',
    '',
    topRows.length ? renderReportRowsTable(topRows) : '_No top results._',
    '',
    '## Best Result By Ticker',
    '',
    bestTickerRows.length
      ? renderReportRowsTable(bestTickerRows)
      : '_No ticker results._',
    '',
    '## Best Config',
    '',
    '```json',
    toJson(bestConfig, true),
    '```',
    '',
    '## Merged Config',
    '',
    '```json',
    toJson(mergedConfig, true),
    '```',
    '',
    '## Errors',
    '',
    errors.length
      ? ['```json', toJson(errors, true), '```'].join('\n')
      : '_No errors._',
    '',
  ];

  await fs.promises.writeFile(outputPath, lines.join('\n'), 'utf8');
  return outputPath;
};

const finishBacktest = async (
  testSuite: Parameters<typeof executeTestSuite>[0]['testSuite'],
) => {
  const topResults = getTopResults();
  const bestTickerResults = getBestTickerResults();
  const topRows = await collectReportRows(topResults);
  const bestTickerRows = await collectReportRows(bestTickerResults);

  if (!isFastMode) {
    await persistTestSummariesIndex();
  }

  const topConfigBuckets = getTopConfigResultBuckets(flags.top);
  const useConfigAverageRanking = !hasSingleSymbol(testSuite);
  const rankedConfigs = useConfigAverageRanking
    ? topConfigBuckets.map((bucket) => bucket.strategyConfig)
    : topResults.map(({ test: { strategyConfig } }) => strategyConfig);
  const bestConfig = rankedConfigs[0];
  const mergedConfig = mergeConfigs(rankedConfigs);

  const finishedAt = new Date();
  const { successTests, errorTests, errors } = getRunCounters();
  const durationSeconds = Number(
    ((Date.now() - getRunStartedAt()) / 1000).toFixed(2),
  );
  const timestamp = createTimestamp(finishedAt);
  const markdownReportPath = await writeBacktestMarkdownReport({
    timestamp,
    testSuite,
    topRows,
    bestTickerRows,
    bestConfig,
    mergedConfig,
    useConfigAverageRanking,
    durationSeconds,
  });

  printRunOutro();
  if (useConfigAverageRanking) {
    const bestBucket = topConfigBuckets[0];
    if (bestBucket) {
      console.log(
        chalk.gray(
          `config ranking: avg P&L across symbols (best avg ${formatMoney(
            getAggregateAverageProfit(bestBucket),
          )}, win ${formatPercent(getAggregateWinRate(bestBucket))}, tests ${
            bestBucket.count
          })`,
        ),
      );
    }
  }
  console.log(chalk.gray(`full report: ${markdownReportPath}`));
  console.log('');

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
        resultsByTickers: toPersistedBacktestResultEntries(bestTickerResults),
        resultsByStrategies: null,
        runtimeComparison: null,
        bestConfig,
        mergedConfig,
        markdownReportPath,
        successTests,
        errors,
        errorTests,
      },
      {
        expire: TTL_1M,
      },
    );
  }

  process.exit();
};

const restoreCompletedBacktestResults = (
  completed: BacktestCheckpointResult[],
) => {
  for (const { result } of completed) {
    incrementSuccessTests();
    recordResultAggregates(result);
    trackTopResult(result);
    updateBestTickerResult(result);
  }
};

const loadBacktestRunForContinue = async (): Promise<{
  completed: BacktestCheckpointResult[];
  manifest: BacktestRunManifest;
} | null> => {
  if (!flags.continue) {
    return null;
  }

  const runId = await resolveBacktestRunIdForContinue({
    config: flags.config,
    requestedRunId: typeof flags.runId === 'string' ? flags.runId : undefined,
    userName,
  });
  if (!runId) {
    throw new Error(
      `No backtest run found to continue for config "${flags.config}"`,
    );
  }

  const manifest = await loadBacktestRunManifest({ runId, userName });
  if (!manifest) {
    throw new Error(`Backtest run "${runId}" was not found`);
  }
  if (manifest.userName !== userName) {
    throw new Error(
      `Backtest run "${runId}" belongs to user "${manifest.userName}", not "${userName}"`,
    );
  }
  if (manifest.config !== flags.config) {
    throw new Error(
      `Backtest run "${runId}" was created for config "${manifest.config}", not "${flags.config}"`,
    );
  }

  const completed = filterCompletedBacktestResultsForSuite({
    completed: await loadBacktestCheckpointResults({ runId, userName }),
    testSuite: manifest.testSuite,
  });
  console.log(
    chalk.gray(
      `continue backtest run ${runId}: completed=${completed.length}/${manifest.testSuite.length}`,
    ),
  );

  return {
    completed,
    manifest: await markBacktestRunStatus({ run: manifest, status: 'running' }),
  };
};

const prepareContinuedBacktestMarketContext = async ({
  manifest,
  remainingSuite,
}: {
  manifest: BacktestRunManifest;
  remainingSuite: TestSuite;
}) => {
  await prepareMarketContextForRun({
    mode: 'backtest',
    userName,
    projectRoot,
    symbols: Array.from(new Set(remainingSuite.map((test) => test.symbol))),
    universe: remainingSuite[0]?.universe,
    interval: manifest.interval as Interval,
    startMs: manifest.window.start,
    endMs: manifest.window.end,
    preloadStartMs: manifest.preloadStart,
    cacheOnly: manifest.flags.cacheOnly,
    aiEnabled: manifest.flags.ai,
    mlEnabled: manifest.flags.ml,
    strategyNames: Array.from(
      new Set(remainingSuite.map((test) => test.strategyName)),
    ),
    log: (message) => console.log(chalk.gray(message)),
  });
};

export const backtest = async () => {
  resetRunState();
  const config = await loadBacktestConfig();
  const continuedRun = await loadBacktestRunForContinue();
  if (continuedRun) {
    const { completed, manifest } = continuedRun;
    restoreCompletedBacktestResults(completed);
    const remainingSuite = filterRemainingBacktestTests({
      completed,
      testSuite: manifest.testSuite,
    });

    if (!remainingSuite.length) {
      await markBacktestRunStatus({ run: manifest, status: 'completed' });
      await finishBacktest(manifest.testSuite);
      return;
    }

    await prepareContinuedBacktestMarketContext({ manifest, remainingSuite });

    await executeTestSuite({
      testSuite: remainingSuite,
      window: manifest.window,
      preloadStart: manifest.preloadStart,
      backtestRunId: manifest.runId,
      initialCompletedTests: completed.length,
      totalTests: manifest.testSuite.length,
      onResult: async (result) => {
        await saveBacktestCheckpointResult({
          result,
          runId: manifest.runId,
          userName,
        });
        trackTopResult(result);
        updateBestTickerResult(result);
      },
      onInterrupt: async () => {
        await markBacktestRunStatus({ run: manifest, status: 'interrupted' });
      },
      onFinish: async () => {
        await markBacktestRunStatus({ run: manifest, status: 'completed' });
        await finishBacktest(manifest.testSuite);
      },
    });
    return;
  }

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
      interval,
    ).map((test: TestSuite[number]) => {
      const deploymentStrategy = preparedRun.deployment?.strategies.find(
        ({ strategyName }) => strategyName === config.strategyName,
      );
      if (preparedRun.deployment && !deploymentStrategy) {
        throw new Error(
          `Strategy ${config.strategyName} is not enabled in deployment ${preparedRun.deployment.id}`,
        );
      }
      const policyProfileId =
        (typeof flags.policyProfile === 'string' && flags.policyProfile.trim()
          ? flags.policyProfile.trim()
          : deploymentStrategy?.policyProfileId) || undefined;
      return {
        ...test,
        instrument: preparedRun.instrumentsBySymbol.get(
          test.symbol.toUpperCase(),
        ),
        universe: preparedRun.universe,
        accountId: preparedRun.accountId,
        deploymentId: preparedRun.deploymentId,
        policyProfileId,
        strategyConfig: {
          ...test.strategyConfig,
          ...deploymentStrategy?.config,
          ...(policyProfileId ? { POLICY_PROFILE_ID: policyProfileId } : {}),
        },
      };
    }),
    window: preparedRun.window,
    preloadStart: preparedRun.preloadStart,
    isReplay: false,
  });
  if (!testSuite) {
    return;
  }

  const manifest = await createBacktestRunManifest({
    userName,
    config: flags.config,
    command: process.argv,
    connectorName: preparedRun.connectorName,
    interval: String(interval),
    window: preparedRun.window,
    preloadStart: preparedRun.preloadStart,
    flags: {
      ai: Boolean(flags.ai),
      backtestEntryDelayBars,
      backtestPriceMode,
      cacheOnly: Boolean(flags.cacheOnly),
      fast: Boolean(flags.fast),
      ml: Boolean(flags.ml),
      researchTrace: Boolean(flags.researchTrace),
    },
    marketContextPreparedAt: new Date().toISOString(),
    testSuite,
  });
  console.log(chalk.gray(`backtest run id: ${manifest.runId}`));

  await executeTestSuite({
    testSuite,
    window: preparedRun.window,
    preloadStart: preparedRun.preloadStart,
    backtestRunId: manifest.runId,
    onResult: async (result) => {
      await saveBacktestCheckpointResult({
        result,
        runId: manifest.runId,
        userName,
      });
      trackTopResult(result);
      updateBestTickerResult(result);
    },
    onInterrupt: async () => {
      await markBacktestRunStatus({ run: manifest, status: 'interrupted' });
    },
    onFinish: async () => {
      await markBacktestRunStatus({ run: manifest, status: 'completed' });
      await finishBacktest(testSuite);
    },
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
  resolveBacktestEntryDelayBars,
  resolveBacktestPriceMode,
  resolveRequestedTestsLimit,
  resolveResultArtifacts,
  resolveWorkerHeapMb,
  resultArtifactsIoConcurrency,
  setTestData,
  toStrategyConfigGrid,
  userName,
};

export type { RuntimeStrategyBacktestConfig };
