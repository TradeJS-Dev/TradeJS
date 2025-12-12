import args from 'args';
import ProgressBar from 'progress';
import _ from 'lodash';
import { connectors } from '@src/connectors';
import chalk from 'chalk';
import { TTL_1D, TTL_1M } from '@constants';
import { update, getTickers, makeScreenshots, sendToTG } from '@utils/cli';
import { getKeys, setData, redisKeys } from '@utils/redis';
import { Interval, Signal } from '@types';
import { TrendlineStrategy } from '@src/strategy/TrendLine/strategy';

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

const flags = args.parse(process.argv);
const minTouches = parseInt(flags.points);
const offset = parseInt(flags.offset);
const interval = flags.timeframe.toString() as Interval;

const byBitConnector = connectors.ByBit({
  userName: flags.user,
});

const findSignals = async (symbol: string) => {
  const prevSignals = await getKeys(redisKeys.signalsBySymbol(symbol));

  if (prevSignals.length) {
    console.log('>>> exit by signal exists', symbol);

    return null;
  }

  const signal = await TrendlineStrategy(byBitConnector, {
    symbol,
    interval,
    minTouches,
    offset,
    makeOrders: flags.makeOrders,
  });

  if (!signal) {
    return;
  }

  await setData(redisKeys.signal(symbol, signal.signalId), signal, {
    stringify: true,
    expire: TTL_1D,
  });

  await setData(redisKeys.storeSignal(symbol, signal.signalId), signal, {
    stringify: true,
    expire: TTL_1M,
  });

  return signal;
};

// const checkSignals = async () => {
//   const posiions = await byBitConnector.getPositions();

//   for await (const posiion of posiions) {
//     const { symbol } = posiion;
//   }
// };

const signals = async () => {
  const signals = new Array<Signal>();

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

  console.log(chalk.yellow(`tickers: ${tickers.length}`));

  for await (const symbol of tickers) {
    const signal = await findSignals(symbol);

    if (signal) {
      signals.push(signal);
    }

    bar.tick(1, {
      found: chalk.cyan(signals.length),
      symbol: chalk.gray(symbol),
    });
  }

  console.log('');

  await makeScreenshots(signals, '15m');

  if (flags.notify) {
    await sendToTG(signals);
  }

  console.log(
    JSON.stringify(
      signals.map((s) => s.symbol),
      null,
      2,
    ),
  );

  process.exit();
};

signals();
