import ProgressBar from 'progress';
import chalk from 'chalk';
import { TestingBox } from '@types';
import { formatUnix } from './timestamp';
import { TestConnectorCreator } from '@src/connectors/Test';
import { getTimestamp } from '@utils/timestamp';
import { setCache } from '@utils/cache';

const _5m = 300_000;
const INC = _5m * 1;

export const testing: TestingBox = async (
  id,
  symbol,
  strategyCreator,
  { start, end },
  config,
) => {
  const times = new Array<number>();
  const strategy = strategyCreator(config);
  const testConnector = TestConnectorCreator({
    key: '',
    secret: '',
  });
  let lastTimeStamp = start!;

  for (let timestamp = start!; timestamp <= end - INC * 4; timestamp += INC) {
    times.push(timestamp);
  }

  const preloadStart = getTimestamp(60);

  await testConnector.kline({
    symbol,
    start: preloadStart,
    end,
    interval: '5',
  });
  await testConnector.kline({
    symbol,
    start: preloadStart,
    end,
    interval: '15',
  });

  const bar = new ProgressBar(':bar :id :date :amount :minamount :orders', {
    total: times.length,
    width: 20,
  });

  for await (const timestamp of times) {
    await testConnector.checkSl(symbol, lastTimeStamp, timestamp);
    await testConnector.checkTp(symbol, lastTimeStamp, timestamp);
    await strategy(symbol, timestamp, testConnector);

    lastTimeStamp = timestamp;

    const stat = testConnector.getStat();

    bar.tick({
      id: chalk.blue(`#${id}`),
      orders: chalk.cyan(stat.orders),
      amount: chalk.green(`${stat.amount.toFixed(2)}$`),
      minamount: chalk.red(`${stat.minAmount.toFixed(2)}$`),
      date: chalk.yellow(formatUnix(timestamp)),
    });
  }

  testConnector.saveStat(symbol, id);
  setCache('data', `_backtest_${symbol}_${id}.info`, config);

  return testConnector.getStat();
};
