import { ML_CANDLE_FEATURE_WINDOW } from '@constants';

// Builds a flat numeric feature row for ML training from a Signal + context.
// The output is a fixed schema with derived indicator series, candle features,
// BTC-relative features, trendline geometry, and strategy config params.
type MlSignalRecord = {
  signal: any;
  context?: {
    strategyConfig?: any;
    strategyName?: string;
    symbol?: string;
    entryTimestamp?: number;
  };
};

// Result record from Redis (label/profit).
type MlResultRecord = {
  profit?: number;
  direction?: 'LONG' | 'SHORT';
  symbol?: string;
};

// Fixed windows for features.
const CANDLE_WINDOW = ML_CANDLE_FEATURE_WINDOW;
const INDICATOR_WINDOW = 10;
const CANDLE_TIMEFRAMES = [
  { label: 'TF15M', key: 'candles15m', btcKey: 'btcCandles15m' },
  { label: 'TF1H', key: 'candles1h', btcKey: 'btcCandles1h' },
  { label: 'TF4H', key: 'candles4h', btcKey: 'btcCandles4h' },
  { label: 'TF1D', key: 'candles1d', btcKey: 'btcCandles1d' },
] as const;
const INDICATOR_TIMEFRAMES = [
  { label: 'TF15M', suffix: '' },
  { label: 'TF1H', suffix: '1h' },
  { label: 'TF4H', suffix: '4h' },
  { label: 'TF1D', suffix: '1d' },
] as const;
type CandleTimeframeLabel = (typeof CANDLE_TIMEFRAMES)[number]['label'];
type IndicatorTimeframe = (typeof INDICATOR_TIMEFRAMES)[number];
type CandleLike = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
};

// Defensive numeric helpers.
const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const safeDiv = (num: number, denom: number): number => {
  if (!Number.isFinite(num) || !Number.isFinite(denom) || denom === 0) {
    return 0;
  }
  return num / denom;
};

// Signed log(1 + |x|) keeps information for series that can be negative (e.g. OBV).
const safeLog1p = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value === 0) {
    return 0;
  }
  return Math.sign(value) * Math.log1p(Math.abs(value));
};

const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const safeLog1pPositive = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.log1p(value);
};

const squash = (value: number, scale: number): number => {
  if (!Number.isFinite(value) || !Number.isFinite(scale) || scale <= 0) {
    return 0;
  }
  return Math.tanh(value / scale);
};

const normalizeSymbol = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim().toUpperCase();
};

// Basic stats for return windows.
const computeMedian = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
};

const computeMean = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
};

// Population std/ skew / kurtosis.
const computeStd = (values: number[]): number => {
  if (values.length === 0) return 0;
  const mean = computeMean(values);
  const variance =
    values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};

const computeSkew = (values: number[]): number => {
  if (values.length === 0) return 0;
  const mean = computeMean(values);
  const std = computeStd(values);
  if (std === 0) return 0;
  const m3 =
    values.reduce((acc, value) => acc + (value - mean) ** 3, 0) / values.length;
  return m3 / std ** 3;
};

const computeKurtosis = (values: number[]): number => {
  if (values.length === 0) return 0;
  const mean = computeMean(values);
  const std = computeStd(values);
  if (std === 0) return 0;
  const m4 =
    values.reduce((acc, value) => acc + (value - mean) ** 4, 0) / values.length;
  return m4 / std ** 4;
};

const percentileRank = (values: number[], target: number): number => {
  if (!values.length || !Number.isFinite(target)) return 0.5;
  let less = 0;
  let equal = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < target) less += 1;
    else if (value === target) equal += 1;
  }
  const n = values.length;
  if (n === 0) return 0.5;
  return clamp((less + equal * 0.5) / n, 0, 1);
};

const standardizeSeries = (values: number[]): number[] => {
  if (!values.length) return [];
  const valuesMean = computeMean(values);
  const valuesStd = computeStd(values);
  if (valuesStd === 0) {
    return values.map(() => 0);
  }
  return values.map((value) => (value - valuesMean) / valuesStd);
};

const backwardReturns = (values: number[]): number[] => {
  if (values.length < 2) return [];
  const result: number[] = [];
  for (let i = values.length - 1; i >= 1; i -= 1) {
    // Guard against division by values close to zero that create huge spikes.
    result.push(clamp(safeDiv(values[i], values[i - 1]) - 1, -5, 5));
  }
  return result;
};

const assignBackwardReturns = (
  row: Record<string, number | string | null>,
  prefix: string,
  returnsNewestFirst: number[],
) => {
  const returnsOldestFirst = [...returnsNewestFirst].reverse();
  for (let i = 0; i < returnsOldestFirst.length; i += 1) {
    row[`${prefix}_${i + 2}`] = clamp(returnsOldestFirst[i], -5, 5);
  }
};

// Slice an inclusive window ending at endIndex.
const sliceWindow = (
  values: number[],
  endIndex: number,
  windowSize: number,
): number[] => {
  if (values.length === 0) return [];
  const start = Math.max(0, endIndex - windowSize + 1);
  return values.slice(start, endIndex + 1);
};

// Normalize any "maybe series" value into an array.
const asArray = (value: unknown): any[] => (Array.isArray(value) ? value : []);

// Convert to numeric series; accepts arrays or scalars.
const normalizeSeries = (value: unknown): number[] => {
  if (Array.isArray(value)) {
    return value.map((item) => toNumber(item, 0));
  }
  if (typeof value === 'number') {
    return [toNumber(value, 0)];
  }
  return [];
};

// Pad or trim series to INDICATOR_WINDOW.
const padSeries = (values: number[]): number[] => {
  if (values.length >= INDICATOR_WINDOW) {
    return values.slice(-INDICATOR_WINDOW);
  }
  const fill = values.length ? values[0] : 0;
  const missing = INDICATOR_WINDOW - values.length;
  return Array.from({ length: missing }, () => fill).concat(values);
};

const normalizeCandles = (value: unknown): CandleLike[] => {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((item) => ({
      open: toNumber((item as Record<string, unknown>)?.open, 0),
      high: toNumber((item as Record<string, unknown>)?.high, 0),
      low: toNumber((item as Record<string, unknown>)?.low, 0),
      close: toNumber((item as Record<string, unknown>)?.close, 0),
      volume: toNumber((item as Record<string, unknown>)?.volume, 0),
      timestamp: toNumber((item as Record<string, unknown>)?.timestamp, 0),
    }))
    .filter((candle) => candle.timestamp > 0);
  normalized.sort((a, b) => a.timestamp - b.timestamp);
  return normalized;
};

const addCandleFeatures = (
  row: Record<string, number | string | null>,
  params: {
    featurePrefix?: CandleTimeframeLabel;
    candles: CandleLike[];
    btcCandles: CandleLike[];
    currentPrice: number;
    priceScaleSeries: number[];
  },
) => {
  const {
    featurePrefix = '',
    candles,
    btcCandles,
    currentPrice,
    priceScaleSeries,
  } = params;
  const key = (name: string) =>
    featurePrefix ? `${featurePrefix}_${name}` : name;
  const candleVolumes = candles.map((candle) => candle.volume);
  const btcVolumes = btcCandles.map((candle) => candle.volume);
  const altReturns: number[] = [];
  const btcReturns: number[] = [];
  const relReturns: number[] = [];
  const candleBodyRaw: number[] = [];
  const altToBtcOpenRaw: number[] = [];
  const altToBtcCloseRaw: number[] = [];
  const altToBtcHighRaw: number[] = [];
  const altToBtcLowRaw: number[] = [];

  const lastAltClose = toNumber(candles[candles.length - 1]?.close, 0);
  const lastBtcClose = toNumber(btcCandles[btcCandles.length - 1]?.close, 0);
  const btcPrice = lastBtcClose;

  for (let i = 0; i < CANDLE_WINDOW; i += 1) {
    const candle = candles[i] ?? {};
    const btcCandle = btcCandles[i] ?? {};

    const altOpenRaw = toNumber(candle?.open, 0);
    const altCloseRaw = toNumber(candle?.close, 0);
    const altHighRaw = toNumber(candle?.high, 0);
    const altLowRaw = toNumber(candle?.low, 0);
    const btcOpenRaw = toNumber(btcCandle?.open, 0);
    const btcCloseRaw = toNumber(btcCandle?.close, 0);
    const btcHighRaw = toNumber(btcCandle?.high, 0);
    const btcLowRaw = toNumber(btcCandle?.low, 0);
    const altRet = safeDiv(altCloseRaw, altOpenRaw);
    const btcRet = safeDiv(btcCloseRaw, btcOpenRaw);
    row[key(`AltRet_${i + 1}`)] = altRet;
    row[key(`BtcRet_${i + 1}`)] = btcRet;
    row[key(`RelRet_${i + 1}`)] = altRet - btcRet;
    altReturns.push(altRet);
    btcReturns.push(btcRet);
    relReturns.push(altRet - btcRet);

    const altToBtcOpen = safeDiv(altOpenRaw, btcOpenRaw);
    const altToBtcClose = safeDiv(altCloseRaw, btcCloseRaw);
    const altToBtcHigh = safeDiv(altHighRaw, btcHighRaw);
    const altToBtcLow = safeDiv(altLowRaw, btcLowRaw);
    altToBtcOpenRaw.push(altToBtcOpen);
    altToBtcCloseRaw.push(altToBtcClose);
    altToBtcHighRaw.push(altToBtcHigh);
    altToBtcLowRaw.push(altToBtcLow);

    const priceScale = toNumber(priceScaleSeries[i], currentPrice);
    const candleMax = Math.max(altOpenRaw, altCloseRaw);
    const candleMin = Math.min(altOpenRaw, altCloseRaw);
    candleBodyRaw.push(safeDiv(altCloseRaw - altOpenRaw, priceScale));
    row[key(`Candle_Range_${i + 1}`)] = safeDiv(
      altHighRaw - altLowRaw,
      priceScale,
    );
    row[key(`Candle_UpperWick_${i + 1}`)] = safeDiv(
      altHighRaw - candleMax,
      priceScale,
    );
    row[key(`Candle_LowerWick_${i + 1}`)] = safeDiv(
      candleMin - altLowRaw,
      priceScale,
    );
    row[key(`Candle_Direction_${i + 1}`)] = altCloseRaw >= altOpenRaw ? 1 : 0;

    const btcCandleMax = Math.max(btcOpenRaw, btcCloseRaw);
    const btcCandleMin = Math.min(btcOpenRaw, btcCloseRaw);
    row[key(`BTC_Candle_Body_${i + 1}`)] = safeDiv(
      btcCloseRaw - btcOpenRaw,
      btcPrice,
    );
    row[key(`BTC_Candle_Range_${i + 1}`)] = safeDiv(
      btcHighRaw - btcLowRaw,
      btcPrice,
    );
    row[key(`BTC_Candle_UpperWick_${i + 1}`)] = safeDiv(
      btcHighRaw - btcCandleMax,
      btcPrice,
    );
    row[key(`BTC_Candle_LowerWick_${i + 1}`)] = safeDiv(
      btcCandleMin - btcLowRaw,
      btcPrice,
    );
    row[key(`BTC_Candle_Direction_${i + 1}`)] =
      btcCloseRaw >= btcOpenRaw ? 1 : 0;

    const candleVol = toNumber(candle?.volume, 0);
    const btcVol = toNumber(btcCandle?.volume, 0);
    const candleWindow = sliceWindow(
      candleVolumes,
      i,
      Math.min(20, candleVolumes.length),
    );
    const btcWindow = sliceWindow(
      btcVolumes,
      i,
      Math.min(20, btcVolumes.length),
    );
    const candleMedian = computeMedian(candleWindow);
    const btcMedian = computeMedian(btcWindow);
    row[key(`Candle_Volume_${i + 1}`)] = safeLog1p(candleVol);
    if (i > 0) {
      row[key(`Candle_Volume_${i + 1}_MedianNorm`)] = safeDiv(
        candleVol,
        candleMedian,
      );
    }
    row[key(`BTC_Candle_Volume_${i + 1}`)] = safeLog1p(btcVol);
    if (i > 0) {
      row[key(`BTC_Candle_Volume_${i + 1}_MedianNorm`)] = safeDiv(
        btcVol,
        btcMedian,
      );
    }
  }

  const candleBodyStd = standardizeSeries(candleBodyRaw);
  const altToBtcOpenRet = backwardReturns(altToBtcOpenRaw);
  const altToBtcCloseRet = backwardReturns(altToBtcCloseRaw);
  const altToBtcHighRet = backwardReturns(altToBtcHighRaw);
  const altToBtcLowRet = backwardReturns(altToBtcLowRaw);
  for (let i = 0; i < CANDLE_WINDOW; i += 1) {
    row[key(`Candle_Body_${i + 1}`)] = candleBodyStd[i] ?? 0;
  }
  assignBackwardReturns(row, key('AltToBtc_Open'), altToBtcOpenRet);
  assignBackwardReturns(row, key('AltToBtc_Close'), altToBtcCloseRet);
  assignBackwardReturns(row, key('AltToBtc_High'), altToBtcHighRet);
  assignBackwardReturns(row, key('AltToBtc_Low'), altToBtcLowRet);

  const windowAlt = sliceWindow(
    altReturns,
    altReturns.length - 1,
    CANDLE_WINDOW,
  );
  const windowBtc = sliceWindow(
    btcReturns,
    btcReturns.length - 1,
    CANDLE_WINDOW,
  );
  const windowRel = sliceWindow(
    relReturns,
    relReturns.length - 1,
    CANDLE_WINDOW,
  );
  row[key('AltRet_Mean10')] = computeMean(windowAlt);
  row[key('AltRet_Std10')] = computeStd(windowAlt);
  row[key('AltRet_Skew10')] = computeSkew(windowAlt);
  row[key('AltRet_Kurt10')] = computeKurtosis(windowAlt);
  row[key('BtcRet_Mean10')] = computeMean(windowBtc);
  row[key('BtcRet_Std10')] = computeStd(windowBtc);
  row[key('BtcRet_Skew10')] = computeSkew(windowBtc);
  row[key('BtcRet_Kurt10')] = computeKurtosis(windowBtc);
  row[key('RelRet_Mean10')] = computeMean(windowRel);
  row[key('RelRet_Std10')] = computeStd(windowRel);
  row[key('RelRet_Skew10')] = computeSkew(windowRel);
  row[key('RelRet_Kurt10')] = computeKurtosis(windowRel);
};

export const buildMlTrainingRow = (
  signalRecord: MlSignalRecord,
  resultRecord: MlResultRecord | null,
): Record<string, number | string | null> => {
  const { signal, context } = signalRecord;
  const indicators = signal?.indicators ?? {};

  // Core prices and context extracted from signal/candles.
  const currentPrice = toNumber(signal?.prices?.currentPrice, 0);
  const candleList = normalizeCandles(indicators.candles15m);
  const btcList = normalizeCandles(indicators.btcCandles15m);

  const lastCandle = candleList[candleList.length - 1] ?? {};

  const lastTimestamp = toNumber(lastCandle?.timestamp, 0);
  const intervalMinutes = toNumber(signal?.interval, 0);
  const entryDate = lastTimestamp > 0 ? new Date(lastTimestamp) : null;
  const entryHour = entryDate ? entryDate.getUTCHours() : 0;
  const entryDayOfWeek = entryDate ? entryDate.getUTCDay() : 0;

  // Base row fields. Most numeric features are normalized vs currentPrice.
  const row: Record<string, number | string | null> = {
    symbol: normalizeSymbol(
      signal?.symbol ?? context?.symbol ?? resultRecord?.symbol ?? '',
    ),
    strategy: normalizeSymbol(signal?.strategy ?? context?.strategyName ?? ''),
    direction: signal?.direction === 'LONG' ? 1 : 0,
    entryTimestamp: lastTimestamp,
    takeProfitPrice: safeDiv(
      currentPrice,
      toNumber(signal?.prices?.takeProfitPrice, 0),
    ),
    stopLossPrice: safeDiv(
      currentPrice,
      toNumber(signal?.prices?.stopLossPrice, 0),
    ),
    riskRatio: toNumber(signal?.prices?.riskRatio, 0),
    Correlation: toNumber(signal?.indicators?.correlation, 0),
    Touches: toNumber(signal?.indicators?.touches, 0),
    Distance: toNumber(signal?.indicators?.distance, 0),
    Ctx_EntryHour: entryHour,
    Ctx_EntryDayOfWeek: entryDayOfWeek,
    Ctx_EntryHourSin: Math.sin((2 * Math.PI * entryHour) / 24),
    Ctx_EntryHourCos: Math.cos((2 * Math.PI * entryHour) / 24),
    Ctx_StopDistance: clamp(1 - safeDiv(currentPrice, toNumber(signal?.prices?.stopLossPrice, 0)), -5, 5),
    Ctx_TakeDistance: clamp(safeDiv(currentPrice, toNumber(signal?.prices?.takeProfitPrice, 0)) - 1, -5, 5),
  };
  row.Ctx_RiskAsymmetry = clamp(
    safeDiv(
      toNumber(row.Ctx_TakeDistance, 0),
      Math.abs(toNumber(row.Ctx_StopDistance, 0)),
    ),
    -10,
    10,
  );

  // Indicator helpers:
  // - addSeries: divide by currentPrice (price-relative)
  // - addSeriesRaw: keep as-is
  // - addSeriesRelTo: divide by matching denominator series
  // - addSeriesLogVolume: log1p volumes
  // - addSeriesVolumeMedianNormalized: volume / rolling median
  const addSeries = (prefix: string, values: unknown[]) => {
    const series = padSeries(normalizeSeries(values));
    for (let i = 0; i < INDICATOR_WINDOW; i += 1) {
      const value = series[i];
      row[`${prefix}_${i + 1}`] = safeDiv(value, currentPrice);
    }
  };

  const addSeriesBackwardReturns = (prefix: string, values: unknown[]) => {
    const series = padSeries(normalizeSeries(values));
    const returns = backwardReturns(series);
    assignBackwardReturns(row, prefix, returns);
  };

  const addSeriesRaw = (prefix: string, values: unknown[]) => {
    const series = padSeries(normalizeSeries(values));
    for (let i = 0; i < INDICATOR_WINDOW; i += 1) {
      row[`${prefix}_${i + 1}`] = series[i];
    }
  };

  const addSeriesPct = (prefix: string, values: unknown[]) => {
    const series = padSeries(normalizeSeries(values));
    for (let i = 0; i < INDICATOR_WINDOW; i += 1) {
      // Percent values are expressed in pct points; squash keeps sign and
      // limits outliers while preserving ordering around zero.
      row[`${prefix}_${i + 1}`] = squash(series[i], 10);
    }
  };

  const addSeriesStd = (prefix: string, values: unknown[]) => {
    const series = padSeries(normalizeSeries(values));
    const standardized = standardizeSeries(series);
    for (let i = 0; i < INDICATOR_WINDOW; i += 1) {
      row[`${prefix}_${i + 1}`] = standardized[i] ?? 0;
    }
  };

  const addSeriesRelTo = (
    prefix: string,
    values: unknown[],
    denomSeries: unknown[],
  ) => {
    const series = padSeries(normalizeSeries(values));
    const denomSeriesSafe = padSeries(normalizeSeries(denomSeries));
    for (let i = 0; i < INDICATOR_WINDOW; i += 1) {
      const value = series[i];
      const denom = denomSeriesSafe[i];
      row[`${prefix}_${i + 1}`] = safeDiv(value, denom);
    }
  };

  const addSeriesRelToBackwardReturns = (
    prefix: string,
    values: unknown[],
    denomSeries: unknown[],
  ) => {
    const series = padSeries(normalizeSeries(values));
    const denomSeriesSafe = padSeries(normalizeSeries(denomSeries));
    const relSeries = series.map((value, i) =>
      safeDiv(value, denomSeriesSafe[i]),
    );
    const returns = backwardReturns(relSeries);
    assignBackwardReturns(row, prefix, returns);
  };

  const addSeriesLogVolume = (prefix: string, values: unknown[]) => {
    const series = padSeries(normalizeSeries(values));
    for (let i = 0; i < INDICATOR_WINDOW; i += 1) {
      const value = series[i];
      row[`${prefix}_${i + 1}`] = clamp(safeLog1p(value), -20, 20);
    }
  };

  const addSeriesLogVolumeBackwardReturns = (
    prefix: string,
    values: unknown[],
  ) => {
    const series = padSeries(normalizeSeries(values));
    const loggedSeries = series.map((value) => safeLog1p(value));
    const returns = backwardReturns(loggedSeries);
    assignBackwardReturns(row, prefix, returns);
  };

  const addSeriesVolumeMedianNormalized = (
    prefix: string,
    values: unknown[],
  ) => {
    const numericValues = padSeries(normalizeSeries(values));
    const windowSize = Math.min(20, numericValues.length);
    for (let i = 1; i < INDICATOR_WINDOW; i += 1) {
      const value = numericValues[i];
      const window = sliceWindow(numericValues, i, windowSize);
      const median = computeMedian(window);
      row[`${prefix}_${i + 1}_MedianNorm`] = clamp(
        safeDiv(value, median),
        0,
        20,
      );
    }
  };

  // Indicator series from the signal: TF15M + TF1H/TF4H/TF1D.
  const keyWithSourceSuffix = (key: string, sourceSuffix?: string) =>
    sourceSuffix ? `${key}${sourceSuffix}` : key;
  const keyWithFeaturePrefix = (key: string, featurePrefix?: string) =>
    featurePrefix ? `${featurePrefix}_${key}` : key;
  const addIndicatorFeatures = (
    featurePrefix?: IndicatorTimeframe['label'],
    sourceSuffix?: IndicatorTimeframe['suffix'],
  ) => {
    const indicatorSeries = (key: string) =>
      asArray(indicators[keyWithSourceSuffix(key, sourceSuffix)]);
    const featureKey = (key: string) => keyWithFeaturePrefix(key, featurePrefix);

    addSeries(featureKey('ATR'), indicatorSeries('atr'));
    addSeriesBackwardReturns(featureKey('MA_Fast'), indicatorSeries('maFast'));
    addSeriesBackwardReturns(
      featureKey('MA_Medium'),
      indicatorSeries('maMedium'),
    );
    addSeriesBackwardReturns(featureKey('MA_Slow'), indicatorSeries('maSlow'));
    addSeriesBackwardReturns(featureKey('BB_Upper'), indicatorSeries('bbUpper'));
    addSeriesBackwardReturns(
      featureKey('BB_Middle'),
      indicatorSeries('bbMiddle'),
    );
    addSeriesBackwardReturns(featureKey('BB_Lower'), indicatorSeries('bbLower'));
    addSeriesLogVolumeBackwardReturns(
      featureKey('OBV_LogRet'),
      indicatorSeries('obv'),
    );
    addSeriesLogVolumeBackwardReturns(
      featureKey('SMA_OBV_LogRet'),
      indicatorSeries('smaObv'),
    );
    addSeriesRaw(featureKey('ATR_PCT'), indicatorSeries('atrPct'));
    // MACD family crosses zero frequently; standardized levels are more stable
    // than ratio-returns for such oscillators.
    addSeriesStd(featureKey('MACD'), indicatorSeries('macd'));
    addSeriesStd(featureKey('MACD_Signal'), indicatorSeries('macdSignal'));
    addSeriesStd(featureKey('MACD_Histogram'), indicatorSeries('macdHistogram'));
    addSeriesPct(featureKey('Price24hPcnt'), indicatorSeries('price24hPcnt'));
    addSeriesPct(featureKey('Price1hPcnt'), indicatorSeries('price1hPcnt'));
    addSeriesRelTo(
      featureKey('HighPrice1h'),
      indicatorSeries('highPrice1h'),
      indicatorSeries('maMedium'),
    );
    addSeriesRelTo(
      featureKey('LowPrice1h'),
      indicatorSeries('lowPrice1h'),
      indicatorSeries('maMedium'),
    );
    addSeriesLogVolume(featureKey('Volume1h'), indicatorSeries('volume1h'));
    addSeriesVolumeMedianNormalized(
      featureKey('Volume1h'),
      indicatorSeries('volume1h'),
    );
    addSeriesRelTo(
      featureKey('HighPrice24h'),
      indicatorSeries('highPrice24h'),
      indicatorSeries('maMedium'),
    );
    addSeriesRelTo(
      featureKey('LowPrice24h'),
      indicatorSeries('lowPrice24h'),
      indicatorSeries('maMedium'),
    );
    addSeriesLogVolume(featureKey('Volume24h'), indicatorSeries('volume24h'));
    addSeriesVolumeMedianNormalized(
      featureKey('Volume24h'),
      indicatorSeries('volume24h'),
    );
  };

  const maMediumSeries = asArray(indicators.maMedium);
  const atrPctSeries = padSeries(normalizeSeries(indicators.atrPct));
  const price1hPctSeries = padSeries(normalizeSeries(indicators.price1hPcnt));
  const tf15mReturns = backwardReturns(
    candleList.slice(-INDICATOR_WINDOW).map((candle) => toNumber(candle.close, 0)),
  );
  for (const timeframe of INDICATOR_TIMEFRAMES) {
    addIndicatorFeatures(timeframe.label, timeframe.suffix);
  }

  // Candle-level features for TF15M + TF1H/TF4H/TF1D windows.
  const basePriceScale = padSeries(normalizeSeries(maMediumSeries));
  for (const timeframe of CANDLE_TIMEFRAMES) {
    const tfCandlesFromIndicators =
      timeframe.key === 'candles15m'
        ? candleList
        : normalizeCandles(indicators[timeframe.key]);
    const tfBtcCandlesFromIndicators =
      timeframe.btcKey === 'btcCandles15m'
        ? btcList
        : normalizeCandles(indicators[timeframe.btcKey]);
    const tfCandles = tfCandlesFromIndicators.slice(-CANDLE_WINDOW);
    const tfBtcCandles = tfBtcCandlesFromIndicators.slice(-CANDLE_WINDOW);
    const priceScaleSeries =
      timeframe.label === 'TF15M'
        ? basePriceScale
        : tfCandles.map((candle) => candle.close);
    addCandleFeatures(row, {
      featurePrefix: timeframe.label,
      candles: tfCandles,
      btcCandles: tfBtcCandles,
      currentPrice,
      priceScaleSeries,
    });
  }

  const atrPctLast = atrPctSeries[atrPctSeries.length - 1] ?? 0;
  const atrPctMean = computeMean(atrPctSeries);
  const atrPctStd = computeStd(atrPctSeries);
  const atrPctZ = atrPctStd > 0 ? (atrPctLast - atrPctMean) / atrPctStd : 0;
  const atrPctRank = percentileRank(atrPctSeries, atrPctLast);
  const realizedVol = computeStd(tf15mReturns);
  const realizedVolRank = percentileRank(
    tf15mReturns.length ? tf15mReturns : [0],
    tf15mReturns.length ? tf15mReturns[tf15mReturns.length - 1] : 0,
  );
  const trendStrength = Math.abs(computeMean(price1hPctSeries));

  row.Regime_ATR_PCT_Last = atrPctLast;
  row.Regime_ATR_PCT_Z = clamp(atrPctZ, -8, 8);
  row.Regime_ATR_PCT_Rank = atrPctRank;
  row.Regime_RealizedVol_10 = realizedVol;
  row.Regime_RealizedVol_Rank = realizedVolRank;
  row.Regime_TrendStrength = trendStrength;
  row.Regime_IsHighVol = atrPctRank >= 0.7 || realizedVolRank >= 0.7 ? 1 : 0;
  row.Ctx_DistanceTo24hRange = clamp(
    toNumber(row.TF15M_HighPrice24h_10, 0) - toNumber(row.TF15M_LowPrice24h_10, 0),
    -10,
    10,
  );

  // Trendline geometry features.
  const trendLine = signal?.figures?.trendLine;
  row.TrendLine_Mode = trendLine?.mode === 'highs' ? 1 : 0;
  row.TrendLine_Distance = toNumber(trendLine?.distance, 0);
  const trendAlpha = padSeries(normalizeSeries(trendLine?.alpha));
  for (let i = 0; i < INDICATOR_WINDOW; i += 1) {
    row[`TrendLine_Alpha_${i + 1}`] = trendAlpha[i];
  }

  // Trendline points (always 2, padded with zeros if missing).
  const points = asArray(trendLine?.points);
  const maxPoints = 2;
  for (let i = 0; i < maxPoints; i += 1) {
    const point = points[i] ?? {};
    row[`POINTS_VALUE_${i + 1}`] = safeDiv(
      toNumber(point?.value, 0),
      currentPrice,
    );
    const pointDeltaMs = lastTimestamp - toNumber(point?.timestamp, 0);
    const pointDeltaMin = safeDiv(pointDeltaMs, 60_000);
    if (i === 0) {
      const pointDeltaBars =
        intervalMinutes > 0
          ? safeDiv(pointDeltaMin, intervalMinutes)
          : pointDeltaMin;
      row[`POINTS_TS_${i + 1}`] = safeLog1pPositive(pointDeltaBars);
    }
  }

  // Touches: keep latest 3 points only, with zero padding.
  const touches = asArray(trendLine?.touches)
    .map((touch) => ({
      value: toNumber(touch?.value, NaN),
      timestamp: toNumber(touch?.timestamp, NaN),
    }))
    .filter(
      (touch) =>
        Number.isFinite(touch.value) && Number.isFinite(touch.timestamp),
    )
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-3);
  const maxTouches = 3;
  for (let i = 0; i < maxTouches; i += 1) {
    const touch = touches[i];
    if (!touch) {
      row[`TOUCHES_VALUE_${i + 1}`] = 0;
      row[`TOUCHES_TS_${i + 1}`] = 0;
      continue;
    }
    row[`TOUCHES_VALUE_${i + 1}`] = safeDiv(
      toNumber(touch?.value, 0),
      currentPrice,
    );
    const touchDeltaMs = lastTimestamp - toNumber(touch?.timestamp, 0);
    const touchDeltaMin = safeDiv(touchDeltaMs, 60_000);
    const touchDeltaBars =
      intervalMinutes > 0
        ? safeDiv(touchDeltaMin, intervalMinutes)
        : touchDeltaMin;
    row[`TOUCHES_TS_${i + 1}`] = safeLog1pPositive(touchDeltaBars);
  }

  // Trendline slope and value at entry computed from last two valid points.
  const normalizedPoints = points
    .map((point) => ({
      value: toNumber(point?.value, NaN),
      timestamp: toNumber(point?.timestamp, NaN),
    }))
    .filter(
      (point) =>
        Number.isFinite(point.value) && Number.isFinite(point.timestamp),
    )
    .sort((a, b) => a.timestamp - b.timestamp);
  if (normalizedPoints.length >= 2) {
    const p1 = normalizedPoints[normalizedPoints.length - 2];
    const p2 = normalizedPoints[normalizedPoints.length - 1];
    const dtMs = p2.timestamp - p1.timestamp;
    if (dtMs !== 0) {
      const slopePerMs = (p2.value - p1.value) / dtMs;
      const tlAtEntry = p1.value + slopePerMs * (lastTimestamp - p1.timestamp);
      const slopePerBar =
        intervalMinutes > 0 ? slopePerMs * intervalMinutes * 60_000 : null;
      row.TrendLine_Delta_To_Price = safeDiv(
        currentPrice - tlAtEntry,
        currentPrice,
      );
      row.TrendLine_Slope =
        slopePerBar == null ? null : safeLog1p(slopePerBar);
    } else {
      row.TrendLine_Delta_To_Price = null;
      row.TrendLine_Slope = null;
    }
  } else {
    row.TrendLine_Delta_To_Price = null;
    row.TrendLine_Slope = null;
  }

  // Label/profit from result record.
  const profit = toNumber(resultRecord?.profit, NaN);
  row.label = Number.isFinite(profit) ? (profit > 0 ? 1 : 0) : null;
  row.profit = Number.isFinite(profit) ? profit : null;

  return row;
};

export type { MlSignalRecord, MlResultRecord };
