import args from 'args';
import ProgressBar from 'progress';
import { connectors } from '@src/connectors';
import chalk from 'chalk';
import { PRELOAD_DAYS } from '@constants';
import { update, getTickers } from '@utils/cli';
import { findTrendlinesByLows } from '@utils/trendLine';
import { getTimestamp } from '@utils/timestamp';
import { Interval } from '@types';

args.option(['t', 'tickers'], 'Selected tickers');
args.option(['e', 'exclude'], 'Exclude tickers from tests');
args.option(['l', 'tickersLimit'], 'Tickers limit');
args.option(['f', 'timeframe'], 'Timeframe', 15);
args.option(['u', 'updateOnly'], 'Only update tickers history', false);
args.option(['C', 'cacheOnly'], 'Do not update tickers history', false);
args.option(['L', 'showTickersList'], 'Just show only ticker list', false);
args.option(['U', 'user'], 'Use user confg', 'root');

const PRELOAD_START = getTimestamp(PRELOAD_DAYS);
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

  const trendlines = findTrendlinesByLows(data, {
    minTouches: 3,
    capture: true,
  });

  if (trendlines.length > 0) {
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

  for await (const ticker of tickers) {
    const res = await checkSignals(ticker);

    if (res) {
      signalsFound.push(ticker);
    }

    bar.tick(1, {
      found: chalk.cyan(signalsFound.length),
      symbol: chalk.gray(ticker),
    });
  }

  console.log(JSON.stringify(signalsFound, null, 2));
};

signals();
