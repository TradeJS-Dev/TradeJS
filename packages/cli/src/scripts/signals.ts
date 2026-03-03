import args from 'args';
import ProgressBar from 'progress';
import _ from 'lodash';
import { connectors } from '@tradejs/connectors';
import chalk from 'chalk';
import { TTL_1D, TTL_3M, SIGNALS_PRELOAD_DAYS } from '@constants';
import { update, getTickers, makeScreenshots, sendToTG } from '@utils/cli';
import { getData, getKeys, setData, redisKeys } from '@utils/redis';
import { getTimestamp } from '@utils/timestamp';
import { runWithConcurrency } from '@utils/async';
import {
  Connector,
  Interval,
  Signal,
  StrategyConfig,
  StrategyCreator,
} from '@types';
import { getStrategyCreator } from '@tradejs/core/strategy';
import { logger } from '@utils/logger';

args.option(['t', 'tickers'], 'Selected tickers');
args.option(['e', 'exclude'], 'Exclude tickers from tests');
args.option(['l', 'tickersLimit'], 'Tickers limit');
args.option(['f', 'timeframe'], 'Timeframe', 15);
args.option(['m', 'makeOrders'], 'Make orders');
args.option(['N', 'notify'], 'Send message in Telegram', false);
args.option(['u', 'updateOnly'], 'Only update tickers history', false);
args.option(['C', 'cacheOnly'], 'Do not update tickers history', false);
args.option(['L', 'showTickersList'], 'Just show only ticker list', false);
args.option(['c', 'chunk'], 'Split by chunks, ex. 1/3');
args.option(['U', 'user'], 'Use user confg', 'root');

const PRELOAD_START = getTimestamp(SIGNALS_PRELOAD_DAYS);

const flags = args.parse(process.argv);
const minTouches = parseInt(flags.points);
const offset = parseInt(flags.offset);
const interval = flags.timeframe.toString() as Interval;

interface StrategyRuntimeConfig {
  strategyName: string;
  strategyCreator: StrategyCreator;
  strategyConfig: StrategyConfig;
}

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
      const strategyCreator = await getStrategyCreator(strategyName);
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

const findSignals = async (
  symbol: string,
  connector: Connector,
  btcBinanceData: Awaited<ReturnType<Connector['kline']>>,
  btcCoinbaseData: Awaited<ReturnType<Connector['kline']>>,
  runtimeStrategies: StrategyRuntimeConfig[],
) => {
  const prevSignals = await getKeys(redisKeys.signalsBySymbol(symbol));

  if (prevSignals.length) {
    logger.info('Exit by signal exists %s', symbol);
    return null;
  }

  const currentTimestamp = getTimestamp();

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
    return;
  }

  for (const runtimeStrategy of runtimeStrategies) {
    const { strategyName, strategyCreator, strategyConfig } = runtimeStrategy;
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
      continue;
    }

    await setData(redisKeys.signal(symbol, signal.signalId), signal, {
      expire: TTL_1D,
    });

    await setData(redisKeys.storeSignal(symbol, signal.signalId), signal, {
      expire: TTL_3M,
    });

    logger.info('Signal found %s by strategy %s', symbol, strategyName);
    return signal;
  }
};

const signals = async () => {
  const signals = new Array<Signal>();

  const byBitConnector = await connectors.ByBit({
    userName: flags.user,
  });
  const binanceConnector = await connectors.Binance({
    userName: flags.user,
  });
  const coinbaseConnector = await connectors.Coinbase({
    userName: flags.user,
  });

  const tickers = await getTickers(
    byBitConnector,
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
    await update(byBitConnector, interval, tickers);

    await update(binanceConnector, interval, ['BTCUSDT']);

    await update(coinbaseConnector, interval, ['BTCUSDT']);
  }

  const currentTimestamp = getTimestamp();
  const [btcBinanceData, btcCoinbaseData] = await Promise.all([
    binanceConnector.kline({
      symbol: 'BTCUSDT',
      start: PRELOAD_START,
      end: currentTimestamp,
      cacheOnly: true,
      interval,
    }),
    coinbaseConnector.kline({
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
      `loaded strategies: ${runtimeStrategies.map((s) => s.strategyName).join(', ')}`,
    ),
  );

  const bar = new ProgressBar(
    ':current/:total [:bar][:percent] :found :eta(s) :symbol',
    {
      total: tickers.length,
      width: 30,
    },
  );

  logger.info(chalk.yellow(`tickers: ${tickers.length}`));

  await runWithConcurrency(tickers, 5, async (symbol) => {
    const signal = await findSignals(
      symbol,
      byBitConnector,
      btcBinanceData,
      btcCoinbaseData,
      runtimeStrategies,
    );

    if (signal) {
      signals.push(signal);
    }

    bar.tick(1, {
      found: chalk.cyan(signals.length),
      symbol: chalk.gray(symbol),
    });
  });

  await makeScreenshots(signals, '15');

  await makeScreenshots(signals, '60');

  if (flags.notify) {
    await sendToTG(signals, '15');
  }

  logger.info(
    JSON.stringify(
      signals.map((s) => s.symbol),
      null,
      2,
    ),
  );

  process.exit();
};

signals();
