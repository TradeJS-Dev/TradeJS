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
import { Candle, Signal, TrendLineOptions, StrategyCreator } from '@types';

const PRELOAD_START = getTimestamp(SIGNALS_PRELOAD_DAYS);
const FEE = 0.005;
const CANDLE_WINDOW = 10;
const BASE_INTERVAL_MINUTES = 15;
const INDICATOR_TIMEFRAMES = [
  { minutes: 60, suffix: '1h' },
  { minutes: 240, suffix: '4h' },
  { minutes: 1440, suffix: '1d' },
] as const;

const toMlCandle = (candle: Candle): Candle => ({
  open: Number(candle.open) || 0,
  high: Number(candle.high) || 0,
  low: Number(candle.low) || 0,
  close: Number(candle.close) || 0,
  volume: Number(candle.volume) || 0,
  turnover: Number(candle.turnover) || 0,
  timestamp: Number(candle.timestamp) || 0,
});

const resampleCandles = (candles: Candle[], targetMinutes: number): Candle[] => {
  if (targetMinutes <= BASE_INTERVAL_MINUTES) return candles.map(toMlCandle);
  const bucketMs = targetMinutes * 60_000;
  const buckets = new Map<number, Candle>();
  for (const raw of candles) {
    const candle = toMlCandle(raw);
    const ts = candle.timestamp;
    if (!Number.isFinite(ts) || ts <= 0) continue;
    const bucket = Math.floor(ts / bucketMs) * bucketMs;
    const current = buckets.get(bucket);
    if (!current) {
      buckets.set(bucket, { ...candle, timestamp: bucket });
      continue;
    }
    current.high = Math.max(current.high, candle.high);
    current.low = Math.min(current.low, candle.low);
    current.close = candle.close;
    current.volume += candle.volume;
    current.turnover += candle.turnover;
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, candle]) => candle);
};

const buildMlCandleIndicators = (candles: Candle[], btcCandles: Candle[]) => ({
  candles15m: candles.slice(-CANDLE_WINDOW).map(toMlCandle),
  candles1h: resampleCandles(candles, 60).slice(-CANDLE_WINDOW),
  candles4h: resampleCandles(candles, 240).slice(-CANDLE_WINDOW),
  candles1d: resampleCandles(candles, 1440).slice(-CANDLE_WINDOW),
  btcCandles15m: btcCandles.slice(-CANDLE_WINDOW).map(toMlCandle),
  btcCandles1h: resampleCandles(btcCandles, 60).slice(-CANDLE_WINDOW),
  btcCandles4h: resampleCandles(btcCandles, 240).slice(-CANDLE_WINDOW),
  btcCandles1d: resampleCandles(btcCandles, 1440).slice(-CANDLE_WINDOW),
});

const buildMlTimeframeIndicators = (
  candles: Candle[],
): Record<string, number[]> => {
  const result: Record<string, number[]> = {};

  for (const timeframe of INDICATOR_TIMEFRAMES) {
    const tfCandles = resampleCandles(candles, timeframe.minutes);
    if (tfCandles.length === 0) continue;

    const history = createIndicators(tfCandles).result();
    for (const [key, values] of Object.entries(history)) {
      result[`${key}${timeframe.suffix}`] = values.slice();
    }
  }

  return result;
};

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

  let indicatorsController =
    ENV !== 'BACKTEST' ? null : createIndicators(cachedData);

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
      indicatorsController.next(candle);
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
      );

      indicatorsController.next(cachedData[cachedData.length - 1]);
    }

    const indicatorHistory = indicatorsController.result();
    const timeframeIndicatorHistory = buildMlTimeframeIndicators(
      cachedData as Candle[],
    );

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
        ...timeframeIndicatorHistory,
        ...buildMlCandleIndicators(cachedData as Candle[], btcCachedData as Candle[]),
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
