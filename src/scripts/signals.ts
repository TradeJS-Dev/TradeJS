import args from 'args';
import ProgressBar from 'progress';
import _ from 'lodash';
import { connectors } from '@src/connectors';
import { SMA } from 'technicalindicators';
import chalk from 'chalk';
import {
  SIGNALS_PRELOAD_DAYS,
  TTL_3H,
  TTL_1M,
  TP_MAX_PERCENT,
  TP_MIN_PERCENT,
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
import { detectMarketStructure } from '@utils/trend';

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
const PRELOAD_END = getTimestamp();

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

  let currentPrice = lastCandle.close;

  const lowsTrendlines = findTrendlinesByLows(data, {
    minTouches,
    offset,
    bestLines: 1,
    maxDistance: 1600,
    capture: true,
  });

  const highsTrendlines = findTrendlinesByHighs(data, {
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

  const position = await byBitConnector.getPosition(symbol);
  const positionExists = !_.isEmpty(position) && position.qty > 0;

  if (positionExists) {
    console.log('>>> exit by position exists', symbol, position);

    return null;
  }
  
  const btcData = await byBitConnector.kline({
    symbol: 'BTCUSDT',
    start: PRELOAD_START,
    end: PRELOAD_END,
    cacheOnly: true,
    interval,
  });

  const { correlation } = calculateCoinBtcCorrelation(
    data.slice(-1000),
    btcData.slice(-1000),
  );

  if (!correlation || correlation > 0.6) {
    console.log('>>> exit by correlation', symbol, correlation);

    return null;
  }

  const data4H = await byBitConnector.kline({
    symbol,
    start: PRELOAD_START,
    end: PRELOAD_END,
    cacheOnly: false,
    interval: '240',
  });

  let { trend } = detectMarketStructure(data4H, 'hard');

  console.log('>>> trend', symbol, trend);

  if (trend === 'RANGE') {
    const sma200 = new SMA({
      period: 200,
      values: data.map((candle) => candle.close),
    });

    const currentSma200 = sma200.getResult().slice(-1)?.[0];

    trend = currentSma200 > currentPrice ? 'BEAR' : 'BULL';
    console.log('>>> trend by sma', symbol, trend, currentSma200, currentPrice);
  }

  if (
    (bestLine.direction === 'SHORT' && trend !== 'BEAR') ||
    (bestLine.direction === 'LONG' && trend !== 'BULL')
  ) {
    console.log('>>> exit by trend', symbol, bestLine.direction, trend);

    return null;
  }

  const sma49 = new SMA({
    period: 49,
    values: data.map((candle) => candle.close),
  });

  const currentSma49 = sma49.getResult().slice(-1)?.[0];

  if ((currentSma49 < currentPrice && bestLine.direction === 'SHORT') || (currentSma49 > currentPrice && bestLine.direction === 'LONG')) {
    console.log('>>> exit by sma49', symbol, bestLine.direction, currentSma49, currentPrice);

    return null;
  }

  const targets = calcTargetsFromTrendLine(bestLine, currentPrice, {
    TP_MAX_PERCENT,
    TP_MIN_PERCENT,
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

      console.log('>>> order', symbol, order);

      const currentPosition = await byBitConnector.getPosition(symbol);

      console.log('>>> position', symbol, currentPosition);

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
