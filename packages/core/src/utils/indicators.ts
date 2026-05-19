import {
  Candle,
  BaseStrategyContextSnapshot,
  IndicatorSnapshot,
  IndicatorsHistorySnapshot,
  MlCandleIndicatorsSnapshot,
} from '@tradejs/types';
import { ML_BASE_CANDLES_WINDOW, CORRELATION_WINDOW } from '../constants';
import { cloneArrayValues } from './array';
import { calculateCoinBtcCorrelation } from './correlation';
import { getRegisteredIndicatorEntries } from './indicatorPlugins';
import {
  createSerializableAtr,
  createSerializableBollinger,
  createSerializableMacd,
  createSerializableObv,
  createSerializableSma,
  SerializableAtrState,
  SerializableBollingerState,
  SerializableEmaState,
  SerializableMacdState,
  SerializableObvState,
  SerializableSdState,
  SerializableSmaState,
} from './serializableIndicators';
import {
  createSerializableSpreadSmoother,
  SpreadSmootherState,
} from './spread';

const CANDLE_WINDOW = ML_BASE_CANDLES_WINDOW;
const CONTROLLER_STATE_CANDLE_WINDOW = 128;
const BASE_INTERVAL_MINUTES = 15;
const INDICATOR_TIMEFRAMES = [
  { minutes: 60, suffix: '1h' },
  { minutes: 240, suffix: '4h' },
  { minutes: 1440, suffix: '1d' },
] as const;

const DEFAULT_INDICATOR_PERIODS: IndicatorPeriods = {
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
  levelLookback: 20,
  levelDelay: 2,
};

const resolveIndicatorPeriods = (
  periods: Partial<IndicatorPeriods> = {},
): IndicatorPeriods => {
  const resolved = {
    ...DEFAULT_INDICATOR_PERIODS,
  };

  for (const [key, value] of Object.entries(periods) as Array<
    [keyof IndicatorPeriods, unknown]
  >) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      resolved[key] = value;
    }
  }

  return resolved;
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

const cloneMlCandle = (candle: Candle): Candle => ({
  open: candle.open,
  high: candle.high,
  low: candle.low,
  close: candle.close,
  volume: candle.volume,
  turnover: candle.turnover,
  timestamp: candle.timestamp,
});

const buildCandleSignature = (candle: Candle | undefined): string | null => {
  if (!candle) return null;
  return [
    candle.timestamp,
    candle.open,
    candle.high,
    candle.low,
    candle.close,
    candle.volume,
    candle.turnover,
  ].join(':');
};

const resampleCandles = (
  candles: Candle[],
  targetMinutes: number,
): Candle[] => {
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

const createIncrementalResampleCache = (targetMinutes: number) => {
  const bucketMs = targetMinutes * 60_000;
  const candles: Candle[] = [];

  return {
    restore: (seedCandles: Candle[]) => {
      candles.length = 0;
      seedCandles.forEach((candle) => {
        candles.push(cloneMlCandle(candle));
      });
    },
    push: (raw: Candle) => {
      const candle = toMlCandle(raw);
      const ts = candle.timestamp;
      if (!Number.isFinite(ts) || ts <= 0) {
        return;
      }

      const bucket = Math.floor(ts / bucketMs) * bucketMs;
      const last = candles[candles.length - 1];
      if (!last || last.timestamp !== bucket) {
        candles.push({ ...candle, timestamp: bucket });
        return;
      }

      last.high = Math.max(last.high, candle.high);
      last.low = Math.min(last.low, candle.low);
      last.close = candle.close;
      last.volume += candle.volume;
      last.turnover += candle.turnover;
    },
    snapshot: (limit?: number) => {
      if (limit == null || limit >= candles.length) {
        return candles;
      }

      return candles.slice(0, limit);
    },
    size: () => candles.length,
  };
};

export const buildMlCandleIndicators = (
  candles: Candle[],
  btcCandles: Candle[],
): MlCandleIndicatorsSnapshot => ({
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

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const toNullable = (value: unknown): number | null =>
  isFiniteNumber(value) ? value : null;

const safeDivide = (numerator: number | null, denominator: number | null) => {
  if (
    numerator == null ||
    denominator == null ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return null;
  }

  return numerator / denominator;
};

const calculateZScore = (
  values: Array<number | null | undefined>,
  current: number | null,
) => {
  const finite = values.filter(isFiniteNumber);
  if (current == null || finite.length < 3) return null;

  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  const variance =
    finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / finite.length;
  const std = Math.sqrt(variance);
  if (!Number.isFinite(std) || std === 0) return 0;

  return (current - mean) / std;
};

const getLastFiniteValue = (
  values: Array<number | null | undefined>,
): number | null => {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const value = values[i];
    if (isFiniteNumber(value)) return value;
  }
  return null;
};

const getRelativeChange = (
  current: number | null,
  reference: number | null,
): number | null => {
  if (
    current == null ||
    reference == null ||
    !Number.isFinite(current) ||
    !Number.isFinite(reference) ||
    reference === 0
  ) {
    return null;
  }

  return (current - reference) / Math.abs(reference);
};

const calculateLineSlope = (
  values: Array<number | null | undefined>,
  lookback = 5,
) => {
  const finite = values.filter(isFiniteNumber);
  const window = finite.slice(-lookback);
  if (window.length < 2) return null;

  const first = window[0];
  const last = window[window.length - 1];
  return (last - first) / (window.length - 1);
};

const calculateCloseStreak = (
  closes: number[],
  direction: 'up' | 'down',
): number => {
  if (closes.length < 2) return 0;

  let streak = 0;
  for (let i = closes.length - 1; i > 0; i -= 1) {
    const delta = closes[i] - closes[i - 1];
    if (
      (direction === 'up' && delta > 0) ||
      (direction === 'down' && delta < 0)
    ) {
      streak += 1;
      continue;
    }
    break;
  }
  return streak;
};

const calculateRangePosition = (
  price: number,
  low: number | null,
  high: number | null,
) => {
  if (
    !Number.isFinite(price) ||
    low == null ||
    high == null ||
    !Number.isFinite(low) ||
    !Number.isFinite(high) ||
    high <= low
  ) {
    return null;
  }

  return (price - low) / (high - low);
};

const averageLastN = (values: number[], period: number): number | null => {
  const safePeriod = Math.max(1, Math.floor(period));
  const window = values
    .filter((value) => Number.isFinite(value))
    .slice(-safePeriod);
  if (window.length < safePeriod) return null;
  return window.reduce((sum, value) => sum + value, 0) / window.length;
};

type TrendlineIndicatorHistoryPush = (
  key: string,
  value: number | null | undefined,
) => void;

type NumericHistoryBuffer = {
  values: number[];
  start: number;
  size: number;
};

type IndicatorRuntimeState = {
  maFast: SerializableSmaState;
  maMedium: SerializableSmaState;
  maSlow: SerializableSmaState;
  atr: SerializableAtrState;
  atrPctShort: SerializableSmaState;
  atrPctLong: SerializableSmaState;
  bb: SerializableBollingerState;
  obv: SerializableObvState;
  smaObv: SerializableSmaState;
  macd: SerializableMacdState;
  btcMaFast: SerializableSmaState;
  btcMaSlow: SerializableSmaState;
  spreadSmoother: SpreadSmootherState;
};

export type IndicatorsControllerRuntimeState = {
  indicatorState: IndicatorRuntimeState;
  indicatorHistory: Record<string, NumericHistoryBuffer>;
  btcRuntimeHistory: Record<string, NumericHistoryBuffer>;
  latestIndicatorValues: Record<string, number>;
  rawCoinCandles: Candle[];
  rawBtcCandles: Candle[];
  coinResampledCandles: {
    h1: Candle[];
    h4: Candle[];
    d1: Candle[];
  };
  btcResampledCandles: {
    h1: Candle[];
    h4: Candle[];
    d1: Candle[];
  };
  btcCloses: number[];
  btcBinanceCursor: number;
  btcCoinbaseCursor: number;
};

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
  highLevel: IndicatorValue;
  lowLevel: IndicatorValue;
  prevClose: IndicatorValue;
  correlation: IndicatorValue;
  spread: IndicatorValue;
};

type CreateIndicatorsOptions = {
  includeMlPayload?: boolean;
  btcBinanceData?: Candle[];
  btcCoinbaseData?: Candle[];
  pluginRegistryScope?: string;
  initialRuntimeState?: IndicatorsControllerRuntimeState;
};

type BuildBaseContextParams = {
  candle: Candle;
  prevCandle: Candle | null;
  baseResult: {
    maFast: number | null;
    maMedium: number | null;
    maSlow: number | null;
    atr: number | null;
    atrPct: number | null;
    bbUpper: number | null;
    bbMiddle: number | null;
    bbLower: number | null;
    obv: number | null;
    smaObv: number | null;
    macd: number | null | undefined;
    macdSignal: number | null | undefined;
    macdHistogram: number | null | undefined;
    price24hPcnt: number;
    price1hPcnt: number;
    highPrice1h: number | null;
    lowPrice1h: number | null;
    volume1h: number | null;
    highPrice24h: number | null;
    lowPrice24h: number | null;
    volume24h: number | null;
    highLevel: number | null;
    lowLevel: number | null;
    prevClose: number | null;
    correlation: number;
    spread: number | null;
  };
  candlesHistory: Candle[];
  btcCandlesHistory: Candle[];
  closeSeries: number[];
  volumeSeries: number[];
  btcCloseSeries: number[];
  coinResampledCandles: {
    h1: Candle[];
    h4: Candle[];
    d1: Candle[];
  };
  btcResampledCandles: {
    h1: Candle[];
    h4: Candle[];
    d1: Candle[];
  };
  indicatorHistory: Record<string, NumericHistoryBuffer>;
  indicatorPeriods: IndicatorPeriods;
};

const buildBaseContextMtfSnapshot = ({
  candlesHistory,
  btcCandlesHistory,
  coinResampledCandles,
  btcResampledCandles,
}: Pick<
  BuildBaseContextParams,
  | 'candlesHistory'
  | 'btcCandlesHistory'
  | 'coinResampledCandles'
  | 'btcResampledCandles'
>) => ({
  candles: {
    m15: candlesHistory.slice(-ML_BASE_CANDLES_WINDOW).map(toMlCandle),
    h1: coinResampledCandles.h1.slice(-ML_BASE_CANDLES_WINDOW),
    h4: coinResampledCandles.h4.slice(-ML_BASE_CANDLES_WINDOW),
    d1: coinResampledCandles.d1.slice(-ML_BASE_CANDLES_WINDOW),
  },
  benchmarkCandles: {
    m15: btcCandlesHistory.slice(-ML_BASE_CANDLES_WINDOW).map(toMlCandle),
    h1: btcResampledCandles.h1.slice(-ML_BASE_CANDLES_WINDOW),
    h4: btcResampledCandles.h4.slice(-ML_BASE_CANDLES_WINDOW),
    d1: btcResampledCandles.d1.slice(-ML_BASE_CANDLES_WINDOW),
  },
});

const buildBaseContextSnapshot = ({
  candle,
  prevCandle,
  baseResult,
  candlesHistory,
  btcCandlesHistory,
  closeSeries,
  volumeSeries,
  btcCloseSeries,
  coinResampledCandles,
  btcResampledCandles,
  indicatorHistory,
  indicatorPeriods,
}: BuildBaseContextParams): BaseStrategyContextSnapshot => {
  const atr = toNullable(baseResult.atr);
  const bbWidthPct =
    baseResult.bbUpper != null &&
    baseResult.bbLower != null &&
    baseResult.bbMiddle != null &&
    baseResult.bbMiddle !== 0
      ? ((baseResult.bbUpper - baseResult.bbLower) / baseResult.bbMiddle) * 100
      : null;
  const atrPctSeries = materializeNumericHistory(
    indicatorHistory.atrPct ?? createNumericHistoryBuffer(),
  );
  const macdHistogramSeries = materializeNumericHistory(
    indicatorHistory.macdHistogram ?? createNumericHistoryBuffer(),
  );
  const spreadSeries = materializeNumericHistory(
    indicatorHistory.spread ?? createNumericHistoryBuffer(),
  );
  const recent20 = candlesHistory.slice(-20);
  const recent20High =
    recent20.length > 0 ? Math.max(...recent20.map((item) => item.high)) : null;
  const recent20Low =
    recent20.length > 0 ? Math.min(...recent20.map((item) => item.low)) : null;
  const avgVolume20 =
    recent20.length > 0
      ? recent20.reduce((sum, item) => sum + item.volume, 0) / recent20.length
      : null;
  const avgTurnover20 =
    recent20.length > 0
      ? recent20.reduce((sum, item) => sum + item.turnover, 0) / recent20.length
      : null;
  const volumeRel20 = safeDivide(candle.volume, avgVolume20);
  const turnoverRel20 = safeDivide(candle.turnover, avgTurnover20);
  const effortVsResult = safeDivide(
    volumeRel20,
    Math.abs(getRelativeChange(candle.close, prevCandle?.close ?? null) ?? 0) ||
      null,
  );
  const priceDistanceToMaFastAtr = safeDivide(
    baseResult.maFast == null ? null : candle.close - baseResult.maFast,
    atr,
  );
  const priceDistanceToMaSlowAtr = safeDivide(
    baseResult.maSlow == null ? null : candle.close - baseResult.maSlow,
    atr,
  );
  const distanceToHighLevelAtr = safeDivide(
    baseResult.highLevel == null ? null : candle.close - baseResult.highLevel,
    atr,
  );
  const distanceToLowLevelAtr = safeDivide(
    baseResult.lowLevel == null ? null : candle.close - baseResult.lowLevel,
    atr,
  );
  const maStackScore =
    baseResult.maFast == null ||
    baseResult.maMedium == null ||
    baseResult.maSlow == null
      ? null
      : Math.sign(baseResult.maFast - baseResult.maMedium) +
        Math.sign(baseResult.maMedium - baseResult.maSlow);
  const trendBias =
    maStackScore == null
      ? 'neutral'
      : maStackScore > 0
        ? 'bull'
        : maStackScore < 0
          ? 'bear'
          : 'neutral';
  const persistenceWindow = closeSeries.slice(-10);
  const directionalMoves = persistenceWindow
    .slice(1)
    .map((value, index) => value - persistenceWindow[index]);
  const persistence =
    directionalMoves.length === 0
      ? null
      : directionalMoves.filter((delta) =>
          trendBias === 'bull'
            ? delta > 0
            : trendBias === 'bear'
              ? delta < 0
              : delta === 0,
        ).length / directionalMoves.length;
  const atrPctZScore = calculateZScore(
    atrPctSeries,
    toNullable(baseResult.atrPct),
  );
  const compressionScore = safeDivide(
    toNullable(baseResult.atrPct),
    getLastFiniteValue(atrPctSeries.slice(0, -1)),
  );
  const expansionScore =
    compressionScore == null || compressionScore === 0
      ? null
      : 1 / compressionScore;
  const volatilityState =
    compressionScore == null
      ? 'unknown'
      : compressionScore <= 0.9
        ? 'compressed'
        : compressionScore >= 1.1
          ? 'expanded'
          : 'normal';
  const highLowRange = candle.high - candle.low;
  const bodyStrength =
    highLowRange > 0
      ? Math.abs(candle.close - candle.open) / highLowRange
      : null;
  const closeLocationInRange =
    highLowRange > 0 ? (candle.close - candle.low) / highLowRange : null;
  const breakoutState =
    baseResult.highLevel == null || baseResult.lowLevel == null
      ? 'unknown'
      : candle.close > baseResult.highLevel
        ? prevCandle != null && prevCandle.close <= baseResult.highLevel
          ? 'above_high_level'
          : 'failed_high_breakout'
        : candle.close < baseResult.lowLevel
          ? prevCandle != null && prevCandle.close >= baseResult.lowLevel
            ? 'below_low_level'
            : 'failed_low_breakout'
          : 'inside_range';
  const upperWick =
    highLowRange > 0
      ? (candle.high - Math.max(candle.open, candle.close)) / highLowRange
      : null;
  const lowerWick =
    highLowRange > 0
      ? (Math.min(candle.open, candle.close) - candle.low) / highLowRange
      : null;
  const rejectionWickScore =
    trendBias === 'bull'
      ? lowerWick
      : trendBias === 'bear'
        ? upperWick
        : Math.max(upperWick ?? 0, lowerWick ?? 0);
  const benchmarkMaFast = averageLastN(btcCloseSeries, indicatorPeriods.maFast);
  const benchmarkMaSlow = averageLastN(btcCloseSeries, indicatorPeriods.maSlow);
  const btc1h = btcResampledCandles.h1;
  const btc4h = btcResampledCandles.h4;
  const btc1d = btcResampledCandles.d1;
  const coin1h = coinResampledCandles.h1;
  const coin4h = coinResampledCandles.h4;
  const coin1d = coinResampledCandles.d1;
  const relativeStrength1h = getRelativeChange(
    baseResult.price1hPcnt,
    btc1h.length >= 2
      ? percentChange(
          btc1h[btc1h.length - 1].close,
          btc1h[Math.max(0, btc1h.length - 2)].close,
        )
      : null,
  );
  const relativeStrength4h = getRelativeChange(
    coin4h.length >= 2
      ? percentChange(
          coin4h[coin4h.length - 1].close,
          coin4h[coin4h.length - 2].close,
        )
      : null,
    btc4h.length >= 2
      ? percentChange(
          btc4h[btc4h.length - 1].close,
          btc4h[btc4h.length - 2].close,
        )
      : null,
  );
  const relativeStrength1d = getRelativeChange(
    coin1d.length >= 2
      ? percentChange(
          coin1d[coin1d.length - 1].close,
          coin1d[coin1d.length - 2].close,
        )
      : null,
    btc1d.length >= 2
      ? percentChange(
          btc1d[btc1d.length - 1].close,
          btc1d[btc1d.length - 2].close,
        )
      : null,
  );
  const benchmarkBias =
    btc1h.length >= 2
      ? btc1h[btc1h.length - 1].close > btc1h[btc1h.length - 2].close
        ? 'bull'
        : btc1h[btc1h.length - 1].close < btc1h[btc1h.length - 2].close
          ? 'bear'
          : 'neutral'
      : 'neutral';
  const trendAlignment =
    trendBias === 'neutral' || benchmarkBias === 'neutral'
      ? 'neutral'
      : trendBias === benchmarkBias
        ? trendBias === 'bull'
          ? 'aligned_bull'
          : 'aligned_bear'
        : 'against_benchmark';
  const benchmarkTrendBias =
    benchmarkMaFast == null || benchmarkMaSlow == null
      ? 'neutral'
      : benchmarkMaFast > benchmarkMaSlow
        ? 'bull'
        : benchmarkMaFast < benchmarkMaSlow
          ? 'bear'
          : 'neutral';
  const benchmarkSpreadPct =
    benchmarkMaFast != null && benchmarkMaSlow != null && benchmarkMaSlow !== 0
      ? ((benchmarkMaFast - benchmarkMaSlow) / Math.abs(benchmarkMaSlow)) * 100
      : null;

  const snapshot = {
    candle,
    prevCandle,
    raw: {
      trend: {
        maFast: baseResult.maFast,
        maMedium: baseResult.maMedium,
        maSlow: baseResult.maSlow,
      },
      volatility: {
        atr,
        atrPct: toNullable(baseResult.atrPct),
        bbUpper: baseResult.bbUpper,
        bbMiddle: baseResult.bbMiddle,
        bbLower: baseResult.bbLower,
        bbWidthPct,
      },
      momentum: {
        macd: toNullable(baseResult.macd),
        macdSignal: toNullable(baseResult.macdSignal),
        macdHistogram: toNullable(baseResult.macdHistogram),
      },
      volume: {
        volume: candle.volume,
        turnover: candle.turnover,
        obv: baseResult.obv,
        obvSma: baseResult.smaObv,
        volume1h: baseResult.volume1h,
        volume24h: baseResult.volume24h,
      },
      price: {
        prevClose: baseResult.prevClose,
        price1hPct: baseResult.price1hPcnt,
        price24hPct: baseResult.price24hPcnt,
        highPrice1h: baseResult.highPrice1h,
        lowPrice1h: baseResult.lowPrice1h,
        highPrice24h: baseResult.highPrice24h,
        lowPrice24h: baseResult.lowPrice24h,
      },
      levels: {
        highLevel: baseResult.highLevel,
        lowLevel: baseResult.lowLevel,
      },
      crossAsset: {
        btcCorrelation: baseResult.correlation,
        venueSpread: baseResult.spread,
      },
    },
    regime: {
      trend: {
        bias: trendBias,
        maStackScore,
        priceDistanceToMaFastAtr,
        priceDistanceToMaSlowAtr,
        persistence,
      },
      volatility: {
        atrPctZScore,
        bbWidthPct,
        compressionScore,
        expansionScore,
        state: volatilityState,
      },
      momentum: {
        roc1h: baseResult.price1hPcnt,
        roc4h:
          coin4h.length >= 2
            ? percentChange(
                coin4h[coin4h.length - 1].close,
                coin4h[coin4h.length - 2].close,
              )
            : null,
        roc1d:
          coin1d.length >= 2
            ? percentChange(
                coin1d[coin1d.length - 1].close,
                coin1d[coin1d.length - 2].close,
              )
            : null,
        macdHistogramSlope: calculateLineSlope(macdHistogramSeries, 5),
        bodyStrength,
        closeLocationInRange,
        upCloseStreak: calculateCloseStreak(closeSeries, 'up'),
        downCloseStreak: calculateCloseStreak(closeSeries, 'down'),
      },
    },
    structure: {
      localRange: {
        rangePosition20: calculateRangePosition(
          candle.close,
          recent20Low,
          recent20High,
        ),
        distanceToHighLevelAtr,
        distanceToLowLevelAtr,
        breakoutState,
      },
      candleQuality: {
        upperWickPct: upperWick,
        lowerWickPct: lowerWick,
        rejectionWickScore,
      },
    },
    participation: {
      volume: {
        volumeRel20,
        turnoverRel20,
        volumeTrendSlope: calculateLineSlope(volumeSeries, 5),
        obvSlope: calculateLineSlope(
          materializeNumericHistory(
            indicatorHistory.obv ?? createNumericHistoryBuffer(),
          ),
          5,
        ),
        effortVsResult,
      },
    },
    relative: {
      benchmark: {
        btcCorrelation: baseResult.correlation,
        maFast: benchmarkMaFast,
        maSlow: benchmarkMaSlow,
        bias: benchmarkTrendBias,
        spreadPct: benchmarkSpreadPct,
        relativeStrength1h,
        relativeStrength4h,
        relativeStrength1d,
        trendAlignment,
      },
      execution: {
        venueSpread: baseResult.spread,
        venueSpreadZScore: calculateZScore(
          spreadSeries,
          toNullable(baseResult.spread),
        ),
      },
    },
  } as Omit<BaseStrategyContextSnapshot, 'mtf'> & {
    mtf?: BaseStrategyContextSnapshot['mtf'];
  };

  let cachedMtfSnapshot: BaseStrategyContextSnapshot['mtf'] | null = null;
  Object.defineProperty(snapshot, 'mtf', {
    configurable: true,
    enumerable: true,
    get() {
      if (!cachedMtfSnapshot) {
        cachedMtfSnapshot = buildBaseContextMtfSnapshot({
          candlesHistory,
          btcCandlesHistory,
          coinResampledCandles,
          btcResampledCandles,
        });
      }

      return cachedMtfSnapshot;
    },
  });

  return snapshot as BaseStrategyContextSnapshot;
};

const cloneHistorySnapshot = (
  record: Record<string, number[] | Candle[]>,
): Record<string, number[] | Candle[]> =>
  Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      Array.isArray(value)
        ? value.map((item) =>
            item && typeof item === 'object'
              ? ({ ...(item as Candle) } as Candle)
              : item,
          )
        : value,
    ]),
  ) as Record<string, number[] | Candle[]>;

export interface IndicatorPeriods {
  maFast: number;
  maMedium: number;
  maSlow: number;
  obvSma: number;
  atr: number;
  atrPctShort: number;
  atrPctLong: number;
  bb: number;
  bbStd: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  levelLookback: number;
  levelDelay: number;
}

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
  pushIndicator('highLevel', indicators.highLevel ?? undefined);
  pushIndicator('lowLevel', indicators.lowLevel ?? undefined);
  pushIndicator('prevClose', indicators.prevClose ?? undefined);
  pushIndicator('correlation', indicators.correlation ?? undefined);
  pushIndicator('spread', indicators.spread ?? undefined);
};

const BASE_HISTORY_KEYS = [
  'maFast',
  'maMedium',
  'maSlow',
  'atr',
  'atrPct',
  'bbUpper',
  'bbMiddle',
  'bbLower',
  'obv',
  'smaObv',
  'macd',
  'macdSignal',
  'macdHistogram',
  'price24hPcnt',
  'price1hPcnt',
  'highPrice1h',
  'lowPrice1h',
  'volume1h',
  'highPrice24h',
  'lowPrice24h',
  'volume24h',
  'highLevel',
  'lowLevel',
  'prevClose',
  'correlation',
  'spread',
] as const;

const CACHEABLE_INDICATOR_KEYS = [...BASE_HISTORY_KEYS] as const;

const TIMEFRAME_SUFFIXES = ['1h', '4h', '1d'] as const;
const CANDLE_SERIES_KEYS = [
  'candles15m',
  'candles1h',
  'candles4h',
  'candles1d',
  'btcCandles15m',
  'btcCandles1h',
  'btcCandles4h',
  'btcCandles1d',
] as const;
const BTC_RUNTIME_KEYS = ['btcMaFast', 'btcMaSlow'] as const;
const prefixStrategySnapshotKey = (key: string, sourcePrefix = '') => {
  if (!sourcePrefix) return key;
  return `${sourcePrefix}${key[0].toUpperCase()}${key.slice(1)}`;
};
const COIN_TIMEFRAME_KEYS = BASE_HISTORY_KEYS.flatMap((key) =>
  TIMEFRAME_SUFFIXES.map((suffix) => `${key}${suffix}`),
);
const BTC_TIMEFRAME_KEYS = BASE_HISTORY_KEYS.flatMap((key) => [
  prefixStrategySnapshotKey(key, 'btc'),
  ...TIMEFRAME_SUFFIXES.map((suffix) =>
    prefixStrategySnapshotKey(`${key}${suffix}`, 'btc'),
  ),
]);
const STRATEGY_SNAPSHOT_LAZY_KEYS = new Set<string>([
  ...CANDLE_SERIES_KEYS,
  ...COIN_TIMEFRAME_KEYS,
  ...BTC_TIMEFRAME_KEYS.filter(
    (key) =>
      !BTC_RUNTIME_KEYS.includes(key as (typeof BTC_RUNTIME_KEYS)[number]),
  ),
]);

const createNumericHistoryBuffer = (): NumericHistoryBuffer => ({
  values: new Array<number>(ML_BASE_CANDLES_WINDOW),
  start: 0,
  size: 0,
});

const cloneNumericHistoryBuffer = (
  buffer: NumericHistoryBuffer,
): NumericHistoryBuffer => ({
  values: [...buffer.values],
  start: buffer.start,
  size: buffer.size,
});

const appendNumericHistory = (buffer: NumericHistoryBuffer, value: number) => {
  if (buffer.size < ML_BASE_CANDLES_WINDOW) {
    buffer.values[(buffer.start + buffer.size) % ML_BASE_CANDLES_WINDOW] =
      value;
    buffer.size += 1;
    return;
  }

  buffer.values[buffer.start] = value;
  buffer.start = (buffer.start + 1) % ML_BASE_CANDLES_WINDOW;
};

const materializeNumericHistory = (buffer: NumericHistoryBuffer): number[] => {
  const materialized = new Array<number>(buffer.size);

  for (let index = 0; index < buffer.size; index += 1) {
    materialized[index] =
      buffer.values[(buffer.start + index) % ML_BASE_CANDLES_WINDOW]!;
  }

  return materialized;
};

export const createIndicators = (
  data: Candle[],
  btcData: Candle[] = [],
  options: CreateIndicatorsOptions & {
    periods?: Partial<IndicatorPeriods>;
  } = {},
) => {
  const indicatorPluginEntries = getRegisteredIndicatorEntries(
    options.pluginRegistryScope,
  );
  const includeMlPayload = options.includeMlPayload !== false;
  const indicatorPeriods = resolveIndicatorPeriods(options.periods);
  const closes: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const volumes: number[] = [];
  const timestamps: number[] = [];
  const btcCloses: number[] = [];
  const candlesHistory: Candle[] = [];
  const btcCandlesHistory: Candle[] = [];
  const btcBinanceCandles = (options.btcBinanceData ?? []).map(toMlCandle);
  const btcCoinbaseCandles = (options.btcCoinbaseData ?? []).map(toMlCandle);
  const restoredState = options.initialRuntimeState;
  const spreadSmoother = createSerializableSpreadSmoother(
    undefined,
    restoredState?.indicatorState.spreadSmoother,
  );
  let btcBinanceCursor = restoredState?.btcBinanceCursor ?? 0;
  let btcCoinbaseCursor = restoredState?.btcCoinbaseCursor ?? 0;
  const createRollingCandleWindow = (windowSize: number) => {
    const buffer = new Array<Candle | undefined>(Math.max(0, windowSize));
    const snapshot: Candle[] = [];
    let startIndex = 0;
    let size = 0;

    return {
      push: (candle: Candle) => {
        if (windowSize <= 0) {
          return;
        }

        if (size < windowSize) {
          buffer[(startIndex + size) % windowSize] = candle;
          size += 1;
          return;
        }

        buffer[startIndex] = candle;
        startIndex = (startIndex + 1) % windowSize;
      },
      snapshot: (): Candle[] => {
        snapshot.length = size;
        for (let index = 0; index < size; index += 1) {
          snapshot[index] = buffer[(startIndex + index) % windowSize]!;
        }
        return snapshot;
      },
      size: () => size,
    };
  };
  const correlationCoinWindow = createRollingCandleWindow(CORRELATION_WINDOW);
  const correlationBtcWindow = createRollingCandleWindow(CORRELATION_WINDOW);
  const coin1hCache = createIncrementalResampleCache(60);
  const coin4hCache = createIncrementalResampleCache(240);
  const coin1dCache = createIncrementalResampleCache(1440);
  const btc1hCache = createIncrementalResampleCache(60);
  const btc4hCache = createIncrementalResampleCache(240);
  const btc1dCache = createIncrementalResampleCache(1440);

  const obv = createSerializableObv(restoredState?.indicatorState.obv);
  const smaObv = createSerializableSma(
    indicatorPeriods.obvSma,
    restoredState?.indicatorState.smaObv,
  );
  const ma14 = createSerializableSma(
    indicatorPeriods.maFast,
    restoredState?.indicatorState.maFast,
  );
  const ma49 = createSerializableSma(
    indicatorPeriods.maMedium,
    restoredState?.indicatorState.maMedium,
  );
  const ma50 = createSerializableSma(
    indicatorPeriods.maSlow,
    restoredState?.indicatorState.maSlow,
  );
  const atr = createSerializableAtr(
    indicatorPeriods.atr,
    restoredState?.indicatorState.atr,
  );
  const atrPctShort = createSerializableSma(
    indicatorPeriods.atrPctShort,
    restoredState?.indicatorState.atrPctShort,
  );
  const atrPctLong = createSerializableSma(
    indicatorPeriods.atrPctLong,
    restoredState?.indicatorState.atrPctLong,
  );
  const bb = createSerializableBollinger(
    indicatorPeriods.bb,
    indicatorPeriods.bbStd,
    restoredState?.indicatorState.bb,
  );
  const macd = createSerializableMacd(
    {
      fastPeriod: indicatorPeriods.macdFast,
      slowPeriod: indicatorPeriods.macdSlow,
      signalPeriod: indicatorPeriods.macdSignal,
      simpleOscillator: false,
      simpleSignal: false,
    },
    restoredState?.indicatorState.macd,
  );
  const btcMaFast = createSerializableSma(
    indicatorPeriods.maFast,
    restoredState?.indicatorState.btcMaFast,
  );
  const btcMaSlow = createSerializableSma(
    indicatorPeriods.maSlow,
    restoredState?.indicatorState.btcMaSlow,
  );

  const indicatorHistory: Record<string, NumericHistoryBuffer> =
    Object.fromEntries(
      Object.entries(restoredState?.indicatorHistory ?? {}).map(
        ([key, buffer]) => [key, cloneNumericHistoryBuffer(buffer)],
      ),
    );
  const btcRuntimeHistory: Record<
    (typeof BTC_RUNTIME_KEYS)[number],
    NumericHistoryBuffer
  > = {
    btcMaFast: cloneNumericHistoryBuffer(
      restoredState?.btcRuntimeHistory?.btcMaFast ??
        createNumericHistoryBuffer(),
    ),
    btcMaSlow: cloneNumericHistoryBuffer(
      restoredState?.btcRuntimeHistory?.btcMaSlow ??
        createNumericHistoryBuffer(),
    ),
  };
  const latestIndicatorValues: Record<string, number> = {
    ...(restoredState?.latestIndicatorValues ?? {}),
  };
  const indicatorPluginErrorShown = new Set<string>();
  let cachedBaseHistoryResult: Record<string, number[]> | null = null;
  let cachedBtcRuntimeHistoryResult: Record<string, number[]> | null = null;
  let cachedHistoryResult: IndicatorsHistorySnapshot | null = null;
  let isBaseHistoryDirty = true;
  let isBtcRuntimeHistoryDirty = true;
  let isHistoryResultDirty = true;

  restoredState?.rawCoinCandles.forEach((candle) => {
    const normalized = toMlCandle(candle);
    candlesHistory.push(normalized);
    closes.push(normalized.close);
    highs.push(normalized.high);
    lows.push(normalized.low);
    volumes.push(normalized.volume);
    timestamps.push(normalized.timestamp);
  });
  restoredState?.rawBtcCandles.forEach((candle) => {
    const normalized = toMlCandle(candle);
    btcCandlesHistory.push(normalized);
  });
  restoredState?.btcCloses.forEach((value) => {
    btcCloses.push(value);
  });
  coin1hCache.restore(restoredState?.coinResampledCandles.h1 ?? []);
  coin4hCache.restore(restoredState?.coinResampledCandles.h4 ?? []);
  coin1dCache.restore(restoredState?.coinResampledCandles.d1 ?? []);
  btc1hCache.restore(restoredState?.btcResampledCandles.h1 ?? []);
  btc4hCache.restore(restoredState?.btcResampledCandles.h4 ?? []);
  btc1dCache.restore(restoredState?.btcResampledCandles.d1 ?? []);

  const getBaseHistoryResult = (): Record<string, number[]> => {
    if (isBaseHistoryDirty || !cachedBaseHistoryResult) {
      cachedBaseHistoryResult = Object.fromEntries(
        Object.entries(indicatorHistory).map(([key, buffer]) => [
          key,
          materializeNumericHistory(buffer),
        ]),
      ) as Record<string, number[]>;
      isBaseHistoryDirty = false;
    }

    return cachedBaseHistoryResult;
  };

  const getBtcRuntimeHistoryResult = (): Record<string, number[]> => {
    if (isBtcRuntimeHistoryDirty || !cachedBtcRuntimeHistoryResult) {
      cachedBtcRuntimeHistoryResult = Object.fromEntries(
        Object.entries(btcRuntimeHistory).map(([key, buffer]) => [
          key,
          materializeNumericHistory(buffer),
        ]),
      ) as Record<string, number[]>;
      isBtcRuntimeHistoryDirty = false;
    }

    return cachedBtcRuntimeHistoryResult;
  };

  const getHistoryResult = (): IndicatorsHistorySnapshot => {
    if (isHistoryResultDirty || !cachedHistoryResult) {
      const baseHistory = cloneArrayValues(getBaseHistoryResult());
      cachedHistoryResult = !includeMlPayload
        ? (baseHistory as IndicatorsHistorySnapshot)
        : ({
            ...baseHistory,
            ...buildMlTimeframeIndicators(candlesHistory, indicatorPeriods),
            ...buildMlCandleIndicators(candlesHistory, btcCandlesHistory),
            ...buildIndicatorSeriesByTimeframes(
              btcCandlesHistory,
              indicatorPeriods,
              'btc',
            ),
          } as IndicatorsHistorySnapshot);
      isHistoryResultDirty = false;
    }

    return cachedHistoryResult;
  };

  const pushIndicator = (key: string, value: number | null | undefined) => {
    if (value == null) {
      return;
    }
    if (!indicatorHistory[key]) {
      indicatorHistory[key] = createNumericHistoryBuffer();
    }
    latestIndicatorValues[key] = value;
    appendNumericHistory(indicatorHistory[key], value);
    isBaseHistoryDirty = true;
    isHistoryResultDirty = true;
  };

  const resolveCloseAtOrBefore = (
    candles: Candle[],
    cursor: number,
    targetTs: number,
  ) => {
    let idx = cursor;
    while (idx + 1 < candles.length && candles[idx + 1].timestamp <= targetTs) {
      idx += 1;
    }
    const close =
      idx < candles.length && candles[idx].timestamp <= targetTs
        ? candles[idx].close
        : null;
    return { close, cursor: idx };
  };

  const levelHighDeque: number[] = [];
  const levelLowDeque: number[] = [];

  const pushLevelHighIndex = (index: number) => {
    while (
      levelHighDeque.length > 0 &&
      highs[levelHighDeque[levelHighDeque.length - 1]] <= highs[index]
    ) {
      levelHighDeque.pop();
    }
    levelHighDeque.push(index);
  };

  const pushLevelLowIndex = (index: number) => {
    while (
      levelLowDeque.length > 0 &&
      lows[levelLowDeque[levelLowDeque.length - 1]] >= lows[index]
    ) {
      levelLowDeque.pop();
    }
    levelLowDeque.push(index);
  };

  const updateLevelWindow = (currentIndex: number) => {
    const enteringIndex = currentIndex - indicatorPeriods.levelDelay;
    if (enteringIndex >= 0) {
      pushLevelHighIndex(enteringIndex);
      pushLevelLowIndex(enteringIndex);
    }

    const validStartIndex =
      currentIndex -
      indicatorPeriods.levelDelay -
      indicatorPeriods.levelLookback +
      1;

    while (levelHighDeque.length > 0 && levelHighDeque[0] < validStartIndex) {
      levelHighDeque.shift();
    }

    while (levelLowDeque.length > 0 && levelLowDeque[0] < validStartIndex) {
      levelLowDeque.shift();
    }
  };

  const createRollingWindowTracker = (windowMs: number) => {
    let startIdx = 0;
    let volumeSum = 0;
    const highDeque: number[] = [];
    const lowDeque: number[] = [];

    return {
      push: (currentIndex: number, currentTimestamp: number) => {
        volumeSum += volumes[currentIndex] ?? 0;

        while (
          highDeque.length > 0 &&
          highs[highDeque[highDeque.length - 1]] <= highs[currentIndex]
        ) {
          highDeque.pop();
        }
        highDeque.push(currentIndex);

        while (
          lowDeque.length > 0 &&
          lows[lowDeque[lowDeque.length - 1]] >= lows[currentIndex]
        ) {
          lowDeque.pop();
        }
        lowDeque.push(currentIndex);

        const windowStart = currentTimestamp - windowMs;
        while (
          startIdx < timestamps.length &&
          timestamps[startIdx] < windowStart
        ) {
          if (highDeque[0] === startIdx) {
            highDeque.shift();
          }
          if (lowDeque[0] === startIdx) {
            lowDeque.shift();
          }
          volumeSum -= volumes[startIdx] ?? 0;
          startIdx += 1;
        }

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

        return {
          startIdx,
          high: highDeque.length > 0 ? highs[highDeque[0]] : null,
          low: lowDeque.length > 0 ? lows[lowDeque[0]] : null,
          volume: volumeSum,
          startClose: closes[startIdx] ?? null,
          hasFullWindow: true,
        };
      },
    };
  };

  const createNearestStartCloseTracker = (windowMs: number) => {
    let lowerBoundIdx = 0;

    return {
      resolve: (currentTimestamp: number) => {
        if (timestamps.length === 0) {
          return { startClose: null, startIdx: 0 };
        }

        const windowStart = currentTimestamp - windowMs;
        while (
          lowerBoundIdx < timestamps.length &&
          timestamps[lowerBoundIdx] < windowStart
        ) {
          lowerBoundIdx += 1;
        }

        const idx = lowerBoundIdx;
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
      },
    };
  };

  const window1hTracker = createRollingWindowTracker(ONE_HOUR_MS);
  const window24hTracker = createRollingWindowTracker(ONE_DAY_MS);
  const price1hStartTracker = createNearestStartCloseTracker(ONE_HOUR_MS);
  const price24hStartTracker = createNearestStartCloseTracker(ONE_DAY_MS);

  candlesHistory.forEach((candle, index) => {
    correlationCoinWindow.push(candle);
    if (indicatorPeriods.levelLookback > 0) {
      updateLevelWindow(index);
    }
    window1hTracker.push(index, candle.timestamp);
    window24hTracker.push(index, candle.timestamp);
    price1hStartTracker.resolve(candle.timestamp);
    price24hStartTracker.resolve(candle.timestamp);
  });
  btcCandlesHistory.forEach((candle) => {
    correlationBtcWindow.push(candle);
  });

  const next = (
    candle: Candle,
    btcCandle?: Candle,
  ): IndicatorSnapshot | null => {
    isHistoryResultDirty = true;
    candlesHistory.push(candle);
    coin1hCache.push(candle);
    coin4hCache.push(candle);
    coin1dCache.push(candle);
    correlationCoinWindow.push(candle);
    if (btcCandle) {
      btcCandlesHistory.push(btcCandle);
      btcCloses.push(btcCandle.close);
      btc1hCache.push(btcCandle);
      btc4hCache.push(btcCandle);
      btc1dCache.push(btcCandle);
      correlationBtcWindow.push(btcCandle);

      const btcMaFastValue = btcMaFast.nextValue(btcCandle.close);
      const btcMaSlowValue = btcMaSlow.nextValue(btcCandle.close);

      if (btcMaFastValue != null) {
        appendNumericHistory(btcRuntimeHistory.btcMaFast, btcMaFastValue);
        latestIndicatorValues.btcMaFast = btcMaFastValue;
        isBtcRuntimeHistoryDirty = true;
      }

      if (btcMaSlowValue != null) {
        appendNumericHistory(btcRuntimeHistory.btcMaSlow, btcMaSlowValue);
        latestIndicatorValues.btcMaSlow = btcMaSlowValue;
        isBtcRuntimeHistoryDirty = true;
      }
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

    const currentTimestamp = candle.timestamp;
    const len = candlesHistory.length;
    const currentIndex = len - 1;
    const prevCandle = len > 1 ? candlesHistory[len - 2] : null;
    const correlationCoinCandles = correlationCoinWindow.snapshot();
    const correlationBtcCandles = correlationBtcWindow.snapshot();
    if (indicatorPeriods.levelLookback > 0) {
      updateLevelWindow(currentIndex);
    }
    const correlation =
      correlationBtcWindow.size() > 0
        ? calculateCoinBtcCorrelation(
            correlationCoinCandles as any,
            correlationBtcCandles as any,
          ).correlation ?? 0
        : 0;

    let spread: number | null = null;
    if (btcBinanceCandles.length > 0 && btcCoinbaseCandles.length > 0) {
      const binanceResolved = resolveCloseAtOrBefore(
        btcBinanceCandles,
        btcBinanceCursor,
        currentTimestamp,
      );
      const coinbaseResolved = resolveCloseAtOrBefore(
        btcCoinbaseCandles,
        btcCoinbaseCursor,
        currentTimestamp,
      );
      btcBinanceCursor = binanceResolved.cursor;
      btcCoinbaseCursor = coinbaseResolved.cursor;

      if (
        binanceResolved.close != null &&
        coinbaseResolved.close != null &&
        Number.isFinite(binanceResolved.close) &&
        Number.isFinite(coinbaseResolved.close) &&
        binanceResolved.close > 0
      ) {
        spread = spreadSmoother.next({
          binancePrice: binanceResolved.close,
          coinbasePrice: coinbaseResolved.close,
        });
      }
    }

    const computePluginSeries = (baseResult: Partial<IndicatorSnapshot>) => {
      const pluginSeries: Record<string, number> = {};

      for (const pluginEntry of indicatorPluginEntries) {
        if (!pluginEntry.compute) continue;

        const historyKey = pluginEntry.historyKey || pluginEntry.indicator.id;
        try {
          const pluginValue = pluginEntry.compute({
            candle,
            btcCandle,
            data: candlesHistory,
            btcData: btcCandlesHistory,
            baseResult,
          });

          if (
            pluginValue == null ||
            typeof pluginValue !== 'number' ||
            !Number.isFinite(pluginValue)
          ) {
            continue;
          }

          pluginSeries[historyKey] = pluginValue;
          pushIndicator(historyKey, pluginValue);
        } catch (error) {
          if (indicatorPluginErrorShown.has(historyKey)) {
            continue;
          }
          indicatorPluginErrorShown.add(historyKey);
          // Log once per plugin key to avoid noisy per-candle output.
          console.warn(
            `Indicator plugin "${historyKey}" compute failed: ${String(error)}`,
          );
        }
      }

      return pluginSeries;
    };

    const window1h = window1hTracker.push(currentIndex, currentTimestamp);
    const window24h = window24hTracker.push(currentIndex, currentTimestamp);

    const price1hStart = price1hStartTracker.resolve(currentTimestamp);
    const price24hStart = price24hStartTracker.resolve(currentTimestamp);
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
      computePluginSeries({
        prevCandle,
        correlation,
        spread,
        candle,
      });
      return null;
    }

    let highLevel: number | null = null;
    let lowLevel: number | null = null;
    if (indicatorPeriods.levelLookback > 0) {
      if (
        len >= indicatorPeriods.levelLookback + indicatorPeriods.levelDelay &&
        levelHighDeque.length > 0 &&
        levelLowDeque.length > 0
      ) {
        highLevel = highs[levelHighDeque[0]];
        lowLevel = lows[levelLowDeque[0]];
      }
    } else if (
      len >=
      indicatorPeriods.levelLookback + indicatorPeriods.levelDelay
    ) {
      const window = candlesHistory.slice(
        len - indicatorPeriods.levelLookback - indicatorPeriods.levelDelay,
        len - indicatorPeriods.levelDelay,
      );
      highLevel = Math.max(...window.map((item) => item.high));
      lowLevel = Math.min(...window.map((item) => item.low));
    }

    const baseResult = {
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
      highLevel,
      lowLevel,
      prevClose: prevCandle?.close ?? null,
      correlation,
      spread,
    };

    applyIndicatorsToHistory(baseResult, pushIndicator);

    const pluginSeries = computePluginSeries({
      ...baseResult,
      candle,
      prevCandle,
      correlation,
    });
    let cachedBaseContext: BaseStrategyContextSnapshot | null = null;

    const result = {
      ...baseResult,
      ...pluginSeries,
      candle,
      prevCandle,
      highLevel,
      lowLevel,
      correlation,
    } as IndicatorSnapshot;

    Object.defineProperty(result, 'baseContext', {
      configurable: true,
      enumerable: true,
      get() {
        if (!cachedBaseContext) {
          cachedBaseContext = buildBaseContextSnapshot({
            candle,
            prevCandle,
            baseResult,
            candlesHistory,
            btcCandlesHistory,
            closeSeries: closes,
            volumeSeries: volumes,
            btcCloseSeries: btcCloses,
            coinResampledCandles: {
              h1: coin1hCache.snapshot(),
              h4: coin4hCache.snapshot(),
              d1: coin1dCache.snapshot(),
            },
            btcResampledCandles: {
              h1: btc1hCache.snapshot(),
              h4: btc4hCache.snapshot(),
              d1: btc1dCache.snapshot(),
            },
            indicatorHistory,
            indicatorPeriods,
          });
        }

        return cachedBaseContext;
      },
    });

    return result;
  };

  const buildStrategySnapshot = (): IndicatorsHistorySnapshot => {
    const baseSnapshot = {
      ...cloneArrayValues(getBaseHistoryResult()),
      ...cloneArrayValues(getBtcRuntimeHistoryResult()),
    } as Record<string, unknown>;
    const capturedCoinLength = candlesHistory.length;
    const capturedBtcLength = btcCandlesHistory.length;
    const capturedCoin1hLength = coin1hCache.size();
    const capturedCoin4hLength = coin4hCache.size();
    const capturedCoin1dLength = coin1dCache.size();
    const capturedBtc1hLength = btc1hCache.size();
    const capturedBtc4hLength = btc4hCache.size();
    const capturedBtc1dLength = btc1dCache.size();

    let cachedMlCandleSnapshot: MlCandleIndicatorsSnapshot | null = null;
    let cachedCoinTimeframeSnapshot: Record<string, number[]> | null = null;
    let cachedBtcSnapshot: Record<string, number[]> | null = null;

    const getCapturedCoinCandles = () =>
      candlesHistory.slice(0, capturedCoinLength);
    const getCapturedBtcCandles = () =>
      btcCandlesHistory.slice(0, capturedBtcLength);
    const getCapturedCoinResampled = () => ({
      h1: coin1hCache.snapshot(capturedCoin1hLength),
      h4: coin4hCache.snapshot(capturedCoin4hLength),
      d1: coin1dCache.snapshot(capturedCoin1dLength),
    });
    const getCapturedBtcResampled = () => ({
      h1: btc1hCache.snapshot(capturedBtc1hLength),
      h4: btc4hCache.snapshot(capturedBtc4hLength),
      d1: btc1dCache.snapshot(capturedBtc1dLength),
    });

    const resolveMlCandleSnapshot = () => {
      if (!cachedMlCandleSnapshot) {
        cachedMlCandleSnapshot = buildMlCandleIndicators(
          getCapturedCoinCandles(),
          getCapturedBtcCandles(),
        );
      }

      return cachedMlCandleSnapshot;
    };

    const resolveCoinTimeframeSnapshot = () => {
      if (!cachedCoinTimeframeSnapshot) {
        cachedCoinTimeframeSnapshot = buildMlTimeframeIndicators(
          getCapturedCoinCandles(),
          indicatorPeriods,
        );
      }

      return cachedCoinTimeframeSnapshot;
    };

    const resolveBtcSnapshot = () => {
      if (!cachedBtcSnapshot) {
        cachedBtcSnapshot = buildIndicatorSeriesByTimeframes(
          getCapturedBtcCandles(),
          indicatorPeriods,
          'btc',
        );
      }

      return cachedBtcSnapshot;
    };

    return new Proxy(baseSnapshot, {
      get(target, prop, receiver) {
        if (typeof prop !== 'string') {
          return Reflect.get(target, prop, receiver);
        }

        if (prop === 'baseContext') {
          const latestCandle = candlesHistory[capturedCoinLength - 1];
          if (!latestCandle) return undefined;

          const latestPrevCandle =
            capturedCoinLength > 1
              ? candlesHistory[capturedCoinLength - 2]
              : null;

          const baseResult = {
            maFast:
              getLastFiniteValue(
                materializeNumericHistory(
                  indicatorHistory.maFast ?? createNumericHistoryBuffer(),
                ),
              ) ?? null,
            maMedium:
              getLastFiniteValue(
                materializeNumericHistory(
                  indicatorHistory.maMedium ?? createNumericHistoryBuffer(),
                ),
              ) ?? null,
            maSlow:
              getLastFiniteValue(
                materializeNumericHistory(
                  indicatorHistory.maSlow ?? createNumericHistoryBuffer(),
                ),
              ) ?? null,
            atr:
              getLastFiniteValue(
                materializeNumericHistory(
                  indicatorHistory.atr ?? createNumericHistoryBuffer(),
                ),
              ) ?? null,
            atrPct:
              getLastFiniteValue(
                materializeNumericHistory(
                  indicatorHistory.atrPct ?? createNumericHistoryBuffer(),
                ),
              ) ?? null,
            bbUpper:
              getLastFiniteValue(
                materializeNumericHistory(
                  indicatorHistory.bbUpper ?? createNumericHistoryBuffer(),
                ),
              ) ?? null,
            bbMiddle:
              getLastFiniteValue(
                materializeNumericHistory(
                  indicatorHistory.bbMiddle ?? createNumericHistoryBuffer(),
                ),
              ) ?? null,
            bbLower:
              getLastFiniteValue(
                materializeNumericHistory(
                  indicatorHistory.bbLower ?? createNumericHistoryBuffer(),
                ),
              ) ?? null,
            obv:
              getLastFiniteValue(
                materializeNumericHistory(
                  indicatorHistory.obv ?? createNumericHistoryBuffer(),
                ),
              ) ?? null,
            smaObv:
              getLastFiniteValue(
                materializeNumericHistory(
                  indicatorHistory.smaObv ?? createNumericHistoryBuffer(),
                ),
              ) ?? null,
            macd:
              getLastFiniteValue(
                materializeNumericHistory(
                  indicatorHistory.macd ?? createNumericHistoryBuffer(),
                ),
              ) ?? null,
            macdSignal:
              getLastFiniteValue(
                materializeNumericHistory(
                  indicatorHistory.macdSignal ?? createNumericHistoryBuffer(),
                ),
              ) ?? null,
            macdHistogram:
              getLastFiniteValue(
                materializeNumericHistory(
                  indicatorHistory.macdHistogram ??
                    createNumericHistoryBuffer(),
                ),
              ) ?? null,
            price24hPcnt:
              getLastFiniteValue(
                materializeNumericHistory(
                  indicatorHistory.price24hPcnt ?? createNumericHistoryBuffer(),
                ),
              ) ?? 0,
            price1hPcnt:
              getLastFiniteValue(
                materializeNumericHistory(
                  indicatorHistory.price1hPcnt ?? createNumericHistoryBuffer(),
                ),
              ) ?? 0,
            highPrice1h:
              getLastFiniteValue(
                materializeNumericHistory(
                  indicatorHistory.highPrice1h ?? createNumericHistoryBuffer(),
                ),
              ) ?? null,
            lowPrice1h:
              getLastFiniteValue(
                materializeNumericHistory(
                  indicatorHistory.lowPrice1h ?? createNumericHistoryBuffer(),
                ),
              ) ?? null,
            volume1h:
              getLastFiniteValue(
                materializeNumericHistory(
                  indicatorHistory.volume1h ?? createNumericHistoryBuffer(),
                ),
              ) ?? null,
            highPrice24h:
              getLastFiniteValue(
                materializeNumericHistory(
                  indicatorHistory.highPrice24h ?? createNumericHistoryBuffer(),
                ),
              ) ?? null,
            lowPrice24h:
              getLastFiniteValue(
                materializeNumericHistory(
                  indicatorHistory.lowPrice24h ?? createNumericHistoryBuffer(),
                ),
              ) ?? null,
            volume24h:
              getLastFiniteValue(
                materializeNumericHistory(
                  indicatorHistory.volume24h ?? createNumericHistoryBuffer(),
                ),
              ) ?? null,
            highLevel:
              getLastFiniteValue(
                materializeNumericHistory(
                  indicatorHistory.highLevel ?? createNumericHistoryBuffer(),
                ),
              ) ?? null,
            lowLevel:
              getLastFiniteValue(
                materializeNumericHistory(
                  indicatorHistory.lowLevel ?? createNumericHistoryBuffer(),
                ),
              ) ?? null,
            prevClose: latestPrevCandle?.close ?? null,
            correlation:
              getLastFiniteValue(
                materializeNumericHistory(
                  indicatorHistory.correlation ?? createNumericHistoryBuffer(),
                ),
              ) ?? 0,
            spread:
              getLastFiniteValue(
                materializeNumericHistory(
                  indicatorHistory.spread ?? createNumericHistoryBuffer(),
                ),
              ) ?? null,
          };

          return buildBaseContextSnapshot({
            candle: latestCandle,
            prevCandle: latestPrevCandle,
            baseResult,
            candlesHistory: getCapturedCoinCandles(),
            btcCandlesHistory: getCapturedBtcCandles(),
            closeSeries: closes.slice(0, capturedCoinLength),
            volumeSeries: volumes.slice(0, capturedCoinLength),
            btcCloseSeries: btcCloses.slice(0, capturedBtcLength),
            coinResampledCandles: getCapturedCoinResampled(),
            btcResampledCandles: getCapturedBtcResampled(),
            indicatorHistory,
            indicatorPeriods,
          });
        }

        if (Reflect.has(target, prop)) {
          return Reflect.get(target, prop, receiver);
        }

        if ((CANDLE_SERIES_KEYS as readonly string[]).includes(prop)) {
          return resolveMlCandleSnapshot()[
            prop as keyof MlCandleIndicatorsSnapshot
          ];
        }

        if ((COIN_TIMEFRAME_KEYS as readonly string[]).includes(prop)) {
          return resolveCoinTimeframeSnapshot()[prop];
        }

        if ((BTC_TIMEFRAME_KEYS as readonly string[]).includes(prop)) {
          return resolveBtcSnapshot()[prop];
        }

        return undefined;
      },
      ownKeys(target) {
        return Array.from(
          new Set([
            ...Reflect.ownKeys(target),
            ...Array.from(STRATEGY_SNAPSHOT_LAZY_KEYS),
          ]),
        );
      },
      getOwnPropertyDescriptor(target, prop) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, prop);
        if (descriptor) {
          return descriptor;
        }

        if (typeof prop === 'string' && STRATEGY_SNAPSHOT_LAZY_KEYS.has(prop)) {
          return {
            enumerable: true,
            configurable: true,
          };
        }

        return undefined;
      },
    }) as IndicatorsHistorySnapshot;
  };

  data.forEach((candle, index) => {
    next(candle, btcData[index]);
  });

  const runtimeState = (): IndicatorsControllerRuntimeState => ({
    indicatorState: {
      maFast: ma14.snapshot(),
      maMedium: ma49.snapshot(),
      maSlow: ma50.snapshot(),
      atr: atr.snapshot(),
      atrPctShort: atrPctShort.snapshot(),
      atrPctLong: atrPctLong.snapshot(),
      bb: bb.snapshot(),
      obv: obv.snapshot(),
      smaObv: smaObv.snapshot(),
      macd: macd.snapshot(),
      btcMaFast: btcMaFast.snapshot(),
      btcMaSlow: btcMaSlow.snapshot(),
      spreadSmoother: spreadSmoother.snapshot(),
    },
    indicatorHistory: Object.fromEntries(
      Object.entries(indicatorHistory).map(([key, buffer]) => [
        key,
        cloneNumericHistoryBuffer(buffer),
      ]),
    ),
    btcRuntimeHistory: Object.fromEntries(
      Object.entries(btcRuntimeHistory).map(([key, buffer]) => [
        key,
        cloneNumericHistoryBuffer(buffer),
      ]),
    ),
    latestIndicatorValues: { ...latestIndicatorValues },
    rawCoinCandles: candlesHistory
      .slice(-CONTROLLER_STATE_CANDLE_WINDOW)
      .map(cloneMlCandle),
    rawBtcCandles: btcCandlesHistory
      .slice(-CONTROLLER_STATE_CANDLE_WINDOW)
      .map(cloneMlCandle),
    coinResampledCandles: {
      h1: coin1hCache
        .snapshot()
        .slice(-ML_BASE_CANDLES_WINDOW)
        .map(cloneMlCandle),
      h4: coin4hCache
        .snapshot()
        .slice(-ML_BASE_CANDLES_WINDOW)
        .map(cloneMlCandle),
      d1: coin1dCache
        .snapshot()
        .slice(-ML_BASE_CANDLES_WINDOW)
        .map(cloneMlCandle),
    },
    btcResampledCandles: {
      h1: btc1hCache
        .snapshot()
        .slice(-ML_BASE_CANDLES_WINDOW)
        .map(cloneMlCandle),
      h4: btc4hCache
        .snapshot()
        .slice(-ML_BASE_CANDLES_WINDOW)
        .map(cloneMlCandle),
      d1: btc1dCache
        .snapshot()
        .slice(-ML_BASE_CANDLES_WINDOW)
        .map(cloneMlCandle),
    },
    btcCloses: btcCloses.slice(-CONTROLLER_STATE_CANDLE_WINDOW),
    btcBinanceCursor,
    btcCoinbaseCursor,
  });

  return {
    next,
    snapshot: (): IndicatorsHistorySnapshot => buildStrategySnapshot(),
    runtimeState,
    latestNumber: (key: string): number | undefined => {
      const latestValue = latestIndicatorValues[key];
      if (typeof latestValue === 'number') {
        return latestValue;
      }

      const value = getHistoryResult()[key as keyof IndicatorsHistorySnapshot];
      if (!Array.isArray(value) || value.length === 0) {
        return undefined;
      }

      const last = value[value.length - 1];
      return typeof last === 'number' ? last : undefined;
    },
    result: (): IndicatorsHistorySnapshot => {
      return cloneHistorySnapshot(
        getHistoryResult() as Record<string, number[] | Candle[]>,
      ) as IndicatorsHistorySnapshot;
    },
  };
};

export type IndicatorCacheSnapshotEntry = {
  timestamp: number;
  candleSignature: string | null;
  btcCandleSignature: string | null;
  ready: boolean;
  indicatorValues: Partial<
    Record<(typeof CACHEABLE_INDICATOR_KEYS)[number], number | null>
  >;
  baseContext: Omit<BaseStrategyContextSnapshot, 'mtf'> | null;
  runtimeState: IndicatorsControllerRuntimeState;
};

const stripMtfFromBaseContext = (
  baseContext: BaseStrategyContextSnapshot,
): Omit<BaseStrategyContextSnapshot, 'mtf'> => {
  const { mtf: _mtf, ...rest } = baseContext;
  return rest;
};

const toCacheableIndicatorValues = (
  snapshot: IndicatorSnapshot,
): IndicatorCacheSnapshotEntry['indicatorValues'] =>
  Object.fromEntries(
    CACHEABLE_INDICATOR_KEYS.map((key) => [
      key,
      toNullable(snapshot[key as keyof IndicatorSnapshot]),
    ]),
  ) as IndicatorCacheSnapshotEntry['indicatorValues'];

export const buildIndicatorCacheSnapshots = (
  data: Candle[],
  btcData: Candle[] = [],
  options: CreateIndicatorsOptions & {
    periods?: Partial<IndicatorPeriods>;
  } = {},
): IndicatorCacheSnapshotEntry[] => {
  const controller = createIndicators([], [], options);
  const entries: IndicatorCacheSnapshotEntry[] = [];

  data.forEach((candle, index) => {
    const btcCandle = btcData[index];
    const snapshot = controller.next(candle, btcCandle);
    entries.push({
      timestamp: candle.timestamp,
      candleSignature: buildCandleSignature(candle),
      btcCandleSignature: buildCandleSignature(btcCandle),
      ready: snapshot != null,
      indicatorValues:
        snapshot == null ? {} : toCacheableIndicatorValues(snapshot),
      baseContext:
        snapshot?.baseContext == null
          ? null
          : stripMtfFromBaseContext(snapshot.baseContext),
      runtimeState: controller.runtimeState(),
    });
  });

  return entries;
};

export const buildMlTimeframeIndicators = (
  candles: Candle[],
  periods: Partial<IndicatorPeriods> = {},
): Record<string, number[]> => {
  const result: Record<string, number[]> = {};
  const indicatorPeriods = resolveIndicatorPeriods(periods);

  for (const timeframe of INDICATOR_TIMEFRAMES) {
    const tfCandles = resampleCandles(candles, timeframe.minutes);
    if (tfCandles.length === 0) continue;

    const history = createIndicators(tfCandles, [], {
      includeMlPayload: false,
      periods: indicatorPeriods,
    }).result() as Record<string, number[]>;
    for (const [key, values] of Object.entries(history)) {
      result[`${key}${timeframe.suffix}`] = values;
    }
  }

  return cloneArrayValues(result);
};

const withSourcePrefix = (key: string, sourcePrefix = '') => {
  if (!sourcePrefix) return key;
  return `${sourcePrefix}${key[0].toUpperCase()}${key.slice(1)}`;
};

const buildIndicatorSeriesByTimeframes = (
  candles: Candle[],
  periods: Partial<IndicatorPeriods>,
  sourcePrefix = '',
): Record<string, number[]> => {
  const result: Record<string, number[]> = {};
  if (candles.length === 0) return result;

  const baseHistory = createIndicators(candles, [], {
    includeMlPayload: false,
    periods,
  }).result() as Record<string, number[]>;
  for (const [key, values] of Object.entries(baseHistory)) {
    result[withSourcePrefix(key, sourcePrefix)] = values;
  }

  const timeframeHistory = buildMlTimeframeIndicators(candles, periods);
  for (const [key, values] of Object.entries(timeframeHistory)) {
    result[withSourcePrefix(key, sourcePrefix)] = values;
  }

  return cloneArrayValues(result);
};
