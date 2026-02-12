import { SMA, ATR, BollingerBands, OBV, MACD } from 'technicalindicators';
import { Candle } from '@types';

const CANDLE_WINDOW = 10;
const BASE_INTERVAL_MINUTES = 15;
const INDICATOR_TIMEFRAMES = [
  { minutes: 60, suffix: '1h' },
  { minutes: 240, suffix: '4h' },
  { minutes: 1440, suffix: '1d' },
] as const;

const INDICATOR_PERIODS = {
  maFast: 14,
  maMedium: 49,
  maSlow: 50,
  obvSma: 10,
  atr: 14,
  atrPctShort: 7,
  atrPctLong: 30,
  bb: 20,
  bbStd: 2,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
};

const ONE_HOUR_MS = 3_600_000;
const ONE_DAY_MS = 86_400_000;

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

export const buildMlCandleIndicators = (
  candles: Candle[],
  btcCandles: Candle[],
) => ({
  candles15m: candles.slice(-CANDLE_WINDOW).map(toMlCandle),
  candles1h: resampleCandles(candles, 60).slice(-CANDLE_WINDOW),
  candles4h: resampleCandles(candles, 240).slice(-CANDLE_WINDOW),
  candles1d: resampleCandles(candles, 1440).slice(-CANDLE_WINDOW),
  btcCandles15m: btcCandles.slice(-CANDLE_WINDOW).map(toMlCandle),
  btcCandles1h: resampleCandles(btcCandles, 60).slice(-CANDLE_WINDOW),
  btcCandles4h: resampleCandles(btcCandles, 240).slice(-CANDLE_WINDOW),
  btcCandles1d: resampleCandles(btcCandles, 1440).slice(-CANDLE_WINDOW),
});

const percentChange = (current: number, previous: number): number | null => {
  if (
    !Number.isFinite(current) ||
    !Number.isFinite(previous) ||
    previous === 0
  ) {
    return null;
  }
  return ((current - previous) / previous) * 100;
};

type IndicatorValue = number | null | undefined;

type TrendlineIndicatorHistoryPush = (
  key: string,
  value: number | null | undefined,
) => void;

type TrendlineIndicators = {
  maFast: IndicatorValue;
  maMedium: IndicatorValue;
  maSlow: IndicatorValue;
  atr: IndicatorValue;
  atrPct: IndicatorValue;
  bbUpper: IndicatorValue;
  bbMiddle: IndicatorValue;
  bbLower: IndicatorValue;
  obv: IndicatorValue;
  smaObv: IndicatorValue;
  macd: IndicatorValue;
  macdSignal: IndicatorValue;
  macdHistogram: IndicatorValue;
  price24hPcnt: IndicatorValue;
  price1hPcnt: IndicatorValue;
  highPrice1h: IndicatorValue;
  lowPrice1h: IndicatorValue;
  volume1h: IndicatorValue;
  highPrice24h: IndicatorValue;
  lowPrice24h: IndicatorValue;
  volume24h: IndicatorValue;
};

type CreateIndicatorsOptions = {
  includeMlPayload?: boolean;
};

export const applyIndicatorsToHistory = (
  indicators: TrendlineIndicators,
  pushIndicator: TrendlineIndicatorHistoryPush,
) => {
  pushIndicator('maFast', indicators.maFast);
  pushIndicator('maMedium', indicators.maMedium);
  pushIndicator('maSlow', indicators.maSlow);
  pushIndicator('atr', indicators.atr);
  pushIndicator('atrPct', indicators.atrPct);
  pushIndicator('bbUpper', indicators.bbUpper);
  pushIndicator('bbMiddle', indicators.bbMiddle);
  pushIndicator('bbLower', indicators.bbLower);
  pushIndicator('obv', indicators.obv);
  pushIndicator('smaObv', indicators.smaObv);
  pushIndicator('macd', indicators.macd);
  pushIndicator('macdSignal', indicators.macdSignal);
  pushIndicator('macdHistogram', indicators.macdHistogram);
  pushIndicator('price24hPcnt', indicators.price24hPcnt ?? undefined);
  pushIndicator('price1hPcnt', indicators.price1hPcnt ?? undefined);
  pushIndicator('highPrice1h', indicators.highPrice1h ?? undefined);
  pushIndicator('lowPrice1h', indicators.lowPrice1h ?? undefined);
  pushIndicator('volume1h', indicators.volume1h ?? undefined);
  pushIndicator('highPrice24h', indicators.highPrice24h ?? undefined);
  pushIndicator('lowPrice24h', indicators.lowPrice24h ?? undefined);
  pushIndicator('volume24h', indicators.volume24h ?? undefined);
};

export const createIndicators = (
  data: Candle[],
  btcData: Candle[] = [],
  options: CreateIndicatorsOptions = {},
) => {
  const includeMlPayload = options.includeMlPayload !== false;
  const closes: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const volumes: number[] = [];
  const timestamps: number[] = [];
  const candlesHistory: Candle[] = [];
  const btcCandlesHistory: Candle[] = [];

  const obv = new OBV({ close: [], volume: [] });
  const smaObv = new SMA({ period: INDICATOR_PERIODS.obvSma, values: [] });
  const ma14 = new SMA({ period: INDICATOR_PERIODS.maFast, values: [] });
  const ma49 = new SMA({ period: INDICATOR_PERIODS.maMedium, values: [] });
  const ma50 = new SMA({ period: INDICATOR_PERIODS.maSlow, values: [] });
  const atr = new ATR({
    period: INDICATOR_PERIODS.atr,
    high: [],
    low: [],
    close: [],
  });
  const atrPctShort = new SMA({
    period: INDICATOR_PERIODS.atrPctShort,
    values: [],
  });
  const atrPctLong = new SMA({
    period: INDICATOR_PERIODS.atrPctLong,
    values: [],
  });
  const bb = new BollingerBands({
    period: INDICATOR_PERIODS.bb,
    values: [],
    stdDev: INDICATOR_PERIODS.bbStd,
  });
  const macd = new MACD({
    fastPeriod: INDICATOR_PERIODS.macdFast,
    slowPeriod: INDICATOR_PERIODS.macdSlow,
    signalPeriod: INDICATOR_PERIODS.macdSignal,
    values: [],
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });

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

  let window1hStart = 0;
  let window24hStart = 0;

  const computeWindow = (
    currentTimestamp: number,
    windowMs: number,
    startIdx: number,
  ) => {
    const windowStart = currentTimestamp - windowMs;
    if (timestamps.length === 0 || timestamps[0] > windowStart) {
      return {
        startIdx,
        high: null,
        low: null,
        volume: null,
        startClose: null,
        hasFullWindow: false,
      };
    }
    let idx = startIdx;
    while (idx < timestamps.length && timestamps[idx] < windowStart) {
      idx += 1;
    }
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    for (let i = idx; i < highs.length; i += 1) {
      const highValue = highs[i];
      const lowValue = lows[i];
      const volumeValue = volumes[i];
      if (highValue > high) high = highValue;
      if (lowValue < low) low = lowValue;
      volume += volumeValue;
    }
    return {
      startIdx: idx,
      high,
      low,
      volume,
      startClose: closes[idx],
      hasFullWindow: true,
    };
  };

  const findNearestStartClose = (
    currentTimestamp: number,
    windowMs: number,
  ) => {
    if (timestamps.length === 0) {
      return { startClose: null, startIdx: 0 };
    }
    const windowStart = currentTimestamp - windowMs;
    let idx = 0;
    while (idx < timestamps.length && timestamps[idx] < windowStart) {
      idx += 1;
    }
    if (idx <= 0) {
      return { startClose: closes[0], startIdx: 0 };
    }
    if (idx >= timestamps.length) {
      const lastIdx = timestamps.length - 1;
      return { startClose: closes[lastIdx], startIdx: lastIdx };
    }
    const prevIdx = idx - 1;
    const currentIdx = timestamps.length - 1;
    // For coarse timeframes (e.g. 4h/1d), prevent anchoring to the current bar
    // when the target window is shorter than a single candle.
    if (idx === currentIdx && timestamps[idx] > windowStart) {
      return { startClose: closes[prevIdx], startIdx: prevIdx };
    }
    const prevDiff = windowStart - timestamps[prevIdx];
    const nextDiff = timestamps[idx] - windowStart;
    const chosenIdx = prevDiff <= nextDiff ? prevIdx : idx;
    return { startClose: closes[chosenIdx], startIdx: chosenIdx };
  };

  const next = (candle: Candle, btcCandle?: Candle) => {
    candlesHistory.push(candle);
    if (btcCandle) {
      btcCandlesHistory.push(btcCandle);
    }

    closes.push(candle.close);
    highs.push(candle.high);
    lows.push(candle.low);
    volumes.push(candle.volume);
    timestamps.push(candle.timestamp);

    const ma14Value = ma14.nextValue(candle.close);
    const ma49Value = ma49.nextValue(candle.close);
    const ma50Value = ma50.nextValue(candle.close);
    const atrValue = atr.nextValue(candle);
    const atrPctValue =
      atrValue != null && Number.isFinite(atrValue) && candle.close
        ? (atrValue / candle.close) * 100
        : null;
    const atrPctShortValue =
      atrPctValue == null ? null : atrPctShort.nextValue(atrPctValue);
    const atrPctLongValue =
      atrPctValue == null ? null : atrPctLong.nextValue(atrPctValue);
    const atrPctRatio =
      typeof atrPctShortValue === 'number' &&
      Number.isFinite(atrPctShortValue) &&
      typeof atrPctLongValue === 'number' &&
      Number.isFinite(atrPctLongValue) &&
      atrPctLongValue !== 0
        ? atrPctShortValue / atrPctLongValue
        : null;
    const bbValue = bb.nextValue(candle.close);
    const obvValue = obv.nextValue(candle);
    const smaObvValue = obvValue == null ? null : smaObv.nextValue(obvValue);
    const macdValue = macd.nextValue(candle.close);

    if (
      ma14Value == null ||
      ma49Value == null ||
      ma50Value == null ||
      atrValue == null ||
      !bbValue ||
      obvValue == null ||
      smaObvValue == null ||
      !macdValue
    ) {
      return null;
    }

    const currentTimestamp = candle.timestamp;
    const window1h = computeWindow(
      currentTimestamp,
      ONE_HOUR_MS,
      window1hStart,
    );
    window1hStart = window1h.startIdx;
    const window24h = computeWindow(
      currentTimestamp,
      ONE_DAY_MS,
      window24hStart,
    );
    window24hStart = window24h.startIdx;

    const price1hStart = findNearestStartClose(currentTimestamp, ONE_HOUR_MS);
    const price24hStart = findNearestStartClose(currentTimestamp, ONE_DAY_MS);
    const price1hPcntRaw =
      price1hStart.startClose != null
        ? percentChange(candle.close, price1hStart.startClose)
        : null;
    const price24hPcntRaw =
      price24hStart.startClose != null
        ? percentChange(candle.close, price24hStart.startClose)
        : null;
    const price1hPcnt = price1hPcntRaw ?? 0;
    const price24hPcnt = price24hPcntRaw ?? 0;

    const highPrice1h = window1h.hasFullWindow ? window1h.high : null;
    const lowPrice1h = window1h.hasFullWindow ? window1h.low : null;
    const volume1h = window1h.hasFullWindow ? window1h.volume : null;
    const highPrice24h = window24h.hasFullWindow ? window24h.high : null;
    const lowPrice24h = window24h.hasFullWindow ? window24h.low : null;
    const volume24h = window24h.hasFullWindow ? window24h.volume : null;

    const result = {
      maFast: ma14Value,
      maMedium: ma49Value,
      maSlow: ma50Value,
      atr: atrValue,
      atrPct: atrPctRatio,
      bbUpper: bbValue.upper,
      bbMiddle: bbValue.middle,
      bbLower: bbValue.lower,
      obv: obvValue,
      smaObv: smaObvValue,
      macd: macdValue.MACD,
      macdSignal: macdValue.signal,
      macdHistogram: macdValue.histogram,
      price24hPcnt,
      price1hPcnt,
      highPrice1h,
      lowPrice1h,
      volume1h,
      highPrice24h,
      lowPrice24h,
      volume24h,
    };

    applyIndicatorsToHistory(result, pushIndicator);

    return result;
  };

  data.forEach((candle, index) => {
    next(candle, btcData[index]);
  });

  return {
    next,
    result: () => {
      if (!includeMlPayload) {
        return indicatorHistory;
      }

      return {
        ...indicatorHistory,
        ...buildMlTimeframeIndicators(candlesHistory),
        ...buildMlCandleIndicators(candlesHistory, btcCandlesHistory),
      };
    },
  };
};

export const buildMlTimeframeIndicators = (
  candles: Candle[],
): Record<string, number[]> => {
  const result: Record<string, number[]> = {};

  for (const timeframe of INDICATOR_TIMEFRAMES) {
    const tfCandles = resampleCandles(candles, timeframe.minutes);
    if (tfCandles.length === 0) continue;

    const history = createIndicators(tfCandles, [], {
      includeMlPayload: false,
    }).result();
    for (const [key, values] of Object.entries(history)) {
      result[`${key}${timeframe.suffix}`] = values.slice();
    }
  }

  return result;
};
