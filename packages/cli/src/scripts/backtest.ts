import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { calculateStatsFull } from '@tradejs/core/backtest';
import { createTestSuite, mergeConfigs } from '@tradejs/core/grid';
import { toJson } from '@tradejs/core/data';
import { getData, setData, redisKeys } from '@tradejs/infra/redis';
import { StrategyConfigGrid, TestStat, TestWorkerResult } from '@tradejs/types';
import { BACKTEST_PRELOAD_DAYS } from '@tradejs/core/constants';
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
  resolveDefaultParallel,
  resolveDefaultWorkerHeapMb,
  resolveEffectiveParallel,
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

const normalizeIndicatorBackendName = (value: unknown) => {
  const normalized = String(value ?? 'ts')
    .trim()
    .toLowerCase();
  return normalized === 'rust' || normalized === 'native' ? 'rust' : 'ts';
};

const printBacktestIndicatorBackend = () => {
  console.log(
    chalk.gray(
      `indicator backend: ${normalizeIndicatorBackendName(
        process.env.TRADEJS_INDICATOR_BACKEND,
      )}`,
    ),
  );
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
      interval,
    ),
    window: preparedRun.window,
    preloadStart: preparedRun.preloadStart,
    isReplay: false,
  });
  if (!testSuite) {
    return;
  }

  printBacktestIndicatorBackend();
  await executeTestSuite({
    testSuite,
    window: preparedRun.window,
    preloadStart: preparedRun.preloadStart,
    onResult: (result) => {
      trackTopResult(result);
      updateBestTickerResult(result);
    },
    onFinish: () => finishBacktest(testSuite),
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
