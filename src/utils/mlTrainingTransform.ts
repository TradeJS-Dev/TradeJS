type MlSignalRecord = {
  signal: any;
  context?: {
    strategyConfig?: any;
    strategyName?: string;
    symbol?: string;
  };
  candles?: any[];
  btcCandles?: any[];
};

type MlResultRecord = {
  profit?: number;
  direction?: 'LONG' | 'SHORT';
  symbol?: string;
};

const CANDLE_WINDOW = 50;
const INDICATOR_WINDOW = 10;

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

const safeLog1p = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.log1p(Math.max(0, value));
};

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

const sliceWindow = (
  values: number[],
  endIndex: number,
  windowSize: number,
): number[] => {
  if (values.length === 0) return [];
  const start = Math.max(0, endIndex - windowSize + 1);
  return values.slice(start, endIndex + 1);
};

const asArray = (value: unknown): any[] => (Array.isArray(value) ? value : []);

export const buildMlTrainingRow = (
  signalRecord: MlSignalRecord,
  resultRecord: MlResultRecord | null,
): Record<string, number | null> => {
  const { signal, context, candles, btcCandles } = signalRecord;

  const currentPrice = toNumber(signal?.prices?.currentPrice, 0);
  const candleList = asArray(candles);
  const btcList = asArray(btcCandles);

  const lastCandle = candleList[candleList.length - 1] ?? {};
  const lastBtcCandle = btcList[btcList.length - 1] ?? {};

  const lastTimestamp = toNumber(lastCandle?.timestamp, 0);
  const btcPrice = toNumber(lastBtcCandle?.close, 0);
  const intervalMinutes = toNumber(signal?.interval, 0);
  const lastAltClose = toNumber(lastCandle?.close, 0);
  const lastBtcClose = toNumber(lastBtcCandle?.close, 0);
  const lastAltToBtcRatio = safeDiv(lastAltClose, lastBtcClose);

  const row: Record<string, number | null> = {
    direction: signal?.direction === 'LONG' ? 1 : 0,
    interval: intervalMinutes,
    currentPrice,
    entryTimestamp: lastTimestamp,
    takeProfitPrice: safeDiv(
      toNumber(signal?.prices?.takeProfitPrice, 0),
      currentPrice,
    ),
    stopLossPrice: safeDiv(
      toNumber(signal?.prices?.stopLossPrice, 0),
      currentPrice,
    ),
    riskRatio: toNumber(signal?.prices?.riskRatio, 0),
    Correlation: toNumber(signal?.indicators?.correlation, 0),
    Touches: toNumber(signal?.indicators?.touches, 0),
    Distance: toNumber(signal?.indicators?.distance, 0),
  };

  const addSeries = (prefix: string, values: unknown[]) => {
    for (let i = 0; i < INDICATOR_WINDOW; i += 1) {
      const value = toNumber(values[i], 0);
      row[`${prefix}_${i + 1}`] = safeDiv(value, currentPrice);
    }
  };

  const addSeriesRaw = (prefix: string, values: unknown[]) => {
    for (let i = 0; i < INDICATOR_WINDOW; i += 1) {
      const value = toNumber(values[i], 0);
      row[`${prefix}_${i + 1}`] = value;
    }
  };

  const addSeriesRelTo = (
    prefix: string,
    values: unknown[],
    denomSeries: unknown[],
  ) => {
    for (let i = 0; i < INDICATOR_WINDOW; i += 1) {
      const value = toNumber(values[i], 0);
      const denom = toNumber(denomSeries[i], 0);
      row[`${prefix}_${i + 1}`] = safeDiv(value, denom);
    }
  };

  const addSeriesLogVolume = (prefix: string, values: unknown[]) => {
    for (let i = 0; i < INDICATOR_WINDOW; i += 1) {
      const value = toNumber(values[i], 0);
      row[`${prefix}_${i + 1}`] = safeLog1p(value);
    }
  };

  const addSeriesVolumeMedianNormalized = (
    prefix: string,
    values: unknown[],
  ) => {
    const numericValues = values.map((value) => toNumber(value, 0));
    const windowSize = Math.min(20, numericValues.length);
    for (let i = 0; i < INDICATOR_WINDOW; i += 1) {
      const value = toNumber(values[i], 0);
      const window = sliceWindow(numericValues, i, windowSize);
      const median = computeMedian(window);
      row[`${prefix}_${i + 1}_MedianNorm`] = safeDiv(value, median);
    }
  };

  const indicators = signal?.indicators ?? {};
  const maMediumSeries = asArray(indicators.maMedium);
  addSeriesRelTo('ATR', asArray(indicators.atr), maMediumSeries);
  addSeriesRelTo('MA_Fast', asArray(indicators.maFast), maMediumSeries);
  addSeriesRelTo('MA_Medium', maMediumSeries, maMediumSeries);
  addSeriesRelTo('MA_Slow', asArray(indicators.maSlow), maMediumSeries);
  addSeriesRelTo('BB_Upper', asArray(indicators.bbUpper), maMediumSeries);
  addSeriesRelTo('BB_Middle', asArray(indicators.bbMiddle), maMediumSeries);
  addSeriesRelTo('BB_Lower', asArray(indicators.bbLower), maMediumSeries);
  addSeriesLogVolume('OBV_Log1p', asArray(indicators.obv));
  const atrSeries = asArray(indicators.atr);
  addSeriesRelTo('MACD', asArray(indicators.macd), atrSeries);
  addSeriesRelTo('MACD_Signal', asArray(indicators.macdSignal), atrSeries);
  addSeriesRelTo(
    'MACD_Histogram',
    asArray(indicators.macdHistogram),
    atrSeries,
  );
  addSeriesRaw('Price24hPcnt', asArray(indicators.price24hPcnt));
  addSeriesRaw('Price1hPcnt', asArray(indicators.price1hPcnt));
  addSeriesRaw('PrevPrice24hPcnt', asArray(indicators.prevPrice24hPcnt));
  addSeriesRaw('PrevPrice1hPcnt', asArray(indicators.prevPrice1hPcnt));
  addSeries('HighPrice1h', asArray(indicators.highPrice1h));
  addSeries('LowPrice1h', asArray(indicators.lowPrice1h));
  addSeriesLogVolume('Volume1h', asArray(indicators.volume1h));
  addSeriesVolumeMedianNormalized('Volume1h', asArray(indicators.volume1h));
  addSeries('HighPrice24h', asArray(indicators.highPrice24h));
  addSeries('LowPrice24h', asArray(indicators.lowPrice24h));
  addSeriesLogVolume('Volume24h', asArray(indicators.volume24h));
  addSeriesVolumeMedianNormalized('Volume24h', asArray(indicators.volume24h));
  addSeries('PrevHighPrice1h', asArray(indicators.prevHighPrice1h));
  addSeries('PrevLowPrice1h', asArray(indicators.prevLowPrice1h));
  addSeriesLogVolume('PrevVolume1h', asArray(indicators.prevVolume1h));
  addSeriesVolumeMedianNormalized(
    'PrevVolume1h',
    asArray(indicators.prevVolume1h),
  );
  addSeries('PrevHighPrice24h', asArray(indicators.prevHighPrice24h));
  addSeries('PrevLowPrice24h', asArray(indicators.prevLowPrice24h));
  addSeriesLogVolume('PrevVolume24h', asArray(indicators.prevVolume24h));
  addSeriesVolumeMedianNormalized(
    'PrevVolume24h',
    asArray(indicators.prevVolume24h),
  );

  const candleVolumes = candleList.map((candle) => toNumber(candle?.volume, 0));
  const btcVolumes = btcList.map((candle) => toNumber(candle?.volume, 0));
  const altReturns: number[] = [];
  const btcReturns: number[] = [];
  const relReturns: number[] = [];

  for (let i = 0; i < CANDLE_WINDOW; i += 1) {
    const candle = candleList[i] ?? {};
    const btcCandle = btcList[i] ?? {};

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
    row[`AltRet_${i + 1}`] = altRet;
    row[`BtcRet_${i + 1}`] = btcRet;
    row[`RelRet_${i + 1}`] = altRet - btcRet;
    altReturns.push(altRet);
    btcReturns.push(btcRet);
    relReturns.push(altRet - btcRet);

    const altToBtcOpen = safeDiv(altOpenRaw, btcOpenRaw);
    const altToBtcClose = safeDiv(altCloseRaw, btcCloseRaw);
    const altToBtcHigh = safeDiv(altHighRaw, btcHighRaw);
    const altToBtcLow = safeDiv(altLowRaw, btcLowRaw);
    row[`AltToBtc_Open_${i + 1}`] = altToBtcOpen;
    row[`AltToBtc_Close_${i + 1}`] = altToBtcClose;
    row[`AltToBtc_High_${i + 1}`] = altToBtcHigh;
    row[`AltToBtc_Low_${i + 1}`] = altToBtcLow;
    row[`AltToBtc_CloseRel_${i + 1}`] = safeDiv(
      altToBtcClose,
      lastAltToBtcRatio,
    );

    const candleMax = Math.max(altOpenRaw, altCloseRaw);
    const candleMin = Math.min(altOpenRaw, altCloseRaw);
    row[`Candle_Body_${i + 1}`] = safeDiv(
      altCloseRaw - altOpenRaw,
      currentPrice,
    );
    row[`Candle_Range_${i + 1}`] = safeDiv(
      altHighRaw - altLowRaw,
      currentPrice,
    );
    row[`Candle_UpperWick_${i + 1}`] = safeDiv(
      altHighRaw - candleMax,
      currentPrice,
    );
    row[`Candle_LowerWick_${i + 1}`] = safeDiv(
      candleMin - altLowRaw,
      currentPrice,
    );
    row[`Candle_Direction_${i + 1}`] = altCloseRaw >= altOpenRaw ? 1 : 0;

    const btcCandleMax = Math.max(btcOpenRaw, btcCloseRaw);
    const btcCandleMin = Math.min(btcOpenRaw, btcCloseRaw);
    row[`BTC_Candle_Body_${i + 1}`] = safeDiv(
      btcCloseRaw - btcOpenRaw,
      btcPrice,
    );
    row[`BTC_Candle_Range_${i + 1}`] = safeDiv(
      btcHighRaw - btcLowRaw,
      btcPrice,
    );
    row[`BTC_Candle_UpperWick_${i + 1}`] = safeDiv(
      btcHighRaw - btcCandleMax,
      btcPrice,
    );
    row[`BTC_Candle_LowerWick_${i + 1}`] = safeDiv(
      btcCandleMin - btcLowRaw,
      btcPrice,
    );
    row[`BTC_Candle_Direction_${i + 1}`] = btcCloseRaw >= btcOpenRaw ? 1 : 0;

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
    row[`Candle_Volume_${i + 1}`] = safeLog1p(candleVol);
    row[`Candle_Volume_${i + 1}_MedianNorm`] = safeDiv(candleVol, candleMedian);
    row[`BTC_Candle_Volume_${i + 1}`] = safeLog1p(btcVol);
    row[`BTC_Candle_Volume_${i + 1}_MedianNorm`] = safeDiv(btcVol, btcMedian);
  }

  const window10Alt = sliceWindow(altReturns, altReturns.length - 1, 10);
  const window10Btc = sliceWindow(btcReturns, btcReturns.length - 1, 10);
  const window10Rel = sliceWindow(relReturns, relReturns.length - 1, 10);
  row.AltRet_Mean10 = computeMean(window10Alt);
  row.AltRet_Std10 = computeStd(window10Alt);
  row.AltRet_Skew10 = computeSkew(window10Alt);
  row.AltRet_Kurt10 = computeKurtosis(window10Alt);
  row.BtcRet_Mean10 = computeMean(window10Btc);
  row.BtcRet_Std10 = computeStd(window10Btc);
  row.BtcRet_Skew10 = computeSkew(window10Btc);
  row.BtcRet_Kurt10 = computeKurtosis(window10Btc);
  row.RelRet_Mean10 = computeMean(window10Rel);
  row.RelRet_Std10 = computeStd(window10Rel);
  row.RelRet_Skew10 = computeSkew(window10Rel);
  row.RelRet_Kurt10 = computeKurtosis(window10Rel);

  const trendLine = signal?.figures?.trendLine;
  row.TrendLine_Mode = trendLine?.mode === 'highs' ? 1 : 0;
  row.TrendLine_Distance = toNumber(trendLine?.distance, 0);

  const points = asArray(trendLine?.points);
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i] ?? {};
    row[`POINTS_VALUE_${i + 1}`] = safeDiv(
      toNumber(point?.value, 0),
      currentPrice,
    );
    const pointDeltaMs = lastTimestamp - toNumber(point?.timestamp, 0);
    const pointDeltaMin = safeDiv(pointDeltaMs, 60_000);
    row[`POINTS_TS_${i + 1}`] =
      intervalMinutes > 0
        ? safeDiv(pointDeltaMin, intervalMinutes)
        : pointDeltaMin;
  }

  const touches = asArray(trendLine?.touches);
  for (let i = 0; i < touches.length; i += 1) {
    const touch = touches[i] ?? {};
    row[`TOUCHES_VALUE_${i + 1}`] = safeDiv(
      toNumber(touch?.value, 0),
      currentPrice,
    );
    const touchDeltaMs = lastTimestamp - toNumber(touch?.timestamp, 0);
    const touchDeltaMin = safeDiv(touchDeltaMs, 60_000);
    row[`TOUCHES_TS_${i + 1}`] =
      intervalMinutes > 0
        ? safeDiv(touchDeltaMin, intervalMinutes)
        : touchDeltaMin;
  }

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
      row.TrendLine_Value_AtEntry = tlAtEntry;
      row.TrendLine_Delta_To_Price = safeDiv(
        currentPrice - tlAtEntry,
        currentPrice,
      );
      row.TrendLine_Slope = slopePerBar ?? null;
    } else {
      row.TrendLine_Value_AtEntry = null;
      row.TrendLine_Delta_To_Price = null;
      row.TrendLine_Slope = null;
    }
  } else {
    row.TrendLine_Value_AtEntry = null;
    row.TrendLine_Delta_To_Price = null;
    row.TrendLine_Slope = null;
  }

  const strategyConfig = context?.strategyConfig ?? {};
  const trendCfg = strategyConfig.TRENDLINE_CONFIG ?? {};
  row.TRENDLINE_minTouches = toNumber(trendCfg.minTouches, 0);
  row.TRENDLINE_offset = toNumber(trendCfg.offset, 0);
  row.TRENDLINE_epsilon = toNumber(trendCfg.epsilon, 0);
  row.TRENDLINE_epsilonOffset = toNumber(trendCfg.epsilonOffset, 0);

  const highsCfg = strategyConfig.HIGHS ?? {};
  row.HIGHS_enable = highsCfg.enable ? 1 : 0;
  row.HIGHS_direction = highsCfg.direction === 'LONG' ? 1 : 0;
  row.HIGHS_TP = toNumber(highsCfg.TP, 0);
  row.HIGHS_SL = toNumber(highsCfg.SL, 0);
  row.HIGHS_minRiskRatio = toNumber(highsCfg.minRiskRatio, 0);

  const lowsCfg = strategyConfig.LOWS ?? {};
  row.LOWS_enable = lowsCfg.enable ? 1 : 0;
  row.LOWS_direction = lowsCfg.direction === 'LONG' ? 1 : 0;
  row.LOWS_TP = toNumber(lowsCfg.TP, 0);
  row.LOWS_SL = toNumber(lowsCfg.SL, 0);
  row.LOWS_minRiskRatio = toNumber(lowsCfg.minRiskRatio, 0);

  const profit = toNumber(resultRecord?.profit, NaN);
  row.label = Number.isFinite(profit) ? (profit > 0 ? 1 : 0) : null;
  row.profit = Number.isFinite(profit) ? profit : null;

  return row;
};

export type { MlSignalRecord, MlResultRecord };
