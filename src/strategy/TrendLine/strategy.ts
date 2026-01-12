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
import { config as DEFAULT_CONFIG, TRENDLINE } from './config';
import {
  Signal,
  TrendLineOptions,
  StrategyCreator,
  StrategyConfig,
} from '@types';

const PRELOAD_START = getTimestamp(SIGNALS_PRELOAD_DAYS);
const FEE = 0.02;

export const TrendlineStrategyCreator: StrategyCreator = ({
  config: baseConfig,
  symbol,
  data: cachedData,
  btcData: btcCachedData,
  connector,
}) => {
  const config = {
    ...DEFAULT_CONFIG,
    ...baseConfig,
  } as StrategyConfig & typeof DEFAULT_CONFIG;

  const {
    env,
    offset,
    minTouches,
    interval,
    makeOrders,
    MAX_CORRELATION,
    MAX_LOSS_VALUE,
    STRATEGY_CONFIG,
  } = config;

  return async (candle, btcCandle) => {
    cachedData.push(candle);
    btcCachedData.push(btcCandle);

    const TRENDLINE_OPTIONS: Partial<TrendLineOptions> = {
      bestLines: 1,
      capture: true,
      minTouches,
      offset,
    };

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

    const { correlation } = calculateCoinBtcCorrelation(
      cachedData.slice(-1000),
      btcCachedData.slice(-1000),
    );

    if (correlation && correlation > MAX_CORRELATION) {
      return `BTC_CORRELATION:${round(correlation)}`;
    }

    const data =
      env === 'development'
        ? cachedData
        : await connector.kline({
            symbol,
            start: PRELOAD_START,
            end: getTimestamp(),
            cacheOnly: false,
            interval,
          });

    const prevCandle = data[data.length - 2];
    const lastCandle = data[data.length - 1];
    const currentPrice = lastCandle.close;

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

    const limitPrice = isLong
      ? (Math.min(prevCandle.close, prevCandle.open, lastCandle.low) +
          currentPrice) /
        2
      : (Math.max(prevCandle.close, prevCandle.open, lastCandle.high) +
          currentPrice) /
        2;

    const stopLossPrice = isLong
      ? limitPrice * (1 - SL / 100)
      : limitPrice * (1 + SL / 100);

    const takeProfitPrice = isLong
      ? limitPrice * (1 + TP / 100)
      : limitPrice * (1 - TP / 100);

    const qty = MAX_LOSS_VALUE / ((limitPrice * (SL + FEE)) / 100);

    let riskRatio: number;

    if (isLong) {
      const reward = takeProfitPrice - limitPrice;
      const risk = limitPrice - stopLossPrice;
      riskRatio = risk > 0 ? reward / risk : 0;
    } else {
      const reward = limitPrice - takeProfitPrice;
      const risk = stopLossPrice - limitPrice;
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
            price: limitPrice,
            isLimit: true,
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

        // const currentPosition = await connector.getPosition(symbol);

        // if (currentPosition?.price) {
        //   currentPrice = currentPosition?.price;
        // }
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
      currentPrice: limitPrice,
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
};
