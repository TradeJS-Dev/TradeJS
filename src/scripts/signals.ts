import args from 'args';
import ProgressBar from 'progress';
import _ from 'lodash';
import { connectors } from '@src/connectors';
import { SMA } from 'technicalindicators';
import chalk from 'chalk';
import { SIGNALS_PRELOAD_DAYS, TTL_1H, TTL_1M } from '@constants';
import { update, getTickers, makeScreenshots, sendToTG } from '@utils/cli';
import { findTrendlinesByLows, findTrendlinesByHighs } from '@utils/trendLine';
import { getTimestamp } from '@utils/timestamp';
import { uuid } from '@utils/uuid';
import { getKeys, setData, redisKeys } from '@utils/redis';
import { Interval, Signal } from '@types';
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

// const TP_MIN_LONG_PERCENT = 1.8;
// const TP_MIN_SHORT_PERCENT = 1.6;
const SL_LONG_PERCENT = 1.2;
const SL_SHORT_PERCENT = 1;
const MAX_LOSS_VALUE = 0.2;
const MIN_RISK_RATIO = 1.5;

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

  const cachedData = await byBitConnector.kline({
    symbol,
    start: PRELOAD_START,
    end: getTimestamp(),
    cacheOnly: true,
    interval,
  });

  const lowsTrendlines = findTrendlinesByLows(cachedData, {
    firstRange: 80,
    minTouches,
    offset,
    bestLines: 1,
    maxDistance: 1600,
    capture: true,
  });

  const highsTrendlines = findTrendlinesByHighs(cachedData, {
    firstRange: 100,
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

  const direction =
    bestLine.direction === 'LONG' ? 'SHORT' : 'LONG';
  const isLong = direction === 'LONG';

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

  // const prevCandle = data[data.length - 2];
  const lastCandle = data[data.length - 1];
  let currentPrice = lastCandle.close;

  // if (
  //   (!isLong &&
  //     (lastCandle.close < prevCandle.open ||
  //       prevCandle.close < prevCandle.open)) ||
  //   (isLong &&
  //     (lastCandle.close > prevCandle.open ||
  //       prevCandle.close > prevCandle.open))
  // ) {
  //   console.log(
  //     '>>> exit candle filter',
  //     symbol,
  //     prevCandle.open,
  //     prevCandle.close,
  //     lastCandle.open,
  //     lastCandle.close,
  //   );

  //   return null;
  // }

  const closes = data.map((candle) => candle.close);

  const smaFast = new SMA({
    period: SMA_FAST,
    values: closes,
  }).getResult();

  const currentSmaFast = smaFast[smaFast.length - 1];

  const smaSlow = new SMA({
    period: SMA_SLOW,
    values: closes,
  }).getResult();

  const currentSmaSlow = smaSlow[smaSlow.length - 1];

  const trend = currentSmaSlow > currentPrice ? 'BEAR' : 'BULL';

  if (
    (isLong && (currentSmaFast < currentPrice || currentSmaFast > currentSmaSlow)) ||
    (!isLong && (currentSmaFast > currentPrice || currentSmaFast < currentSmaSlow))
  ) {
    console.log(
      '>>> exit by trend',
      symbol,
      direction,
      currentSmaFast,
      currentPrice,
    );

    return null;
  }

  // const targets = calcTargetsFromTrendLine(bestLine, currentPrice, {
  //   TP_MAX_PERCENT: isLong ? TP_MAX_LONG_PERCENT : TP_MAX_SHORT_PERCENT,
  //   TP_MIN_PERCENT: isLong ? TP_MIN_LONG_PERCENT : TP_MIN_SHORT_PERCENT,
  //   TP_DISTANCE,
  //   SL_PERCENT: isLong ? SL_LONG_PERCENT : SL_SHORT_PERCENT,
  //   MAX_LOSS_VALUE,
  //   MIN_RISK_RATIO,
  // });

  const SL_PERCENT = isLong ? SL_LONG_PERCENT : SL_SHORT_PERCENT;

  const stopLossPrice = isLong
    ? currentPrice * (1 - SL_PERCENT / 100)
    : currentPrice * (1 + SL_PERCENT / 100);

  const qty = MAX_LOSS_VALUE / ((currentPrice * SL_PERCENT) / 100);

  const firstTakeProfitPrice = currentSmaFast;

  const secondTakeProfitPrice = currentSmaSlow;

  const avgTakeProfitPrice = (firstTakeProfitPrice + secondTakeProfitPrice) / 2;

  let riskRatio: number;

  if (isLong) {
    const reward = avgTakeProfitPrice - currentPrice;
    const risk = currentPrice - stopLossPrice;
    riskRatio = risk > 0 ? reward / risk : 0;
  } else {
    const reward = currentPrice - avgTakeProfitPrice;
    const risk = stopLossPrice - currentPrice;
    riskRatio = risk > 0 ? reward / risk : 0;
  }

  if (riskRatio <= MIN_RISK_RATIO) {
    console.log('>>> exit by riskRatio', symbol, riskRatio);

    return null;
  }

  console.log('>>> prices', symbol, {
    currentPrice,
    firstTakeProfitPrice,
    secondTakeProfitPrice,
    avgTakeProfitPrice,
    currentSmaFast,
    currentSmaSlow,
    stopLossPrice,
    riskRatio,
  });

  if (flags.makeOrders) {
    try {
      await byBitConnector.placeOrder(
        {
          symbol,
          qty,
          price: currentPrice,
          timestamp: lastCandle.timestamp,
          direction,
        },
        [
          {
            rate: 0.5,
            price: firstTakeProfitPrice,
          },
          {
            rate: 0.5,
            price: secondTakeProfitPrice,
          },
        ],
        stopLossPrice,
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
    direction,
    trendLine: bestLine,
    timestamp: lastCandle.timestamp,
    currentPrice,
    takeProfitPrice: avgTakeProfitPrice,
    stopLossPrice: stopLossPrice,
    riskRatio: riskRatio,
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

const checkSignals = async () => {
  const posiions = await byBitConnector.getPositions();

  for await (const posiion of posiions) {
    const { symbol } = posiion;
  }
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
