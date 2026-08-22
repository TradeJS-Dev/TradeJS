import fs from 'fs/promises';
import path from 'path';
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
  setData,
} from '@tradejs/infra/redis';
import { logger } from '@tradejs/infra/logger';
import { getDataEdgesForSymbols } from '@tradejs/infra/timescale/candles';
import { askAI } from './ai';
import { ensureStrategyPluginsLoaded } from './strategy/manifests';
import { screenDashboard } from './screenshot';
import {
  sendDocumentToTG,
  sendSignal,
  sendSignalAnalysis,
  sendTextToTG,
} from './signals';
import {
  Connector,
  Interval,
  TestStat,
  ThresholdLevel,
  TestThresholdsKey,
  Signal,
  RuntimeStrategyCloseNotification,
  StrategyRuntimeAiOptions,
} from '@tradejs/types';
import { getTradejsProjectCwd } from './tradejsConfig';
export { loadTradejsConfig } from './tradejsConfig';

const getProjectRoot = (): string => getTradejsProjectCwd();

const escapeHtml = (value?: string | number | null) =>
  value == null
    ? ''
    : String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

const formatOptionalNumber = (value?: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }

  const normalized = Number(value.toFixed(8));
  return Number.isInteger(normalized) ? String(normalized) : String(normalized);
};

const formatOptionalTimestamp = (value?: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }

  return new Date(value).toISOString();
};

const isEnoentError = (error: unknown) =>
  (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';

export const cleanFiles = async (dir: string) => {
  let completed = 0;

  const projectRoot = getProjectRoot();
  let files: string[] = [];

  try {
    files = await getFiles(dir, projectRoot);
  } catch (error) {
    if (isEnoentError(error)) {
      logger.info(chalk.yellow('clean:', dir));
      logger.info('');
      return;
    }
    throw error;
  }

  const bar = new ProgressBar(':current/:total [:bar][:percent] :eta(s)', {
    total: files.length,
    width: 30,
  });

  logger.info(chalk.yellow('clean:', dir));

  for await (const file of files) {
    completed++;
    const fullPath = path.join(projectRoot, dir, file);

    try {
      const stat = await fs.lstat(fullPath);
      if (stat.isDirectory()) {
        await fs.rm(fullPath, { recursive: true, force: true });
      } else {
        await fs.unlink(fullPath);
      }
    } catch (error) {
      if (!isEnoentError(error)) {
        throw error;
      }
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
    preloadStart?: number;
    preloadEnd?: number;
    skipCovered?: boolean;
  } = {},
) => {
  const preloadStart = Math.trunc(
    options.preloadStart ?? getTimestamp(preloadDays),
  );
  const preloadEnd = Math.trunc(options.preloadEnd ?? getTimestamp());
  const connectorLabel = String(options.connectorLabel || '').trim();
  const preloadLabel =
    options.preloadStart != null || options.preloadEnd != null
      ? `preloadStart=${formatOptionalTimestamp(preloadStart)}, preloadEnd=${formatOptionalTimestamp(preloadEnd)}`
      : `preloadDays=${preloadDays}`;

  if (preloadStart >= preloadEnd) {
    throw new Error(
      `Invalid update preload window: start (${preloadStart}) must be less than end (${preloadEnd})`,
    );
  }

  let queue = [...new Set(tickers.slice())];

  if (!queue.includes('BTCUSDT')) {
    queue.unshift('BTCUSDT');
  }

  const intervalMinutes = Number(interval);
  if (
    options.skipCovered &&
    connectorLabel &&
    Number.isFinite(intervalMinutes) &&
    intervalMinutes > 0
  ) {
    const edges = await getDataEdgesForSymbols(
      connectorLabel,
      queue,
      Math.floor(intervalMinutes),
    );
    const initialCount = queue.length;
    queue = queue.filter((symbol) => {
      const edge = edges.get(String(symbol).toUpperCase());
      return (
        !edge ||
        edge.min === undefined ||
        edge.max === undefined ||
        edge.min > preloadStart ||
        edge.max < preloadEnd
      );
    });

    const skippedCount = initialCount - queue.length;
    if (skippedCount > 0) {
      logger.info(
        chalk.gray(
          `update ${connectorLabel}: skip ${skippedCount}/${initialCount} cached symbols for interval=${interval}`,
        ),
      );
    }
  }

  if (queue.length === 0) {
    logger.info(
      chalk.yellow(
        `update: 0 (connector=${connectorLabel || 'unknown'}, interval=${interval}, klineConcurrency=${KLINE_CONCURRENCY_LIMIT}, ${preloadLabel})`,
      ),
    );
    logger.info('');
    return;
  }

  const bar = new ProgressBar(
    ':current/:total [:bar][:percent] :eta(s) :symbol',
    {
      total: queue.length,
      width: 30,
    },
  );

  logger.info(
    chalk.yellow(
      `update: ${queue.length} (connector=${connectorLabel || 'unknown'}, interval=${interval}, klineConcurrency=${KLINE_CONCURRENCY_LIMIT}, ${preloadLabel})`,
    ),
  );

  await runWithConcurrency(queue, KLINE_CONCURRENCY_LIMIT, async (symbol) => {
    try {
      await connector.kline({
        symbol,
        start: preloadStart,
        end: preloadEnd,
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
    case 'neutral':
      return chalk.gray;
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

const scanner = async (
  connector: Connector,
  limit?: number,
  query?: Parameters<Connector['getTickers']>[0],
) => {
  const data = await connector.getTickers(query);

  const tickers = getTopTickers(data, limit);
  return tickers.map(({ value }) => value);
};

export const getTickers = async (
  connector: Connector,
  include = '',
  exclude = '',
  limit?: number,
  chunk?: string,
  query?: Parameters<Connector['getTickers']>[0],
) => {
  let tickers: Array<string>;

  const excludeTickers = parseSymbolsFromCLI(exclude);

  if (include) {
    tickers = parseSymbolsFromCLI(include);
  } else {
    tickers = await scanner(connector, limit, query);
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
  await ensureStrategyPluginsLoaded();
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

export const formatRuntimeCloseNotification = (
  event: RuntimeStrategyCloseNotification,
  _userName = event.userName ?? 'root',
) => {
  const ownership =
    event.openedByStrategy === event.strategy
      ? 'matched'
      : `mismatch: opened by ${event.openedByStrategy}`;

  return [
    '<b>Strategy self-close</b>',
    `Symbol: <b>${escapeHtml(event.symbol)}</b>`,
    `Strategy: <b>${escapeHtml(event.strategy)}</b>`,
    `Direction: <b>${escapeHtml(event.direction)}</b>`,
    `Reason: <code>${escapeHtml(event.code)}</code>`,
    '',
    `Opened by journal: <b>${escapeHtml(event.openedByStrategy)}</b>`,
    `Ownership: <b>${escapeHtml(ownership)}</b>`,
    '',
    `Entry: <b>${escapeHtml(formatOptionalNumber(event.entryPrice))}</b> at <code>${escapeHtml(formatOptionalTimestamp(event.entryTimestamp))}</code>`,
    `Exit: <b>${escapeHtml(formatOptionalNumber(event.exitPrice))}</b> at <code>${escapeHtml(formatOptionalTimestamp(event.exitTimestamp))}</code>`,
    `Qty: <b>${escapeHtml(formatOptionalNumber(event.qty))}</b>`,
    `Closed PnL: <b>${escapeHtml(formatOptionalNumber(event.closedPnl))}</b>`,
  ].join('\n');
};

export const sendRuntimeCloseNotificationsToTG = async (
  events: RuntimeStrategyCloseNotification[],
  userName = 'root',
) => {
  logger.info(chalk.yellow('close messages:', events.length));

  if (!events.length) {
    logger.info('');
    return;
  }

  const bar = new ProgressBar(
    ':current/:total [:bar][:percent] :eta(s) :symbol',
    {
      total: events.length,
      width: 30,
    },
  );

  await runWithConcurrency(events, 1, async (event) => {
    try {
      await sendTextToTG(formatRuntimeCloseNotification(event, userName), {
        userName,
      });
    } catch (err) {
      logger.error(
        'Failed close notification: %s %s',
        event.symbol,
        (err as Error)?.message || String(err),
      );
    } finally {
      bar.tick(1, { symbol: chalk.gray(event.symbol) });
    }
  });

  logger.info('');
};

export type SignalNotificationAiOptions = Pick<
  StrategyRuntimeAiOptions,
  'enabled' | 'mode' | 'minQuality'
>;

export type SignalNotificationAiOptionsByStrategy = ReadonlyMap<
  string,
  SignalNotificationAiOptions
>;

export const sendToTG = async (
  signals: Signal[],
  imgInterval: Interval,
  userName = 'root',
  aiOptionsByStrategy: SignalNotificationAiOptionsByStrategy = new Map(),
) => {
  await ensureStrategyPluginsLoaded();
  const resolveDecision = (
    analysis: Record<string, any> | null,
    direction: Signal['direction'],
    minQuality = 4,
  ): 'approved' | 'rejected' => {
    if (analysis?.needRetest === true) {
      return 'rejected';
    }

    const quality = Number(analysis?.quality);
    if (!Number.isFinite(quality)) {
      return 'rejected';
    }
    const normalized = Math.round(quality);
    const resolvedQuality = analysis?.direction === direction ? normalized : 0;
    return resolvedQuality >= minQuality ? 'approved' : 'rejected';
  };

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
      let analysis = await getData(
        redisKeys.analysis(signal.symbol, signal.signalId),
        null,
      );
      let shouldSendSignalAnalysis =
        analysis &&
        typeof analysis === 'object' &&
        Object.keys(analysis).length > 0;
      const aiOptions = aiOptionsByStrategy.get(signal.strategy);
      const gateAnalysis = signal.aiAnalysis;
      if (
        aiOptions?.enabled !== false &&
        aiOptions?.mode === 'gate' &&
        gateAnalysis
      ) {
        const minQuality = Number.isFinite(aiOptions.minQuality)
          ? Number(aiOptions.minQuality)
          : 4;
        const gateDecision = resolveDecision(
          gateAnalysis as Record<string, any>,
          signal.direction,
          minQuality,
        );

        try {
          const llmAnalysis = await askAI(signal, { userName });
          const llmDecision = resolveDecision(
            llmAnalysis as Record<string, any>,
            signal.direction,
            minQuality,
          );
          analysis = {
            ...(llmAnalysis ?? {}),
            gateAnalysis,
            gateDecision,
            llmDecision,
            gateContradictsLlm: gateDecision !== llmDecision,
          };
          try {
            await setData(
              redisKeys.analysis(signal.symbol, signal.signalId),
              analysis,
            );
          } catch (error) {
            logger.error(
              'LLM comparison persistence failed: %s (%s)',
              signal.symbol,
              (error as Error)?.message || String(error),
            );
          }
          shouldSendSignalAnalysis = true;
        } catch (error) {
          logger.error(
            'LLM commentary failed: %s (%s)',
            signal.symbol,
            (error as Error)?.message || String(error),
          );
          analysis = {
            gateAnalysis,
            gateDecision,
          };
          shouldSendSignalAnalysis = false;
        }
      }

      await sendSignal(signal, imgInterval, analysis, { userName });

      if (
        shouldSendSignalAnalysis &&
        analysis &&
        typeof analysis === 'object' &&
        Object.keys(analysis).length > 0
      ) {
        await sendSignalAnalysis(signal, analysis, { userName });
      }
    } catch (err) {
      logger.error(
        'Signal notification failed: %s (%s)',
        signal.symbol,
        (err as Error)?.message || String(err),
      );
    } finally {
      bar.tick(1, { symbol: chalk.gray(signal.symbol) });
    }
  });

  logger.info('');
};

export { sendDocumentToTG, sendTextToTG };
