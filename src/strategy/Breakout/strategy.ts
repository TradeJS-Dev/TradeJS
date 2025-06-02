import _ from 'lodash';
import { SMA, ATR, BollingerBands, OBV, RSI } from 'technicalindicators';
import { MOM } from '@src/indicators/mom';
import { config as DEFAULT_CONFIG } from './config';
import { Strategy, StrategyCreator, StrategyConfig, Candle } from '@types';

type IndicatorsContext = {
  smaFast: number;
  smaSlow: number;
  obv: number;
  smaObv: number | undefined;
  price: number;
  bb: { upper: number; lower: number };
  mom: number;
  rsi: number;
  hadSqueeze: boolean;
  highLevel: number;
  lowLevel: number;
};

type WeightKey =
  | 'smaTrend'
  | 'obvTrend'
  | 'bbBreakout'
  | 'momDirection'
  | 'rsiInRange'
  | 'hadSqueeze'
  | 'priceBreakout';

type ConditionResult = {
  score: number;
  conditions: Record<string, boolean>;
};

const calculateLongScore = (
  candle: Candle,
  prevCandle: Candle,
  indicators: IndicatorsContext,
  config: StrategyConfig & typeof DEFAULT_CONFIG,
): ConditionResult => {
  const {
    smaFast,
    smaSlow,
    obv,
    smaObv,
    price,
    bb,
    mom,
    rsi,
    hadSqueeze,
    highLevel,
  } = indicators;
  const weights = config.CONDITION_WEIGHTS;
  let score = 0;

  const conditions: Record<WeightKey, boolean> = {
    smaTrend: smaFast > smaSlow,
    obvTrend: smaObv ? obv > smaObv : true,
    bbBreakout: price > bb.upper,
    momDirection: mom > 0,
    rsiInRange: rsi < config.RSI_CHANNEL[1],
    hadSqueeze: !config.REQUIRE_SQUEEZE_BEFORE_BREAKOUT || hadSqueeze,
    priceBreakout:
      candle.close > prevCandle.close &&
      candle.close > highLevel &&
      prevCandle.high > highLevel,
  };

  for (const [key, passed] of Object.entries(conditions)) {
    if (passed) score += weights[key as WeightKey] ?? 0;
  }

  return { score, conditions };
};

const calculateShortScore = (
  candle: Candle,
  prevCandle: Candle,
  indicators: IndicatorsContext,
  config: StrategyConfig & typeof DEFAULT_CONFIG,
): ConditionResult => {
  const {
    smaFast,
    smaSlow,
    obv,
    smaObv,
    price,
    bb,
    mom,
    rsi,
    hadSqueeze,
    lowLevel,
  } = indicators;
  const weights = config.CONDITION_WEIGHTS;
  let score = 0;

  const conditions: Record<WeightKey, boolean> = {
    smaTrend: smaFast < smaSlow,
    obvTrend: smaObv ? obv < smaObv : true,
    bbBreakout: price < bb.lower,
    momDirection: mom < 0,
    rsiInRange: rsi > config.RSI_CHANNEL[0],
    hadSqueeze: !config.REQUIRE_SQUEEZE_BEFORE_BREAKOUT || hadSqueeze,
    priceBreakout:
      candle.close < prevCandle.close &&
      candle.close < lowLevel &&
      prevCandle.low < lowLevel,
  };

  for (const [key, passed] of Object.entries(conditions)) {
    if (passed) score += weights[key as WeightKey] ?? 0;
  }

  return { score, conditions };
};

export const BreakoutStrategyCreator: StrategyCreator = (baseConfig, data) => {
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

  const rsiInstance = new RSI({ period: config.RSI_PERIOD, values: closes });
  const momInstance = new MOM({ period: config.MOM_PERIOD, values: closes });

  const strategy: Strategy = async (symbol, candle, connector) => {
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
    const rsi = rsiInstance.nextValue(price);
    const mom = momInstance.nextValue(price);

    if (!smaFast || !smaSlow || !atr || !bb || !obv || !rsi || !mom)
      return 'NO_INDICATORS';

    const len = candles.length;
    if (len < config.BREAKOUT_LOOKBACK + 2) return 'WAIT_DATA';

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
          .slice(len - config.BREAKOUT_LOOKBACK - 2, len - 2)
          .map((c) => c.high),
      );
      const lowLevel = Math.min(
        ...candles
          .slice(len - config.BREAKOUT_LOOKBACK - 2, len - 2)
          .map((c) => c.low),
      );

      const prevCandle = candles[len - 2];

      const indicators = {
        smaFast,
        smaSlow,
        obv,
        smaObv,
        price,
        bb,
        mom,
        rsi,
        hadSqueeze,
        highLevel,
        lowLevel,
      };

      const longResult = calculateLongScore(
        candle,
        prevCandle,
        indicators,
        config,
      );
      const shortResult = calculateShortScore(
        candle,
        prevCandle,
        indicators,
        config,
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
    const isLong = position?.direction === 'LONG';
    const isShort = position?.direction === 'SHORT';
    const direction = isLong ? 'LONG' : 'SHORT';

    if ((isLong && smaFast < smaSlow) || (isShort && smaFast > smaSlow)) {
      await connector.closePosition({ symbol, price, timestamp, direction });
      return 'CLOSE_POSITION';
    }

    const trailingStopDistance = atr * config.ATR_CLOSE;

    if (isLong && price < position.price - trailingStopDistance) {
      await connector.closePosition({ symbol, price, timestamp, direction });
      return 'TRAILING_STOP';
    }

    if (isShort && price > position.price + trailingStopDistance) {
      await connector.closePosition({ symbol, price, timestamp, direction });
      return 'TRAILING_STOP';
    }

    return 'POSITION_HELD';
  };

  return strategy;
};
