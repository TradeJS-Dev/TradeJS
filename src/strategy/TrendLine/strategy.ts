import _ from 'lodash';
import { SIGNALS_PRELOAD_DAYS } from '@constants';
import { findTrendlinesByLows } from '@utils/trendLine';
import { getTimestamp } from '@utils/timestamp';
import { calculateCoinBtcCorrelation } from '@utils/correlation';
import { uuid } from '@utils/uuid';
import { ATR_PCT } from '@utils/indicators';
import { logger } from '@utils/logger';
import { round } from '@utils/math';
import { getSma, makeRelPrice, getSupportLevels } from './utils';
import { filterByATR, filterByVeryVolatility } from './filters';
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
const MIN_RISK_RATIO = 1.5;
const MAX_CORRELATION = 0.45;

const BREAKOUT = 'BREAKOUT';
const BREAKOUT_NO_TREND = 'BREAKOUT_NO_TREND';

const STRATEGY_CONFIG = {
  highs: {
    [BREAKOUT]: {
      direction: 'LONG',
      TP: 5.7,
      SL: 1.6,
    },
    [BREAKOUT_NO_TREND]: {
      direction: 'LONG',
      TP: 4.4,
      SL: 1.6,
    },
  },
  lows: {
    [BREAKOUT]: {
      direction: 'LONG',
      TP: 2.9,
      SL: 0.9,
    },
    [BREAKOUT_NO_TREND]: {
      direction: 'LONG',
      TP: 3.2,
      SL: 0.9,
    },
  },
} as const;

export const TrendlineStrategy = async (
  connector: Connector,
  { symbol, interval, minTouches, offset, makeOrders }: TrenlineStrategyOptions,
): Promise<Signal | null> => {
  const TRENDLINE_OPTIONS: Partial<TrendLineOptions> = {
    bestLines: 1,
    capture: true,
    minTouches,
    offset,
  };

  const currentTimestamp = getTimestamp();

  const cachedData = await connector.kline({
    symbol,
    start: PRELOAD_START,
    end: currentTimestamp,
    cacheOnly: true,
    interval,
  });

  let lowsTrendlines = findTrendlinesByLows(cachedData, {
    ...TRENDLINE_OPTIONS,
  });

  // let highsTrendlines = findTrendlinesByHighs(cachedData, {
  //   ...TRENDLINE_OPTIONS,
  // });

  const bestLine = lowsTrendlines?.[0];
  //  lowsTrendlines.length > 0 ? lowsTrendlines[0] : highsTrendlines[0];

  if (!bestLine) {
    return null;
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
    logger.warn('exit by correlation: %s %d', symbol, round(correlation, 2));

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

  const lastCandle = data[data.length - 1];
  let currentPrice = lastCandle.close;

  if (!filterByVeryVolatility(symbol, data)) {
    return null;
  }

  const { last: currentGlobalSmaFast } = getSma(SMA_FAST, globalData);
  const { mode } = bestLine;

  const supportLevels = getSupportLevels(
    mode,
    data.slice(-14),
    makeRelPrice(currentPrice, mode === 'highs' ? 2 : -2),
    currentPrice,
  );

  const globalTrend = currentGlobalSmaFast > currentPrice ? 'BEAR' : 'BULL';

  const shouldBreakoutNoTrend =
    (mode === 'lows' && globalTrend === 'BULL') ||
    (mode === 'highs' && globalTrend === 'BEAR');

  const shouldBreakout =
    (mode === 'lows' && globalTrend === 'BEAR') ||
    (mode === 'highs' && globalTrend === 'BULL');

  if (!shouldBreakoutNoTrend && !shouldBreakout) {
    logger.warn('exit by strategy: %s %j', symbol, {
      mode,
      globalTrend,
      currentPrice,
      supportLevels,
      shouldBreakoutNoTrend,
      shouldBreakout,
    });

    return null;
  }

  const strategy = shouldBreakout ? BREAKOUT : BREAKOUT_NO_TREND;
  const { direction, TP, SL } = STRATEGY_CONFIG[mode][strategy];
  const isLong = direction === 'LONG';
  const { value: atr } = ATR_PCT(data, 14, 7, 30);

  if ([BREAKOUT_NO_TREND].includes(strategy) && !filterByATR(symbol, data)) {
    return null;
  }

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

  logger.info('result: %s %j', symbol, {
    strategy,
    direction,
    qty,
    currentPrice,
    takeProfitPrice,
    stopLossPrice,
    riskRatio,
  });

  if (riskRatio <= MIN_RISK_RATIO) {
    logger.warn('exit by riskRatio: %s %d', symbol, round(riskRatio, 2));

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
    distance: bestLine.distance,
    trend: globalTrend,
    support: supportLevels,
    atr,
  };

  return signal;
};
