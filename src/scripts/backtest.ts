const ListIt = require('list-it');
import chalk from 'chalk';
import { getUnixTime, subDays } from 'date-fns';
import { testing } from '@src/utils/testing';
import { BreakoutStrategyCreator, config } from '@src/strategy/Breakout';
import { TestConfig } from '@types';

const start = getUnixTime(subDays(new Date(), 30)) * 1000;
const end = getUnixTime(new Date()) * 1000;

const TEST_CONFIG: TestConfig = [
  {
    options: {
      symbol: 'DOGSUSDT',
      start,
      end,
    },
    strategyConfig: {
      ...config,
    },
  },
];

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

  for await (const test of TEST_CONFIG) {
    const stat = await testing(
      num.toString(),
      BreakoutStrategyCreator,
      test.options,
      test.strategyConfig,
    );

    results.push([
      chalk.blue(`#${num.toString()}`),
      chalk.yellow(test.options.symbol),
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
