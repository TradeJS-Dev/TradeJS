import args from 'args';
import ProgressBar from 'progress';
import _ from 'lodash';
import { connectors } from '@src/connectors';
import { SMA } from 'technicalindicators';
import chalk from 'chalk';
import {
  SIGNALS_PRELOAD_DAYS,
  TTL_1H,
  TTL_1M,
  TP_MAX_SHORT_PERCENT,
  TP_MAX_LONG_PERCENT,
  TP_MIN_PERCENT,
  TP_DISTANCE,
  SL_PERCENT,
  MAX_LOSS_VALUE,
  MIN_RISK_RATIO,
} from '@constants';
import { update, getTickers, makeScreenshots, sendToTG } from '@utils/cli';
import { findTrendlinesByLows, findTrendlinesByHighs } from '@utils/trendLine';
import { getTimestamp } from '@utils/timestamp';
import { uuid } from '@utils/uuid';
import { getKeys, setData, redisKeys } from '@utils/redis';
import { Interval, Signal } from '@types';
import { calcTargetsFromTrendLine } from '@utils/signals';
import { calculateCoinBtcCorrelation } from '@utils/correlation';

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
const SMA_FAST = 49;
const SMA_SLOW = 200;
const MAX_CORRELATION = 0.6;

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
    return null;
  }

  const cachedData = await byBitConnector.kline({
    symbol,
    start: PRELOAD_START,
    end: getTimestamp(),
    cacheOnly: true,
    interval,
  });

  const lowsTrendlines = findTrendlinesByLows(cachedData, {
    minTouches,
    offset,
    bestLines: 1,
    maxDistance: 1600,
    capture: true,
  });

  const highsTrendlines = findTrendlinesByHighs(cachedData, {
    minTouches,
    offset,
    bestLines: 1,
    maxDistance: 1400,
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

  const isLong = bestLine.direction === 'LONG';

  const position = await byBitConnector.getPosition(symbol);
  const positionExists = !_.isEmpty(position) && position.qty > 0;

  if (positionExists) {
    console.log('>>> exit by position exists', symbol, position);

    return null;
  }

  const btcData = await byBitConnector.kline({
    symbol: 'BTCUSDT',
    start: PRELOAD_START,
    end: getTimestamp(),
    cacheOnly: true,
    interval,
  });

  const { correlation } = calculateCoinBtcCorrelation(
    cachedData.slice(-1000),
    btcData.slice(-1000),
  );

  if (!correlation || correlation > MAX_CORRELATION) {
    console.log('>>> exit by correlation', symbol, correlation);

    return null;
  }

  const data = await byBitConnector.kline({
    symbol,
    start: PRELOAD_START,
    end: getTimestamp(),
    cacheOnly: false,
    interval,
  });

  const prevCandle = data[data.length - 2];
  const lastCandle = data[data.length - 1];

  if (
    (isLong &&
      (lastCandle.close < lastCandle.open ||
        prevCandle.close < prevCandle.open)) ||
    (!isLong &&
      (lastCandle.close > lastCandle.open ||
        prevCandle.close > prevCandle.open))
  ) {
    return console.log(
      '>>> exit by revert',
      symbol,
      prevCandle.open,
      prevCandle.close,
      lastCandle.open,
      lastCandle.close,
    );
  }

  let currentPrice = lastCandle.close;

  const smaFast = new SMA({
    period: SMA_FAST,
    values: data.map((candle) => candle.close),
  }).getResult();

  const currentSmaFast = smaFast[smaFast.length - 1];

  const smaSlow = new SMA({
    period: SMA_SLOW,
    values: data.map((candle) => candle.close),
  }).getResult();

  const currentSmaSlow = smaSlow[smaSlow.length - 1];

  const trend = currentSmaSlow > currentPrice ? 'BEAR' : 'BULL';

  if ((!isLong && trend !== 'BEAR') || (isLong && trend !== 'BULL')) {
    console.log('>>> exit by trend', symbol, bestLine.direction, trend);

    return null;
  }

  if (
    (currentSmaFast < currentPrice && !isLong) ||
    (currentSmaFast > currentPrice && isLong)
  ) {
    console.log(
      '>>> exit by smaFast',
      symbol,
      bestLine.direction,
      currentSmaFast,
      currentPrice,
    );

    return null;
  }

  const targets = calcTargetsFromTrendLine(bestLine, currentPrice, {
    TP_MAX_SHORT_PERCENT,
    TP_MAX_LONG_PERCENT,
    TP_MIN_PERCENT,
    TP_DISTANCE,
    SL_PERCENT,
    MAX_LOSS_VALUE,
    MIN_RISK_RATIO,
  });

  if (!targets) {
    console.log('>>> exit by targets', symbol, targets, currentPrice);

    return null;
  }

  if (flags.makeOrders) {
    try {
      const order = await byBitConnector.placeOrder(
        {
          symbol,
          qty: targets.qty,
          price: currentPrice,
          timestamp: lastCandle.timestamp,
          direction: bestLine.direction,
        },
        [
          {
            rate: 1,
            price: targets.takeProfitPrice,
          },
        ],
        targets.stopLossPrice,
      );

      const currentPosition = await byBitConnector.getPosition(symbol);

      if (currentPosition?.price) {
        currentPrice = currentPosition?.price;
      }
    } catch (err) {
      console.error('>>> order error:', symbol, err);
    }
  }

  const signalId = uuid();

  const signal: Signal = {
    signalId,
    symbol,
    interval,
    direction: bestLine.direction,
    trendLine: bestLine,
    timestamp: lastCandle.timestamp,
    currentPrice,
    takeProfitPrice: targets.takeProfitPrice,
    stopLossPrice: targets.stopLossPrice,
    riskRatio: targets.riskRatio,
    correlation,
    trend,
  };

  await setData(redisKeys.signal(symbol, signalId), signal, {
    stringify: true,
    expire: TTL_1H,
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
