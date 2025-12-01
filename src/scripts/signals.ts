import args from 'args';
import ProgressBar from 'progress';
import { connectors } from '@src/connectors';
import chalk from 'chalk';
import { SIGNALS_PRELOAD_DAYS, TTL_3H, TTL_1M } from '@constants';
import {
  update,
  getTickers,
  makeScreenshots,
  sendToAI,
  sendToTG,
} from '@utils/cli';
import { findTrendlinesByLows, findTrendlinesByHighs } from '@utils/trendLine';
import { getTimestamp } from '@utils/timestamp';
import { uuid } from '@utils/uuid';
import { getKeys, setData, redisKeys } from '@utils/redis';
import { Interval, Signal } from '@types';
import { calcTargetsFromTrendLine } from '@utils/signals';
import { calculateCoinBtcCorrelation } from '@utils/correlation';
import { detectMarketStructure } from '@utils/trend';

args.option(['t', 'tickers'], 'Selected tickers');
args.option(['e', 'exclude'], 'Exclude tickers from tests');
args.option(['l', 'tickersLimit'], 'Tickers limit');
args.option(['f', 'timeframe'], 'Timeframe', 15);
args.option(['o', 'offset'], 'Offset', 3);
args.option(['p', 'points'], 'Points', 3);
args.option(['N', 'notify'], 'Send message in Telegram', false);
args.option(['u', 'updateOnly'], 'Only update tickers history', false);
args.option(['C', 'cacheOnly'], 'Do not update tickers history', false);
args.option(['L', 'showTickersList'], 'Just show only ticker list', false);
args.option(['c', 'chunk'], 'Split by chunks, ex. 1/3');
args.option(['U', 'user'], 'Use user confg', 'root');

const PRELOAD_START = getTimestamp(SIGNALS_PRELOAD_DAYS);
const PRELOAD_END = getTimestamp();

const flags = args.parse(process.argv);
const minTouches = parseInt(flags.points);
const offset = parseInt(flags.offset);
const interval = flags.timeframe.toString() as Interval;

const byBitConnector = connectors.ByBit({
  userName: flags.user,
});

const checkSignals = async (symbol: string) => {
  const prevSignals = await getKeys(redisKeys.signalsBySymbol(symbol));

  if (prevSignals.length) {
    return null;
  }

  const data = await byBitConnector.kline({
    symbol,
    start: PRELOAD_START,
    end: PRELOAD_END,
    cacheOnly: true,
    interval,
  });

  const lastCandle = data.slice(-1)?.[0];

  if (!lastCandle) {
    return null;
  }

  const lowsTrendlines = findTrendlinesByLows(data, {
    minTouches,
    offset,
    bestLines: 1,
    capture: true,
  });

  const highsTrendlines = findTrendlinesByHighs(data, {
    minTouches,
    offset,
    bestLines: 1,
    capture: true,
  });

  const bestLine =
    lowsTrendlines.length > 0 ? lowsTrendlines[0] : highsTrendlines[0];

  if (!bestLine) {
    return null;
  }

  console.log('');
  console.log('');

  console.log('>>> line', symbol, bestLine);

  const btcData = await byBitConnector.kline({
    symbol: 'BTCUSDT',
    start: PRELOAD_START,
    end: PRELOAD_END,
    cacheOnly: true,
    interval,
  });

  const { correlation } = calculateCoinBtcCorrelation(
    data.slice(-300),
    btcData.slice(-300),
  );

  console.log('>>> correlation', symbol, correlation);

  if (!correlation || correlation > 0.6) {
    return null;
  }

  const data4H = await byBitConnector.kline({
    symbol,
    start: PRELOAD_START,
    end: PRELOAD_END,
    cacheOnly: false,
    interval: '240',
  });

  const { trend } = detectMarketStructure(data4H, 'hard');

  console.log('>>> trend', symbol, trend);

  if (
    (bestLine.direction === 'SHORT' && trend === 'BULL') ||
    (bestLine.direction === 'LONG' && trend === 'BEAR')
  ) {
    return null;
  }

  const targets = calcTargetsFromTrendLine(bestLine, lastCandle.close);

  console.log('>>> targets', symbol, targets);

  if (!targets) {
    return null;
  }

  const signalId = uuid();

  const signal: Signal = {
    signalId,
    symbol,
    interval,
    direction: bestLine.direction,
    trendLine: bestLine,
    timestamp: lastCandle.timestamp,
    currentPrice: lastCandle.close,
    takeProfitPrice: targets.takeProfitPrice,
    stopLossPrice: targets.stopLossPrice,
    riskRatio: targets.riskRatio,
    correlation,
    trend,
  };

  await setData(redisKeys.signal(symbol, signalId), signal, {
    stringify: true,
    expire: TTL_3H,
  });

  await setData(redisKeys.storeSignal(symbol, signalId), signal, {
    stringify: true,
    expire: TTL_1M,
  });

  return signal;
};

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
    const signal = await checkSignals(symbol);

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
