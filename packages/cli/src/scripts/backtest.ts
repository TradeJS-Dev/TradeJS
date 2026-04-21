const ListIt = require('list-it');
import args from 'args';
import ProgressBar from 'progress';
import { fork } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import _ from 'lodash';
import { format } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import { ConnectorNames } from '@tradejs/connectors';
import {
  DEFAULT_CONNECTOR_NAME,
  getConnectorCreatorByName,
  resolveConnectorName,
} from '@tradejs/node/connectors';
import { drawStatInCLI, getTickers, update } from '@tradejs/node/cli';
import {
  calculateStatsFull,
  createTestSuite,
  mergeConfigs,
} from '@tradejs/core/backtest';
import { toJson } from '@tradejs/core/data';
import {
  BACKTEST_PRELOAD_DAYS,
  TESTS_LIMIT,
  TESTS_TOP_LIMIT,
  TTL_1D,
  TTL_1M,
} from '@tradejs/core/constants';
import { formatUnix, getTimestamp } from '@tradejs/core/time';
import { setData, getData, redisKeys } from '@tradejs/infra/redis';
import {
  Interval,
  OrderLog,
  PositionLogData,
  TestStat,
  Test,
  TestWorkerResult,
  ConnectorCreator,
  StrategyConfigGrid,
} from '@tradejs/types';
import {
  backfillDerivativesContextForBacktest,
  shouldBackfillDerivativesContextForBacktest,
} from '../lib/derivativesContextBackfill';
import { resolveTimeWindow } from '../lib/timeWindow';

const MAX_PARALLEL = Math.min(os.cpus().length, 6);

args.example(
  ' yarn backtest -t 400 --cacheOnly',
  'Run tests on uploaded data for 400 tickers',
);

args.option(['t', 'tickers'], 'Selected tickers');
args.option(['e', 'exclude'], 'Exclude tickers from tests');
args.option(['l', 'tickersLimit'], 'Tickers limit');
args.option(['n', 'tests'], 'Tests limit', TESTS_LIMIT);
args.option('skip', 'Skip first N tests', 0);
args.option(['p', 'parallel'], 'Parallel tasks', MAX_PARALLEL);
args.option(['f', 'timeframe'], 'Timeframe', 15);
args.option(['d', 'days'], 'Run backtest only for the last N days');
args.option('startTime', 'Explicit backtest start timestamp (ms or seconds)');
args.option('endTime', 'Explicit backtest end timestamp (ms or seconds)');
args.option(['T', 'top'], 'Return N best tests', TESTS_TOP_LIMIT);
args.option(['u', 'updateOnly'], 'Only update tickers history', false);
args.option(['C', 'cacheOnly'], 'Do not update tickers history', false);
args.option(['c', 'config'], 'Backtest config', 'breakout');
args.option(['L', 'showTickersList'], 'Just show only ticker list', false);
args.option(['S', 'progressStep'], 'Progress step', 100);
args.option(['U', 'user'], 'Use user config', 'root');
args.option(
  'connector',
  'Connector provider or name for backtest (e.g. bybit, binance, coinbase, custom)',
  'bybit',
);
args.option(
  ['m', 'ml'],
  'Write ML dataset rows to per-worker JSONL chunks',
  false,
);
args.option(
  ['A', 'ai'],
  'Write AI prompt rows to per-worker JSONL chunks',
  false,
);

const normalizedArgv = process.argv.map((arg) => {
  if (arg === '--ML') {
    return '--ml';
  }
  if (arg === '--AI') {
    return '--ai';
  }
  return arg;
});

const flags = args.parse(normalizedArgv);
const interval = flags.timeframe.toString() as Interval;
const progressStep = Math.max(1, parseInt(String(flags.progressStep), 10));
const testsLimit = Math.max(0, parseInt(String(flags.tests), 10));
const testsSkip = Math.max(0, parseInt(String(flags.skip ?? 0), 10));
const testItemTimeoutMs = 120_000;
const uuid = (len = 12) => uuidv4().slice(-len);
const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();
const testerWorkerPathCandidates = [
  // `tradejs` bin runs from dist/cli.js, so bundled commands resolve from `dist`.
  path.resolve(__dirname, './workers/testerWorker.js'),
  // Direct execution of dist/scripts/backtest.js resolves from `dist/scripts`.
  path.resolve(__dirname, '../workers/testerWorker.js'),
  // ts-node execution resolves from `src/scripts`.
  path.resolve(__dirname, '../workers/testerWorker.ts'),
];
const testerWorkerPath = testerWorkerPathCandidates.find((candidate) =>
  fs.existsSync(candidate),
);
if (!testerWorkerPath) {
  throw new Error(
    `Tester worker file not found. Checked: ${testerWorkerPathCandidates.join(', ')}`,
  );
}
const testerNeedsTsRuntime = testerWorkerPath.endsWith('.ts');

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

type ErrorMessage = { id?: number; error?: unknown; payload?: any };
type TestResultArtifacts = {
  orderLog?: OrderLog[];
  positionLog?: PositionLogData;
};

let successTests = 0;
let errorTests = 0;
const errorMessages: ErrorMessage[] = [];
let results: TestWorkerResult[] = [];
const resultsByTickers = new Map<string, TestWorkerResult>();
const resultArtifactsByTestName = new Map<string, TestResultArtifacts>();
const artifactRefCountsByTestName = new Map<string, number>();
const bestTickerTestNameBySymbol = new Map<string, string>();
let topResultNames = new Set<string>();

const userName = flags.user;
const runStartedAt = Date.now();

const createListIt = () =>
  new ListIt({
    autoAlign: true,
    headerUnderline: true,
  });

const createTable = (headers: string[], rows: string[][]) =>
  createListIt().setHeaderRow(headers).d(rows).toString();

const createTimestamp = (date: Date) => format(date, 'yyyyMMddHHmm');

const isGoodTest = (result: TestWorkerResult) =>
  result.stat?.orders > 5 && result.stat?.profit > 10;

const getResultAmount = (result: TestWorkerResult) => result.stat.amount ?? 0;

const recordError = (error: ErrorMessage) => {
  errorMessages.push(error);
};

const stripInlineLogs = (result: TestWorkerResult): TestWorkerResult => {
  const { inlineOrderLog, inlinePositionLog, ...resultWithoutLogs } = result;
  return resultWithoutLogs;
};

const getInlineArtifacts = (
  result: TestWorkerResult,
): TestResultArtifacts | null => {
  if (!result.inlineOrderLog && !result.inlinePositionLog) {
    return null;
  }

  return {
    orderLog: result.inlineOrderLog,
    positionLog: result.inlinePositionLog,
  };
};

const retainArtifacts = (
  testName: string,
  artifacts?: TestResultArtifacts | null,
) => {
  if (artifacts) {
    resultArtifactsByTestName.set(testName, artifacts);
  }
  artifactRefCountsByTestName.set(
    testName,
    (artifactRefCountsByTestName.get(testName) ?? 0) + 1,
  );
};

const releaseArtifacts = (testName: string) => {
  const nextCount = (artifactRefCountsByTestName.get(testName) ?? 0) - 1;
  if (nextCount <= 0) {
    artifactRefCountsByTestName.delete(testName);
    resultArtifactsByTestName.delete(testName);
    return;
  }

  artifactRefCountsByTestName.set(testName, nextCount);
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

const updateTopResults = (
  nextResults: TestWorkerResult[],
  nextResult: TestWorkerResult,
  artifacts?: TestResultArtifacts | null,
) => {
  const previousTopNames = topResultNames;
  const nextTopNames = new Set(nextResults.map((result) => result.test.name));

  if (
    artifacts &&
    !previousTopNames.has(nextResult.test.name) &&
    nextTopNames.has(nextResult.test.name)
  ) {
    retainArtifacts(nextResult.test.name, artifacts);
  }

  for (const testName of previousTopNames) {
    if (!nextTopNames.has(testName)) {
      releaseArtifacts(testName);
    }
  }

  results = nextResults;
  topResultNames = nextTopNames;
};

const updateBestTickerResult = (
  result: TestWorkerResult,
  artifacts?: TestResultArtifacts | null,
) => {
  if (!isGoodTest(result)) {
    return false;
  }

  const previousResult = resultsByTickers.get(result.test.symbol);
  if (previousResult && previousResult.stat.profit >= result.stat.profit) {
    return false;
  }

  const previousTestName = bestTickerTestNameBySymbol.get(result.test.symbol);
  if (previousTestName) {
    releaseArtifacts(previousTestName);
  }

  resultsByTickers.set(result.test.symbol, result);
  bestTickerTestNameBySymbol.set(result.test.symbol, result.test.name);
  if (artifacts) {
    retainArtifacts(result.test.name, artifacts);
  }

  return true;
};

const isStrategyConfigGrid = (value: unknown): value is StrategyConfigGrid => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.values(value as Record<string, unknown>).every((item) =>
    Array.isArray(item),
  );
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
  const orderLog = (await getData(
    redisKeys.cacheOrders(userName, orderLogId),
    null,
  )) as OrderLog[];
  const positionLog = (await getData(
    redisKeys.cachePositions(userName, orderLogId),
    null,
  )) as PositionLogData;

  return { orderLog, positionLog };
};

const cacheArtifactsById = async (
  orderLogId: string,
  artifacts?: TestResultArtifacts | null,
) => {
  if (
    !artifacts ||
    !Array.isArray(artifacts.orderLog) ||
    !Array.isArray(artifacts.positionLog)
  ) {
    return;
  }

  await Promise.all([
    setData(redisKeys.cacheOrders(userName, orderLogId), artifacts.orderLog, {
      expire: TTL_1D,
    }),
    setData(
      redisKeys.cachePositions(userName, orderLogId),
      artifacts.positionLog,
      {
        expire: TTL_1D,
      },
    ),
  ]);
};

const resolveResultArtifacts = async (result: TestWorkerResult) => {
  const inlineArtifacts = resultArtifactsByTestName.get(result.test.name);
  if (inlineArtifacts?.orderLog && inlineArtifacts?.positionLog) {
    return inlineArtifacts;
  }

  return getLogsById(result.orderLogId);
};

const setTestData = async (
  test: Test,
  stat: TestStat,
  orderLog: OrderLog[],
) => {
  await setData(
    redisKeys.testOrders(test.userName, test.strategyName, test.name),
    orderLog,
    {
      expire: TTL_1M,
    },
  );

  await setData(
    redisKeys.testConfig(test.userName, test.strategyName, test.name),
    test,
    {
      expire: TTL_1M,
    },
  );

  await setData(
    redisKeys.testStat(test.userName, test.strategyName, test.name),
    stat,
    {
      expire: TTL_1M,
    },
  );
};

const backtest = async () => {
  if (!flags.config) {
    throw new Error('Backtest config not send');
  }

  const strategyName = flags.config.split(':')[0];

  if (!flags.config) {
    throw new Error('Strategy name not found');
  }

  const backtestConfig = await getData(
    redisKeys.backtestConfig(userName, flags.config),
    null,
  );
  if (!backtestConfig) {
    throw new Error(`Backtest config "${flags.config}" not found`);
  }

  const typedBacktestConfig = backtestConfig as StrategyConfigGrid;
  if (!isStrategyConfigGrid(typedBacktestConfig)) {
    throw new Error(
      `Backtest config "${flags.config}" must include strategyName and strategyConfig grid`,
    );
  }

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

  const tickers = await getTickers(
    marketConnector,
    flags.tickers,
    flags.exclude,
    flags.tickersLimit,
  );

  if (flags.showTickersList) {
    console.log(chalk.gray(JSON.stringify(tickers.sort(), null, 2)));

    return;
  }

  if (!flags.cacheOnly) {
    await update(marketConnector, interval, tickers, undefined, {
      connectorLabel: connectorName,
    });

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
    await update(binanceConnector, interval, ['BTCUSDT'], undefined, {
      connectorLabel: ConnectorNames.Binance,
    });
    await update(coinbaseConnector, interval, ['BTCUSDT'], undefined, {
      connectorLabel: ConnectorNames.Coinbase,
    });
  }

  if (flags.updateOnly) {
    return;
  }

  let testSuite = createTestSuite(
    userName,
    tickers,
    strategyName,
    typedBacktestConfig,
    connectorName,
  );
  const window = resolveTimeWindow({
    days: flags.days,
    startTime: flags.startTime,
    endTime: flags.endTime,
    defaultStartMs: getTimestamp(BACKTEST_PRELOAD_DAYS),
    defaultEndMs: getTimestamp(),
  });
  const mlEnabled = Boolean(flags.ml);
  const aiEnabled = Boolean(flags.ai);
  testSuite = testSuite
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
    .slice(testsSkip, testsSkip + testsLimit);

  if (!testSuite.length) {
    console.log(
      chalk.yellow(
        `No tests selected (skip=${testsSkip}, limit=${testsLimit}).`,
      ),
    );
    return;
  }

  if (
    shouldBackfillDerivativesContextForBacktest({
      aiEnabled,
      cacheOnly: Boolean(flags.cacheOnly),
      mlEnabled,
    })
  ) {
    await backfillDerivativesContextForBacktest({
      userName,
      symbols: testSuite.map((test) => test.symbol),
      startMs: window.start,
      endMs: window.end,
    });
  }

  const chunkSize = Math.ceil(testSuite.length / parseInt(flags.parallel));
  const chunks = _.chunk(testSuite, chunkSize);
  let completedTests = 0;
  let isFinishing = false;
  const workers = new Set<ReturnType<typeof fork>>();

  const maybeFinish = async () => {
    if (isFinishing) {
      return;
    }

    if (completedTests !== testSuite.length || workers.size > 0) {
      return;
    }

    isFinishing = true;
    await finish();
  };

  const stopWorkers = () => {
    for (const worker of workers) {
      if (!worker.killed) {
        worker.kill('SIGTERM');
      }
    }
  };

  process.once('SIGINT', () => {
    stopWorkers();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    stopWorkers();
    process.exit(143);
  });

  console.log(chalk.yellow(`tests: ${testSuite.length}`));
  console.log(
    chalk.gray(
      `window: ${formatUnix(window.start)} -> ${formatUnix(window.end)} (${window.source})`,
    ),
  );

  console.log('');
  const bar = new ProgressBar(
    ':current/:total [:bar][:percent] :symbol :amount :eta(s)',
    {
      total: testSuite.length,
      width: 20,
    },
  );

  for (const chunk of chunks) {
    const chunkId = uuid();
    const chunkWithId = chunk.map((test) => ({ ...test, chunkId }));
    const tester = fork(testerWorkerPath, [], {
      execArgv: testerNeedsTsRuntime
        ? [
            '--max-old-space-size=8192',
            '-r',
            'ts-node/register',
            '-r',
            'tsconfig-paths/register',
          ]
        : ['--max-old-space-size=8192'],
    });
    workers.add(tester);

    tester.on('message', async (msg: any) => {
      if (msg.done) {
        workers.delete(tester);
        await maybeFinish();
        return;
      }

      completedTests++;

      if (msg.error) {
        errorTests++;
        recordError({
          id: msg.id,
          error: msg.error,
          payload: msg,
        });

        console.error(
          chalk.red(`Error in test #${msg.id}: ${JSON.stringify(msg)}`),
        );

        return;
      } else {
        successTests++;
      }

      const fullResult = msg as TestWorkerResult;
      const result = stripInlineLogs(fullResult);
      const inlineArtifacts = getInlineArtifacts(fullResult);

      const nextTopResults = insertTopResult(results, result, flags.top);
      const shouldCacheTopArtifacts = nextTopResults.added;
      if (nextTopResults.added || results !== nextTopResults.results) {
        updateTopResults(nextTopResults.results, result, inlineArtifacts);
      }

      const updatedBestTickerResult = updateBestTickerResult(
        result,
        inlineArtifacts,
      );

      if (
        (shouldCacheTopArtifacts || updatedBestTickerResult) &&
        inlineArtifacts
      ) {
        await cacheArtifactsById(result.orderLogId, inlineArtifacts);
      }

      if (
        completedTests % progressStep === 0 ||
        completedTests === testSuite.length
      ) {
        const bestResult = results[0];
        const symbol = bestResult?.test.symbol || '-';
        const profit = bestResult?.stat.profit || 0;

        const profitStr = `${(profit || 0).toFixed(2)}$`;

        bar.tick(
          completedTests === testSuite.length
            ? completedTests % progressStep
            : progressStep,
          {
            symbol: chalk.yellow(symbol),
            amount: profit > 0 ? chalk.green(profitStr) : chalk.red(profitStr),
          },
        );
      }
    });

    tester.on('error', (err) => {
      recordError({ error: err?.message ?? err });
      console.error(chalk.red(`Worker error: ${err.message}`));
    });

    tester.on('exit', (code) => {
      workers.delete(tester);
      if (code !== 0) {
        recordError({ error: `Worker exited with code ${code}` });
        console.error(chalk.red(`Worker exited with code ${code}`));
      }

      void maybeFinish();
    });

    await setData(redisKeys.cacheChunk(userName, chunkId), chunkWithId, {
      expire: TTL_1D,
    });

    tester.send({ chunkId, userName });
  }
};

const saveAndPrintResults = async () => {
  const colorizedResults: string[][] = [];
  for await (const result of results) {
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

    const statRow = [
      chalk.blue(name),
      chalk.yellow(symbol),
      ...drawStatInCLI(stat, [
        'netProfit',
        'orders',
        'winRate',
        'riskRewardRatio',
        'maxDrawdown',
      ]),
    ];

    colorizedResults.push(statRow);
  }

  console.log('');
  console.log('RESULTS:');
  console.log(createTable(HEADERS_RESULTS, colorizedResults));
  console.log('');
};

const saveAndPrintResultsByTickers = async () => {
  const colorizedResultsByTickers: string[][] = [];
  for await (const result of resultsByTickers.values()) {
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

    const statRow = [
      chalk.blue(name),
      chalk.yellow(symbol),
      ...drawStatInCLI(stat, [
        'netProfit',
        'orders',
        'winRate',
        'riskRewardRatio',
        'maxDrawdown',
      ]),
    ];

    colorizedResultsByTickers.push(statRow);
  }

  console.log('');
  console.log('RESULTS BY TICKERS:');
  console.log(
    createTable(HEADERS_RESULTS_BY_TICKERS, colorizedResultsByTickers),
  );
  console.log('');
};

const finish = async () => {
  if (flags.tickers) {
    await saveAndPrintResults();
  } else {
    await saveAndPrintResultsByTickers();
  }

  const bestConfig = results[0]?.test.strategyConfig;
  console.log(chalk.gray('BEST CONFIG:'));
  console.log(chalk.green(toJson(bestConfig, true)));
  console.log('');

  const mergedConfig = mergeConfigs(
    results.map(({ test: { strategyConfig } }) => strategyConfig),
  );
  console.log(chalk.gray('MERGED CONFIG:'));
  console.log(chalk.blue(toJson(mergedConfig, true)));
  console.log('');

  console.log(`${chalk.green('SUCCESS TESTS')}: ${successTests}`);
  console.log(`${chalk.red('ERRORS')}: ${errorTests}`);
  console.log('');

  const finishedAt = new Date();
  const durationSeconds = Number(
    ((Date.now() - runStartedAt) / 1000).toFixed(2),
  );
  const timestamp = createTimestamp(finishedAt);

  await setData(
    redisKeys.backtestResults(userName, flags.config, timestamp),
    {
      config: flags.config,
      user: userName,
      startedAt: new Date(runStartedAt).toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationSeconds,
      results,
      resultsByTickers: Array.from(resultsByTickers.values()),
      bestConfig,
      mergedConfig,
      successTests,
      errors: errorMessages,
      errorTests,
    },
    {
      expire: 0,
    },
  );

  process.exit();
};

backtest();
