import _ from 'lodash';
import { SIGNALS_PRELOAD_DAYS } from '@constants';
import { findTrendlinesByLows, findTrendlinesByHighs } from '@utils/trendLine';
import { getTimestamp } from '@utils/timestamp';
import { calculateCoinBtcCorrelation } from '@utils/correlation';
import { uuid } from '@utils/uuid';
import { getSma, makeRelPrice, hasSupportLevel } from './utils';
import { Interval, Signal, Connector } from '@types';

interface TrenlineStrategyOptions {
  symbol: string;
  interval: Interval;
  makeOrders?: boolean;
  minTouches: number;
  offset: number;
}

const PRELOAD_START = getTimestamp(SIGNALS_PRELOAD_DAYS);
const SMA_FAST = 49;
const SMA_SLOW = 200;

const SL_LONG_PERCENT = 1.7;
const SL_SHORT_PERCENT = 1.5;
const MAX_LOSS_VALUE = 0.2;
const MIN_RISK_RATIO = 2.5;

const MIN_CORRELATION = 0.03;
const MAX_CORRELATION = 0.5;

export const TrendlineStrategy = async (
  connector: Connector,
  { symbol, interval, minTouches, offset, makeOrders }: TrenlineStrategyOptions,
): Promise<Signal | null> => {
  const currentTimestamp = getTimestamp();

  const cachedData = await connector.kline({
    symbol,
    start: PRELOAD_START,
    end: currentTimestamp,
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

  const position = await connector.getPosition(symbol);
  const positionExists = !_.isEmpty(position) && position.qty > 0;

  if (positionExists) {
    console.log('>>> exit by position exists', symbol, position);

    return null;
  }

  const btcData = await connector.kline({
    symbol: 'BTCUSDT',
    start: PRELOAD_START,
    end: currentTimestamp,
    cacheOnly: true,
    interval,
  });

  const { correlation } = calculateCoinBtcCorrelation(
    cachedData.slice(-1000),
    btcData.slice(-1000),
  );

  if (
    !correlation ||
    correlation <= MIN_CORRELATION ||
    correlation > MAX_CORRELATION
  ) {
    console.log('>>> exit by correlation', symbol, correlation);

    return null;
  }

  const data = await connector.kline({
    symbol,
    start: PRELOAD_START,
    end: getTimestamp(),
    cacheOnly: false,
    interval,
  });

  const globalData = await connector.kline({
    symbol,
    start: PRELOAD_START,
    end: getTimestamp(),
    cacheOnly: false,
    interval: '720',
  });

  const { last: currentGlobalSmaFast } = getSma(SMA_FAST, globalData);
  const { last: currentSmaFast } = getSma(SMA_FAST, data);
  const { last: currentSmaSlow } = getSma(SMA_SLOW, data);

  const lastCandle = data[data.length - 1];
  let currentPrice = lastCandle.close;

  const { trend } = bestLine;
  const localTrend = currentSmaSlow > currentPrice ? 'BEAR' : 'BULL';
  const globalTrend = currentPrice < currentGlobalSmaFast ? 'BEAR' : 'BULL';

  const hasSupportLevel1 = hasSupportLevel(
    trend,
    data.slice(-20),
    makeRelPrice(currentPrice, trend === 'BULL' ? 1 : -1),
    currentPrice,
  );

  const shouldReversal =
    (trend === 'BEAR' &&
      localTrend === 'BEAR' &&
      globalTrend === 'BULL' &&
      hasSupportLevel1) ||
    (trend === 'BULL' &&
      localTrend === 'BULL' &&
      globalTrend === 'BEAR' &&
      hasSupportLevel1);

  if (!shouldReversal) {
    console.log('>>> exit by shouldReversal', {
      symbol,
      trend,
      localTrend,
      globalTrend,
      currentPrice,
      hasSupportLevel1,
    });

    return null;
  }

  const direction = trend === 'BEAR' ? 'LONG' : 'SHORT';
  const isLong = direction === 'LONG';

  const SL_PERCENT = isLong ? SL_LONG_PERCENT : SL_SHORT_PERCENT;

  const stopLossPrice = isLong
    ? currentPrice * (100 - SL_PERCENT / 100)
    : currentPrice * (100 + SL_PERCENT / 100);

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

  console.log('>>> prices', symbol, {
    qty,
    currentPrice,
    firstTakeProfitPrice,
    secondTakeProfitPrice,
    avgTakeProfitPrice,
    currentSmaFast,
    currentSmaSlow,
    stopLossPrice,
    riskRatio,
  });

  if (riskRatio <= MIN_RISK_RATIO) {
    console.log('>>> exit by riskRatio', symbol, riskRatio);

    return null;
  }

  if (makeOrders) {
    try {
      await connector.placeOrder(
        {
          symbol,
          qty,
          price: currentPrice,
          timestamp: lastCandle.timestamp,
          direction,
        },
        [
          {
            rate: 1,
            price: avgTakeProfitPrice,
          },
        ],
        stopLossPrice,
      );

      const currentPosition = await connector.getPosition(symbol);

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

  return signal;
};
