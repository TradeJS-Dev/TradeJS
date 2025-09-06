import { SMA, ATR, BollingerBands, OBV } from 'technicalindicators';
import _ from 'lodash';
import {
  TechnicalIndicators,
  StrategyConfig,
  Candle,
  KlineChartData,
} from '@types';

export const createIndicators = (
  config: StrategyConfig,
  data: KlineChartData,
): ((candle: Candle) => TechnicalIndicators | string) => {
  const MAX_WINDOW =
    Math.max(
      config.MA_SLOW,
      config.BB_PERIOD,
      config.OBV_SMA_PERIOD,
      config.BREAKOUT_LOOKBACK,
    ) + 5;

  const trim = (arr: unknown[]) => {
    if (arr.length > MAX_WINDOW) arr.splice(0, arr.length - MAX_WINDOW);
  };

  const closes: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const volumes: number[] = [];
  const candles: Candle[] = [];

  const obvInstance = new OBV({ close: [], volume: [] });

  const smaOBVInstance = new SMA({ period: config.OBV_SMA_PERIOD, values: [] });

  data.forEach((item) => {
    closes.push(item.close);
    highs.push(item.high);
    lows.push(item.low);
    volumes.push(item.volume);
    candles.push(item);

    const obv = obvInstance.nextValue(item);

    if (obv) {
      smaOBVInstance.nextValue(obv);
    }
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

  return (candle: Candle) => {
    if (_.isEmpty(candle)) return 'NO_DATA';

    candles.push(candle);
    closes.push(candle.close);
    highs.push(candle.high);
    lows.push(candle.low);
    volumes.push(candle.volume);

    // trim(closes);
    // trim(highs);
    // trim(lows);
    // trim(volumes);
    // trim(candles);

    const price = candle.close;

    const smaFast = smaFastInstance.nextValue(price);
    const smaSlow = smaSlowInstance.nextValue(price);
    const atr = atrInstance.nextValue(candle);
    const bb = bbInstance.nextValue(price);
    const obv = obvInstance.nextValue(candle);

    if (!smaFast || !smaSlow || !atr || !bb || !obv) return 'NO_INDICATORS';

    const smaObv = smaOBVInstance.nextValue(obv);

    if (!smaObv) {
      return 'NO_INDICATORS';
    }

    const len = candles.length;
    if (len < config.BREAKOUT_LOOKBACK + config.BREAKOUT_LOOKBACK_DELAY)
      return 'WAIT_DATA';

    const highLevel = Math.max(
      ...candles
        .slice(
          len - config.BREAKOUT_LOOKBACK - config.BREAKOUT_LOOKBACK_DELAY,
          len - config.BREAKOUT_LOOKBACK_DELAY,
        )
        .map((c) => c.high),
    );
    const lowLevel = Math.min(
      ...candles
        .slice(
          len - config.BREAKOUT_LOOKBACK - config.BREAKOUT_LOOKBACK_DELAY,
          len - config.BREAKOUT_LOOKBACK_DELAY,
        )
        .map((c) => c.low),
    );

    const prevCandle = candles[len - 2];

    return {
      closes,
      candle,
      prevCandle,
      highLevel,
      lowLevel,
      smaFast,
      smaSlow,
      smaObv,
      obv,
      bb,
      atr,
    };
  };
};
