import _ from 'lodash';
import { SIGNALS_PRELOAD_DAYS } from '@constants';
import { getTimestamp } from '@utils/timestamp';
import { calculateCoinBtcCorrelation } from '@utils/correlation';
import { uuid } from '@utils/uuid';
import { ATR_PCT } from '@utils/indicators';
import { logger } from '@utils/logger';
import { round } from '@utils/math';
import { createTrendlineEngine } from '@utils/trendLineEngine';
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
  } as typeof DEFAULT_CONFIG;

  const {
    env,
    interval,
    makeOrders,
    TRENDLINE_CONFIG,
    MAX_CORRELATION,
    MAX_LOSS_VALUE,
    HIGHS_CONFIG,
    LOWS_CONFIG,
  } = config;

  const TRENDLINE_OPTIONS: Partial<TrendLineOptions> = {
    bestLines: 1,
    capture: true,
    ...TRENDLINE_CONFIG,
  };

  const getLowsTrendlines = createTrendlineEngine(cachedData, {
    mode: 'lows',
    ...TRENDLINE_OPTIONS,
  });

  const getHighsTrendlines = createTrendlineEngine(cachedData, {
    mode: 'lows',
    ...TRENDLINE_OPTIONS,
  });

  return async (candle, btcCandle) => {
    cachedData.push(candle);
    btcCachedData.push(btcCandle);

    const lowsTrendlines = getLowsTrendlines.next(candle);
    const highsTrendlines = getHighsTrendlines.next(candle);

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
    let currentPrice =
      env === 'development' ? lastCandle.open : lastCandle.close;

    if (!filterByVeryVolatility(data)) {
      return 'VERY_VOLATILITY';
    }

    const { mode } = bestLine;

    const strategy = TRENDLINE;
    const { direction, TP, SL, minRiskRatio, enable } =
      mode === 'highs' ? HIGHS_CONFIG[strategy] : LOWS_CONFIG[strategy];

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
            isLimit: false,
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
