import _ from 'lodash';
import { SIGNALS_PRELOAD_DAYS } from '@constants';
import { getTimestamp } from '@utils/timestamp';
import { calculateCoinBtcCorrelation } from '@utils/correlation';
import { uuid } from '@utils/uuid';
import { ATR_PCT } from '@utils/indicators';
import { logger } from '@utils/logger';
import { round } from '@utils/math';
import { createTrendlineEngine } from '@utils/trendLineEngine';
import { findTrendlinesByHighs, findTrendlinesByLows } from '@utils/trendLine';
import { filterByVeryVolatility } from './filters';
import { config as DEFAULT_CONFIG, TRENDLINE } from './config';
import { Signal, TrendLineOptions, StrategyCreator } from '@types';

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
    ENV,
    INTERVAL,
    MAKE_ORDERS,
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

  const debugTrendline = process.env.DEBUG_TRENDLINE_ENGINE === '1';

  const getLowsTrendlines = createTrendlineEngine(cachedData, {
    mode: 'lows',
    ...TRENDLINE_OPTIONS,
  });

  const getHighsTrendlines = createTrendlineEngine(cachedData, {
    mode: 'highs',
    ...TRENDLINE_OPTIONS,
  });

  const ONE_DAY_MS = 86_400_000;
  let lastTradeTimestamp: number | null = null;

  return async (candle, btcCandle) => {
    cachedData.push(candle);
    btcCachedData.push(btcCandle);

    const lowsTrendlines = getLowsTrendlines.next(candle);
    const highsTrendlines = getHighsTrendlines.next(candle);

    const oldLowsTrendlines = debugTrendline
      ? findTrendlinesByLows(cachedData, {
          mode: 'lows',
          ...TRENDLINE_OPTIONS,
        })
      : [];
    const oldHighsTrendlines = debugTrendline
      ? findTrendlinesByHighs(cachedData, {
          mode: 'highs',
          ...TRENDLINE_OPTIONS,
        })
      : [];

    const bestLine =
      lowsTrendlines.length > 0 ? lowsTrendlines[0] : highsTrendlines[0];

    const oldBestLine =
      oldLowsTrendlines.length > 0
        ? oldLowsTrendlines[0]
        : oldHighsTrendlines[0];

    if (debugTrendline && !_.isEqual(bestLine, oldBestLine)) {
      const leftAnchorIndex =
        oldBestLine?.points?.[0]?.timestamp != null
          ? cachedData.findIndex(
              (item) => item.timestamp === oldBestLine.points[0].timestamp,
            )
          : null;

      logger.info(
        'trendline mismatch %j',
        {
          timestamp: candle.timestamp,
          bestLine: bestLine ? JSON.stringify(bestLine) : 'undefined',
          oldBestLine: oldBestLine ? JSON.stringify(oldBestLine) : 'undefined',
          engineCounts: {
            lows: lowsTrendlines.length,
            highs: highsTrendlines.length,
          },
          batchCounts: {
            lows: oldLowsTrendlines.length,
            highs: oldHighsTrendlines.length,
          },
          cachedLength: cachedData.length,
          leftAnchorIndex,
        },
      );
    }

    if (!bestLine) {
      return 'NO_TRENDLINE';
    }

    const position = await connector.getPosition(symbol);
    const positionExists = !_.isEmpty(position) && position.qty > 0;

    if (positionExists) {
      return 'POSITION_EXISTS';
    }

    if (
      ENV === 'development' &&
      lastTradeTimestamp &&
      candle.timestamp <= lastTradeTimestamp + ONE_DAY_MS
    ) {
      return 'DEV_TRADE_COOLDOWN';
    }

    let correlation = null;

    if (ENV !== 'development') {
      correlation = calculateCoinBtcCorrelation(
        cachedData.slice(-100),
        btcCachedData.slice(-100),
      ).correlation;

      if (correlation && correlation > MAX_CORRELATION) {
        return `BTC_CORRELATION:${round(correlation)}`;
      }
    }

    const data =
      ENV === 'development'
        ? cachedData
        : await connector.kline({
            symbol,
            start: PRELOAD_START,
            end: getTimestamp(),
            cacheOnly: false,
            interval: INTERVAL,
          });

    const lastCandle = data[data.length - 1];
    let currentPrice =
      ENV === 'development' ? lastCandle.open : lastCandle.close;

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

    const signalId = uuid();

    const signal: Signal = {
      signalId,
      strategy,
      symbol,
      interval: INTERVAL,
      direction,
      timestamp: lastCandle.timestamp,
      figures: {
        trendLine: bestLine,
      },
      prices: {
        currentPrice,
        takeProfitPrice,
        stopLossPrice,
        riskRatio: riskRatio,
      },
      indicators: {
        correlation: correlation || 0,
        touches: bestLine.touches.length + 2,
        distance: bestLine.distance,
        atr,
      },
    };

    if (MAKE_ORDERS) {
      try {
        await connector.placeOrder(
          {
            symbol,
            qty,
            price: currentPrice,
            isLimit: false,
            timestamp: lastCandle.timestamp,
            direction,
            signal,
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
          signal.prices.currentPrice = currentPrice;
        }
      } catch (err) {
        logger.error('order error: %s %s', symbol, err);
      }
    }

    if (ENV === 'development') {
      lastTradeTimestamp = lastCandle.timestamp;
    }

    return signal;
  };
};
