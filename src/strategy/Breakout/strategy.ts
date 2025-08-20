import _ from 'lodash';
import { SMA, ATR, BollingerBands, OBV } from 'technicalindicators';
import { config as DEFAULT_CONFIG } from './config';
import { Strategy, StrategyCreator, StrategyConfig, Candle } from '@types';

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

    if (!smaFast || !smaSlow || !atr || !bb || !obv) return 'NO_INDICATORS';

    const smaObv = smaOBVInstance.nextValue(obv);
    const obvGrowing = smaObv ? obv > smaObv : true;
    const obvFalling = smaObv ? obv < smaObv : true;

    const atrThreshold = atr * config.ATR_OPEN;
    const isVolatile =
      Math.abs(closes[closes.length - 1] - closes[closes.length - 2]) >
      atrThreshold;

    const qty = config.LIMIT / price;

    const len = candles.length;
    if (len < config.BREAKOUT_LOOKBACK + 2) return 'WAIT_DATA';

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

    const priceBreaksUpperBB = bb && candle.close > bb.upper;
    const priceBreaksLowerBB = bb && candle.close < bb.lower;

    const breakoutUp =
      prevCandle.high > highLevel &&
      smaFast > smaSlow &&
      obvGrowing &&
      candle.close > prevCandle.close &&
      candle.close > highLevel &&
      priceBreaksUpperBB;

    const breakoutDown =
      prevCandle.low < lowLevel &&
      smaFast < smaSlow &&
      obvFalling &&
      candle.close < prevCandle.close &&
      candle.close < lowLevel &&
      priceBreaksLowerBB;

    if (!positionExists) {
      if (breakoutUp && isVolatile) {
        await connector.placeOrder(
          { symbol, qty, price, timestamp, direction: 'LONG' },
          config.TP_LONG,
          config.SL_LONG,
        );
        return 'OPEN_LONG';
      }

      if (breakoutDown && isVolatile) {
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
