const ListIt = require('list-it');
import ProgressBar from 'progress';
import { fork } from 'child_process';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import _ from 'lodash';
import createTestSuite from '@/backtest.config';
import { mergeConfigs } from '@utils/grid';
import { rankBacktests, getFormatted } from '@utils/stat';
import { setData, getData } from '@/src/utils/data';
import { toJson } from '@/src/utils/toJson';
import { uuid } from '@utils/uuid';
import {
  TestWorkerResult,
  ThresholdLevel,
  TestStat,
  TestThresholdsKey,
} from '@types';

const TOP_LIMIT = 40;
const MAX_PARALLEL = Math.min(os.cpus().length, 4);

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

export const drawInCLI = (
  stat: TestStat,
  keys: TestThresholdsKey[],
): string[] => {
  return keys.map((key) => {
    const { formatted, level } = getFormatted(stat, key);

    const color = getCLILevelColor(level);

    return color(formatted);
  });
};

const backtest = async () => {
  let testSuite = await createTestSuite();

  testSuite = testSuite.slice(-100);

  const chunkSize = Math.ceil(testSuite.length / MAX_PARALLEL);
  const chunks = _.chunk(testSuite, chunkSize);
  let results: TestWorkerResult[] = [];
  let completedWorkers = 0;
  let completedTests = 0;
  console.log(testSuite.length);

  console.log('');
  const bar = new ProgressBar(
    ':current/:total [:bar][:percent] :id :symbol :amount :minamount :wins/:losses/:orders :winrate :eta(s)',
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
      if (msg.done) {
        completedWorkers++;
        if (completedWorkers === chunks.length) {
          results = rankBacktests(results, TOP_LIMIT);
          await finish(results);
        }
        return;
      }

      if (msg.error) {
        console.error(
          chalk.red(`Error in test #${msg.id}: ${JSON.stringify(msg)}`),
        );
        return;
      }

      completedTests++;

      results.push(msg as TestWorkerResult);

      results.forEach(({ stat: { netProfit, winRate } }) => {
        if (netProfit > bestResults.netProfit) {
          bestResults.netProfit = netProfit;
        }
        if (winRate > bestResults.winRate) {
          bestResults.winRate = winRate;
        }
      });

      if (completedTests % 100 === 0 || completedTests === testSuite.length) {
        results = rankBacktests(results, TOP_LIMIT);

        const {
          test: { symbol, name },
          stat: { orders, amount, minAmount, wins, losses, winRate },
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

  const bestConfig = results[0].test.strategyConfig;
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
          amount: `${bestResults.netProfit.toFixed(2)}$`,
          ws: `${bestResults.winRate.toFixed(0)}%`,
        },
        true,
      ),
    ),
  );
  console.log('');

  process.exit();
};

backtest();
