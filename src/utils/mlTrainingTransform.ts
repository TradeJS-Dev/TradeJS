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

const computeMean = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
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

const sliceWindow = (values: number[], endIndex: number, windowSize: number): number[] => {
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

  // ВАЖНО: currentPrice используется как общий якорь нормализации для множества фич.
  // Это корректно только если индикаторы в абсолютных ценовых единицах.
  // Если индикатор уже нормализован (например, MA/close или проценты),
  // деление на currentPrice ломает масштаб и вредит модели. См. ниже.
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

  // Базовые скалярные фичи. Часть нормализуется на currentPrice,
  // чтобы сделать масштабы сопоставимыми между активами.
  const row: Record<string, number | null> = {
    direction: signal?.direction === 'LONG' ? 1 : 0,
    interval: intervalMinutes,
    currentPrice,
    takeProfitPrice: safeDiv(toNumber(signal?.prices?.takeProfitPrice, 0), currentPrice),
    stopLossPrice: safeDiv(toNumber(signal?.prices?.stopLossPrice, 0), currentPrice),
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

  const addSeriesLogVolume = (prefix: string, values: unknown[]) => {
    for (let i = 0; i < INDICATOR_WINDOW; i += 1) {
      const value = toNumber(values[i], 0);
      row[`${prefix}_${i + 1}`] = safeLog1p(value);
    }
  };

  const addSeriesVolumeNormalized = (prefix: string, values: unknown[]) => {
    const numericValues = values.map((value) => toNumber(value, 0));
    const windowSize = Math.min(20, numericValues.length);
    for (let i = 0; i < INDICATOR_WINDOW; i += 1) {
      const value = toNumber(values[i], 0);
      const window = sliceWindow(numericValues, i, windowSize);
      const median = computeMedian(window);
      const mean = computeMean(window);
      row[`${prefix}_${i + 1}_MedianNorm`] = safeDiv(value, median);
      row[`${prefix}_${i + 1}_MeanNorm`] = safeDiv(value, mean);
    }
  };

  const indicators = signal?.indicators ?? {};
  // ВНИМАНИЕ: Эти индикаторы нормализуются на currentPrice.
  // Это корректно только если значения в абсолютных ценовых единицах.
  // Если они уже нормализованы (отношения/проценты), деление ломает масштаб
  // (пример: MA уже как MA/close).
  addSeries('ATR', asArray(indicators.atr));
  addSeries('MA_Fast', asArray(indicators.maFast));
  addSeries('MA_Medium', asArray(indicators.maMedium));
  addSeries('MA_Slow', asArray(indicators.maSlow));
  addSeries('BB_Upper', asArray(indicators.bbUpper));
  addSeries('BB_Middle', asArray(indicators.bbMiddle));
  addSeries('BB_Lower', asArray(indicators.bbLower));
  addSeries('OBV', asArray(indicators.obv));
  addSeries('MACD', asArray(indicators.macd));
  addSeries('MACD_Signal', asArray(indicators.macdSignal));
  addSeries('MACD_Histogram', asArray(indicators.macdHistogram));
  // Эти серии предполагаются уже нормализованными (проценты/дельты), оставляем как есть.
  addSeriesRaw('Price24hPcnt', asArray(indicators.price24hPcnt));
  addSeriesRaw('Price1hPcnt', asArray(indicators.price1hPcnt));
  addSeriesRaw('PrevPrice24hPcnt', asArray(indicators.prevPrice24hPcnt));
  addSeriesRaw('PrevPrice1hPcnt', asArray(indicators.prevPrice1hPcnt));
  addSeries('HighPrice1h', asArray(indicators.highPrice1h));
  addSeries('LowPrice1h', asArray(indicators.lowPrice1h));
  // ВАЖНО: Деление на lastVolume нестабильно при маленьком/аномальном объеме.
  // Используем log1p и дополнительно нормализацию по rolling median/mean.
  addSeriesLogVolume('Volume1h', asArray(indicators.volume1h));
  addSeriesVolumeNormalized('Volume1h', asArray(indicators.volume1h));
  addSeries('HighPrice24h', asArray(indicators.highPrice24h));
  addSeries('LowPrice24h', asArray(indicators.lowPrice24h));
  addSeriesLogVolume('Volume24h', asArray(indicators.volume24h));
  addSeriesVolumeNormalized('Volume24h', asArray(indicators.volume24h));
  addSeries('PrevHighPrice1h', asArray(indicators.prevHighPrice1h));
  addSeries('PrevLowPrice1h', asArray(indicators.prevLowPrice1h));
  addSeriesLogVolume('PrevVolume1h', asArray(indicators.prevVolume1h));
  addSeriesVolumeNormalized('PrevVolume1h', asArray(indicators.prevVolume1h));
  addSeries('PrevHighPrice24h', asArray(indicators.prevHighPrice24h));
  addSeries('PrevLowPrice24h', asArray(indicators.prevLowPrice24h));
  addSeriesLogVolume('PrevVolume24h', asArray(indicators.prevVolume24h));
  addSeriesVolumeNormalized('PrevVolume24h', asArray(indicators.prevVolume24h));

  const candleVolumes = candleList.map((candle) => toNumber(candle?.volume, 0));
  const btcVolumes = btcList.map((candle) => toNumber(candle?.volume, 0));

  for (let i = 0; i < CANDLE_WINDOW; i += 1) {
    // ВАЖНО: Свечи должны быть строго до entryTimestamp, иначе будет leakage.
    // Если есть свеча, начавшаяся после входа, это утечка будущей информации.
    const candle = candleList[i] ?? {};
    const btcCandle = btcList[i] ?? {};

    const candleOpen = safeDiv(toNumber(candle?.open, 0), currentPrice);
    const candleClose = safeDiv(toNumber(candle?.close, 0), currentPrice);
    const candleHigh = safeDiv(toNumber(candle?.high, 0), currentPrice);
    const candleLow = safeDiv(toNumber(candle?.low, 0), currentPrice);

    const btcOpen = safeDiv(toNumber(btcCandle?.open, 0), btcPrice);
    const btcClose = safeDiv(toNumber(btcCandle?.close, 0), btcPrice);
    const btcHigh = safeDiv(toNumber(btcCandle?.high, 0), btcPrice);
    const btcLow = safeDiv(toNumber(btcCandle?.low, 0), btcPrice);

    row[`Candle_Open_${i + 1}`] = candleOpen;
    row[`Candle_Close_${i + 1}`] = candleClose;
    row[`Candle_High_${i + 1}`] = candleHigh;
    row[`Candle_Low_${i + 1}`] = candleLow;

    row[`BTC_Candle_Open_${i + 1}`] = btcOpen;
    row[`BTC_Candle_Close_${i + 1}`] = btcClose;
    row[`BTC_Candle_High_${i + 1}`] = btcHigh;
    row[`BTC_Candle_Low_${i + 1}`] = btcLow;

    // Относительные доходности более устойчивы, чем отношение нормализованных OHLC.
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

    // Альтернативный alt/btc ratio ряд (уровни), плюс нормализация на последний ratio.
    const altToBtcOpen = safeDiv(altOpenRaw, btcOpenRaw);
    const altToBtcClose = safeDiv(altCloseRaw, btcCloseRaw);
    const altToBtcHigh = safeDiv(altHighRaw, btcHighRaw);
    const altToBtcLow = safeDiv(altLowRaw, btcLowRaw);
    row[`AltToBtc_Open_${i + 1}`] = altToBtcOpen;
    row[`AltToBtc_Close_${i + 1}`] = altToBtcClose;
    row[`AltToBtc_High_${i + 1}`] = altToBtcHigh;
    row[`AltToBtc_Low_${i + 1}`] = altToBtcLow;
    row[`AltToBtc_CloseRel_${i + 1}`] = safeDiv(altToBtcClose, lastAltToBtcRatio);

    // Derived-фичи свечи: body/range/wicks/direction (нормализованы на currentPrice).
    const candleMax = Math.max(altOpenRaw, altCloseRaw);
    const candleMin = Math.min(altOpenRaw, altCloseRaw);
    row[`Candle_Body_${i + 1}`] = safeDiv(altCloseRaw - altOpenRaw, currentPrice);
    row[`Candle_Range_${i + 1}`] = safeDiv(altHighRaw - altLowRaw, currentPrice);
    row[`Candle_UpperWick_${i + 1}`] = safeDiv(altHighRaw - candleMax, currentPrice);
    row[`Candle_LowerWick_${i + 1}`] = safeDiv(candleMin - altLowRaw, currentPrice);
    row[`Candle_Direction_${i + 1}`] = altCloseRaw >= altOpenRaw ? 1 : 0;

    // Объем — log1p плюс нормализация по rolling median/mean.
    const candleVol = toNumber(candle?.volume, 0);
    const btcVol = toNumber(btcCandle?.volume, 0);
    const candleWindow = sliceWindow(candleVolumes, i, Math.min(20, candleVolumes.length));
    const btcWindow = sliceWindow(btcVolumes, i, Math.min(20, btcVolumes.length));
    const candleMedian = computeMedian(candleWindow);
    const candleMean = computeMean(candleWindow);
    const btcMedian = computeMedian(btcWindow);
    const btcMean = computeMean(btcWindow);
    row[`Candle_Volume_${i + 1}`] = safeLog1p(candleVol);
    row[`Candle_Volume_${i + 1}_MedianNorm`] = safeDiv(candleVol, candleMedian);
    row[`Candle_Volume_${i + 1}_MeanNorm`] = safeDiv(candleVol, candleMean);
    row[`BTC_Candle_Volume_${i + 1}`] = safeLog1p(btcVol);
    row[`BTC_Candle_Volume_${i + 1}_MedianNorm`] = safeDiv(btcVol, btcMedian);
    row[`BTC_Candle_Volume_${i + 1}_MeanNorm`] = safeDiv(btcVol, btcMean);
  }

  const trendLine = signal?.figures?.trendLine;
  row.TrendLine_Mode = trendLine?.mode === 'highs' ? 1 : 0;
  row.TrendLine_Distance = toNumber(trendLine?.distance, 0);

  const points = asArray(trendLine?.points);
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i] ?? {};
    // ВАЖНО: Значение нормализуется на currentPrice (ценовые единицы).
    // Переводим временные дельты в бары (или в минуты, если interval неизвестен).
    row[`POINTS_VALUE_${i + 1}`] = safeDiv(toNumber(point?.value, 0), currentPrice);
    const pointDeltaMs = lastTimestamp - toNumber(point?.timestamp, 0);
    const pointDeltaMin = safeDiv(pointDeltaMs, 60_000);
    row[`POINTS_TS_${i + 1}`] =
      intervalMinutes > 0 ? safeDiv(pointDeltaMin, intervalMinutes) : pointDeltaMin;
  }

  const touches = asArray(trendLine?.touches);
  for (let i = 0; i < touches.length; i += 1) {
    const touch = touches[i] ?? {};
    // Та же нормализация времени, что и для points.
    row[`TOUCHES_VALUE_${i + 1}`] = safeDiv(toNumber(touch?.value, 0), currentPrice);
    const touchDeltaMs = lastTimestamp - toNumber(touch?.timestamp, 0);
    const touchDeltaMin = safeDiv(touchDeltaMs, 60_000);
    row[`TOUCHES_TS_${i + 1}`] =
      intervalMinutes > 0 ? safeDiv(touchDeltaMin, intervalMinutes) : touchDeltaMin;
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

  // Лейбл сейчас бинарный (profit > 0). Если нужна более богатая супервизия,
  // храните еще и непрерывный target (profit) для регрессии/гибридной модели.
  const profit = toNumber(resultRecord?.profit, NaN);
  row.label = Number.isFinite(profit) ? (profit > 0 ? 1 : 0) : null;

  return row;
};

export type { MlSignalRecord, MlResultRecord };
