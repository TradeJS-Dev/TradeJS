import fs from 'fs/promises';
import _ from 'lodash';
import ProgressBar from 'progress';
import chalk from 'chalk';
import { runWithConcurrency } from '@tradejs/core/async';
import { getFormatted } from '@tradejs/core/backtest';
import { PRELOAD_DAYS } from '@tradejs/core/constants';
import { getTopTickers } from '@tradejs/core/tickers';
import { getTimestamp } from '@tradejs/core/time';
import {
  AI_CONCURRENCY_LIMIT,
  KLINE_CONCURRENCY_LIMIT,
  SCREENSHOT_CONCURRENCY_LIMIT,
} from './constants';
import { getFiles } from '@tradejs/infra/files';
import {
  RedisWriteBlockedError,
  delKeyWithOptions,
  getKeys,
  getData,
  redisKeys,
} from '@tradejs/infra/redis';
import { logger } from '@tradejs/infra/logger';
import { askAI } from './ai';
import { screenDashboard } from './screenshot';
import { sendSignal, sendSignalAnalysis, sendTextToTG } from './signals';
import {
  Connector,
  Interval,
  TestStat,
  ThresholdLevel,
  TestThresholdsKey,
  Signal,
} from '@tradejs/types';
import { getTradejsProjectCwd } from './tradejsConfig';
export { loadTradejsConfig } from './tradejsConfig';

const getProjectRoot = (): string => getTradejsProjectCwd();

export const cleanFiles = async (dir: string) => {
  let completed = 0;

  const projectRoot = getProjectRoot();
  const files = await getFiles(dir, projectRoot);

  const bar = new ProgressBar(':current/:total [:bar][:percent] :eta(s)', {
    total: files.length,
    width: 30,
  });

  logger.info(chalk.yellow('clean:', dir));

  for await (const file of files) {
    completed++;
    const fullPath = `${dir}/${file}`;
    const stat = await fs.lstat(fullPath);
    if (stat.isDirectory()) {
      await fs.rm(fullPath, { recursive: true, force: true });
    } else {
      await fs.unlink(fullPath);
    }

    if (completed % 100 === 0 || completed === files.length) {
      bar.tick(completed === files.length ? completed % 100 : 100);
    }
  }

  logger.info('');
};

export const cleanRedis = async (area: string) => {
  let completed = 0;

  const keys = await getKeys(area);

  const bar = new ProgressBar(':current/:total [:bar][:percent] :eta(s)', {
    total: keys.length,
    width: 30,
  });

  logger.info(chalk.yellow('clean:', area));

  try {
    for await (const key of keys) {
      completed++;

      await delKeyWithOptions(key, { raiseOnMisconf: true });

      if (completed % 100 === 0 || completed === keys.length) {
        bar.tick(completed === keys.length ? completed % 100 : 100);
      }
    }
  } catch (e) {
    if (e instanceof RedisWriteBlockedError || String(e).includes('MISCONF')) {
      logger.error(
        'Redis write is blocked by MISCONF (RDB save failure). Cleanup stopped early.',
      );
      logger.error(
        'Check Redis logs and fix persistence/memory pressure before retry.',
      );
      logger.info('');
      return;
    }
    throw e;
  }

  logger.info('');
};

export const update = async (
  connector: Connector,
  interval: Interval,
  tickers: string[],
  preloadDays = PRELOAD_DAYS,
  options: {
    connectorLabel?: string;
  } = {},
) => {
  const PRELOAD_START = getTimestamp(preloadDays);
  const PRELOAD_END = getTimestamp();
  const connectorLabel = String(options.connectorLabel || '').trim();

  const bar = new ProgressBar(
    ':current/:total [:bar][:percent] :eta(s) :symbol',
    {
      total: tickers.length,
      width: 30,
    },
  );

  logger.info(
    chalk.yellow(
      `update: ${tickers.length} (connector=${connectorLabel || 'unknown'}, klineConcurrency=${KLINE_CONCURRENCY_LIMIT}, preloadDays=${preloadDays})`,
    ),
  );

  const queue = tickers.slice();

  if (!queue.includes('BTCUSDT')) {
    queue.unshift('BTCUSDT');
  }

  await runWithConcurrency(queue, KLINE_CONCURRENCY_LIMIT, async (symbol) => {
    try {
      await connector.kline({
        symbol,
        start: PRELOAD_START,
        end: PRELOAD_END,
        interval,
        silent: true,
        warmOnly: true,
      });
    } catch {
      logger.error('Failed loading: %s', symbol);
    } finally {
      bar.tick(1, { symbol: chalk.gray(symbol) });
    }
  });

  logger.info('');
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
  stat: Partial<TestStat> | undefined,
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
  let tickers: Array<string>;

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

    logger.info('chunk: %d / %d', currentChunk, chunksCount);
    const chunkSize = Math.ceil(tickers.length / chunksCount);
    const chunks = _.chunk(tickers, chunkSize);
    tickers = chunks[currentChunk - 1];
  }

  return tickers.filter((t) => !excludeTickers.includes(t));
};

export const makeScreenshots = async (
  signals: Signal[],
  interval: Interval,
  userName = 'root',
) => {
  const projectRoot = getProjectRoot();
  const bar = new ProgressBar(
    ':current/:total [:bar][:percent] :eta(s) :symbol',
    {
      total: signals.length,
      width: 30,
    },
  );

  logger.info(chalk.yellow('screenshots:', `${interval}m`, signals.length));

  await runWithConcurrency(
    signals,
    SCREENSHOT_CONCURRENCY_LIMIT,
    async (signal) => {
      try {
        await screenDashboard({ ...signal, interval }, projectRoot, userName);
      } catch (error) {
        logger.error(
          'Failed screenshot: %s (%s)',
          signal.symbol,
          (error as Error)?.message || String(error),
        );
      } finally {
        bar.tick(1, { symbol: chalk.gray(signal.symbol) });
      }
    },
  );

  logger.info('');
};

export const sendToAI = async (signals: Signal[], userName = 'root') => {
  const bar = new ProgressBar(
    ':current/:total [:bar][:percent] :eta(s) :symbol',
    {
      total: signals.length,
      width: 30,
    },
  );

  logger.info(chalk.yellow('AI:', signals.length));

  await runWithConcurrency(signals, AI_CONCURRENCY_LIMIT, async (signal) => {
    try {
      await askAI(signal, { userName });
    } catch {
      logger.error('Failed ask: %s', signal.symbol);
    } finally {
      bar.tick(1, { symbol: chalk.gray(signal.symbol) });
    }
  });

  logger.info('');
};

export const sendToTG = async (
  signals: Signal[],
  imgInterval: Interval,
  userName = 'root',
) => {
  const deliverableSignals = signals.filter(
    (signal) =>
      signal.orderStatus !== 'skipped' && signal.orderStatus !== 'canceled',
  );

  logger.info(chalk.yellow('messages:', deliverableSignals.length));

  if (!deliverableSignals.length) {
    logger.info('');
    return;
  }

  const bar = new ProgressBar(
    ':current/:total [:bar][:percent] :eta(s) :symbol',
    {
      total: deliverableSignals.length,
      width: 30,
    },
  );

  // Keep Telegram deliveries serialized so each signal stays grouped
  // with its AI analysis in chat order.
  await runWithConcurrency(deliverableSignals, 1, async (signal) => {
    try {
      const analysis = await getData(
        redisKeys.analysis(signal.symbol, signal.signalId),
        null,
      );

      await sendSignal(signal, imgInterval, analysis, { userName });

      if (
        analysis &&
        typeof analysis === 'object' &&
        Object.keys(analysis).length > 0
      ) {
        await sendSignalAnalysis(signal, analysis, { userName });
      }
    } catch (err) {
      logger.error(
        'Failed sent: %s %s',
        signal.symbol,
        (err as Error)?.message || String(err),
      );
    } finally {
      bar.tick(1, { symbol: chalk.gray(signal.symbol) });
    }
  });

  logger.info('');
};

export { sendTextToTG };
