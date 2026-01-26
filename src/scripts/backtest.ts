const ListIt = require('list-it');
import args from 'args';
import ProgressBar from 'progress';
import { fork } from 'child_process';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import _ from 'lodash';
import { TESTS_TOP_LIMIT, TESTS_LIMIT } from '@constants';
import { connectors } from '@src/connectors';
import { mergeConfigs } from '@utils/grid';
import {
  getBacktestScore,
  calculateStatsFull,
  sortBestTests,
} from '@utils/stat';
import { setData, getData, redisKeys } from '@utils/redis';
import { toJson } from '@utils/toJson';
import { uuid } from '@utils/uuid';
import { createTestSuite } from '@utils/grid';
import { update, drawStatInCLI, getTickers } from '@utils/cli';
import { filterGoodTests } from '@utils/tests';
import { Interval, TestStat, TestWorkerResult } from '@types';

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
  chalk.cyan('SHARPE'),
  chalk.cyan('EXPOSURE (%)'),
  chalk.cyan('MAX DRAWDOWN (%)'),
];

const HEADERS_RESULTS_BY_TICKERS = [
  chalk.blue('ID'),
  chalk.yellow('SYMBOL'),
  chalk.cyan('PROFIT'),
  chalk.cyan('ORDERS'),
];

let successTests = 0;
let errorTests = 0;
const resultsByTickers = new Map<
  string,
  {
    testName: string;
    profit: number;
    orders: number;
  }
>();

const userName = flags.user;

const createListIt = () =>
  new ListIt({
    autoAlign: true,
    headerUnderline: true,
  });

const backtest = async () => {
  const byBitConnector = await connectors.ByBit({
    userName: flags.user,
  });

  const tickers = await getTickers(
    byBitConnector,
    flags.tickers,
    flags.exclude,
    flags.tickersLimit,
  );

  if (flags.showTickersList) {
    console.log(chalk.gray(JSON.stringify(tickers.sort(), null, 2)));

    return;
  }

  if (!flags.cacheOnly) {
    await update(byBitConnector, interval, tickers);
  }

  if (flags.updateOnly) {
    return;
  }

  const backtestConfig = await getData(redisKeys.backtest(flags.config));

  let testSuite = createTestSuite(userName, tickers, backtestConfig).slice(
    0,
    parseInt(flags.tests),
  );

  const chunkSize = Math.ceil(testSuite.length / parseInt(flags.parallel));
  const chunks = _.chunk(testSuite, chunkSize);
  let results: TestWorkerResult[] = [];
  let completedWorkers = 0;
  let completedTests = 0;

  console.log(chalk.yellow(`tests: ${testSuite.length}`));

  console.log('');
  const bar = new ProgressBar(
    ':current/:total [:bar][:percent] :id :symbol :amount :eta(s)',
    {
      total: testSuite.length,
      width: 40,
    },
  );

  for (const chunk of chunks) {
    const tester = fork(
      path.resolve(__dirname, '../workers', 'tester.ts'),
      [],
      {
        execArgv: ['--max-old-space-size=8192', '-r', 'ts-node/register'],
      },
    );

    tester.on('message', async (msg: any) => {
      completedTests++;

      if (msg.done) {
        completedWorkers++;

        if (completedWorkers === chunks.length) {
          results = sortBestTests(results, flags.top);
          await finish(results);
        }

        return;
      }

      if (msg.error) {
        errorTests++;

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

        if (!prevValue || prevValue.profit < res.stat.profit) {
          resultsByTickers.set(res.test.symbol, {
            orders: res.stat.orders,
            profit: res.stat.profit,
            testName: res.test.name,
          });
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
            id: chalk.blue(`#${name}`),
            symbol: chalk.yellow(symbol),
            amount: profit > 0 ? chalk.green(profitStr) : chalk.red(profitStr),
          },
        );
      }
    });

    tester.on('error', (err) => {
      console.error(chalk.red(`Worker error: ${err.message}`));
    });

    tester.on('exit', (code) => {
      if (code !== 0)
        console.error(chalk.red(`Worker exited with code ${code}`));
    });

    const chunkId = uuid();
    await setData(redisKeys.cacheChunk(chunkId), chunk);

    tester.send({ chunkId });
  }
};

const finish = async (results: TestWorkerResult[]) => {
  const colorizedResults = new Array<string[]>();

  for await (const result of results) {
    const { test, orderLogId } = result;

    const { symbol, name } = test;

    const orderLog = await getData(redisKeys.cacheOrders(orderLogId));
    const positionLog = await getData(redisKeys.cachePositions(orderLogId));

    const stat = calculateStatsFull(positionLog) as TestStat;

    if (!stat) {
      continue;
    }

    stat.score = getBacktestScore(stat);

    await setData(redisKeys.testOrders(userName, name), orderLog, {
      stringify: false,
    });

    await setData(redisKeys.testConfig(userName, name), test, {
      stringify: true,
    });

    await setData(redisKeys.testStat(userName, name), stat, {
      stringify: true,
    });

    colorizedResults.push([
      chalk.blue(name),
      chalk.yellow(symbol),
      ...drawStatInCLI(stat, [
        'netProfit',
        'orders',
        'winRate',
        'riskRewardRatio',
        'sharpeRatio',
        'exposure',
        'maxDrawdown',
      ]),
    ]);
  }

  console.log('');
  console.log('RESULTS:');
  console.log(
    createListIt().setHeaderRow(HEADERS_RESULTS).d(colorizedResults).toString(),
  );
  console.log('');

  console.log('');
  console.log('RESULTS BY TICKERS:');
  console.log(
    createListIt()
      .setHeaderRow(HEADERS_RESULTS_BY_TICKERS)
      .d(
        [...resultsByTickers].map(([symbol, value]) => [
          value.testName,
          symbol,
          value.profit,
          value.orders,
        ]),
      )
      .toString(),
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

  process.exit();
};

backtest();
