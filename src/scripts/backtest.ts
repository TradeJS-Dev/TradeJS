const ListIt = require('list-it');
import ProgressBar from 'progress';
import { fork } from 'child_process';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import _ from 'lodash';
import createTestConfig from '@/backtest.config';
import { getTopResults, mergeConfigs } from '@utils/results';
import { setData, getData } from '@/src/utils/data';
import { toJson } from '@/src/utils/toJson';
import { uuid } from '@utils/uuid';
import { BacktestStat } from '@types';

const TOP_LIMIT = 10;
const MAX_PARALLEL = Math.min(os.cpus().length, 4);

const HEADERS = [
  chalk.blue('ID'),
  chalk.yellow('SYMBOL'),
  chalk.green('PROFIT'),
  chalk.red('LOW'),
  chalk.green('WINS'),
  chalk.red('LOSSES'),
  chalk.cyan('ORDERS'),
  chalk.yellow('WIN/LOSS (%)'),
];

let betResults: any = {
  amount: 0,
  ws: 0,
};

const backtest = async () => {
  const testConfig = await createTestConfig();

  const chunkSize = Math.ceil(testConfig.length / MAX_PARALLEL);
  const chunks = _.chunk(testConfig, chunkSize);
  let results: BacktestStat[] = [];
  let completedWorkers = 0;
  let completedTests = 0;
  console.log(testConfig.length);

  console.log('');
  const bar = new ProgressBar(
    ':current/:total [:bar][:percent] :id :symbol :amount :minamount :wins/:losses/:orders :ws :eta(s)',
    {
      total: testConfig.length,
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
          await finish(results);
        }
        return;
      }

      if (msg.error) {
        console.error(chalk.red(`Error in test #${msg.id}: ${msg.error}`));
        return;
      }

      completedTests++;

      const { stat, test } = msg;

      results.push({
        id: test.name,
        symbol: test.symbol,
        config: test.strategyConfig,
        ...stat,
      });

      results.forEach(({ amount, ws }) => {
        if (amount > betResults.amount) {
          betResults.amount = amount;
        }
        if (ws > betResults.ws) {
          betResults.ws = ws;
        }
      });

      if (completedTests % 100 === 0 || completedTests === testConfig.length) {
        results = getTopResults(results, TOP_LIMIT);

        const { symbol, id, orders, amount, minAmount, wins, losses, ws } =
          results[0];

        bar.tick(
          completedTests === testConfig.length ? completedTests % 100 : 100,
          {
            id: chalk.blue(`#${id}`),
            symbol: chalk.yellow(symbol),
            amount: chalk.green(`${(amount || 0).toFixed(2)}$`),
            minamount: chalk.red(`${(minAmount || 0).toFixed(2)}$`),
            wins: chalk.green(wins),
            losses: chalk.red(losses),
            ws: chalk.yellow(`${(ws || 0).toFixed(0)}%`),
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

const finish = async (results: BacktestStat[]) => {
  const listit = new ListIt({
    autoAlign: true,
    headerUnderline: true,
  });

  for await (const result of results) {
    const { symbol, id, orderLogId, config } = result;
    const orderLog = await getData('data/cache', orderLogId);
    await setData('data/tests', `${symbol}_${id}`, orderLog, {
      useCache: false,
      stringify: true,
    });
    await setData('data/tests', `${symbol}_${id}.info`, config, {
      useCache: false,
      stringify: true,
    });
  }

  const colorizedResults = results.map(
    ({ id, symbol, amount, minAmount, wins, losses, ws, orders }) => [
      chalk.blue(id),
      chalk.yellow(symbol),
      chalk.green(`${(amount || 0).toFixed(2)}$`),
      chalk.red(`${(minAmount || 0).toFixed(2)}$`),
      chalk.green(wins),
      chalk.red(losses),
      chalk.cyan(orders),
      chalk.yellow(`${(ws || 0).toFixed(0)}%`),
    ],
  );

  console.log('');
  console.log('');
  console.log(listit.setHeaderRow(HEADERS).d(colorizedResults).toString());
  console.log('');

  const bestConfig = results[0].config;
  console.log(chalk.gray('best config:'));
  console.log(chalk.green(toJson(bestConfig, true)));
  console.log('');

  const mergedConfig = mergeConfigs(results.map(({ config }) => config));
  console.log(chalk.gray('merged config:'));
  console.log(chalk.blue(toJson(mergedConfig, true)));
  console.log('');

  console.log(
    chalk.yellow(
      toJson(
        {
          amount: `${betResults.amount.toFixed(2)}$`,
          ws: `${betResults.ws.toFixed(0)}%`,
        },
        true,
      ),
    ),
  );
  console.log('');

  process.exit();
};

backtest();
