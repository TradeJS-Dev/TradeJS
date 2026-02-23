import _ from 'lodash';
import { SIGNALS_PRELOAD_DAYS } from '@constants';
import { getTimestamp } from '@utils/timestamp';
import { calculateCoinBtcCorrelation } from '@utils/correlation';
import { uuid } from '@utils/uuid';
import { round } from '@utils/math';
import { logger } from '@utils/logger';
import { getData, redisKeys } from '@utils/redis';
import { createTrendlineEngine } from '@utils/trendLineEngine';
import { fetchMlThreshold } from '@utils/mlGrpc';
import { askAI } from '@utils/ai';
import { createIndicators, IndicatorPeriods } from '@utils/indicators';
import { closeOppositePositionsBeforeOpen } from '@utils/closeOppositePositionsBeforeOpen';
import { filterByVeryVolatility } from './filters';
import { config as DEFAULT_CONFIG } from './config';
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
    const userConfig = (await getData(
      redisKeys.strategyConfig(userName, 'TrendLine'),
      {},
    )) as typeof config;

    if (!_.isEmpty(userConfig)) {
      config = {
        ...config,
        ...userConfig,
      };
    }

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
    CLOSE_OPPOSITE_POSITIONS,
    TRENDLINE,
    ML_THRESHOLD,
    MAX_LOSS_VALUE,
    MA_FAST,
    MA_MEDIUM,
    MA_SLOW,
    OBV_SMA,
    ATR,
    ATR_PCT_SHORT,
    ATR_PCT_LONG,
    BB,
    BB_STD,
    MACD_FAST,
    MACD_SLOW,
    MACD_SIGNAL,
    LEVEL_LOOKBACK,
    LEVEL_DELAY,
    HIGHS,
    LOWS,
  } = config;

  const indicatorPeriods: Partial<IndicatorPeriods> = {
    maFast: MA_FAST,
    maMedium: MA_MEDIUM,
    maSlow: MA_SLOW,
    obvSma: OBV_SMA,
    atr: ATR,
    atrPctShort: ATR_PCT_SHORT,
    atrPctLong: ATR_PCT_LONG,
    bb: BB,
    bbStd: BB_STD,
    macdFast: MACD_FAST,
    macdSlow: MACD_SLOW,
    macdSignal: MACD_SIGNAL,
    levelLookback: LEVEL_LOOKBACK,
    levelDelay: LEVEL_DELAY,
  };

  let indicatorsController =
    ENV !== 'BACKTEST'
      ? null
      : createIndicators(cachedData, btcCachedData, {
          periods: indicatorPeriods,
        });

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

    if (indicatorsController) {
      indicatorsController.next(candle, btcCandle);
    }

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

    // if (
    //   ENV !== 'BACKTEST' &&
    //   !configFromBacktest &&
    //   correlation &&
    //   correlation > MAX_CORRELATION
    // ) {
    //   return `BTC_CORRELATION:${round(correlation)}`;
    // }

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
        {
          periods: indicatorPeriods,
        },
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
        ML_THRESHOLD,
      });
      if (mlResult) {
        signal.ml = mlResult;
      }
    }

    let quality: number | undefined;

    if (ENV !== 'BACKTEST') {
      try {
        const analysis = await askAI(signal);
        const aiApprovedCurrentTrade = analysis?.direction === direction;
        quality =
          aiApprovedCurrentTrade && typeof analysis?.quality === 'number'
            ? Math.round(analysis.quality)
            : undefined;
      } catch (err) {
        logger.error('AI analysis error: %s %s', symbol, err);
      }
    }

    const shouldMakeOrder =
      MAKE_ORDERS && (ENV === 'BACKTEST' || [4, 5].includes(quality ?? -1));

    signal.orderStatus = 'canceled';

    if (shouldMakeOrder) {
      try {
        if (CLOSE_OPPOSITE_POSITIONS) {
          await closeOppositePositionsBeforeOpen({
            connector,
            currentSymbol: symbol,
            currentDirection: direction,
            price: currentPrice,
            timestamp: lastCandle.timestamp,
            strategyName: strategy,
          });
        }

        const orderPlaced = await connector.placeOrder(
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

        signal.orderStatus = orderPlaced ? 'completed' : 'failed';

        const currentPosition = await connector.getPosition(symbol);

        if (currentPosition?.price) {
          currentPrice = currentPosition?.price;
          signal.prices.currentPrice = currentPrice;
        }
      } catch (err) {
        signal.orderStatus = 'failed';
        logger.error('order error: %s %s', symbol, err);
      }
    }

    if (ENV === 'BACKTEST') {
      lastTradeTimestamp = lastCandle.timestamp;
    }

    return signal;
  };
};
