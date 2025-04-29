const ListIt = require('list-it');
import chalk from 'chalk';
import { getUnixTime, subDays } from 'date-fns';
import { testing } from '@src/utils/testing';
import { MaStrategyCreator, config } from '@src/strategy/MA';
import { TestConfig } from '@types';

const start = getUnixTime(subDays(new Date(), 3)) * 1000;
const end = getUnixTime(new Date()) * 1000;

const TEST_CONFIG: TestConfig = [
  {
    options: {
      symbol: 'SUIUSDT',
      start,
      end,
    },
    strategyConfig: {
      ...config,
      PERIODS: [2, 50],
      tpl: [
        {
          rate: 0.3,
          profit: 0.04,
        },
        {
          rate: 0.3,
          profit: 0.08,
        },
        {
          rate: 0.3,
          profit: 0.16,
        },
      ],
    },
  },
  // {
  //   options: {
  //     symbol: 'DYMUSDT',
  //     start,
  //     end,
  //   },
  //   strategyConfig: {
  //     PERIODS: [2, 50],
  //     LIMIT: 200,
  //     tpl: [
  //       {
  //         rate: 0.3,
  //         profit: 0.02,
  //       },
  //       {
  //         rate: 0.3,
  //         profit: 0.04,
  //       },
  //       {
  //         rate: 0.3,
  //         profit: 0.08,
  //       },
  //     ],
  //   },
  // },
  // {
  //   options: {
  //     symbol: 'DYMUSDT',
  //     start,
  //     end,
  //   },
  //   strategyConfig: {
  //     PERIODS: [2, 99],
  //     LIMIT: 200,
  //     tpl: [
  //       {
  //         rate: 0.3,
  //         profit: 0.02,
  //       },
  //       {
  //         rate: 0.3,
  //         profit: 0.04,
  //       },
  //       {
  //         rate: 0.3,
  //         profit: 0.08,
  //       },
  //     ],
  //   },
  // },
  // {
  //   options: {
  //     symbol: 'DYMUSDT',
  //     start,
  //     end,
  //   },
  //   strategyConfig: {
  //     PERIODS: [2, 99],
  //     LIMIT: 200,
  //     tpl: [
  //       {
  //         rate: 0.3,
  //         profit: 0.04,
  //       },
  //       {
  //         rate: 0.3,
  //         profit: 0.08,
  //       },
  //       {
  //         rate: 0.3,
  //         profit: 0.16,
  //       },
  //     ],
  //   },
  // },
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
      MaStrategyCreator,
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
