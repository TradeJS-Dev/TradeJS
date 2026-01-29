import args from 'args';
import ProgressBar from 'progress';
import chalk from 'chalk';
import { connectors } from '@src/connectors';
import { PRELOAD_DAYS } from '@constants';
import { getTimestamp, formatUnix } from '@utils/timestamp';
import {
  findContinuityGap,
  deleteCandles,
  waitForDbReady,
} from '@utils/timescale';
import { getTickers } from '@utils/cli';
import { Interval } from '@types';
import { logger } from '@utils/logger';

args.option(['t', 'tickers'], 'Selected tickers');
args.option(['f', 'timeframe'], 'Timeframe', 15);
args.option(['U', 'user'], 'Use user confg', 'root');

const flags = args.parse(process.argv);
const interval = Number(flags.timeframe);
const intervalKey = flags.timeframe.toString() as Interval;

const continuity = async () => {
  if (!Number.isFinite(interval) || interval <= 0) {
    logger.error('Invalid timeframe: %s', flags.timeframe);
    process.exit(1);
  }

  const byBitConnector = await connectors.ByBit({
    userName: flags.user,
  });

  await waitForDbReady();

  const tickers = await getTickers(byBitConnector, flags.tickers);

  const bar = new ProgressBar(
    ':current/:total [:bar][:percent] :fixed :eta(s) :symbol',
    {
      total: tickers.length,
      width: 30,
    },
  );

  const reloadStart = getTimestamp(PRELOAD_DAYS);
  const reloadEnd = getTimestamp();
  let fixed = 0;

  for await (const symbol of tickers) {
    const gap = await findContinuityGap(symbol, interval);

    if (gap) {
      logger.warn(
        'gap %s %s: %s -> %s (%ss)',
        symbol,
        interval,
        formatUnix(gap.prevTs),
        formatUnix(gap.ts),
        gap.diffSeconds,
      );

      await deleteCandles(symbol, interval);

      await byBitConnector.kline({
        symbol,
        interval: intervalKey,
        start: reloadStart,
        end: reloadEnd,
        silent: true,
      });

      fixed++;
    }

    bar.tick(1, {
      fixed: chalk.cyan(fixed),
      symbol: chalk.gray(symbol),
    });
  }

  logger.info(chalk.yellow(`fixed: ${fixed}/${tickers.length}`));
  process.exit();
};

continuity();
