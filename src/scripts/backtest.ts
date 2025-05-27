const ListIt = require('list-it');
import ProgressBar from 'progress';
import chalk from 'chalk';
import { testing } from '@utils/testing';
import createTestConfig from '@/backtest.config';
import { getTopResults, mergeConfigs } from '@utils/results';
import { setCache } from '@utils/cache';
import { stringify } from '@utils/stringify';
import { BacktestStat } from '@types';

const TOP_LIMIT = 10;

const HEADERS = [
  chalk.gray('#'),
  chalk.blue('id'),
  chalk.yellow('symbol'),
  chalk.green('profit'),
  chalk.red('low'),
  chalk.cyan('orders'),
];

const backtest = async () => {
  let num = 0;
  let results: BacktestStat[] = [];

  const testConfig = await createTestConfig();

  console.log('');
  const bar = new ProgressBar(
    ':current/:total [:bar][:percent] :ind :id :symbol :amount :minamount :orders :eta(s)',
    {
      total: testConfig.length,
      width: 40,
    },
  );

  for await (const test of testConfig) {
    const testStat = await testing(
      test.symbol,
      test.options,
      test.strategyCreator,
      test.strategyConfig,
      test.connector,
    );

    results.push({
      ind: num,
      id: test.name,
      symbol: test.symbol,
      config: test.strategyConfig,
      ...testStat,
    });

    results = getTopResults(results, TOP_LIMIT);

    const { symbol, id, ind, orders, amount, minAmount } = results[0];

    bar.tick({
      ind: chalk.gray(ind),
      id: chalk.blue(`#${id}`),
      symbol: chalk.yellow(symbol),
      amount: chalk.green(`${amount.toFixed(2)}$`),
      minamount: chalk.red(`${minAmount.toFixed(2)}$`),
      orders: chalk.cyan(orders),
    });

    num++;
  }

  const listit = new ListIt({
    autoAlign: true,
    headerUnderline: true,
  });

  results.forEach(({ symbol, id, orderLog, config }) => {
    setCache('data', `_backtest_${symbol}_${id}`, orderLog);
    setCache('data', `_backtest_${symbol}_${id}.info`, config);
  });

  const colorizedResults = results.map(
    ({ ind, id, symbol, amount, minAmount, orders }) => [
      chalk.gray(ind),
      chalk.blue(id),
      chalk.yellow(symbol),
      chalk.green(`${amount.toFixed(2)}$`),
      chalk.red(`${minAmount.toFixed(2)}$`),
      chalk.cyan(orders),
    ],
  );

  console.log('');
  console.log(listit.setHeaderRow(HEADERS).d(colorizedResults).toString());
  console.log('');

  const bestConfig = results[0].config;
  console.log(chalk.gray('best config:'));
  console.log(chalk.green(stringify(bestConfig)));
  console.log('');

  const mergedConfig = mergeConfigs(results.map(({ config }) => config));
  console.log(chalk.gray('merged config:'));
  console.log(chalk.blue(stringify(mergedConfig)));
  console.log('');
};

backtest();
