import ProgressBar from 'progress';
import chalk from 'chalk';
import { TestingBox } from '@types';
import { formatUnix } from './timestamp';
import { TestConnectorCreator } from '@src/connectors/Test';

const _5m = 300_000;
const INC = _5m * 1;

export const testing: TestingBox = async (
  id,
  strategyCreator,
  { symbol, start, end },
  config,
) => {
  const times = new Array<number>();
  const strategy = strategyCreator(config);
  const testConnector = TestConnectorCreator({
    key: '',
    secret: '',
  });
  let lastTimeStamp = start!;

  for (let timestamp = start!; timestamp <= end; timestamp += INC) {
    times.push(timestamp);
  }

  const bar = new ProgressBar(':bar :id :date :amount :minamount :orders', {
    total: times.length,
    width: 20,
  });

  for await (const timestamp of times) {
    lastTimeStamp = timestamp;
    await testConnector.checkSl(symbol, lastTimeStamp, timestamp);
    await testConnector.checkTp(symbol, lastTimeStamp, timestamp);

    await strategy(symbol, timestamp, testConnector);

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

  return testConnector.getStat();
};
