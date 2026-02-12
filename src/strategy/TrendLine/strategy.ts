import _ from 'lodash';
import { ML_BASE_CANDLES_WINDOW, SIGNALS_PRELOAD_DAYS } from '@constants';
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
import { createIndicators } from './indicators';
import {
  Signal,
  TrendLineOptions,
  StrategyCreator,
  StrategyResults,
} from '@types';

const PRELOAD_START = getTimestamp(SIGNALS_PRELOAD_DAYS);
const FEE = 0.005;

export const TrendlineStrategyCreator: StrategyCreator = async ({
  userName,
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

  if (config.ENV !== 'BACKTEST') {
    const results = (await getData(
      redisKeys.strategyResults(userName, 'TrendLine'),
      {},
    )) as StrategyResults;

    const backtestResult = results?.[symbol];
    if (backtestResult && !_.isEmpty(backtestResult.config)) {
      config = {
        ...config,
        ...backtestResult.config,
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

  let indicatorsController =
    ENV !== 'BACKTEST' ? null : createIndicators(cachedData, btcCachedData);

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

  const closeOppositePositionsBeforeOpen = async ({
    currentSymbol,
    currentDirection,
    price,
    timestamp,
  }: {
    currentSymbol: string;
    currentDirection: 'LONG' | 'SHORT';
    price: number;
    timestamp: number;
  }) => {
    try {
      logger.log(
        'info',
        '[TrendLine] checking open positions before open: %s %s',
        currentSymbol,
        currentDirection,
      );

      const positions = await connector.getPositions();
      const openPositions = (positions || []).filter(
        (item) => item && Number(item.qty) > 0,
      );

      logger.log(
        'info',
        '[TrendLine] open positions found: %s',
        openPositions.length,
      );

      const oppositePositions = openPositions.filter(
        (item) =>
          item.symbol !== currentSymbol && item.direction !== currentDirection,
      );

      if (_.isEmpty(oppositePositions)) {
        logger.log(
          'info',
          '[TrendLine] no opposite positions to close before open: %s',
          currentSymbol,
        );
        return;
      }

      for (const position of oppositePositions) {
        logger.log(
          'info',
          '[TrendLine] closing opposite position: %s %s qty=%s',
          position.symbol,
          position.direction,
          position.qty,
        );

        try {
          await connector.closePosition({
            symbol: position.symbol,
            price,
            timestamp,
            direction: position.direction,
          });

          logger.log(
            'info',
            '[TrendLine] opposite position closed: %s',
            position.symbol,
          );
        } catch (err) {
          logger.log(
            'error',
            '[TrendLine] failed to close opposite position: %s %s',
            position.symbol,
            err,
          );
        }
      }
    } catch (err) {
      logger.log(
        'error',
        '[TrendLine] failed to load open positions before open: %s %s',
        currentSymbol,
        err,
      );
    }
  };

  return async (candle, btcCandle) => {
    cachedData.push(candle);
    btcCachedData.push(btcCandle);

    const lowsTrendlines = getLowsTrendlines.next(candle);
    const highsTrendlines = getHighsTrendlines.next(candle);

    if (indicatorsController) {
      indicatorsController.next(candle, btcCandle);
    }

    let bestLine =
      lowsTrendlines.length > 0 ? lowsTrendlines[0] : highsTrendlines[0];
    let trendlineFrom: 'engine' | 'batch' = 'engine';

    if (!bestLine && ENV !== 'BACKTEST') {
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
      ENV === 'BACKTEST' &&
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
      ENV !== 'BACKTEST' &&
      !configFromBacktest &&
      correlation &&
      correlation > MAX_CORRELATION
    ) {
      return `BTC_CORRELATION:${round(correlation)}`;
    }

    const data =
      ENV === 'BACKTEST'
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
      ENV === 'BACKTEST'
        ? (lastCandle.open + lastCandle.close) / 2
        : lastCandle.close;

    if (!filterByVeryVolatility(data)) {
      return 'VERY_VOLATILITY';
    }

    const { mode } = bestLine;

    const strategy = 'TrendLine';
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

    if (!indicatorsController) {
      indicatorsController = createIndicators(
        cachedData.slice(0, cachedData.length - 1),
        btcCachedData.slice(0, btcCachedData.length - 1),
      );

      indicatorsController.next(
        cachedData[cachedData.length - 1],
        btcCachedData[btcCachedData.length - 1],
      );
    }

    const indicatorHistory = indicatorsController.result();

    const signalId = uuid();

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

    if (ENV !== 'BACKTEST') {
      const mlResult = await fetchMlThreshold(signal, {
        strategyName: strategy,
        strategyConfig: {
          TRENDLINE_CONFIG: TRENDLINE,
          HIGHS,
          LOWS,
        },
        symbol,
        candles: cachedData.slice(-ML_BASE_CANDLES_WINDOW),
        btcCandles: btcCachedData.slice(-ML_BASE_CANDLES_WINDOW),
        ML_THRESHOLD,
      });
      if (mlResult) {
        signal.ml = mlResult;
      }
    }

    if (MAKE_ORDERS) {
      try {
        if (ENV !== 'BACKTEST') {
          await closeOppositePositionsBeforeOpen({
            currentSymbol: symbol,
            currentDirection: direction,
            price: currentPrice,
            timestamp: lastCandle.timestamp,
          });
        }

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

    if (ENV === 'BACKTEST') {
      lastTradeTimestamp = lastCandle.timestamp;
    }

    return signal;
  };
};
