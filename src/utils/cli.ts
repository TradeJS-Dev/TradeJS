import fs from 'fs/promises';
import ProgressBar from 'progress';
import chalk from 'chalk';
import { PRELOAD_DAYS } from '@constants';
import { getFiles } from '@utils/data';
import { getTimestamp } from '@utils/timestamp';
import { getFormatted } from '@utils/stat';
import { getTopTickers } from '@utils/tickers';
import {
  Connector,
  Interval,
  TestStat,
  ThresholdLevel,
  TestThresholdsKey,
} from '@types';

const PRELOAD_START = getTimestamp(PRELOAD_DAYS);
const PRELOAS_END = getTimestamp();

export const cleanFiles = async (dir: string) => {
  let completed = 0;

  const files = await getFiles(dir);

  const bar = new ProgressBar(':current/:total [:bar][:percent] :eta(s)', {
    total: files.length,
    width: 30,
  });

  console.log(chalk.yellow(`clean ${dir}`));

  for await (const file of files) {
    completed++;

    await fs.unlink(`${dir}/${file}`);

    if (completed % 100 === 0 || completed === files.length) {
      bar.tick(completed === files.length ? completed % 100 : 100);
    }
  }

  console.log('');
};

export const update = async (
  connector: Connector,
  interval: Interval,
  tickers: string[],
) => {
  const bar = new ProgressBar(
    ':current/:total [:bar][:percent] :eta(s) :symbol',
    {
      total: tickers.length,
      width: 30,
    },
  );

  let completed = 0;

  console.log(chalk.yellow('update tickers'));

  for await (const symbol of tickers) {
    await connector.kline({
      symbol,
      start: PRELOAD_START,
      end: PRELOAS_END,
      interval: interval,
      silent: true,
    });

    completed++;

    bar.tick(1, {
      symbol: chalk.gray(symbol),
    });
  }

  console.log('');
};

const parseSymbolsFromCLI = (symbol = '') =>
  symbol.split(',').map((s) => {
    const ticker = s.toUpperCase();
    return ticker.endsWith('USDT') ? ticker : `${ticker}USDT`;
  });

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

export const drawStatInCLI = (
  stat: TestStat,
  keys: TestThresholdsKey[],
): string[] => {
  return keys.map((key) => {
    const { formatted, level } = getFormatted(stat, key);

    const color = getCLILevelColor(level);

    return color(formatted);
  });
};

const scanner = async (connector: Connector, limit?: number) => {
  const data = await connector.getTickers();

  const tickers = getTopTickers(data, limit);
  return tickers.map(({ value }) => value);
};

export const getTickers = async (
  connector: Connector,
  include = '',
  exclude = '',
  limit?: number,
) => {
  let tickers = new Array<string>();

  const excludeTickers = parseSymbolsFromCLI(exclude);

  if (include) {
    tickers = parseSymbolsFromCLI(include);
  } else {
    tickers = await scanner(connector, limit);
  }

  return tickers.filter((t) => !excludeTickers.includes(t));
};
