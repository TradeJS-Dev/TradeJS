import ProgressBar from 'progress';
import chalk from 'chalk';
import { TestingBox } from '@types';
import { formatUnix } from './timestamp';
import { TestConnectorCreator } from '@src/connectors/Test';
import { getTimestamp } from '@utils/timestamp';
import { setCache } from '@utils/cache';

const preloadStart = getTimestamp(90);

export const testing: TestingBox = async (
  id,
  symbol,
  { start, end },
  strategyCreator,
  strategyConfig,
  connector,
) => {
  if (!start) {
    throw new Error('no start');
  }

  const data = await connector.kline({
    symbol,
    start: preloadStart,
    end,
    interval: '15',
  });

  const prevData = data.filter((candle) => candle.timestamp < start);
  const testData = data.filter((candle) => candle.timestamp >= start);

  const strategy = strategyCreator(strategyConfig, prevData);
  const testConnector = TestConnectorCreator(connector);

  const bar = new ProgressBar(':bar :id :date :amount :minamount :orders', {
    total: testData.length,
    width: 20,
  });

  for await (const candle of testData) {
    await strategy(symbol, candle, testConnector);
    testConnector.checkSl(candle);
    testConnector.checkTp(candle);

    const stat = testConnector.getStat();

    bar.tick({
      id: chalk.blue(`#${id}`),
      orders: chalk.cyan(stat.orders),
      amount: chalk.green(`${stat.amount.toFixed(2)}$`),
      minamount: chalk.red(`${stat.minAmount.toFixed(2)}$`),
      date: chalk.yellow(formatUnix(candle.timestamp)),
    });
  }

  testConnector.saveStat(symbol, id);
  setCache('data', `_backtest_${symbol}_${id}.info`, strategyConfig);

  return testConnector.getStat();
};
