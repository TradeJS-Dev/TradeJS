import _ from 'lodash';
import { SMA, ATR, BollingerBands, OBV } from 'technicalindicators';
import { MOM } from '@src/indicators/mom';
import { config as DEFAULT_CONFIG } from './config';
import { Strategy, StrategyCreator, StrategyConfig, Candle } from '@types';
import { IndicatorsContext, WeightKey, ConditionResult } from './types';

const calculateScore = (
  candle: Candle,
  prevCandle: Candle,
  indicators: IndicatorsContext,
  config: StrategyConfig & typeof DEFAULT_CONFIG,
  isLong: boolean,
): ConditionResult => {
  const {
    smaFast,
    smaSlow,
    obv,
    smaObv,
    price,
    bb,
    mom,
    hadSqueeze,
    highLevel,
    lowLevel,
  } = indicators;

  const weights = config.CONDITION_WEIGHTS;
  const scoreConditions: Record<WeightKey, boolean> = {
    smaTrend: isLong ? smaFast > smaSlow : smaFast < smaSlow,
    obvTrend: smaObv ? (isLong ? obv > smaObv : obv < smaObv) : true,
    bbBreakout: isLong ? price > bb.upper : price < bb.lower,
    momDirection: isLong ? mom > 0 : mom < 0,
    hadSqueeze: !config.REQUIRE_SQUEEZE_BEFORE_BREAKOUT || hadSqueeze,
    priceBreakout: isLong
      ? candle.close > prevCandle.close &&
        candle.close > highLevel &&
        prevCandle.high > highLevel
      : candle.close < prevCandle.close &&
        candle.close < lowLevel &&
        prevCandle.low < lowLevel,
  };

  const score = Object.entries(scoreConditions).reduce(
    (acc, [key, passed]) =>
      passed ? acc + (weights[key as WeightKey] ?? 0) : acc,
    0,
  );

  return { score, conditions: scoreConditions };
};

export const BreakoutWeightsStrategyCreator: StrategyCreator = ({
  config: baseConfig,
  symbol,
  data,
  connector,
}) => {
  const config = {
    ...DEFAULT_CONFIG,
    ...baseConfig,
  } as StrategyConfig & typeof DEFAULT_CONFIG;

  const closes: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const volumes: number[] = [];
  const candles: Candle[] = [];
  const squeezeHistory: boolean[] = [];

  data.forEach((item) => {
    closes.push(item.close);
    highs.push(item.high);
    lows.push(item.low);
    volumes.push(item.volume);
    candles.push(item);
  });

  const smaFastInstance = new SMA({ period: config.MA_FAST, values: closes });
  const smaSlowInstance = new SMA({ period: config.MA_SLOW, values: closes });
  const atrInstance = new ATR({
    period: config.ATR_PERIOD,
    high: highs,
    low: lows,
    close: closes,
  });
  const bbInstance = new BollingerBands({
    period: config.BB_PERIOD,
    values: closes,
    stdDev: config.BB_STDDEV,
  });
  const obvInstance = new OBV({ close: closes, volume: volumes });

  const smaOBVInstance = new SMA({ period: config.OBV_SMA_PERIOD, values: [] });

  const momInstance = new MOM({ period: config.MOM_PERIOD, values: closes });

  const strategy: Strategy = async (candle) => {
    if (_.isEmpty(candle)) return 'NO_DATA';

    candles.push(candle);
    closes.push(candle.close);
    highs.push(candle.high);
    lows.push(candle.low);
    volumes.push(candle.volume);

    const price = candle.close;
    const { timestamp } = candle;

    const position = await connector.getPosition(symbol);
    const positionExists = !_.isEmpty(position) && position.qty >= 0;

    const smaFast = smaFastInstance.nextValue(price);
    const smaSlow = smaSlowInstance.nextValue(price);
    const atr = atrInstance.nextValue(candle);
    const bb = bbInstance.nextValue(price);
    const obv = obvInstance.nextValue(candle);
    const mom = momInstance.nextValue(price);

    if (!smaFast || !smaSlow || !atr || !bb || !obv || !mom)
      return 'NO_INDICATORS';

    const candlesCount = candles.length;
    if (candlesCount < config.BREAKOUT_LOOKBACK + 2) return 'WAIT_DATA';

    if (!positionExists) {
      const smaObv = smaOBVInstance.nextValue(obv);

      const bbWidth = bb.upper - bb.lower;
      const squeezeThreshold = atr * config.BB_SQUEEZE_THRESHOLD;
      const isCurrentSqueeze = bbWidth < squeezeThreshold;

      squeezeHistory.push(isCurrentSqueeze);
      if (squeezeHistory.length > config.BB_SQUEEZE_LOOKBACK + 1) {
        squeezeHistory.shift();
      }

      const hadSqueeze = squeezeHistory
        .slice(-config.BB_SQUEEZE_LOOKBACK)
        .some((s) => s);

      const atrThreshold = atr * config.ATR_OPEN;
      const isVolatile =
        Math.abs(closes[closes.length - 1] - closes[closes.length - 2]) >
        atrThreshold;

      const qty = config.LIMIT / price;

      const highLevel = Math.max(
        ...candles
          .slice(candlesCount - config.BREAKOUT_LOOKBACK - 2, candlesCount - 2)
          .map((c) => c.high),
      );
      const lowLevel = Math.min(
        ...candles
          .slice(candlesCount - config.BREAKOUT_LOOKBACK - 2, candlesCount - 2)
          .map((c) => c.low),
      );

      const prevCandle = candles[candlesCount - 2];

      const indicators = {
        smaFast,
        smaSlow,
        obv,
        smaObv,
        price,
        bb,
        mom,
        hadSqueeze,
        highLevel,
        lowLevel,
      };

      const longResult = calculateScore(
        candle,
        prevCandle,
        indicators,
        config,
        true,
      );
      const shortResult = calculateScore(
        candle,
        prevCandle,
        indicators,
        config,
        false,
      );

      const breakoutUp =
        isVolatile && longResult.score >= config.REQUIRED_SCORE_LONG;
      const breakoutDown =
        isVolatile && shortResult.score >= config.REQUIRED_SCORE_SHORT;

      if (breakoutUp) {
        await connector.placeOrder(
          { symbol, qty, price, timestamp, direction: 'LONG' },
          config.TP_LONG,
          config.SL_LONG,
        );
        return 'OPEN_LONG';
      }

      if (breakoutDown) {
        await connector.placeOrder(
          { symbol, qty, price, timestamp, direction: 'SHORT' },
          config.TP_SHORT,
          config.SL_SHORT,
        );
        return 'OPEN_SHORT';
      }

      return 'NO_SIGNAL';
    }

    // Закрытие по развороту тренда или трейлинг-стопу (как раньше)
    const isLong = position.direction === 'LONG';
    const isShort = position.direction === 'SHORT';

    if ((isLong && smaFast < smaSlow) || (isShort && smaFast > smaSlow)) {
      await connector.closePosition({
        symbol,
        price,
        timestamp,
        direction: position.direction,
      });
      return 'CLOSE_POSITION';
    }

    const trailingStopDistance = atr * config.ATR_CLOSE;

    if (isLong && price < position.price - trailingStopDistance) {
      await connector.closePosition({
        symbol,
        price,
        timestamp,
        direction: position.direction,
      });
      return 'TRAILING_STOP';
    }

    if (isShort && price > position.price + trailingStopDistance) {
      await connector.closePosition({
        symbol,
        price,
        timestamp,
        direction: position.direction,
      });
      return 'TRAILING_STOP';
    }

    return 'POSITION_HELD';
  };

  return strategy;
};
