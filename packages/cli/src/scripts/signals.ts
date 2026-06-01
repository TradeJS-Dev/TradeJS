import 'dotenv/config';
import args from 'args';
import ProgressBar from 'progress';
import _ from 'lodash';
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
} from '@tradejs/node/cli';
import { runWithConcurrency } from '@tradejs/core/async';
import type {
  TradejsConfigAfterSignalsHookContext,
  TradejsConfigHooks,
} from '@tradejs/core/config';
import { SIGNALS_CLI_PRELOAD_DAYS, TTL_10D } from '@tradejs/core/constants';
import { enrichSignalWithBinanceMarketContext } from '@tradejs/node/strategies';
import { getTimestamp } from '@tradejs/core/time';
import { logger } from '@tradejs/infra/logger';
import { redisKeys, setData, setHashJsonField } from '@tradejs/infra/redis';
import { Connector, ConnectorCreator, Interval, Signal } from '@tradejs/types';
import {
  getRuntimeStorageDayKey,
  toRuntimeSignalBucketRef,
} from '../lib/runtimeSignalsStorage';
import {
  alignSymbolWithBtcReference,
  getClosedCandlesForInterval,
} from '../lib/marketData/windows';
import { timeOperation as runTimedOperation } from '../lib/runFormatting';
import {
  invokeAfterSignalsHooks,
  invokeBeforeSignalsHooks,
} from '../lib/signals/hooks';
import { prepareMarketContextForRun } from '../lib/marketContextPrepare';
import {
  loadBtcReferenceConnectors,
  updateMarketHistoryWithBtcReferences,
} from '../lib/marketData/historyPrepare';
import {
  loadRuntimeStrategies,
  type StrategyRuntimeConfig,
} from '../lib/signals/runtimeStrategies';
import {
  createStrategySkipStats,
  logStrategySkipStats,
  recordStrategyReason,
  type StrategySkipStatsMap,
} from '../lib/signals/skipStats';
import {
  buildRuntimeSignalEvaluationId,
  saveRuntimeSignalEvaluation,
} from '../lib/signals/evaluations';
import { getTelegramDeliverableSignals } from '../lib/signals/telegram';
import { buildRuntimeModeStrategyConfig } from '../lib/runtimeModeConfig';

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

const formatElapsed = (startedAt: number) =>
  `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;

const resolvePositiveInteger = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : fallback;
};

const timeOperation = <T>(label: string, operation: () => Promise<T>) =>
  runTimedOperation(label, operation, (message) =>
    logger.info(chalk.gray(message)),
  );

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
  const closedData = getClosedCandlesForInterval(
    cachedData,
    currentTimestamp,
    intervalMs,
  );
  const closedBtcData = getClosedCandlesForInterval(
    btcCachedData,
    currentTimestamp,
    intervalMs,
  );
  const { alignedCoinCandles, alignedBtcCandles } = alignSymbolWithBtcReference(
    closedData,
    closedBtcData,
  );
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
      config: buildRuntimeModeStrategyConfig({
        strategyConfig,
        env: 'CRON',
        interval,
        makeOrders: flags.makeOrders,
      }),
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
    await enrichSignalWithBinanceMarketContext({
      signal,
      env: 'CRON',
    });
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

    const btcReferences = await loadBtcReferenceConnectors({
      connectorName,
      marketConnector,
      userName: flags.user,
      projectRoot,
      shouldUseDedicatedReferences:
        connectorName.toLowerCase() === DEFAULT_CONNECTOR_NAME.toLowerCase(),
      warn: (message) => logger.warn(message),
    });

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
      await updateMarketHistoryWithBtcReferences({
        marketConnector,
        connectorName,
        btcReferences,
        interval,
        symbols: tickers,
        preloadDays: SIGNALS_CLI_PRELOAD_DAYS,
        log: (message) => logger.info(chalk.gray(message)),
      });
    }

    const currentTimestamp = getTimestamp();
    await prepareMarketContextForRun({
      mode: 'signals',
      userName: flags.user,
      projectRoot,
      symbols: tickers,
      interval,
      startMs: currentTimestamp,
      endMs: currentTimestamp,
      preloadStartMs: PRELOAD_START,
      cacheOnly: Boolean(flags.cacheOnly),
      log: (message) => logger.info(chalk.gray(message)),
    });

    if (flags.updateOnly) {
      return;
    }

    const [btcBinanceData, btcCoinbaseData] = await timeOperation(
      'reference candles load',
      () =>
        Promise.all([
          btcReferences.binance.kline({
            symbol: 'BTCUSDT',
            start: PRELOAD_START,
            end: currentTimestamp,
            cacheOnly: true,
            interval,
          }),
          btcReferences.coinbase.kline({
            symbol: 'BTCUSDT',
            start: PRELOAD_START,
            end: currentTimestamp,
            cacheOnly: true,
            interval,
          }),
        ]),
    );

    const runtimeStrategies = await loadRuntimeStrategies({
      userName: flags.user,
      projectRoot,
    });
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
