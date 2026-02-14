const ListIt = require('list-it');
import args from 'args';
import ProgressBar from 'progress';
import { fork } from 'child_process';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import _ from 'lodash';
import { format } from 'date-fns';
import { TESTS_TOP_LIMIT, TESTS_LIMIT, TTL_1M, TTL_1D } from '@constants';
import { connectors, ConnectorNames } from '@src/connectors';
import { mergeConfigs, createTestSuite } from '@utils/grid';
import { calculateStatsFull, sortBestTests } from '@utils/stat';
import { setData, getData, redisKeys } from '@utils/redis';
import { toJson } from '@utils/toJson';
import { uuid } from '@utils/uuid';
import { update, drawStatInCLI, getTickers } from '@utils/cli';
import {
  Interval,
  OrderLog,
  PositionLogData,
  TestStat,
  Test,
  TestWorkerResult,
  ConnectorCreator,
} from '@types';

const MAX_PARALLEL = Math.min(os.cpus().length, 4);

args.example(
  ' yarn backtest -t 400 --cacheOnly',
  'Run tests on uploaded data for 400 tickers',
);

args.option(['t', 'tickers'], 'Selected tickers');
args.option(['e', 'exclude'], 'Exclude tickers from tests');
args.option(['l', 'tickersLimit'], 'Tickers limit');
args.option(['n', 'tests'], 'Tests limit', TESTS_LIMIT);
args.option(['p', 'parallel'], 'Parallel tasks', MAX_PARALLEL);
args.option(['f', 'timeframe'], 'Timeframe', 15);
args.option(['T', 'top'], 'Return N best tests', TESTS_TOP_LIMIT);
args.option(['u', 'updateOnly'], 'Only update tickers history', false);
args.option(['C', 'cacheOnly'], 'Do not update tickers history', false);
args.option(['c', 'config'], 'Backtest config', 'breakout');
args.option(['L', 'showTickersList'], 'Just show only ticker list', false);
args.option(['S', 'progressStep'], 'Progress step', 100);
args.option(['U', 'user'], 'Use user confg', 'root');
args.option(['m', 'ml'], 'Write ML dataset rows to per-worker JSONL chunks', false);

const flags = args.parse(process.argv);
const interval = flags.timeframe.toString() as Interval;
const progressStep = flags.progressStep;

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

let successTests = 0;
let errorTests = 0;
const errorMessages: ErrorMessage[] = [];
const resultsByTickers = new Map<string, TestWorkerResult>();

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

const filterGoodTests = (tests: TestWorkerResult[]) =>
  tests.filter((res) => res.stat?.orders > 5 && res.stat?.profit > 10);

const recordError = (error: ErrorMessage) => {
  errorMessages.push(error);
};

const getLogsById = async (orderLogId: string) => {
  const orderLog = (await getData(
    redisKeys.cacheOrders(userName, orderLogId),
  )) as OrderLog;
  const positionLog = (await getData(
    redisKeys.cachePositions(userName, orderLogId),
  )) as PositionLogData;

  return { orderLog, positionLog };
};

const setTestData = async (test: Test, stat: TestStat, orderLog: OrderLog) => {
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
  const backtestConfig = await getData(
    redisKeys.backtestConfig(userName, flags.config),
  );
  const connectorNameRaw = String(backtestConfig?.connectorName || '');
  const connectorName =
    connectorNameRaw === 'binance'
      ? ConnectorNames.Binance
      : connectorNameRaw === 'coinbase'
        ? ConnectorNames.Coinbase
        : connectorNameRaw === 'bybit'
          ? ConnectorNames.ByBit
          : (backtestConfig?.connectorName as ConnectorNames | undefined) ||
            ConnectorNames.ByBit;
  const connectorFactory =
    connectors[connectorName] || connectors[ConnectorNames.ByBit];
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
    await update(marketConnector, interval, tickers);
  }

  if (flags.updateOnly) {
    return;
  }

  let testSuite = createTestSuite(userName, tickers, backtestConfig).slice(
    0,
    parseInt(flags.tests),
  );
  const mlEnabled = Boolean(flags.ml);
  testSuite = testSuite.map((test) => ({ ...test, ml: mlEnabled }));

  const chunkSize = Math.ceil(testSuite.length / parseInt(flags.parallel));
  const chunks = _.chunk(testSuite, chunkSize);
  let results: TestWorkerResult[] = [];
  let completedWorkers = 0;
  let completedTests = 0;
  let isFinishing = false;
  const workers = new Set<ReturnType<typeof fork>>();

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
    const tester = fork(
      path.resolve(__dirname, '../workers', 'tester.ts'),
      [],
      {
        execArgv: ['--max-old-space-size=8192', '-r', 'ts-node/register'],
      },
    );
    workers.add(tester);

    tester.on('message', async (msg: any) => {
      if (msg.done) {
        completedWorkers++;
        workers.delete(tester);

        if (completedWorkers === chunks.length && !isFinishing) {
          isFinishing = true;
          results = sortBestTests(results, flags.top);
          await finish(results);
        }

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

      results.push(msg as TestWorkerResult);
      const goodResults = filterGoodTests(results);

      goodResults.forEach((res) => {
        const prevValue = resultsByTickers.get(res.test.symbol);

        if (!prevValue || prevValue.stat.profit < res.stat.profit) {
          resultsByTickers.set(res.test.symbol, res);
        }
      });

      if (
        completedTests % progressStep === 0 ||
        completedTests === testSuite.length
      ) {
        results = sortBestTests(results, flags.top);

        const {
          test: { symbol, name },
          stat: { profit },
        } = results[0];

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
    });

    await setData(redisKeys.cacheChunk(userName, chunkId), chunkWithId, {
      expire: TTL_1D,
    });

    tester.send({ chunkId, userName });
  }
};

const finish = async (results: TestWorkerResult[]) => {
  const colorizedResults: string[][] = [];
  const colorizedResultsByTickers: string[][] = [];

  for await (const result of results) {
    const { test, orderLogId } = result;

    const { symbol, name } = test;

    const { orderLog, positionLog } = await getLogsById(orderLogId);

    const stat = calculateStatsFull(positionLog) as TestStat;

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

  for await (const result of resultsByTickers.values()) {
    const { test, orderLogId } = result;

    const { symbol, name } = test;

    const { orderLog, positionLog } = await getLogsById(orderLogId);

    const stat = calculateStatsFull(positionLog) as TestStat;

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
      resultsByTickers: resultsByTickers.values(),
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
