import _ from 'lodash';
import { SIGNALS_PRELOAD_DAYS } from '@constants';
import { getTimestamp } from '@utils/timestamp';
import { calculateCoinBtcCorrelation } from '@utils/correlation';
import { uuid } from '@utils/uuid';
import { round } from '@utils/math';
import { logger } from '@utils/logger';
import { getData, redisKeys } from '@utils/redis';
import { createTrendlineEngine } from '@utils/trendLineEngine';
import { findTrendlinesByHighs, findTrendlinesByLows } from '@utils/trendLine';
import { fetchMlThreshold } from '@utils/mlGrpc';
import { filterByVeryVolatility } from './filters';
import { config as DEFAULT_CONFIG } from './config';
import { applyIndicatorsToHistory, createIndicators } from './indicators';
import { Signal, TrendLineOptions, StrategyCreator } from '@types';

const PRELOAD_START = getTimestamp(SIGNALS_PRELOAD_DAYS);
const FEE = 0.02;

export const TrendlineStrategyCreator: StrategyCreator = async ({
  config: baseConfig,
  symbol,
  data: cachedData,
  btcData: btcCachedData,
  connector,
}) => {
  const ONE_DAY_MS = 86_400_000;
  let lastTradeTimestamp: number | null = null;

  let config = {
    ...DEFAULT_CONFIG,
    ...baseConfig,
  } as typeof DEFAULT_CONFIG;

  let configFromBacktest = false;

  if (config.ENV !== 'development') {
    const results = (await getData(
      redisKeys.strategyResults('TrendLine'),
      {},
    )) as Record<string, typeof config>;

    const backtestConfig = results?.[symbol];
    if (backtestConfig && !_.isEmpty(backtestConfig)) {
      config = {
        ...config,
        ...backtestConfig,
      };
      configFromBacktest = true;
    }
  }

  const {
    ENV,
    INTERVAL,
    MAKE_ORDERS,
    TRENDLINE,
    ML_THRESHOLD,
    MAX_CORRELATION,
    MAX_LOSS_VALUE,
    HIGHS,
    LOWS,
  } = config;

  const getIndicators = createIndicators(cachedData);
  const indicatorHistory: Record<string, number[]> = {};
  const pushIndicator = (key: string, value: number | null | undefined) => {
    if (value == null) {
      return;
    }
    if (!indicatorHistory[key]) {
      indicatorHistory[key] = [];
    }
    indicatorHistory[key].push(value);
    if (indicatorHistory[key].length > 10) {
      indicatorHistory[key].splice(0, indicatorHistory[key].length - 10);
    }
  };

  const trendlineOptions: Partial<TrendLineOptions> = {
    bestLines: 1,
    capture: true,
    ...TRENDLINE,
  };

  const getLowsTrendlines = createTrendlineEngine(cachedData, {
    mode: 'lows',
    ...trendlineOptions,
  });

  const getHighsTrendlines = createTrendlineEngine(cachedData, {
    mode: 'highs',
    ...trendlineOptions,
  });

  return async (candle, btcCandle) => {
    cachedData.push(candle);
    btcCachedData.push(btcCandle);

    const lowsTrendlines = getLowsTrendlines.next(candle);
    const highsTrendlines = getHighsTrendlines.next(candle);

    let bestLine =
      lowsTrendlines.length > 0 ? lowsTrendlines[0] : highsTrendlines[0];
    let trendlineFrom: 'engine' | 'batch' = 'engine';

    if (!bestLine && ENV !== 'development') {
      const batchLows = findTrendlinesByLows(cachedData, trendlineOptions);
      const batchHighs = findTrendlinesByHighs(cachedData, trendlineOptions);
      bestLine = batchLows.length > 0 ? batchLows[0] : batchHighs[0];
      if (bestLine) {
        trendlineFrom = 'batch';
      }
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

    const correlation = calculateCoinBtcCorrelation(
      cachedData.slice(-100),
      btcCachedData.slice(-100),
    ).correlation;

    if (
      ENV !== 'development' &&
      !configFromBacktest &&
      correlation &&
      correlation > MAX_CORRELATION
    ) {
      return `BTC_CORRELATION:${round(correlation)}`;
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
      ENV === 'development'
        ? (lastCandle.open + lastCandle.close) / 2
        : lastCandle.close;

    if (!filterByVeryVolatility(data)) {
      return 'VERY_VOLATILITY';
    }

    const { mode } = bestLine;

    const strategy = 'TRENDLINE';
    const { direction, TP, SL, minRiskRatio, enable } =
      mode === 'highs' ? HIGHS : LOWS;

    if (!enable) {
      return 'STRATEGY_DISABLED';
    }

    const isLong = direction === 'LONG';
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

    const technicalIndicators = getIndicators(candle);
    if (technicalIndicators) {
      applyIndicatorsToHistory(technicalIndicators, pushIndicator);
    }

    const signal: Signal = {
      signalId,
      strategy,
      symbol,
      interval: INTERVAL,
      direction,
      timestamp: lastCandle.timestamp,
      trendlineFrom,
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
        ...indicatorHistory,
      },
      configFromBacktest,
    };

    if (ENV !== 'development') {
      const mlResult = await fetchMlThreshold(signal, {
        strategyName: strategy,
        strategyConfig: {
          TRENDLINE_CONFIG: TRENDLINE,
          HIGHS,
          LOWS,
        },
        symbol,
        candles: cachedData.slice(-50),
        btcCandles: btcCachedData.slice(-50),
        ML_THRESHOLD,
      });
      if (mlResult) {
        signal.ml = mlResult;
      }
    }

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
