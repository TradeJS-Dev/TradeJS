import 'dotenv/config';
import args from 'args';
import ProgressBar from 'progress';
import _ from 'lodash';
import { ConnectorNames } from '@tradejs/connectors';
import chalk from 'chalk';
import {
  getConnectorCreatorByName,
  resolveConnectorName,
  DEFAULT_CONNECTOR_NAME,
} from '@tradejs/node/connectors';
import {
  getTickers,
  loadTradejsConfig,
  makeScreenshots,
  sendToTG,
  update,
} from '@tradejs/node/cli';
import { runWithConcurrency } from '@tradejs/core/async';
import { alignSortedCandlesByTimestamp } from '@tradejs/core/indicators';
import type {
  TradejsConfigAfterSignalsHook,
  TradejsConfigAfterSignalsHookContext,
  TradejsConfigBeforeSignalsHook,
  TradejsConfigBeforeSignalsHookResult,
  TradejsConfigHooks,
  TradejsConfigSignalsHookContext,
} from '@tradejs/core/config';
import { SIGNALS_CLI_PRELOAD_DAYS, TTL_10D } from '@tradejs/core/constants';
import { getStrategyCreator } from '@tradejs/node/strategies';
import { getTimestamp } from '@tradejs/core/time';
import { logger } from '@tradejs/infra/logger';
import {
  getData,
  incrHashFields,
  redisKeys,
  setData,
  setHashJsonField,
} from '@tradejs/infra/redis';
import {
  Connector,
  ConnectorCreator,
  Interval,
  RuntimeSignalEvaluationRecord,
  Signal,
  StrategyConfig,
  StrategyCreator,
} from '@tradejs/types';
import {
  backfillDerivativesContextForSignals,
  shouldBackfillDerivativesContextForSignals,
} from '../lib/derivativesContextBackfill';
import { loadRuntimeStrategyConfigs } from '../lib/runtimeRedis';
import {
  buildRuntimeSignalStatsIncrements,
  getRuntimeStorageDayKey,
  normalizeRuntimeSignalSkipReason,
  shouldStoreDetailedRuntimeSignalEvaluation,
  toRuntimeSignalBucketRef,
} from '../lib/runtimeSignalsStorage';

args.option(['t', 'tickers'], 'Selected tickers');
args.option(['e', 'exclude'], 'Exclude tickers from tests');
args.option(['l', 'tickersLimit'], 'Tickers limit');
args.option(['f', 'timeframe'], 'Timeframe', 15);
args.option(['m', 'makeOrders'], 'Make orders');
args.option(['N', 'notify'], 'Send message in Telegram', false);
args.option(['S', 'skipScreenshots'], 'Skip screenshot generation', false);
args.option(['u', 'updateOnly'], 'Only update tickers history', false);
args.option(['C', 'cacheOnly'], 'Do not update tickers history', false);
args.option(['L', 'showTickersList'], 'Just show only ticker list', false);
args.option(
  ['p', 'parallel'],
  'Signal evaluation worker count',
  Number(process.env.SIGNALS_PARALLEL || 4),
);
args.option(
  ['R', 'showSkipStats'],
  'Show aggregated skip stats by strategy',
  false,
);
args.option(['c', 'chunk'], 'Split by chunks, ex. 1/3');
args.option(['U', 'user'], 'Use user confg', 'root');
args.option(
  'connector',
  'Connector provider or name for signals (e.g. bybit, binance, coinbase, custom)',
  'bybit',
);

const PRELOAD_START = getTimestamp(SIGNALS_CLI_PRELOAD_DAYS);
const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();

const flags = args.parse(process.argv);
const interval = flags.timeframe.toString() as Interval;
const intervalMs = Number(interval) * 60_000;

const getCurrentOpenTimestamp = (timestamp: number) =>
  Number.isFinite(intervalMs) && intervalMs > 0
    ? Math.floor(timestamp / intervalMs) * intervalMs
    : timestamp;

const getClosedCandles = <T extends { timestamp: number }>(
  candles: T[],
  currentTimestamp: number,
) => {
  const currentOpenTimestamp = getCurrentOpenTimestamp(currentTimestamp);
  return candles.filter((candle) => candle.timestamp < currentOpenTimestamp);
};

const formatElapsed = (startedAt: number) =>
  `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;

const formatDuration = (startedAt: number) => {
  const seconds = (Date.now() - startedAt) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = Math.round(seconds % 60);
  return `${minutes}m ${restSeconds}s`;
};

const resolvePositiveInteger = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : fallback;
};

const timeOperation = async <T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const startedAt = Date.now();
  try {
    return await operation();
  } finally {
    logger.info(chalk.gray(`${label}: done in ${formatDuration(startedAt)}`));
  }
};

interface StrategyRuntimeConfig {
  strategyName: string;
  strategyCreator: StrategyCreator;
  strategyConfig: StrategyConfig;
}

interface StrategySkipStats {
  evaluated: number;
  signals: number;
  reasons: Map<string, number>;
}

type StrategySkipStatsMap = Map<string, StrategySkipStats>;
type StrategySkipSource = 'core' | 'AI' | 'ML' | 'hook' | 'policy' | 'runtime';

const normalizeHookList = <THook extends (...args: any[]) => unknown>(
  value: THook | THook[] | undefined,
): THook[] => {
  if (Array.isArray(value)) {
    return value;
  }

  return value ? [value] : [];
};

const invokeBeforeSignalsHooks = async (
  hooks: TradejsConfigHooks | undefined,
  params: TradejsConfigSignalsHookContext,
): Promise<TradejsConfigBeforeSignalsHookResult | undefined> => {
  for (const hook of normalizeHookList(
    hooks?.beforeSignals,
  ) as TradejsConfigBeforeSignalsHook[]) {
    const result = await hook(params);
    if (result?.abort === true) {
      return result;
    }
  }

  return undefined;
};

const invokeAfterSignalsHooks = async (
  hooks: TradejsConfigHooks | undefined,
  params: TradejsConfigAfterSignalsHookContext,
) => {
  for (const hook of normalizeHookList(
    hooks?.afterSignals,
  ) as TradejsConfigAfterSignalsHook[]) {
    await hook(params);
  }
};

const isStrategyRuntimeEnabled = (strategyConfig: StrategyConfig) => {
  const enabled = (strategyConfig as Record<string, unknown>).ENABLE;
  return enabled !== false;
};

const loadRuntimeStrategies = async (
  userName: string,
): Promise<StrategyRuntimeConfig[]> => {
  const strategyConfigs = await Promise.all(
    (await loadRuntimeStrategyConfigs(userName)).map(
      async ({
        key,
        strategyName,
        strategyConfig,
      }): Promise<StrategyRuntimeConfig | null> => {
        if (!isStrategyRuntimeEnabled(strategyConfig)) {
          logger.info(
            'Skip inactive strategy config by ENABLE=false: %s',
            strategyName,
          );
          return null;
        }
        const strategyCreator = await getStrategyCreator(
          strategyName,
          projectRoot,
        );
        if (!strategyCreator) {
          logger.warn('Skip unknown strategy config key: %s', key);
          return null;
        }
        return {
          strategyName,
          strategyCreator,
          strategyConfig,
        };
      },
    ),
  );
  return strategyConfigs.filter(Boolean) as StrategyRuntimeConfig[];
};

const createStrategySkipStats = (
  runtimeStrategies: StrategyRuntimeConfig[],
): StrategySkipStatsMap =>
  new Map(
    runtimeStrategies.map(({ strategyName }) => [
      strategyName,
      {
        evaluated: 0,
        signals: 0,
        reasons: new Map<string, number>(),
      },
    ]),
  );

const recordStrategyReason = (
  strategyStats: StrategySkipStatsMap,
  strategyName: string,
  reason: string,
  fallbackSource: StrategySkipSource = 'core',
) => {
  const stats = strategyStats.get(strategyName);
  if (!stats) {
    return;
  }

  const normalized = normalizeRuntimeSignalSkipReason(reason, fallbackSource);
  const normalizedReason = `${normalized.source} / ${normalized.reason}`;
  stats.reasons.set(
    normalizedReason,
    (stats.reasons.get(normalizedReason) ?? 0) + 1,
  );
};

const buildRuntimeSignalEvaluationId = ({
  strategyName,
  symbol,
  timestamp,
}: {
  strategyName: string;
  symbol: string;
  timestamp: number;
}) => `${strategyName}:${symbol}:${timestamp}`;

const getTelegramDeliverableSignals = (signals: Signal[]) =>
  signals.filter(
    (signal) =>
      signal.orderStatus !== 'skipped' && signal.orderStatus !== 'canceled',
  );

const saveRuntimeSignalEvaluation = async (
  evaluation: RuntimeSignalEvaluationRecord,
) => {
  const dayKey = getRuntimeStorageDayKey(evaluation.timestamp);
  if (shouldStoreDetailedRuntimeSignalEvaluation(evaluation)) {
    await setHashJsonField(
      redisKeys.runtimeSignalEvaluationBucket(
        evaluation.userName,
        dayKey,
        evaluation.strategy,
      ),
      evaluation.evaluationId,
      evaluation,
      {
        expire: TTL_10D,
      },
    );
  }
  await incrHashFields(
    redisKeys.runtimeSignalEvaluationStatsBucket(
      evaluation.userName,
      dayKey,
      evaluation.strategy,
    ),
    buildRuntimeSignalStatsIncrements(evaluation),
    {
      expire: TTL_10D,
    },
  );
};

const logStrategySkipStats = (
  runtimeStrategies: StrategyRuntimeConfig[],
  strategyStats: StrategySkipStatsMap,
) => {
  logger.info(chalk.yellow('skip stats:'));

  for (const { strategyName } of runtimeStrategies) {
    const stats = strategyStats.get(strategyName);
    if (!stats) {
      continue;
    }

    logger.info(
      `${strategyName}: evaluated=${stats.evaluated}, signals=${stats.signals}`,
    );

    const sortedReasons = [...stats.reasons.entries()].sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    );

    if (!sortedReasons.length) {
      logger.info('  none');
      continue;
    }

    for (const [reason, count] of sortedReasons) {
      logger.info(`  ${reason}: ${count}`);
    }
  }
};

const resolveSignalsConnectorName = async (value: unknown): Promise<string> => {
  const connectorName = await resolveConnectorName(value, projectRoot);
  if (connectorName) {
    return connectorName;
  }

  logger.warn(
    'Unknown connector "%s". Fallback to %s.',
    String(value || '').trim() || String(value),
    DEFAULT_CONNECTOR_NAME,
  );
  return DEFAULT_CONNECTOR_NAME;
};

const findSignals = async (
  symbol: string,
  connectorName: string,
  connector: Connector,
  btcBinanceData: Awaited<ReturnType<Connector['kline']>>,
  btcCoinbaseData: Awaited<ReturnType<Connector['kline']>>,
  runtimeStrategies: StrategyRuntimeConfig[],
  strategyStats: StrategySkipStatsMap,
): Promise<Signal[]> => {
  const currentTimestamp = getTimestamp();
  const strategySignals: Signal[] = [];

  const [cachedData, btcCachedData] = await Promise.all([
    connector.kline({
      symbol,
      start: PRELOAD_START,
      end: currentTimestamp,
      cacheOnly: true,
      interval,
    }),
    connector.kline({
      symbol: 'BTCUSDT',
      start: PRELOAD_START,
      end: currentTimestamp,
      cacheOnly: true,
      interval,
    }),
  ]);

  // Runtime evaluates only on the last closed candle. Timestamp filtering keeps
  // cache-only runs from accidentally stepping one closed bar back when the
  // newest forming bar is absent from Timescale.
  const closedData = getClosedCandles(cachedData, currentTimestamp);
  const closedBtcData = getClosedCandles(btcCachedData, currentTimestamp);
  const { alignedCoinCandles, alignedBtcCandles } =
    alignSortedCandlesByTimestamp(closedData, closedBtcData);
  const lastCandle = alignedCoinCandles.at(-1);
  const btcLastCandle = alignedBtcCandles.at(-1);

  if (!lastCandle || !btcLastCandle) {
    return strategySignals;
  }
  const previousData = alignedCoinCandles.slice(0, -1);
  const previousBtcData = alignedBtcCandles.slice(0, -1);

  for (const runtimeStrategy of runtimeStrategies) {
    const { strategyName, strategyCreator, strategyConfig } = runtimeStrategy;
    const stats = strategyStats.get(strategyName);
    if (stats) {
      stats.evaluated += 1;
    }

    const strategy = await strategyCreator({
      userName: flags.user,
      connectorName,
      connector,
      symbol,
      data: [...previousData],
      btcData: [...previousBtcData],
      btcBinanceData,
      btcCoinbaseData,
      config: {
        ...strategyConfig,
        ENV: 'CRON',
        INTERVAL: interval,
        MAKE_ORDERS: flags.makeOrders,
      },
    });

    const signal = await strategy(lastCandle, btcLastCandle);
    if (!signal || typeof signal === 'string') {
      const reason =
        typeof signal === 'string' && signal.trim() ? signal : 'NO_SIGNAL';
      if (typeof signal === 'string') {
        recordStrategyReason(strategyStats, strategyName, signal, 'core');
      }
      await saveRuntimeSignalEvaluation({
        evaluationId: buildRuntimeSignalEvaluationId({
          strategyName,
          symbol,
          timestamp: lastCandle.timestamp,
        }),
        userName: flags.user,
        strategy: strategyName,
        symbol,
        interval,
        timestamp: lastCandle.timestamp,
        evaluatedAt: Date.now(),
        status: 'skip',
        reason,
      });
      continue;
    }

    if (stats) {
      stats.signals += 1;
    }
    if (
      signal.orderStatus === 'skipped' &&
      typeof signal.orderSkipReason === 'string' &&
      signal.orderSkipReason.trim()
    ) {
      recordStrategyReason(
        strategyStats,
        strategyName,
        signal.orderSkipReason,
        'runtime',
      );
    }
    strategySignals.push(signal);

    await setData(redisKeys.storeSignal(symbol, signal.signalId), signal, {
      expire: TTL_10D,
    });

    await setHashJsonField(
      redisKeys.runtimeSignalBucket(
        flags.user,
        getRuntimeStorageDayKey(signal.timestamp),
        signal.strategy,
      ),
      signal.signalId,
      toRuntimeSignalBucketRef(signal),
      {
        expire: TTL_10D,
      },
    );

    await saveRuntimeSignalEvaluation({
      evaluationId: buildRuntimeSignalEvaluationId({
        strategyName,
        symbol,
        timestamp: lastCandle.timestamp,
      }),
      userName: flags.user,
      strategy: strategyName,
      symbol,
      interval,
      timestamp: lastCandle.timestamp,
      evaluatedAt: Date.now(),
      status: 'signal',
      reason: signal.orderSkipReason || signal.orderStatus || 'SIGNAL',
      signalId: signal.signalId,
      direction: signal.direction,
      orderStatus: signal.orderStatus,
      orderSkipReason: signal.orderSkipReason,
      ...(signal.aiAnalysis ? { aiAnalysis: signal.aiAnalysis } : {}),
      ...(signal.ml ? { ml: signal.ml } : {}),
    });

    logger.info('Signal found %s by strategy %s', symbol, strategyName);
  }

  return strategySignals;
};

export const signals = async () => {
  const startedAt = Date.now();
  const signals = new Array<Signal>();
  let status: 'completed' | 'failed' = 'completed';
  let projectHooks: TradejsConfigHooks | undefined;
  let afterSignalsHookContext: Omit<
    TradejsConfigAfterSignalsHookContext,
    'signals' | 'status' | 'durationMs'
  > | null = null;

  try {
    const connectorName = await resolveSignalsConnectorName(flags.connector);
    const connectorFactory = await getConnectorCreatorByName(
      connectorName,
      projectRoot,
    );
    if (!connectorFactory) {
      throw new Error(`Connector "${connectorName}" is not registered`);
    }
    const marketConnector = await (connectorFactory as ConnectorCreator)({
      userName: flags.user,
    });

    let btcBinanceConnector: Connector = marketConnector;
    let btcCoinbaseConnector: Connector = marketConnector;

    if (connectorName.toLowerCase() === DEFAULT_CONNECTOR_NAME.toLowerCase()) {
      const binanceFactory = await getConnectorCreatorByName(
        ConnectorNames.Binance,
        projectRoot,
      );
      if (binanceFactory) {
        btcBinanceConnector = await (binanceFactory as ConnectorCreator)({
          userName: flags.user,
        });
      } else {
        logger.warn(
          'Binance connector is unavailable. Reusing %s.',
          connectorName,
        );
      }

      const coinbaseFactory = await getConnectorCreatorByName(
        ConnectorNames.Coinbase,
        projectRoot,
      );
      if (coinbaseFactory) {
        btcCoinbaseConnector = await (coinbaseFactory as ConnectorCreator)({
          userName: flags.user,
        });
      } else {
        logger.warn(
          'Coinbase connector is unavailable. Reusing %s.',
          connectorName,
        );
      }
    }

    const tickers = await timeOperation('tickers load', () =>
      getTickers(
        marketConnector,
        flags.tickers,
        flags.exclude,
        flags.tickersLimit,
        flags.chunk,
      ),
    );

    if (flags.showTickersList) {
      console.log(chalk.gray(JSON.stringify(tickers.sort(), null, 2)));

      return;
    }

    const projectConfig = await loadTradejsConfig(projectRoot);
    projectHooks = projectConfig.hooks;

    if (!flags.cacheOnly) {
      await timeOperation(`update ${connectorName}`, () =>
        update(marketConnector, interval, tickers, SIGNALS_CLI_PRELOAD_DAYS, {
          connectorLabel: connectorName,
        }),
      );

      if (btcBinanceConnector !== marketConnector) {
        await timeOperation(`update ${ConnectorNames.Binance}`, () =>
          update(
            btcBinanceConnector,
            interval,
            ['BTCUSDT'],
            SIGNALS_CLI_PRELOAD_DAYS,
            { connectorLabel: ConnectorNames.Binance },
          ),
        );
      }

      if (btcCoinbaseConnector !== marketConnector) {
        await timeOperation(`update ${ConnectorNames.Coinbase}`, () =>
          update(
            btcCoinbaseConnector,
            interval,
            ['BTCUSDT'],
            SIGNALS_CLI_PRELOAD_DAYS,
            { connectorLabel: ConnectorNames.Coinbase },
          ),
        );
      }
    }

    const currentTimestamp = getTimestamp();
    if (
      shouldBackfillDerivativesContextForSignals({
        cacheOnly: Boolean(flags.cacheOnly),
      })
    ) {
      await timeOperation('derivatives context backfill', () =>
        backfillDerivativesContextForSignals({
          userName: flags.user,
          symbols: tickers,
          startMs: currentTimestamp,
          endMs: currentTimestamp,
          preloadStartMs: PRELOAD_START,
        }),
      );
    }

    if (flags.updateOnly) {
      return;
    }

    const [btcBinanceData, btcCoinbaseData] = await timeOperation(
      'reference candles load',
      () =>
        Promise.all([
          btcBinanceConnector.kline({
            symbol: 'BTCUSDT',
            start: PRELOAD_START,
            end: currentTimestamp,
            cacheOnly: true,
            interval,
          }),
          btcCoinbaseConnector.kline({
            symbol: 'BTCUSDT',
            start: PRELOAD_START,
            end: currentTimestamp,
            cacheOnly: true,
            interval,
          }),
        ]),
    );

    const runtimeStrategies = await loadRuntimeStrategies(flags.user);
    if (!runtimeStrategies.length) {
      logger.warn(
        'No strategy configs found by users:%s:strategies:*:config',
        flags.user,
      );
      return;
    }
    logger.info(
      chalk.yellow(
        `loaded strategies (user=${flags.user}): ${runtimeStrategies.map((s) => s.strategyName).join(', ')}`,
      ),
    );
    afterSignalsHookContext = {
      connector: marketConnector,
      connectorName,
      userName: flags.user,
      interval,
      tickers: [...tickers],
      runtimeStrategies: runtimeStrategies.map(
        ({ strategyName, strategyConfig }) => ({
          strategyName,
          strategyConfig,
        }),
      ),
    };

    const beforeSignalsResult = await invokeBeforeSignalsHooks(
      projectHooks,
      afterSignalsHookContext,
    );
    if (beforeSignalsResult?.abort === true) {
      logger.info(
        'signals aborted before ticker evaluation: %s',
        beforeSignalsResult.reason ?? 'PROJECT_BEFORE_SIGNALS_ABORTED',
      );
      return;
    }

    const strategyStats = createStrategySkipStats(runtimeStrategies);

    const bar = new ProgressBar(
      ':current/:total [:bar][:percent] :found :eta(s) :symbol',
      {
        total: tickers.length,
        width: 30,
      },
    );

    logger.info(chalk.yellow(`tickers: ${tickers.length}`));
    const signalsParallel = resolvePositiveInteger(flags.parallel, 4);
    logger.info(chalk.yellow(`signal workers: ${signalsParallel}`));

    await runWithConcurrency(tickers, signalsParallel, async (symbol) => {
      const strategySignals = await findSignals(
        symbol,
        connectorName,
        marketConnector,
        btcBinanceData,
        btcCoinbaseData,
        runtimeStrategies,
        strategyStats,
      );

      if (strategySignals.length > 0) {
        signals.push(...strategySignals);
      }

      bar.tick(1, {
        found: chalk.cyan(signals.length),
        symbol: chalk.gray(symbol),
      });
    });

    if (flags.notify) {
      const telegramSignals = getTelegramDeliverableSignals(signals);

      if (!flags.skipScreenshots && telegramSignals.length > 0) {
        await makeScreenshots(telegramSignals, '15', flags.user);
      }

      await sendToTG(telegramSignals, '15', flags.user);
    }

    logger.info(
      JSON.stringify(
        signals.map((s) => s.symbol),
        null,
        2,
      ),
    );

    if (flags.showSkipStats) {
      logStrategySkipStats(runtimeStrategies, strategyStats);
    }
  } catch (error) {
    status = 'failed';
    logger.error(
      'signals failed: %s',
      (error as Error)?.message || String(error),
    );
    throw error;
  } finally {
    if (projectHooks && afterSignalsHookContext) {
      try {
        await invokeAfterSignalsHooks(projectHooks, {
          ...afterSignalsHookContext,
          signals: [...signals],
          status,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        logger.error(
          'afterSignals hook failed: %s',
          (error as Error)?.message || String(error),
        );
      }
    }

    logger.info(
      chalk.yellow(
        `signals ${status} in ${formatElapsed(startedAt)} (found=${signals.length})`,
      ),
    );
  }
};
export const main = signals;
