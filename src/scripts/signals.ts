import args from 'args';
import ProgressBar from 'progress';
import { connectors } from '@src/connectors';
import chalk from 'chalk';
import { DASHBOARD_DAYS } from '@constants';
import { update, getTickers } from '@utils/cli';
import { findTrendlinesByLows, findTrendlinesByHighs } from '@utils/trendLine';
import { getTimestamp } from '@utils/timestamp';
import { screenDashboard } from '@utils/screen';
import { Interval } from '@types';

args.option(['t', 'tickers'], 'Selected tickers');
args.option(['e', 'exclude'], 'Exclude tickers from tests');
args.option(['l', 'tickersLimit'], 'Tickers limit');
args.option(['f', 'timeframe'], 'Timeframe', 15);
args.option(['o', 'offset'], 'Offset', 3);
args.option(['u', 'updateOnly'], 'Only update tickers history', false);
args.option(['C', 'cacheOnly'], 'Do not update tickers history', false);
args.option(['L', 'showTickersList'], 'Just show only ticker list', false);
args.option(['U', 'user'], 'Use user confg', 'root');

const PRELOAD_START = getTimestamp(DASHBOARD_DAYS);
const PRELOAS_END = getTimestamp();

const flags = args.parse(process.argv);
const interval = flags.timeframe.toString() as Interval;

const byBitConnector = connectors.ByBit({
  userName: flags.user,
});

const checkSignals = async (symbol: string) => {
  const data = await byBitConnector.kline({
    symbol,
    start: PRELOAD_START,
    end: PRELOAS_END,
    cacheOnly: true,
    interval,
  });

  const lowsTrendlines = findTrendlinesByLows(data, {
    minTouches: 2,
    offset: parseInt(flags.offset),
    capture: true,
  });

  const highsTrendlines = findTrendlinesByHighs(data, {
    minTouches: 2,
    offset: parseInt(flags.offset),
    capture: true,
  });

  if (lowsTrendlines.length > 0 || highsTrendlines.length > 0) {
    // console.log(symbol, { lowsTrendlines, highsTrendlines });
    return true;
  }

  return false;
};

const signals = async () => {
  const signalsFound = new Array<string>();

  const tickers = await getTickers(
    byBitConnector,
    flags.tickers,
    flags.exclude,
    flags.tickersLimit,
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
    const res = await checkSignals(symbol);

    if (res) {
      signalsFound.push(symbol);
      await screenDashboard({
        symbol,
        interval,
      });
    }

    bar.tick(1, {
      found: chalk.cyan(signalsFound.length),
      symbol: chalk.gray(symbol),
    });
  }

  console.log(JSON.stringify(signalsFound, null, 2));
};

signals();
