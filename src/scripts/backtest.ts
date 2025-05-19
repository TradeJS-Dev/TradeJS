const ListIt = require('list-it');
import chalk from 'chalk';
import { format } from 'date-fns';
import { testing } from '@utils/testing';
import createTestConfig from '@/backtest.config';

const HEADERS = [
  chalk.blue('id'),
  chalk.yellow('symbol'),
  chalk.green('profit'),
  chalk.red('low'),
  chalk.cyan('orders'),
];

const backtest = async () => {
  let num = 1;
  const results: string[][] = [];

  const testConfig = await createTestConfig();

  for await (const test of testConfig) {
    const id = `${test.name}-${format(new Date(), 'dd.MM-HH:mm')}`;

    const stat = await testing(
      id,
      test.symbol,
      test.strategy,
      test.options,
      test.strategyConfig,
      test.connector,
    );

    results.push([
      chalk.blue(`#${num.toString()} ${id}`),
      chalk.yellow(test.symbol),
      chalk.green(`${stat.amount.toFixed(2)}$`),
      chalk.red(`${stat.minAmount.toFixed(2)}$`),
      chalk.cyan(stat.orders),
    ]);

    num++;
  }

  const listit = new ListIt({
    autoAlign: true,
    headerUnderline: true,
  });

  console.log(listit.setHeaderRow(HEADERS).d(results).toString());
};

backtest();
