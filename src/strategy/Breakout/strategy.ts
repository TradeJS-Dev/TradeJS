import _ from 'lodash';
import { config as DEFAULT_CONFIG } from './config';
import { Candle, StrategyCreator, StrategyConfig } from '@types';
import {
  createIndicators,
  IndicatorPeriods,
  IndicatorSnapshot,
} from '@utils/indicators';

interface SignalConfig {
  weight: number;
  required?: boolean;
}

type SignalsConfig = { [K in Signal]?: SignalConfig };

type Signals = Record<Signal, boolean>;

export enum Signal {
  VOLATILE = 'VOLATILE',
  SMA_UPTREND = 'SMA_UPTREND',
  SMA_DOWNTREND = 'SMA_DOWNTREND',
  OBV_ABOVE_SMA = 'OBV_ABOVE_SMA',
  OBV_BELOW_SMA = 'OBV_BELOW_SMA',
  PREV_HIGH_BREAKOUT = 'PREV_HIGH_BREAKOUT',
  CLOSE_ABOVE_UPPER_BB = 'CLOSE_ABOVE_UPPER_BB',
  CLOSE_ABOVE_HIGH_LEVEL = 'CLOSE_ABOVE_HIGH_LEVEL',
  CLOSE_ABOVE_PREV_CLOSE = 'CLOSE_ABOVE_PREV_CLOSE',
  PREV_LOW_BREAKDOWN = 'PREV_LOW_BREAKDOWN',
  CLOSE_BELOW_LOWER_BB = 'CLOSE_BELOW_LOWER_BB',
  CLOSE_BELOW_LOW_LEVEL = 'CLOSE_BELOW_LOW_LEVEL',
  CLOSE_BELOW_PREV_CLOSE = 'CLOSE_BELOW_PREV_CLOSE',
}

type BreakoutSignalIndicators = Omit<
  IndicatorSnapshot,
  'prevCandle' | 'highLevel' | 'lowLevel'
> & {
  prevCandle: Candle;
  highLevel: number;
  lowLevel: number;
  bb: { upper: number; lower: number };
};

const getSignals = (
  config: StrategyConfig,
  indicators: BreakoutSignalIndicators,
): Signals => {
  const {
    candle,
    prevCandle,
    highLevel,
    lowLevel,
    maFast,
    maSlow,
    smaObv,
    obv,
    bb,
    atr,
  } = indicators;

  const obvAboveSma = obv > smaObv;
  const obvBelowSma = obv < smaObv;

  const smaUptrend = maFast > maSlow;
  const smaDowntrend = maFast < maSlow;

  const prevHighBreakout = prevCandle.high > highLevel;
  const closeAboveUpperBB = candle.close > bb.upper;
  const closeAboveHighLevel = candle.close > highLevel;
  const closeAbovePrevClose = candle.close > prevCandle.close;

  const prevLowBreakdown = prevCandle.low < lowLevel;
  const closeBelowLowerBB = candle.close < bb.lower;
  const closeBelowLowLevel = candle.close < lowLevel;
  const closeBelowPrevClose = candle.close < prevCandle.close;

  const atrThreshold = atr * config.ATR_OPEN;

  const trueRange = Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - prevCandle.close),
    Math.abs(candle.low - prevCandle.close),
  );

  const isVolatile = trueRange > atrThreshold;

  return {
    [Signal.VOLATILE]: isVolatile,
    [Signal.SMA_UPTREND]: smaUptrend,
    [Signal.SMA_DOWNTREND]: smaDowntrend,
    [Signal.OBV_ABOVE_SMA]: obvAboveSma,
    [Signal.OBV_BELOW_SMA]: obvBelowSma,
    [Signal.PREV_HIGH_BREAKOUT]: prevHighBreakout,
    [Signal.CLOSE_ABOVE_UPPER_BB]: closeAboveUpperBB,
    [Signal.CLOSE_ABOVE_HIGH_LEVEL]: closeAboveHighLevel,
    [Signal.CLOSE_ABOVE_PREV_CLOSE]: closeAbovePrevClose,
    [Signal.PREV_LOW_BREAKDOWN]: prevLowBreakdown,
    [Signal.CLOSE_BELOW_LOWER_BB]: closeBelowLowerBB,
    [Signal.CLOSE_BELOW_LOW_LEVEL]: closeBelowLowLevel,
    [Signal.CLOSE_BELOW_PREV_CLOSE]: closeBelowPrevClose,
  };
};

const checkSignals = (
  config: SignalsConfig,
  minScore: number,
  signals: Signals,
) => {
  let score = 0;

  for (const [signal, rules] of Object.entries(config)) {
    if (rules.required && !signals[signal as Signal]) {
      return false;
    }

    if (signals[signal as Signal]) {
      score += rules.weight;
    }
  }

  return score >= minScore;
};

export const BreakoutStrategyCreator: StrategyCreator = async ({
  userName,
  config: baseConfig,
  symbol,
  data,
  connector,
}) => {
  const config = {
    ...DEFAULT_CONFIG,
    ...baseConfig,
  } as StrategyConfig & typeof DEFAULT_CONFIG;

  const indicatorPeriods: Partial<IndicatorPeriods> = {
    maFast: config.MA_FAST,
    maMedium: config.MA_MEDIUM,
    maSlow: config.MA_SLOW,
    obvSma: config.OBV_SMA,
    atr: config.ATR,
    atrPctShort: config.ATR_PCT_SHORT,
    atrPctLong: config.ATR_PCT_LONG,
    bb: config.BB,
    bbStd: config.BB_STD,
    macdFast: config.MACD_FAST,
    macdSlow: config.MACD_SLOW,
    macdSignal: config.MACD_SIGNAL,
    levelLookback: config.LEVEL_LOOKBACK,
    levelDelay: config.LEVEL_DELAY,
  };

  const indicatorsController = createIndicators(data, [], {
    periods: indicatorPeriods,
  });

  return async (candle) => {
    if (_.isEmpty(candle)) return 'NO_DATA';

    const indicatorValues = indicatorsController.next(candle);
    if (!indicatorValues) {
      return 'NO_INDICATORS';
    }

    if (
      !indicatorValues.prevCandle ||
      indicatorValues.highLevel == null ||
      indicatorValues.lowLevel == null
    ) {
      return 'WAIT_DATA';
    }

    const { close: price, timestamp } = candle;

    const position = await connector.getPosition(symbol);
    const positionExists = !_.isEmpty(position) && position.qty > 0;

    const qty = config.LIMIT / price;

    const signals = getSignals(config, {
      ...indicatorValues,
      prevCandle: indicatorValues.prevCandle,
      highLevel: indicatorValues.highLevel,
      lowLevel: indicatorValues.lowLevel,
      bb: {
        upper: indicatorValues.bbUpper,
        lower: indicatorValues.bbLower,
      },
    });

    const shouldOpenLong = checkSignals(
      config.SIGNALS_LONG,
      config.REQUIRED_SCORE_LONG,
      signals,
    );
    const shouldOpenShort = checkSignals(
      config.SIGNALS_SHORT,
      config.REQUIRED_SCORE_SHORT,
      signals,
    );

    if (!positionExists) {
      const slPrice = shouldOpenLong
        ? price * (1 - config.SL_LONG)
        : price * (1 + config.SL_SHORT);

      if (shouldOpenLong) {
        await connector.placeOrder(
          { symbol, qty, price, timestamp, direction: 'LONG' },
          config.TP_LONG.map(({ rate, profit }) => ({
            rate,
            price: price * (1 + profit),
          })),
          slPrice,
        );
        return 'OPEN_LONG';
      }

      if (shouldOpenShort) {
        await connector.placeOrder(
          { symbol, qty, price, timestamp, direction: 'SHORT' },
          config.TP_SHORT.map(({ rate, profit }) => ({
            rate,
            price: price * (1 - profit),
          })),
          slPrice,
        );
        return 'OPEN_SHORT';
      }

      return 'NO_SIGNAL';
    }

    // Закрытие по развороту тренда или трейлинг-стопу (как раньше)
    const isLong = position.direction === 'LONG';
    const isShort = position.direction === 'SHORT';
    const direction = isLong ? 'LONG' : 'SHORT';

    if ((isLong && shouldOpenShort) || (isShort && shouldOpenLong)) {
      await connector.closePosition({ symbol, price, timestamp, direction });
      return 'CLOSE_POSITION_BY_OPEN_SIGNAL';
    }

    if ((isLong && signals.SMA_DOWNTREND) || (isShort && signals.SMA_UPTREND)) {
      await connector.closePosition({ symbol, price, timestamp, direction });
      return 'CLOSE_POSITION_BY_SMA';
    }

    // const trailingStopDistance = indicators.atr * config.ATR_CLOSE;

    // if (isLong && price < position.price - trailingStopDistance) {
    //   await connector.closePosition({ symbol, price, timestamp, direction });
    //   return 'TRAILING_STOP';
    // }

    // if (isShort && price > position.price + trailingStopDistance) {
    //   await connector.closePosition({ symbol, price, timestamp, direction });
    //   return 'TRAILING_STOP';
    // }

    return 'POSITION_HELD';
  };
};
