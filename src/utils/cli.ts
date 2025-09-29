import fs from 'fs/promises';
import _ from 'lodash';
import ProgressBar from 'progress';
import chalk from 'chalk';
import { PRELOAD_DAYS } from '@constants';
import { getFiles } from '@utils/data';
import { getTimestamp } from '@utils/timestamp';
import { getFormatted } from '@utils/stat';
import { getTopTickers } from '@utils/tickers';
import { screenDashboard } from '@utils/screen';
import {
  Connector,
  Interval,
  TestStat,
  ThresholdLevel,
  TestThresholdsKey,
  Signal,
} from '@types';

const PRELOAD_START = getTimestamp(PRELOAD_DAYS);
const PRELOAD_END = getTimestamp();
const CONCURRENCY = 10;

export const cleanFiles = async (dir: string) => {
  let completed = 0;

  const files = await getFiles(dir);

  const bar = new ProgressBar(':current/:total [:bar][:percent] :eta(s)', {
    total: files.length,
    width: 30,
  });

  console.log(chalk.yellow('clean:', dir));

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

  console.log(chalk.yellow('update:', tickers.length));

  const queue = tickers.slice();

  const worker = async () => {
    while (queue.length > 0) {
      const symbol = queue.shift()!;
      try {
        await connector.kline({
          symbol,
          start: PRELOAD_START,
          end: PRELOAD_END,
          interval,
          silent: true,
        });
      } catch {
        console.error('Failed loading', symbol);
      } finally {
        bar.tick(1, { symbol: chalk.gray(symbol) });
      }
    }
  };

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

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
  chunk?: string,
) => {
  let tickers = new Array<string>();

  const excludeTickers = parseSymbolsFromCLI(exclude);

  if (include) {
    tickers = parseSymbolsFromCLI(include);
  } else {
    tickers = await scanner(connector, limit);
  }

  if (chunk) {
    const [currentChunk, chunksCount] = chunk
      .split('/')
      .map((c) => parseInt(c));

    console.log('chunks', currentChunk, chunksCount);
    const chunkSize = Math.ceil(tickers.length / chunksCount);
    const chunks = _.chunk(tickers, chunkSize);
    tickers = chunks[currentChunk];
  }

  return tickers.filter((t) => !excludeTickers.includes(t));
};

export const makeScreenshots = async (signals: Signal[]) => {
  const bar = new ProgressBar(
    ':current/:total [:bar][:percent] :eta(s) :symbol',
    {
      total: signals.length,
      width: 30,
    },
  );

  console.log(chalk.yellow('screenshots:', signals.length));

  const queue = signals.slice();

  const worker = async () => {
    while (queue.length > 0) {
      const { symbol, interval, signalId } = queue.shift()!;
      try {
        await screenDashboard({
          symbol,
          interval,
          signalId,
        });
      } catch {
        console.error('Failed screenshot', symbol);
      } finally {
        bar.tick(1, { symbol: chalk.gray(symbol) });
      }
    }
  };

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  console.log('');
};
