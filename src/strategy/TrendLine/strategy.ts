import _ from 'lodash';
import { SIGNALS_PRELOAD_DAYS } from '@constants';
import { findTrendlinesByLows, findTrendlinesByHighs } from '@utils/trendLine';
import { getTimestamp } from '@utils/timestamp';
import { calculateCoinBtcCorrelation } from '@utils/correlation';
import { uuid } from '@utils/uuid';
import { ATR_PCT } from '@utils/indicators';
import { getSma, makeRelPrice, getSupportLevels } from './utils';
import {logger} from '@utils/logger';
import { Interval, Signal, Connector, TrendLineOptions } from '@types';

interface TrenlineStrategyOptions {
  symbol: string;
  interval: Interval;
  makeOrders?: boolean;
  minTouches: number;
  offset: number;
}

const PRELOAD_START = getTimestamp(SIGNALS_PRELOAD_DAYS);
const SMA_FAST = 49;
const MAX_LOSS_VALUE = 1;
const MIN_RISK_RATIO = 2.5;
const MAX_CORRELATION = 0.5;

const TPSL = {
  BREAKOUT: {
    LONG: {
      TP: 7.5,
      SL: 2.2,
    },
    SHORT: {
      TP: 7.5,
      SL: 2.2,
    },
  },
  REVERSAL: {
    LONG: {
      TP: 3.5,
      SL: 1.5,
    },
    SHORT: {
      TP: 3.5,
      SL: 1.5,
    },
  },
};

const TRENDLINE_OPTIONS: Partial<TrendLineOptions> = {
  firstRange: 100,
  bestLines: 1,
  maxDistance: 1600,
  capture: true,
};

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

  let epsilon = 0.002;

  let lowsTrendlines = findTrendlinesByLows(cachedData, {
    ...TRENDLINE_OPTIONS,
    minTouches,
    offset,
    epsilon,
  });

  let highsTrendlines = findTrendlinesByHighs(cachedData, {
    ...TRENDLINE_OPTIONS,
    minTouches,
    offset,
    epsilon,
  });

  let bestLine =
    lowsTrendlines.length > 0 ? lowsTrendlines[0] : highsTrendlines[0];

  if (!bestLine) {
    epsilon = 0.003;

    lowsTrendlines = findTrendlinesByLows(cachedData, {
      ...TRENDLINE_OPTIONS,
      minTouches,
      offset,
      epsilon,
    });

    highsTrendlines = findTrendlinesByHighs(cachedData, {
      ...TRENDLINE_OPTIONS,
      minTouches,
      offset,
      epsilon,
    });

    bestLine =
      lowsTrendlines.length > 0 ? lowsTrendlines[0] : highsTrendlines[0];

    if (!bestLine) {
      return null;
    }
  }

  logger.info('line %s %j', symbol, bestLine);

  const position = await connector.getPosition(symbol);
  const positionExists = !_.isEmpty(position) && position.qty > 0;

  if (positionExists) {
    logger.warn('exit by position exists: %s %j', symbol, position);

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

  if (correlation && correlation > MAX_CORRELATION) {
    logger.warn('exit by correlation: %s %d', symbol, correlation);

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

  const lastCandle = data[data.length - 1];
  let currentPrice = lastCandle.close;

  const { mode } = bestLine;
  const globalTrend = currentGlobalSmaFast > currentPrice ? 'BEAR' : 'BULL';

  const supportLevels = getSupportLevels(
    mode,
    data.slice(-14),
    makeRelPrice(currentPrice, mode === 'highs' ? 2 : -2),
    currentPrice,
  );

  const { value: atr } = ATR_PCT(data, 14, 7, 30);

  const shouldReversal =
    (mode === 'lows' && globalTrend === 'BULL') ||
    (mode === 'highs' && globalTrend === 'BEAR');

  const shouldBreakout =
    (mode === 'lows' && globalTrend === 'BEAR') ||
    (mode === 'highs' && globalTrend === 'BULL');

  if (!shouldReversal && !shouldBreakout) {
    logger.warn('exit by strategy: %s %j', symbol, {
      mode,
      globalTrend,
      currentPrice,
      supportLevels,
      shouldReversal,
      shouldBreakout,
    });

    return null;
  }

  const strategy = shouldBreakout ? 'BREAKOUT' : 'REVERSAL';
  const direction = mode === 'lows' && shouldBreakout ? 'SHORT' : 'LONG';
  const isLong = direction === 'LONG';

  const { TP, SL } = TPSL[strategy][direction];

  const stopLossPrice = isLong
    ? currentPrice * (1 - SL / 100)
    : currentPrice * (1 + SL / 100);

  const takeProfitPrice = isLong
    ? currentPrice * (1 + TP / 100)
    : currentPrice * (1 - TP / 100);

  const qty = MAX_LOSS_VALUE / ((currentPrice * SL) / 100);

  let riskRatio: number;

  if (isLong) {
    const reward = takeProfitPrice - currentPrice;
    const risk = currentPrice - stopLossPrice;
    riskRatio = risk > 0 ? reward / risk : 0;
  } else {
    const reward = currentPrice - takeProfitPrice;
    const risk = stopLossPrice - currentPrice;
    riskRatio = risk > 0 ? reward / risk : 0;
  }

  logger.info('prices: %s %j', symbol, {
    strategy,
    direction,
    qty,
    currentPrice,
    takeProfitPrice,
    stopLossPrice,
    riskRatio,
  });

  if (riskRatio <= MIN_RISK_RATIO) {
    logger.warn('exit by riskRatio: %s %d', symbol, riskRatio);

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
            price: takeProfitPrice,
          },
        ],
        stopLossPrice,
      );

      const currentPosition = await connector.getPosition(symbol);

      if (currentPosition?.price) {
        currentPrice = currentPosition?.price;
      }
    } catch (err) {
      logger.error('order error: %s %s', symbol, err);
    }
  }

  const signalId = uuid();

  const signal: Signal = {
    signalId,
    strategy,
    symbol,
    interval,
    direction,
    trendLine: bestLine,
    timestamp: lastCandle.timestamp,
    currentPrice,
    takeProfitPrice,
    stopLossPrice,
    riskRatio: riskRatio,
    correlation: correlation || 0,
    touches: bestLine.touches.length + 2,
    trend: globalTrend,
    support: supportLevels,
    atr,
    epsilon,
  };

  return signal;
};
