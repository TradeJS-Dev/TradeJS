import { diffRel } from '@tradejs/core/math';
import { ATR_PCT } from '@tradejs/indicators';
import { getSma } from './utils';

import { Candle, KlineChartData } from '@tradejs/types';

const MIN_ATR = 0.94;
const SMA_SLOW = 200;
const MIN_DISTANCE_LOCAL_SMA_SLOW = 0.005;
const MAX_DISTANCE_LAST_ANCHOR = 0.02;
const MIN_BREAKOUT_PRICE = 0.002;
const MAX_CANDLE_VOLATILITY = 0.025;

export const filterByLocalSmaSlow = (data: KlineChartData) => {
  const { last: currentLocalSmaSlow } = getSma(SMA_SLOW, data);
  const lastCandle = data[data.length - 1];

  if (
    diffRel(lastCandle.close, currentLocalSmaSlow) < MIN_DISTANCE_LOCAL_SMA_SLOW
  ) {
    // logger.warn('exit by local SMA SLOW is nearest: %s', symbol);

    return false;
  }

  return true;
};

export const filterByTooLate = (
  price: number,
  lineStart: number,
  lineEnd: number,
) => {
  if (
    diffRel(lineStart, price) < diffRel(lineEnd, price) ||
    diffRel(lineEnd, price) > MAX_DISTANCE_LAST_ANCHOR
  ) {
    // logger.warn('exit by is too late: %s', symbol);

    return false;
  }

  return true;
};

export const filterByBreakablePrice = (
  isLong: boolean,
  price: number,
  lineEnd: number,
) => {
  const priceIsBreakable =
    (isLong && price > lineEnd * (1 + MIN_BREAKOUT_PRICE)) ||
    (!isLong && price < lineEnd * (1 - MIN_BREAKOUT_PRICE));

  if (!priceIsBreakable) {
    // logger.warn('exit by price no breakable: %s %s', symbol);

    return false;
  }

  return true;
};

export const filterByATR = (data: KlineChartData) => {
  const { value: atr } = ATR_PCT(data, 14, 7, 30);

  if (atr < MIN_ATR) {
    // logger.warn('exit by ATR: %s %s', symbol, atr);

    return false;
  }

  return true;
};

type VolatilityCandle = Pick<Candle, 'high' | 'low'>;

export const filterByVeryVolatilityCandles = (
  lastCandle: VolatilityCandle | null | undefined,
  prevCandle: VolatilityCandle | null | undefined,
) => {
  if (!lastCandle || !prevCandle) {
    return false;
  }

  const isVeryVolatility =
    diffRel(lastCandle.low, lastCandle.high) > MAX_CANDLE_VOLATILITY ||
    diffRel(prevCandle.low, prevCandle.high) > MAX_CANDLE_VOLATILITY;

  if (isVeryVolatility) {
    return false;
  }

  return true;
};

export const filterByVeryVolatility = (data: KlineChartData) =>
  filterByVeryVolatilityCandles(data[data.length - 1], data[data.length - 2]);
