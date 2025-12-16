import { SMA, ATR, BollingerBands, OBV } from 'technicalindicators';
import { KLineData } from 'klinecharts';
import _ from 'lodash';
import { round } from '@utils/math';
import {
  TechnicalIndicators,
  StrategyConfig,
  Candle,
  KlineChartData,
} from '@types';

export const ATR_PCT = (
  data: KLineData[],
  period: number,
  SMA_SHORT: number,
  SMA_LONG: number,
) => {
  const closes = data.map((x) => x.close);
  const highs = data.map((x) => x.high);
  const lows = data.map((x) => x.low);

  const atrRaw = ATR.calculate({
    period,
    high: highs,
    low: lows,
    close: closes,
  });
  const atrAligned: (number | undefined)[] = Array(period - 1)
    .fill(undefined)
    .concat(atrRaw);

  const atrPctAligned: (number | undefined)[] = atrAligned.map((v, i) => {
    const c = closes[i];
    if (typeof v !== 'number' || !Number.isFinite(v) || !c) return undefined;
    return (v / c) * 100;
  });

  const shortLine = smaAligned(atrPctAligned, SMA_SHORT);
  const longLine = smaAligned(atrPctAligned, SMA_LONG);

  const lastShortLine = shortLine[shortLine.length - 1];
  const lastLongLine = longLine[longLine.length - 1];

  const value =
    typeof lastShortLine === 'number' &&
    Number.isFinite(lastShortLine) &&
    typeof lastLongLine === 'number' &&
    Number.isFinite(lastLongLine)
      ? round(lastShortLine / lastLongLine, 2)
      : 0;

  return { shortLine, longLine, value };
};

export const smaAligned = (values: (number | undefined)[], len: number) => {
  const numeric = values.filter(
    (x): x is number => typeof x === 'number' && Number.isFinite(x),
  );
  const sma = SMA.calculate({ period: len, values: numeric });

  // сколько undefined было до первого числа + (len-1)
  const firstNumIdx = values.findIndex(
    (x) => typeof x === 'number' && Number.isFinite(x),
  );
  const prefix = (firstNumIdx === -1 ? values.length : firstNumIdx) + (len - 1);

  const out: (number | undefined)[] = Array(prefix).fill(undefined).concat(sma);
  if (out.length > values.length) out.length = values.length;
  while (out.length < values.length) out.push(undefined);
  return out;
};

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
