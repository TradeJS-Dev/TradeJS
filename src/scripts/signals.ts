import args from 'args';
import ProgressBar from 'progress';
import _ from 'lodash';
import { connectors } from '@src/connectors';
import chalk from 'chalk';
import { TTL_1D, TTL_3M, SIGNALS_PRELOAD_DAYS } from '@constants';
import { update, getTickers, makeScreenshots, sendToTG } from '@utils/cli';
import { getKeys, setData, redisKeys } from '@utils/redis';
import { getTimestamp } from '@utils/timestamp';
import { Connector, Interval, Signal } from '@types';
import { TrendlineStrategyCreator } from '@src/strategy/TrendLine/strategy';
import { logger } from '@utils/logger';

args.option(['t', 'tickers'], 'Selected tickers');
args.option(['e', 'exclude'], 'Exclude tickers from tests');
args.option(['l', 'tickersLimit'], 'Tickers limit');
args.option(['f', 'timeframe'], 'Timeframe', 15);
args.option(['o', 'offset'], 'Offset', 3);
args.option(['p', 'points'], 'Points', 3);
args.option(['m', 'makeOrders'], 'Make orders', false);
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

const findSignals = async (symbol: string, connector: Connector) => {
  const prevSignals = await getKeys(redisKeys.signalsBySymbol(symbol));

  if (prevSignals.length) {
    logger.info('Exit by signal exists %s', symbol);
    return null;
  }

  const currentTimestamp = getTimestamp();

  const cachedData = await connector.kline({
    symbol,
    start: PRELOAD_START,
    end: currentTimestamp,
    cacheOnly: true,
    interval,
  });

  const btcCachedData = await connector.kline({
    symbol: 'BTCUSDT',
    start: PRELOAD_START,
    end: currentTimestamp,
    cacheOnly: true,
    interval,
  });

  const lastCandle = cachedData.pop();
  const btcLastCandle = btcCachedData.pop();

  if (!lastCandle || !btcLastCandle) {
    return;
  }

  const strategy = await TrendlineStrategyCreator({
    connector,
    symbol,
    data: cachedData,
    btcData: btcCachedData,
    config: {
      ENV: 'production',
      INTERVAL: interval,
      MAKE_ORDERS: flags.makeOrders,
      TRENDLINE_CONFIG: {
        minTouches,
        offset,
      },
    },
  });

  const signal = await strategy(lastCandle, btcLastCandle);

  if (!signal) {
    return;
  }

  if (typeof signal === 'string') {
    if (signal !== 'NO_TRENDLINE') {
      logger.warn('exit %s by %s', symbol, signal);
    }

    return;
  }

  await setData(redisKeys.signal(symbol, signal.signalId), signal, {
    stringify: true,
    expire: TTL_1D,
  });

  await setData(redisKeys.storeSignal(symbol, signal.signalId), signal, {
    stringify: true,
    expire: TTL_3M,
  });

  return signal;
};

const signals = async () => {
  const signals = new Array<Signal>();

  const byBitConnector = await connectors.ByBit({
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
  }

  if (flags.updateOnly) {
    return;
  }

  const bar = new ProgressBar(
    ':current/:total [:bar][:percent] :found :eta(s) :symbol',
    {
      total: tickers.length,
      width: 30,
    },
  );

  logger.info(chalk.yellow(`tickers: ${tickers.length}`));

  for await (const symbol of tickers) {
    const signal = await findSignals(symbol, byBitConnector);

    if (signal) {
      signals.push(signal);
    }

    bar.tick(1, {
      found: chalk.cyan(signals.length),
      symbol: chalk.gray(symbol),
    });
  }

  await makeScreenshots(signals, '15');

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
