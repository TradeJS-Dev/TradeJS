const ListIt = require('list-it');
import args from 'args';
import ProgressBar from 'progress';
import { fork } from 'child_process';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import _ from 'lodash';
import { TESTS_TOP_LIMIT, TESTS_LIMIT, TICKERS_LIMIT } from '@constants';
import { connectors } from '@src/connectors';
import { PRELOAD_DAYS } from '@constants';
import { mergeConfigs } from '@utils/grid';
import { rankBacktests, getFormatted } from '@utils/stat';
import { setData, getData } from '@/src/utils/data';
import { toJson } from '@/src/utils/toJson';
import { uuid } from '@utils/uuid';
import { createTestSuite } from '@utils/grid';
import { getTimestamp } from '@utils/timestamp';
import { getTopTickers } from '@utils/tickers';
import {
  TestWorkerResult,
  ThresholdLevel,
  TestStat,
  TestThresholdsKey,
} from '@types';

const PRELOAD_START = getTimestamp(PRELOAD_DAYS);
const PRELOAS_END = getTimestamp();
const MAX_PARALLEL = Math.min(os.cpus().length, 4);

args.example(
  ' yarn backtest -t 400 --cacheOnly',
  'Run tests on uploaded data for 400 tickers',
);

args.option(['s', 'symbol'], 'Selected symbols');
args.option(['e', 'exclude'], 'Exclude tickers from tests');
args.option(['t', 'tickers'], 'Tickers limit', TICKERS_LIMIT);
args.option(['n', 'tests'], 'Tests limit', TESTS_LIMIT);
args.option(['p', 'parallel'], 'Parallel tasks', MAX_PARALLEL);
args.option(['T', 'top'], 'Return N best tests', TESTS_TOP_LIMIT);
args.option(['u', 'updateOnly'], 'Only update tickers history', false);
args.option(['c', 'cacheOnly'], 'Do not update tickers history', false);
args.option(['S', 'showTickersList'], 'Just show only ticker list', false);
args.option(['U', 'user'], 'Use user confg', 'root');

const flags = args.parse(process.argv);

const HEADERS = [
  chalk.blue('ID'),
  chalk.yellow('SYMBOL'),
  chalk.cyan('PROFIT'),
  chalk.cyan('ORDERS'),
  chalk.cyan('WIN/LOSS (%)'),
  chalk.cyan('RISK'),
  chalk.cyan('SHARPE'),
  chalk.cyan('SORTINO'),
  chalk.cyan('EXPOSURE (%)'),
  chalk.cyan('MAX DRAWDOWN (%)'),
  chalk.cyan('SCORE'),
];

let bestResults = {
  netProfit: -1000,
  winRate: 0,
  minAmount: 0,
  sharpeRatio: 0,
};

let successTests = 0;
let errorTests = 0;

const byBitConnector = connectors.ByBit({
  userName: flags.user,
});

const update = async (tickers: string[]) => {
  const bar = new ProgressBar(':current/:total [:bar][:percent] :eta(s)', {
    total: tickers.length,
    width: 100,
  });

  let completed = 0;

  console.log(chalk.yellow('update tickers'));

  for await (const symbol of tickers) {
    await byBitConnector.kline({
      symbol,
      start: PRELOAD_START,
      end: PRELOAS_END,
      interval: '15',
      silent: true,
    });

    completed++;

    bar.tick(1);
  }
};

const scanner = async (skip = false) => {
  if (skip) {
    return [];
  }

  const data = await byBitConnector.getTickers();

  const tickers = getTopTickers(data, flags.tickers || TICKERS_LIMIT);
  return tickers.map(({ value }) => value);
};

const parseSymbolsFromCLI = (symbol = '') => {
  return symbol.split(',').map((s) => (s.endsWith('USDT') ? s : `${s}USDT`));
};

const getCLILevelColor = (level: ThresholdLevel) => {
  switch (level) {
    case 'success':
      return chalk.green;
    case 'warning':
      return chalk.yellow;
    case 'error':
      return chalk.red;
  }
};

const drawInCLI = (stat: TestStat, keys: TestThresholdsKey[]): string[] => {
  return keys.map((key) => {
    const { formatted, level } = getFormatted(stat, key);

    const color = getCLILevelColor(level);

    return color(formatted);
  });
};

const backtest = async () => {
  const backtestConfig = await getData('data/backtest', flags.user);

  const volatilityTickers = await scanner(!!flags.symbol);
  const tickers = (
    flags.symbol ? parseSymbolsFromCLI(flags.symbol) : volatilityTickers
  ).filter((t) => !parseSymbolsFromCLI(flags.exclude).includes(t));

  if (flags.tickersList) {
    console.log(chalk.gray(JSON.stringify(tickers.sort(), null, 2)));

    return;
  }

  if (!flags.cacheOnly) {
    await update(tickers);
  }

  if (flags.updateOnly) {
    return;
  }

  let testSuite = createTestSuite(flags.user, tickers, backtestConfig).slice(
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
    ':current/:total [:bar][:percent] :id :symbol :amount :minamount :wins/:losses/:orders :winrate :sharpeRatio :eta(s)',
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
          results = rankBacktests(results, flags.top);
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

      results.forEach(
        ({ stat: { netProfit, winRate, sharpeRatio, minAmount } }) => {
          if (netProfit > bestResults.netProfit) {
            bestResults.netProfit = netProfit;
          }
          if (winRate > bestResults.winRate) {
            bestResults.winRate = winRate;
          }
          if (minAmount > bestResults.minAmount) {
            bestResults.minAmount = minAmount;
          }
          if (sharpeRatio && sharpeRatio > bestResults.sharpeRatio) {
            bestResults.sharpeRatio = sharpeRatio;
          }
        },
      );

      if (completedTests % 100 === 0 || completedTests === testSuite.length) {
        results = rankBacktests(results, flags.top);

        const {
          test: { symbol, name },
          stat: {
            orders,
            amount,
            minAmount,
            wins,
            losses,
            winRate,
            sharpeRatio,
          },
        } = results[0];

        bar.tick(
          completedTests === testSuite.length ? completedTests % 100 : 100,
          {
            id: chalk.blue(`#${name}`),
            symbol: chalk.yellow(symbol),
            amount: chalk.green(`${(amount || 0).toFixed(2)}$`),
            minamount: chalk.red(`${(minAmount || 0).toFixed(2)}$`),
            wins: chalk.green(wins),
            losses: chalk.red(losses),
            winrate: chalk.yellow(`${(winRate || 0).toFixed(0)}%`),
            orders: chalk.cyan(orders),
            sharpeRatio: chalk.magenta(`${(sharpeRatio || 0).toFixed(2)}`),
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
    await setData('data/cache', chunkId, chunk, { useCache: false });

    tester.send({ chunkId });
  }
};

const finish = async (results: TestWorkerResult[]) => {
  const listit = new ListIt({
    autoAlign: true,
    headerUnderline: true,
  });

  for await (const result of results) {
    const { test, stat, orderLogId } = result;

    const { name } = test;

    const orderLog = await getData('data/cache', orderLogId, {
      useCache: false,
    });

    await setData('data/tests', `${name}.orders`, orderLog, {
      useCache: false,
      stringify: true,
    });

    await setData('data/tests', `${name}.config`, test, {
      useCache: false,
      stringify: true,
    });

    await setData('data/tests', `${name}.stat`, stat, {
      useCache: false,
      stringify: true,
    });
  }

  const colorizedResults = results.map(({ test: { symbol, name }, stat }) => [
    chalk.blue(name),
    chalk.yellow(symbol),
    ...drawInCLI(stat, [
      'netProfit',
      'orders',
      'winRate',
      'riskRewardRatio',
      'sharpeRatio',
      'sortinoRatio',
      'exposure',
      'maxDrawdown',
      'score',
    ]),
  ]);

  console.log('');
  console.log('');
  console.log(listit.setHeaderRow(HEADERS).d(colorizedResults).toString());
  console.log('');

  const bestConfig = results[0]?.test.strategyConfig;
  console.log(chalk.gray('best config:'));
  console.log(chalk.green(toJson(bestConfig, true)));
  console.log('');

  const mergedConfig = mergeConfigs(
    results.map(({ test: { strategyConfig } }) => strategyConfig),
  );
  console.log(chalk.gray('merged config:'));
  console.log(chalk.blue(toJson(mergedConfig, true)));
  console.log('');

  console.log(chalk.gray('best result:'));
  console.log(
    chalk.yellow(
      toJson(
        {
          profit: `${bestResults.netProfit.toFixed(2)}$`,
          ws: `${bestResults.winRate.toFixed(0)}%`,
          minAmount: `${bestResults.minAmount.toFixed(2)}$`,
          sharpeRatio: `${bestResults.sharpeRatio.toFixed(2)}`,
        },
        true,
      ),
    ),
  );
  console.log('');
  console.log(`${chalk.green('success')}: ${successTests}`);
  console.log(`${chalk.red('errors')}: ${errorTests}`);
  console.log('');

  process.exit();
};

backtest();
