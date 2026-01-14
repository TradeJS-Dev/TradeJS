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

    let correlation = null;

    if (env !== 'development') {
      correlation = calculateCoinBtcCorrelation(
        cachedData.slice(-100),
        btcCachedData.slice(-100),
      ).correlation;

      if (correlation && correlation > MAX_CORRELATION) {
        return `BTC_CORRELATION:${round(correlation)}`;
      }
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

    const qty = MAX_LOSS_VALUE / ((currentPrice * (SL + FEE)) / 100);

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
};
