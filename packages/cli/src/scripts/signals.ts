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
  makeScreenshots,
  sendToTG,
  update,
} from '@tradejs/node/cli';
import { runWithConcurrency } from '@tradejs/core/async';
import {
  SIGNALS_CLI_PRELOAD_DAYS,
  TTL_1D,
  TTL_3M,
} from '@tradejs/core/constants';
import { getStrategyCreator } from '@tradejs/node/strategies';
import { getTimestamp } from '@tradejs/core/time';
import { logger } from '@tradejs/infra/logger';
import { getData, getKeys, redisKeys, setData } from '@tradejs/infra/redis';
import {
  Connector,
  ConnectorCreator,
  Interval,
  Signal,
  StrategyConfig,
  StrategyCreator,
} from '@tradejs/types';

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

const formatElapsed = (startedAt: number) =>
  `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;

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

const resolveStrategyNameByConfigKey = (
  userName: string,
  key: string,
): string | null => {
  const parts = key.split(':');
  if (parts.length !== 5) {
    return null;
  }
  const [users, keyUserName, strategiesKey, strategyName, configKey] = parts;
  if (
    users !== 'users' ||
    keyUserName !== userName ||
    strategiesKey !== 'strategies' ||
    configKey !== 'config' ||
    !strategyName
  ) {
    return null;
  }
  return strategyName;
};

const loadRuntimeStrategies = async (
  userName: string,
): Promise<StrategyRuntimeConfig[]> => {
  const keys = await getKeys(`${redisKeys.strategies(userName)}:`);
  const configKeys = keys
    .filter((key) => key.endsWith(':config'))
    .sort((a, b) => a.localeCompare(b));
  const strategyConfigs = await Promise.all(
    configKeys.map(async (key): Promise<StrategyRuntimeConfig | null> => {
      const strategyName = resolveStrategyNameByConfigKey(userName, key);
      if (!strategyName) {
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
      const strategyConfig = (await getData(key, {})) as StrategyConfig;
      return {
        strategyName,
        strategyCreator,
        strategyConfig,
      };
    }),
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
) => {
  const stats = strategyStats.get(strategyName);
  if (!stats) {
    return;
  }

  stats.reasons.set(reason, (stats.reasons.get(reason) ?? 0) + 1);
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

  const lastCandle = cachedData.pop();
  const btcLastCandle = btcCachedData.pop();

  if (!lastCandle || !btcLastCandle) {
    return strategySignals;
  }

  for (const runtimeStrategy of runtimeStrategies) {
    const { strategyName, strategyCreator, strategyConfig } = runtimeStrategy;
    const stats = strategyStats.get(strategyName);
    if (stats) {
      stats.evaluated += 1;
    }

    const strategy = await strategyCreator({
      userName: flags.user,
      connector,
      symbol,
      data: [...cachedData],
      btcData: [...btcCachedData],
      btcBinanceData: [...btcBinanceData],
      btcCoinbaseData: [...btcCoinbaseData],
      config: {
        ...strategyConfig,
        ENV: 'CRON',
        INTERVAL: interval,
        MAKE_ORDERS: flags.makeOrders,
      },
    });

    const signal = await strategy(lastCandle, btcLastCandle);
    if (!signal || typeof signal === 'string') {
      if (typeof signal === 'string') {
        recordStrategyReason(strategyStats, strategyName, signal);
      }
      continue;
    }

    if (stats) {
      stats.signals += 1;
    }
    strategySignals.push(signal);

    await setData(redisKeys.signal(symbol, signal.signalId), signal, {
      expire: TTL_1D,
    });

    await setData(redisKeys.storeSignal(symbol, signal.signalId), signal, {
      expire: TTL_3M,
    });

    await setData(
      redisKeys.runtimeSignal(flags.user, signal.signalId),
      signal,
      {
        expire: TTL_3M,
      },
    );

    logger.info('Signal found %s by strategy %s', symbol, strategyName);
  }

  return strategySignals;
};

export const signals = async () => {
  const startedAt = Date.now();
  const signals = new Array<Signal>();
  let status: 'completed' | 'failed' = 'completed';

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

    const tickers = await getTickers(
      marketConnector,
      flags.tickers,
      flags.exclude,
      flags.tickersLimit,
      flags.chunk,
    );

    if (flags.showTickersList) {
      console.log(chalk.gray(JSON.stringify(tickers.sort(), null, 2)));

      return;
    }

    if (!flags.cacheOnly) {
      await update(
        marketConnector,
        interval,
        tickers,
        SIGNALS_CLI_PRELOAD_DAYS,
        { connectorLabel: connectorName },
      );

      if (btcBinanceConnector !== marketConnector) {
        await update(
          btcBinanceConnector,
          interval,
          ['BTCUSDT'],
          SIGNALS_CLI_PRELOAD_DAYS,
          { connectorLabel: ConnectorNames.Binance },
        );
      }

      if (btcCoinbaseConnector !== marketConnector) {
        await update(
          btcCoinbaseConnector,
          interval,
          ['BTCUSDT'],
          SIGNALS_CLI_PRELOAD_DAYS,
          { connectorLabel: ConnectorNames.Coinbase },
        );
      }
    }

    const currentTimestamp = getTimestamp();
    const [btcBinanceData, btcCoinbaseData] = await Promise.all([
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
    ]);

    if (flags.updateOnly) {
      return;
    }

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
    const strategyStats = createStrategySkipStats(runtimeStrategies);

    const bar = new ProgressBar(
      ':current/:total [:bar][:percent] :found :eta(s) :symbol',
      {
        total: tickers.length,
        width: 30,
      },
    );

    logger.info(chalk.yellow(`tickers: ${tickers.length}`));

    await runWithConcurrency(tickers, 5, async (symbol) => {
      const strategySignals = await findSignals(
        symbol,
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

    if (!flags.skipScreenshots) {
      await makeScreenshots(signals, '15', flags.user);
    }

    if (flags.notify) {
      await sendToTG(signals, '15', flags.user);
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
    logger.info(
      chalk.yellow(
        `signals ${status} in ${formatElapsed(startedAt)} (found=${signals.length})`,
      ),
    );
  }
};

if (process.env.NODE_ENV !== 'test') {
  signals()
    .then(() => {
      process.exit(0);
    })
    .catch(() => {
      process.exit(1);
    });
}
