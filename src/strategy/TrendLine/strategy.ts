import _ from 'lodash';
import { SIGNALS_PRELOAD_DAYS } from '@constants';
import { findTrendlinesByLows, findTrendlinesByHighs } from '@utils/trendLine';
import { getTimestamp } from '@utils/timestamp';
import { calculateCoinBtcCorrelation } from '@utils/correlation';
import { uuid } from '@utils/uuid';
import { ATR_PCT } from '@utils/indicators';
import { logger } from '@utils/logger';
import { round } from '@utils/math';
import { filterByVeryVolatility } from './filters';
import { Interval, Signal, Connector, TrendLineOptions } from '@types';

interface TrenlineStrategyOptions {
  symbol: string;
  interval: Interval;
  makeOrders?: boolean;
  minTouches: number;
  offset: number;
}

const PRELOAD_START = getTimestamp(SIGNALS_PRELOAD_DAYS);
const MAX_LOSS_VALUE = 1;
const MAX_CORRELATION = 0.45;

const TRENDLINE = 'TRENDLINE';

const STRATEGY_CONFIG = {
  highs: {
    [TRENDLINE]: {
      enable: false,
      direction: 'LONG',
      TP: 4.4,
      SL: 1.6,
      minRiskRatio: 2,
    },
  },
  lows: {
    [TRENDLINE]: {
      enable: true,
      direction: 'LONG',
      TP: 3.2,
      SL: 0.9,
      minRiskRatio: 2,
    },
  },
} as const;

export const TrendlineStrategy = async (
  connector: Connector,
  { symbol, interval, minTouches, offset, makeOrders }: TrenlineStrategyOptions,
): Promise<Signal | string> => {
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

  let highsTrendlines = findTrendlinesByHighs(cachedData, {
    ...TRENDLINE_OPTIONS,
  });

  const bestLine =
    lowsTrendlines.length > 0 ? lowsTrendlines[0] : highsTrendlines[0];

  if (!bestLine) {
    return 'NO_TRENDLINE';
  }

  const position = await connector.getPosition(symbol);
  const positionExists = !_.isEmpty(position) && position.qty > 0;

  if (positionExists) {
    return 'POSITION_EXISTS';
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
    return `BTC_CORRELATION:${round(correlation)}`;
  }

  const data = await connector.kline({
    symbol,
    start: PRELOAD_START,
    end: getTimestamp(),
    cacheOnly: false,
    interval,
  });

  const lastCandle = data[data.length - 1];
  let currentPrice = lastCandle.close;

  if (!filterByVeryVolatility(data)) {
    return 'VERY_VOLATILITY';
  }

  const { mode } = bestLine;

  const strategy = TRENDLINE;
  const { direction, TP, SL, minRiskRatio, enable } =
    STRATEGY_CONFIG[mode][strategy];

  if (!enable) {
    return 'STRATEGY_DISABLED';
  }

  const isLong = direction === 'LONG';
  const { value: atr } = ATR_PCT(data, 14, 7, 30);

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

  if (riskRatio <= minRiskRatio) {
    return `RISK_RATIO:${round(riskRatio)}`;
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
    atr,
  };

  return signal;
};
