import type { BaseStrategyContextSnapshot, Candle } from '@tradejs/types';
import { adx, rsi } from 'fast-technical-indicators';
import { ML_BASE_CANDLES_WINDOW } from '../constants';
import {
  createNumericHistoryBuffer,
  materializeNumericHistory,
  type NumericHistoryBuffer,
} from './indicatorHistory';
import {
  averageLastN,
  calculateLineSlope,
  calculateRangePosition,
  calculateZScore,
  getRelativeChange,
  getLastFiniteValue,
  percentChange,
  safeDivide,
  toMlCandle,
  toNullable,
} from './indicatorMath';
import type { IndicatorPeriods } from './indicators';

export type CloseStreakRuntimeState = {
  up: number;
  down: number;
};

export type BreakoutRuntimeState = {
  side: 'high' | 'low' | null;
  barsSinceBreakout: number | null;
};

export type BaseContextNativeOverlay = {
  adaptiveChannel?: BaseStrategyContextSnapshot['regime']['trend']['adaptiveChannel'];
  trendFollow?: BaseStrategyContextSnapshot['regime']['trend']['trendFollow'];
  srZones?: BaseStrategyContextSnapshot['structure']['srZones'];
  liquidityZones?: BaseStrategyContextSnapshot['structure']['liquidityZones'];
  liquidityTails?: BaseStrategyContextSnapshot['structure']['liquidityTails'];
  volumeStructure?: BaseStrategyContextSnapshot['participation']['volumeStructure'];
  delta?: BaseStrategyContextSnapshot['participation']['delta'];
};

const SESSION_WINDOWS: Array<{
  name: 'asia' | 'europe' | 'us';
  startMinuteUtc: number;
  endMinuteUtc: number;
}> = [
  { name: 'asia', startMinuteUtc: 0, endMinuteUtc: 8 * 60 },
  { name: 'europe', startMinuteUtc: 7 * 60, endMinuteUtc: 16 * 60 },
  { name: 'us', startMinuteUtc: 13 * 60, endMinuteUtc: 22 * 60 },
];

const FUNDING_WINDOW_STEP_MINUTES = 8 * 60;
const FUNDING_WINDOW_NEARBY_MINUTES = 60;

const isInsideSession = (
  minuteUtc: number,
  startMinuteUtc: number,
  endMinuteUtc: number,
) =>
  startMinuteUtc <= endMinuteUtc
    ? minuteUtc >= startMinuteUtc && minuteUtc < endMinuteUtc
    : minuteUtc >= startMinuteUtc || minuteUtc < endMinuteUtc;

export const buildSessionContext = (timestamp: number) => {
  const date = new Date(timestamp);
  const utcHour = date.getUTCHours();
  const utcMinute = date.getUTCMinutes();
  const minuteUtc = utcHour * 60 + utcMinute;
  const activeSessions = SESSION_WINDOWS.filter((session) =>
    isInsideSession(minuteUtc, session.startMinuteUtc, session.endMinuteUtc),
  ).map((session) => session.name);

  const sessionPhase = activeSessions.includes('us')
    ? 'us'
    : activeSessions.includes('europe')
      ? 'europe'
      : activeSessions.includes('asia')
        ? 'asia'
        : 'off_hours';

  const primaryWindow = SESSION_WINDOWS.find(
    (session) => session.name === sessionPhase,
  );
  const minutesFromSessionOpen =
    primaryWindow != null ? minuteUtc - primaryWindow.startMinuteUtc : null;
  const minutesToFundingWindow =
    (FUNDING_WINDOW_STEP_MINUTES - (minuteUtc % FUNDING_WINDOW_STEP_MINUTES)) %
    FUNDING_WINDOW_STEP_MINUTES;

  return {
    sessionPhase,
    isOverlap: activeSessions.length > 1,
    minutesFromSessionOpen,
    minutesToFundingWindow,
    fundingWindowNearby:
      minutesToFundingWindow <= FUNDING_WINDOW_NEARBY_MINUTES,
  };
};

type BaseResultSnapshot = {
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

type PivotPoint = {
  type: 'high' | 'low';
  index: number;
  price: number;
};

type PriceZone = {
  type: 'support' | 'resistance';
  level: number;
  lower: number;
  upper: number;
  touches: number;
  volume: number;
  ageBars: number;
};

const STRUCTURE_LOOKBACK = 80;
const PIVOT_LEFT_RIGHT = 2;
const ZONE_ATR_FACTOR = 0.5;
const PROFILE_BIN_COUNT = 24;
const SR_ZONE_PIVOT_PERIOD = 9;
const SR_ZONE_MIN_STRENGTH = 2;
const SR_ZONE_MAX_PIVOTS = 15;
const SR_ZONE_CHANNEL_WIDTH_PCT = 8;
const SR_ZONE_MAX_LEVELS = 6;
const VOLUME_STRUCTURE_CALC_BARS = 180;
const VOLUME_STRUCTURE_ROW_COUNT = 20;
const LIQUIDITY_ZONE_LOOKBACK = 15;
const LIQUIDITY_ZONE_MAX_AGE = 120;
const LIQUIDITY_TAIL_ATR_LENGTH = 14;
const LIQUIDITY_TAIL_ATR_MULT = 0.8;
const LIQUIDITY_TAIL_MIN_WICK_RATIO = 1.3;
const LIQUIDITY_TAIL_WICK_DOMINANCE = 1.2;
const LIQUIDITY_TAIL_MIN_GAP = 5;
const LIQUIDITY_TAIL_MAX_AGE = 120;
const TREND_FOLLOW_PIVOT_LENGTH = 10;
const TREND_FOLLOW_ATR_LENGTH = 14;
const TREND_FOLLOW_ATR_MULT = 4;
const ADAPTIVE_CHANNEL_REGRESSION_BARS = 7;
const ADAPTIVE_CHANNEL_ENVELOPE_BARS = 2;
const ADAPTIVE_CHANNEL_ATR_STRETCH = 2;
const ADAPTIVE_CHANNEL_VOLATILITY_LOOKBACK = 100;
const ADAPTIVE_CHANNEL_CALC_LOOKBACK = 220;
const STRUCTURE_ZONES_ZONE_WIDTH_ATR = 0.5;
const STRUCTURE_ZONES_ACCEPT_BARS = 2;
export const BASE_CONTEXT_MA_LAYER_PERIODS = [
  [5, 12],
  [9, 13],
  [34, 50],
  [72, 89],
  [180, 200],
] as const;

export type BaseContextMaLayerInput = {
  fastPeriod: number;
  slowPeriod: number;
  fast: number | null;
  slow: number | null;
};

export type BaseContextContextMaInput = {
  baseline: number | null;
};

export type BaseContextAdaptiveChannelInput = {
  centerline: number | null;
  previousCenterline: number | null;
};

export type BaseContextPsarInput = {
  value: number | null;
  direction: 'bull' | 'bear' | 'unknown';
  rawBuySignal: boolean | null;
  rawSellSignal: boolean | null;
  buySignal: boolean | null;
  sellSignal: boolean | null;
  emaFilter: number | null;
  trendLongOk: boolean | null;
  trendShortOk: boolean | null;
  adxOk: boolean | null;
  candleLongOk: boolean | null;
  candleShortOk: boolean | null;
  cooldownOk: boolean | null;
  barsSinceSignal: number | null;
};

type SrZoneLevel = {
  level: number;
  upper: number;
  lower: number;
  strength: number;
  distancePct: number | null;
  side: 'support' | 'resistance';
};

type LiquidityZoneSnapshot = {
  kind: 'swing_high_liquidity' | 'swing_low_liquidity';
  top: number;
  bottom: number;
  level: number;
  mid: number;
  startIndex: number;
  hitCount: number;
  crossed: boolean;
};

type LiquidityTailZoneSnapshot = {
  kind: 'buy_pressure' | 'sell_pressure';
  top: number;
  bottom: number;
  mid: number;
  startIndex: number;
  touches: number;
  spent: boolean;
};

const getTypicalPrice = (candle: Candle) =>
  (candle.high + candle.low + candle.close) / 3;

const normalizeContextNumber = (value: number | null): number | null =>
  value == null || !Number.isFinite(value) ? value : Number(value.toFixed(12));

const calculateSma = (values: number[], period: number): number | null =>
  values.length < period
    ? null
    : normalizeContextNumber(averageLastN(values, period));

const calculateEma = (values: number[], period: number): number | null => {
  if (values.length < period) {
    return null;
  }

  const seed =
    values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const multiplier = 2 / (period + 1);

  return normalizeContextNumber(
    values
      .slice(period)
      .reduce(
        (ema, value) => value * multiplier + ema * (1 - multiplier),
        seed,
      ),
  );
};

const calculatePercentRank = (
  values: Array<number | null | undefined>,
  current: number | null,
  lookback: number,
): number | null => {
  const finite = values.filter(
    (value): value is number =>
      typeof value === 'number' && Number.isFinite(value),
  );
  const window = finite.slice(-lookback);
  if (current == null || window.length < 3) {
    return null;
  }

  return (
    (window.filter((value) => value <= current).length / window.length) * 100
  );
};

const calculateRsiContext = (closes: number[], period = 14) => {
  const values = rsi({ values: closes, period });
  const value = values.length > 0 ? values[values.length - 1] : null;
  return (
    buildRsiContext(value) ?? {
      rsi: null,
      rsiState: 'unknown',
    }
  );
};

const buildRsiContext = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  const rsiState =
    value >= 70 ? 'overbought' : value <= 30 ? 'oversold' : 'neutral';

  return {
    rsi: value,
    rsiState,
  };
};

const buildAdxContext = (
  latest:
    | {
        adx?: number;
        pdi?: number;
        mdi?: number;
      }
    | null
    | undefined,
) => {
  if (!latest) {
    return null;
  }

  const adxValue = toNullable(latest.adx);
  const diPlus = toNullable(latest.pdi);
  const diMinus = toNullable(latest.mdi);
  const direction =
    diPlus == null || diMinus == null
      ? 'unknown'
      : Math.abs(diPlus - diMinus) < 1
        ? 'neutral'
        : diPlus > diMinus
          ? 'bull'
          : 'bear';
  const strength =
    adxValue == null
      ? 'unknown'
      : adxValue >= 25
        ? 'strong'
        : adxValue >= 18
          ? 'developing'
          : 'weak';

  return {
    adx: adxValue,
    diPlus,
    diMinus,
    direction,
    strength,
  };
};

const calculateAdxContext = (candles: Candle[], period = 14) => {
  const values = adx({
    close: candles.map((item) => item.close),
    high: candles.map((item) => item.high),
    low: candles.map((item) => item.low),
    period,
  });
  const latest = values.length > 0 ? values[values.length - 1] : null;
  return (
    buildAdxContext(latest) ?? {
      adx: null,
      diPlus: null,
      diMinus: null,
      direction: 'unknown',
      strength: 'unknown',
    }
  );
};

const calculateTrueRange = (current: Candle, previous: Candle | null) =>
  previous == null
    ? current.high - current.low
    : Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close),
      );

const calculateRecentFiniteSeries = (
  length: number,
  lookback: number,
  calculateAt: (index: number) => number | null,
) => {
  const values: number[] = [];

  for (
    let index = length - 1;
    index >= 0 && values.length < lookback;
    index -= 1
  ) {
    const value = calculateAt(index);
    if (typeof value === 'number' && Number.isFinite(value)) {
      values.push(value);
    }
  }

  return values.reverse();
};

const calculateRealizedVolatilityAt = (
  closes: number[],
  index: number,
  period = 20,
) => {
  if (index < period) {
    return null;
  }

  const startIndex = index - period;
  const returns = closes
    .slice(startIndex + 1, index + 1)
    .map((close, offset) => {
      const previous = closes[startIndex + offset];
      return previous > 0 ? Math.log(close / previous) : 0;
    });
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    returns.length;

  return Math.sqrt(variance);
};

const calculateRealizedVolatility = (closes: number[], period = 20) =>
  calculateRealizedVolatilityAt(closes, closes.length - 1, period);

const calculateRecentRealizedVolatilitySeries = (
  closes: number[],
  lookback: number,
  period = 20,
) =>
  calculateRecentFiniteSeries(closes.length, lookback, (index) =>
    calculateRealizedVolatilityAt(closes, index, period),
  );

const calculateBbWidthPctAt = (
  closes: number[],
  index: number,
  period = 20,
  stdMultiplier = 2,
) => {
  const windowStart = index + 1 - period;
  if (windowStart < 0) {
    return null;
  }

  const window = closes.slice(windowStart, index + 1);
  const mean = window.reduce((sum, value) => sum + value, 0) / window.length;
  const variance =
    window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / window.length;
  const std = Math.sqrt(variance);

  return mean === 0 ? null : ((std * stdMultiplier * 2) / mean) * 100;
};

const calculateRecentBbWidthPctSeries = (
  closes: number[],
  lookback: number,
  period = 20,
  stdMultiplier = 2,
) =>
  calculateRecentFiniteSeries(closes.length, lookback, (index) =>
    calculateBbWidthPctAt(closes, index, period, stdMultiplier),
  );

const calculateAtrPctAt = (candles: Candle[], index: number, period = 14) => {
  const windowStart = index + 1 - period;
  if (windowStart < 0) {
    return null;
  }

  const atrValue =
    candles.slice(windowStart, index + 1).reduce((sum, item, windowIndex) => {
      const absoluteIndex = windowStart + windowIndex;
      const previous = absoluteIndex > 0 ? candles[absoluteIndex - 1] : null;
      return sum + calculateTrueRange(item, previous);
    }, 0) / period;

  return safeDivide(atrValue, candles[index].close);
};

const calculateAtrAt = (candles: Candle[], index: number, period = 14) => {
  const windowStart = index + 1 - period;
  if (windowStart < 0) {
    return null;
  }

  return (
    candles.slice(windowStart, index + 1).reduce((sum, item, windowIndex) => {
      const absoluteIndex = windowStart + windowIndex;
      const previous = absoluteIndex > 0 ? candles[absoluteIndex - 1] : null;
      return sum + calculateTrueRange(item, previous);
    }, 0) / period
  );
};

const calculateAtrSeries = (candles: Candle[], period = 14) => {
  const result: Array<number | null> = [];
  let rollingSum = 0;
  const ranges: number[] = [];

  for (let index = 0; index < candles.length; index += 1) {
    const range = calculateTrueRange(
      candles[index],
      candles[index - 1] ?? null,
    );
    ranges.push(range);
    rollingSum += range;
    if (ranges.length > period) {
      rollingSum -= ranges[ranges.length - period - 1] ?? 0;
    }

    result[index] = ranges.length >= period ? rollingSum / period : null;
  }

  return result;
};

const calculateRecentAtrPctSeries = (
  candles: Candle[],
  lookback: number,
  period = 14,
) =>
  calculateRecentFiniteSeries(candles.length, lookback, (index) =>
    calculateAtrPctAt(candles, index, period),
  );

const calculateRangeExpansionAt = (candles: Candle[], index: number) => {
  const item = candles[index];
  if (!item) {
    return null;
  }

  const previous = index > 0 ? candles[index - 1] : null;
  return safeDivide(item.high - item.low, calculateTrueRange(item, previous));
};

const calculateRecentRangeExpansionSeries = (
  candles: Candle[],
  lookback: number,
) =>
  calculateRecentFiniteSeries(candles.length, lookback, (index) =>
    calculateRangeExpansionAt(candles, index),
  );

const buildMtfTrendBias = (
  candles: Candle[],
): 'bull' | 'bear' | 'neutral' | 'unknown' => {
  const closes = candles.map((item) => item.close);
  const fast = calculateSma(closes, 14);
  const slow = calculateSma(closes, 50);
  return fast == null || slow == null
    ? 'unknown'
    : fast > slow
      ? 'bull'
      : fast < slow
        ? 'bear'
        : 'neutral';
};

const buildMtfVolatilityState = (
  candles: Candle[],
): 'compressed' | 'normal' | 'expanded' | 'unknown' => {
  if (candles.length < 15) {
    return 'unknown' as const;
  }

  const atrPctValues = candles.map((item, index) => {
    const previous = index > 0 ? candles[index - 1] : null;
    return safeDivide(calculateTrueRange(item, previous), item.close);
  });
  const current = atrPctValues[atrPctValues.length - 1] ?? null;
  const rank = calculatePercentRank(atrPctValues, current, 50);

  return rank == null
    ? 'unknown'
    : rank >= 70
      ? 'expanded'
      : rank <= 30
        ? 'compressed'
        : 'normal';
};

const buildMtfSummary = (
  coinResampledCandles: BuildBaseContextParams['coinResampledCandles'],
  currentTrendBias?: 'bull' | 'bear' | 'neutral',
) => {
  const h1TrendBias = buildMtfTrendBias(coinResampledCandles.h1);
  const h4TrendBias = buildMtfTrendBias(coinResampledCandles.h4);
  const d1TrendBias = buildMtfTrendBias(coinResampledCandles.d1);
  const h1Recent = coinResampledCandles.h1.slice(-20);
  const h1RangePosition =
    h1Recent.length === 0
      ? null
      : calculateRangePosition(
          h1Recent[h1Recent.length - 1].close,
          Math.min(...h1Recent.map((item) => item.low)),
          Math.max(...h1Recent.map((item) => item.high)),
        );
  const knownBiases = [h1TrendBias, h4TrendBias, d1TrendBias].filter(
    (value) => value !== 'unknown',
  );
  const mtfAlignment:
    | 'aligned_bull'
    | 'aligned_bear'
    | 'mixed'
    | 'neutral'
    | 'unknown' =
    knownBiases.length === 0
      ? 'unknown'
      : knownBiases.every((value) => value === 'bull') &&
          (currentTrendBias == null || currentTrendBias === 'bull')
        ? 'aligned_bull'
        : knownBiases.every((value) => value === 'bear') &&
            (currentTrendBias == null || currentTrendBias === 'bear')
          ? 'aligned_bear'
          : knownBiases.every((value) => value === 'neutral')
            ? 'neutral'
            : 'mixed';

  return {
    h1TrendBias,
    h4TrendBias,
    d1TrendBias,
    h1RangePosition,
    h4VolatilityState: buildMtfVolatilityState(coinResampledCandles.h4),
    mtfAlignment,
  };
};

const detectConfirmedPivots = (
  candles: Candle[],
  atr: number | null,
): PivotPoint[] => {
  const deviation = atr != null && atr > 0 ? atr * 0.35 : 0;
  const pivots: PivotPoint[] = [];

  for (
    let index = PIVOT_LEFT_RIGHT;
    index < candles.length - PIVOT_LEFT_RIGHT;
    index += 1
  ) {
    const candle = candles[index];
    let maxOtherHigh = Number.NEGATIVE_INFINITY;
    let minOtherLow = Number.POSITIVE_INFINITY;

    for (
      let cursor = index - PIVOT_LEFT_RIGHT;
      cursor <= index + PIVOT_LEFT_RIGHT;
      cursor += 1
    ) {
      if (cursor === index) {
        continue;
      }
      const surrounding = candles[cursor];
      maxOtherHigh = Math.max(maxOtherHigh, surrounding.high);
      minOtherLow = Math.min(minOtherLow, surrounding.low);
    }

    if (candle.high >= maxOtherHigh + deviation) {
      pivots.push({ type: 'high', index, price: candle.high });
    }

    if (candle.low <= minOtherLow - deviation) {
      pivots.push({ type: 'low', index, price: candle.low });
    }
  }

  return pivots;
};

const buildPriceZones = (
  candles: Candle[],
  pivots: PivotPoint[],
  atr: number | null,
): PriceZone[] => {
  if (pivots.length === 0) {
    return [];
  }

  const tolerance = atr != null && atr > 0 ? atr * ZONE_ATR_FACTOR : null;
  if (tolerance == null || tolerance === 0) {
    return [];
  }

  const zones: PriceZone[] = [];

  for (const pivot of pivots) {
    const type = pivot.type === 'low' ? 'support' : 'resistance';
    const matchingZone = zones.find(
      (zone) =>
        zone.type === type && Math.abs(zone.level - pivot.price) <= tolerance,
    );

    if (matchingZone) {
      const nextTouches = matchingZone.touches + 1;
      matchingZone.level =
        (matchingZone.level * matchingZone.touches + pivot.price) / nextTouches;
      matchingZone.lower = matchingZone.level - tolerance;
      matchingZone.upper = matchingZone.level + tolerance;
      matchingZone.touches = nextTouches;
      matchingZone.ageBars = candles.length - 1 - pivot.index;
      continue;
    }

    zones.push({
      type,
      level: pivot.price,
      lower: pivot.price - tolerance,
      upper: pivot.price + tolerance,
      touches: 1,
      volume: 0,
      ageBars: candles.length - 1 - pivot.index,
    });
  }

  for (const zone of zones) {
    zone.volume = candles.reduce(
      (sum, candle) =>
        getTypicalPrice(candle) >= zone.lower &&
        getTypicalPrice(candle) <= zone.upper
          ? sum + candle.volume
          : sum,
      0,
    );
  }

  return zones;
};

const getNearestZone = (
  zones: PriceZone[],
  type: PriceZone['type'],
  price: number,
) => {
  const candidates = zones.filter((zone) =>
    type === 'support'
      ? zone.type === type && zone.level <= price
      : zone.type === type && zone.level >= price,
  );

  return candidates.reduce<PriceZone | null>((nearest, zone) => {
    if (!nearest) {
      return zone;
    }

    return Math.abs(zone.level - price) < Math.abs(nearest.level - price)
      ? zone
      : nearest;
  }, null);
};

const buildSwingContext = (pivots: PivotPoint[]) => {
  const highs = pivots.filter((pivot) => pivot.type === 'high');
  const lows = pivots.filter((pivot) => pivot.type === 'low');
  const highPairs = highs.slice(1).map((pivot, index) => ({
    current: pivot.price,
    previous: highs[index].price,
  }));
  const lowPairs = lows.slice(1).map((pivot, index) => ({
    current: pivot.price,
    previous: lows[index].price,
  }));
  const higherHighs = highPairs.filter(
    ({ current, previous }) => current > previous,
  ).length;
  const lowerHighs = highPairs.filter(
    ({ current, previous }) => current < previous,
  ).length;
  const higherLows = lowPairs.filter(
    ({ current, previous }) => current > previous,
  ).length;
  const lowerLows = lowPairs.filter(
    ({ current, previous }) => current < previous,
  ).length;
  const comparedSwingCount = highPairs.length + lowPairs.length;
  const bullScore = higherHighs + higherLows;
  const bearScore = lowerHighs + lowerLows;
  const swingBias =
    comparedSwingCount === 0
      ? 'unknown'
      : bullScore > bearScore
        ? 'bull'
        : bearScore > bullScore
          ? 'bear'
          : 'neutral';
  const state =
    comparedSwingCount < 2
      ? 'unknown'
      : Math.abs(bullScore - bearScore) >= 2
        ? 'trend'
        : bullScore > 0 && bearScore > 0
          ? 'transition'
          : 'range';

  return {
    state,
    bias: swingBias,
    higherHighCount: highPairs.length > 0 ? higherHighs : null,
    higherLowCount: lowPairs.length > 0 ? higherLows : null,
    lowerHighCount: highPairs.length > 0 ? lowerHighs : null,
    lowerLowCount: lowPairs.length > 0 ? lowerLows : null,
  };
};

const buildPriceVolumeProfileContext = (
  candles: Candle[],
  price: number,
  atr: number | null,
) => {
  if (candles.length === 0) {
    return {
      pointOfControl: null,
      distanceToPointOfControlAtr: null,
      pointOfControlVolumeShare: null,
      priceAbovePointOfControl: null,
      nearPointOfControl: null,
    };
  }

  const rangeHigh = Math.max(...candles.map((candle) => candle.high));
  const rangeLow = Math.min(...candles.map((candle) => candle.low));
  const range = rangeHigh - rangeLow;
  if (range <= 0) {
    return {
      pointOfControl: price,
      distanceToPointOfControlAtr: safeDivide(price - price, atr),
      pointOfControlVolumeShare: 1,
      priceAbovePointOfControl: false,
      nearPointOfControl: atr == null ? null : true,
    };
  }

  const binWidth = range / PROFILE_BIN_COUNT;
  const bins = Array.from({ length: PROFILE_BIN_COUNT }, () => 0);
  let totalVolume = 0;

  for (const candle of candles) {
    const index = Math.min(
      PROFILE_BIN_COUNT - 1,
      Math.max(0, Math.floor((getTypicalPrice(candle) - rangeLow) / binWidth)),
    );
    bins[index] += candle.volume;
    totalVolume += candle.volume;
  }

  const maxVolume = Math.max(...bins);
  const maxIndex = bins.indexOf(maxVolume);
  const pointOfControl = rangeLow + binWidth * (maxIndex + 0.5);
  const distanceToPointOfControlAtr = safeDivide(price - pointOfControl, atr);
  const nearThresholdAtr = 0.75;

  return {
    pointOfControl,
    distanceToPointOfControlAtr,
    pointOfControlVolumeShare: safeDivide(maxVolume, totalVolume),
    priceAbovePointOfControl: price > pointOfControl,
    nearPointOfControl:
      distanceToPointOfControlAtr == null
        ? null
        : Math.abs(distanceToPointOfControlAtr) <= nearThresholdAtr,
  };
};

const getOverlapHeight = (
  bandLow: number,
  bandHigh: number,
  areaLow: number,
  areaHigh: number,
) => Math.max(Math.min(bandHigh, areaHigh) - Math.max(bandLow, areaLow), 0);

const clampIndex = (value: number, maxIndex: number) =>
  Math.max(0, Math.min(maxIndex, value));

const buildVolumeStructureContext = (
  candles: Candle[],
  price: number,
  atr: number | null,
) => {
  const startIndex = Math.max(0, candles.length - VOLUME_STRUCTURE_CALC_BARS);
  const calcBars = candles.length - startIndex;
  const empty = {
    pointOfControl: null,
    pocIndex: null,
    pointOfControlVolumeShare: null,
    pocUpVolumeShare: null,
    pocDownVolumeShare: null,
    totalUpVolumeShare: null,
    totalDownVolumeShare: null,
    priceAbovePointOfControl: null,
    distanceToPointOfControlAtr: null,
    rowCount: VOLUME_STRUCTURE_ROW_COUNT,
    calcBars,
  };

  if (calcBars === 0) {
    return empty;
  }

  let top = Number.NEGATIVE_INFINITY;
  let bottom = Number.POSITIVE_INFINITY;
  for (let index = startIndex; index < candles.length; index += 1) {
    const candle = candles[index];
    top = Math.max(top, candle.high);
    bottom = Math.min(bottom, candle.low);
  }

  const range = top - bottom;
  if (range <= 0) {
    return {
      ...empty,
      pointOfControl: price,
      pocIndex: 0,
      pointOfControlVolumeShare: 1,
      pocUpVolumeShare: null,
      pocDownVolumeShare: null,
      totalUpVolumeShare: null,
      totalDownVolumeShare: null,
      priceAbovePointOfControl: false,
      distanceToPointOfControlAtr: safeDivide(price - price, atr),
    };
  }

  const rowCount = VOLUME_STRUCTURE_ROW_COUNT;
  const step = range / rowCount;
  const upVolumes = new Array<number>(rowCount).fill(0);
  const downVolumes = new Array<number>(rowCount).fill(0);
  const distributeSegmentVolume = (
    segmentLow: number,
    segmentHigh: number,
    segmentVolume: number,
    upShare: number,
    downShare: number,
  ) => {
    const segmentHeight = segmentHigh - segmentLow;
    if (segmentHeight <= 0 || segmentVolume <= 0) {
      return;
    }

    const startIndex = clampIndex(
      Math.floor((segmentLow - bottom) / step),
      rowCount - 1,
    );
    const endIndex = clampIndex(
      Math.floor((segmentHigh - bottom) / step),
      rowCount - 1,
    );

    for (let index = startIndex; index <= endIndex; index += 1) {
      const bandLow = bottom + step * index;
      const bandHigh = bandLow + step;
      const allocatedVolume =
        (getOverlapHeight(bandLow, bandHigh, segmentLow, segmentHigh) /
          segmentHeight) *
        segmentVolume;
      upVolumes[index] += allocatedVolume * upShare;
      downVolumes[index] += allocatedVolume * downShare;
    }
  };

  for (let index = startIndex; index < candles.length; index += 1) {
    const candle = candles[index];
    const bodyTop = Math.max(candle.close, candle.open);
    const bodyBottom = Math.min(candle.close, candle.open);
    const body = bodyTop - bodyBottom;
    const topWick = candle.high - bodyTop;
    const bottomWick = bodyBottom - candle.low;
    const weightedRange = 2 * topWick + 2 * bottomWick + body;
    if (weightedRange <= 0) {
      continue;
    }

    const bodyVolume = (body * candle.volume) / weightedRange;
    const topWickVolume = (2 * topWick * candle.volume) / weightedRange;
    const bottomWickVolume = (2 * bottomWick * candle.volume) / weightedRange;
    const isUpBar = candle.close >= candle.open;

    distributeSegmentVolume(
      bodyBottom,
      bodyTop,
      bodyVolume,
      isUpBar ? 1 : 0,
      isUpBar ? 0 : 1,
    );
    distributeSegmentVolume(bodyTop, candle.high, topWickVolume, 0.5, 0.5);
    distributeSegmentVolume(candle.low, bodyBottom, bottomWickVolume, 0.5, 0.5);
  }

  let totalVolume = 0;
  let maxVolume = Number.NEGATIVE_INFINITY;
  let pocIndex = 0;
  let totalUpVolume = 0;
  let totalDownVolume = 0;
  for (let index = 0; index < rowCount; index += 1) {
    const upVolume = upVolumes[index];
    const downVolume = downVolumes[index];
    const totalRowVolume = upVolume + downVolume;
    totalVolume += totalRowVolume;
    totalUpVolume += upVolume;
    totalDownVolume += downVolume;
    if (totalRowVolume > maxVolume) {
      maxVolume = totalRowVolume;
      pocIndex = index;
    }
  }

  const pointOfControl = bottom + step * (pocIndex + 0.5);
  const pocTotalVolume = upVolumes[pocIndex] + downVolumes[pocIndex];
  const pocUpVolume = upVolumes[pocIndex];
  const pocDownVolume = downVolumes[pocIndex];

  return {
    pointOfControl,
    pocIndex,
    pointOfControlVolumeShare: safeDivide(maxVolume, totalVolume),
    pocUpVolumeShare: safeDivide(pocUpVolume, pocTotalVolume),
    pocDownVolumeShare: safeDivide(pocDownVolume, pocTotalVolume),
    totalUpVolumeShare: safeDivide(totalUpVolume, totalVolume),
    totalDownVolumeShare: safeDivide(totalDownVolume, totalVolume),
    priceAbovePointOfControl: price > pointOfControl,
    distanceToPointOfControlAtr: safeDivide(price - pointOfControl, atr),
    rowCount,
    calcBars,
  };
};

const buildSrZonesContext = (
  candles: Candle[],
  price: number,
  previousPrice: number | null,
  atr: number | null,
) => {
  const empty = {
    levels: [] as SrZoneLevel[],
    nearestSupport: {
      level: null,
      strength: null,
      distanceAtr: null,
    },
    nearestResistance: {
      level: null,
      strength: null,
      distanceAtr: null,
    },
    crossedAbove: null,
    crossedBelow: null,
  };

  if (candles.length < SR_ZONE_PIVOT_PERIOD * 2 + 1) {
    return empty;
  }

  const pivotValues: number[] = [];
  for (
    let index = SR_ZONE_PIVOT_PERIOD;
    index < candles.length - SR_ZONE_PIVOT_PERIOD;
    index += 1
  ) {
    const candle = candles[index];
    let isPivotHigh = true;
    let isPivotLow = true;
    for (
      let cursor = index - SR_ZONE_PIVOT_PERIOD;
      cursor <= index + SR_ZONE_PIVOT_PERIOD;
      cursor += 1
    ) {
      if (cursor === index) {
        continue;
      }
      const surrounding = candles[cursor];
      if (candle.high < surrounding.high) {
        isPivotHigh = false;
      }
      if (candle.low > surrounding.low) {
        isPivotLow = false;
      }
      if (!isPivotHigh && !isPivotLow) {
        break;
      }
    }

    if (isPivotHigh || isPivotLow) {
      pivotValues.unshift(isPivotHigh ? candle.high : candle.low);
      if (pivotValues.length > SR_ZONE_MAX_PIVOTS) {
        pivotValues.pop();
      }
    }
  }

  if (pivotValues.length === 0) {
    return empty;
  }

  let highest = Number.NEGATIVE_INFINITY;
  let lowest = Number.POSITIVE_INFINITY;
  for (const candle of candles) {
    highest = Math.max(highest, candle.high);
    lowest = Math.min(lowest, candle.low);
  }
  const channelWidth = ((highest - lowest) * SR_ZONE_CHANNEL_WIDTH_PCT) / 100;
  const srLevels: Array<{ upper: number; lower: number; strength: number }> =
    [];

  for (const pivotValue of pivotValues) {
    let lower = pivotValue;
    let upper = pivotValue;
    let strength = 0;

    for (const candidate of pivotValues) {
      const width = candidate <= lower ? upper - candidate : candidate - lower;
      if (width <= channelWidth) {
        lower = Math.min(lower, candidate);
        upper = Math.max(upper, candidate);
        strength += 1;
      }
    }

    const overlapIndex = srLevels.findIndex(
      (level) =>
        (level.upper >= lower && level.upper <= upper) ||
        (level.lower >= lower && level.lower <= upper),
    );

    if (overlapIndex >= 0) {
      if (strength >= srLevels[overlapIndex].strength) {
        srLevels.splice(overlapIndex, 1);
      } else {
        continue;
      }
    }

    if (strength >= SR_ZONE_MIN_STRENGTH) {
      srLevels.push({ upper, lower, strength });
      srLevels.sort((left, right) => right.strength - left.strength);
      srLevels.splice(SR_ZONE_MAX_LEVELS);
    }
  }

  const levels = srLevels.map((level) => {
    const mid = (level.upper + level.lower) / 2;
    return {
      level: mid,
      upper: level.upper,
      lower: level.lower,
      strength: level.strength,
      distancePct: price === 0 ? null : ((mid - price) / price) * 100,
      side: mid >= price ? 'resistance' : 'support',
    } satisfies SrZoneLevel;
  });

  const nearestSupport = levels
    .filter((level) => level.level <= price)
    .reduce<SrZoneLevel | null>(
      (nearest, level) =>
        nearest == null ||
        Math.abs(price - level.level) < Math.abs(price - nearest.level)
          ? level
          : nearest,
      null,
    );
  const nearestResistance = levels
    .filter((level) => level.level >= price)
    .reduce<SrZoneLevel | null>(
      (nearest, level) =>
        nearest == null ||
        Math.abs(level.level - price) < Math.abs(nearest.level - price)
          ? level
          : nearest,
      null,
    );

  const crossedAbove =
    previousPrice == null
      ? null
      : levels.some(
          (level) => previousPrice <= level.level && price > level.level,
        );
  const crossedBelow =
    previousPrice == null
      ? null
      : levels.some(
          (level) => previousPrice >= level.level && price < level.level,
        );

  return {
    levels,
    nearestSupport: {
      level: nearestSupport?.level ?? null,
      strength: nearestSupport?.strength ?? null,
      distanceAtr: safeDivide(
        nearestSupport == null ? null : price - nearestSupport.level,
        atr,
      ),
    },
    nearestResistance: {
      level: nearestResistance?.level ?? null,
      strength: nearestResistance?.strength ?? null,
      distanceAtr: safeDivide(
        nearestResistance == null ? null : nearestResistance.level - price,
        atr,
      ),
    },
    crossedAbove,
    crossedBelow,
  };
};

const isConfirmedPivotHigh = (
  candles: Candle[],
  index: number,
  lookback: number,
) => {
  const candidate = candles[index];
  if (!candidate) {
    return false;
  }

  for (
    let cursor = Math.max(0, index - lookback);
    cursor <= Math.min(candles.length - 1, index + lookback);
    cursor += 1
  ) {
    if (cursor !== index && candles[cursor].high > candidate.high) {
      return false;
    }
  }

  return true;
};

const isConfirmedPivotLow = (
  candles: Candle[],
  index: number,
  lookback: number,
) => {
  const candidate = candles[index];
  if (!candidate) {
    return false;
  }

  for (
    let cursor = Math.max(0, index - lookback);
    cursor <= Math.min(candles.length - 1, index + lookback);
    cursor += 1
  ) {
    if (cursor !== index && candles[cursor].low < candidate.low) {
      return false;
    }
  }

  return true;
};

const buildLiquidityZonesContext = (
  candles: Candle[],
  price: number,
  previousPrice: number | null,
  atr: number | null,
) => {
  const emptyZone = {
    top: null,
    bottom: null,
    level: null,
    ageBars: null,
    hitCount: null,
    distanceAtr: null,
  };
  const empty = {
    activeCount: 0,
    nearestSupport: { ...emptyZone },
    nearestResistance: { ...emptyZone },
    activeRetestDirection: null,
    retestPenetrationPct: null,
    crossedAbove: null,
    crossedBelow: null,
  };

  if (candles.length < LIQUIDITY_ZONE_LOOKBACK * 2 + 1) {
    return empty;
  }

  const zones: LiquidityZoneSnapshot[] = [];
  for (
    let index = LIQUIDITY_ZONE_LOOKBACK;
    index < candles.length - LIQUIDITY_ZONE_LOOKBACK;
    index += 1
  ) {
    const candle = candles[index];
    for (const zone of zones) {
      if (!zone.crossed && candle.low < zone.top && candle.high > zone.bottom) {
        zone.hitCount += 1;
      }
    }

    if (isConfirmedPivotHigh(candles, index, LIQUIDITY_ZONE_LOOKBACK)) {
      const top = candle.high;
      const bottom = Math.max(candle.open, candle.close);
      zones.push({
        kind: 'swing_high_liquidity',
        top,
        bottom,
        level: top,
        mid: (top + bottom) / 2,
        startIndex: index,
        hitCount: 0,
        crossed: false,
      });
    }

    if (isConfirmedPivotLow(candles, index, LIQUIDITY_ZONE_LOOKBACK)) {
      const top = Math.min(candle.open, candle.close);
      const bottom = candle.low;
      zones.push({
        kind: 'swing_low_liquidity',
        top,
        bottom,
        level: bottom,
        mid: (top + bottom) / 2,
        startIndex: index,
        hitCount: 0,
        crossed: false,
      });
    }
  }

  const lastIndex = candles.length - 1;
  const current = candles[lastIndex];
  const activeZones = zones.filter((zone) => {
    if (lastIndex - zone.startIndex > LIQUIDITY_ZONE_MAX_AGE) {
      return false;
    }

    const crossed =
      zone.crossed ||
      (zone.kind === 'swing_high_liquidity'
        ? current.close > zone.top
        : current.close < zone.bottom);
    zone.crossed = crossed;
    return !crossed;
  });
  const supports = activeZones.filter(
    (zone) => zone.kind === 'swing_low_liquidity',
  );
  const resistances = activeZones.filter(
    (zone) => zone.kind === 'swing_high_liquidity',
  );
  const nearestSupport =
    supports.reduce<LiquidityZoneSnapshot | null>(
      (nearest, zone) =>
        nearest == null ||
        Math.abs(price - zone.level) < Math.abs(price - nearest.level)
          ? zone
          : nearest,
      null,
    ) ?? null;
  const nearestResistance =
    resistances.reduce<LiquidityZoneSnapshot | null>(
      (nearest, zone) =>
        nearest == null ||
        Math.abs(zone.level - price) < Math.abs(nearest.level - price)
          ? zone
          : nearest,
      null,
    ) ?? null;
  const supportRetest =
    nearestSupport != null && current.low <= nearestSupport.top;
  const resistanceRetest =
    nearestResistance != null && current.high >= nearestResistance.bottom;
  const retestZone = supportRetest
    ? nearestSupport
    : resistanceRetest
      ? nearestResistance
      : null;
  const retestPenetration =
    retestZone == null
      ? null
      : retestZone.kind === 'swing_low_liquidity'
        ? Math.max(0, retestZone.top - current.low)
        : Math.max(0, current.high - retestZone.bottom);
  const retestHeight =
    retestZone == null ? null : Math.max(retestZone.top - retestZone.bottom, 0);

  return {
    activeCount: activeZones.length,
    nearestSupport: {
      top: nearestSupport?.top ?? null,
      bottom: nearestSupport?.bottom ?? null,
      level: nearestSupport?.level ?? null,
      ageBars:
        nearestSupport == null ? null : lastIndex - nearestSupport.startIndex,
      hitCount: nearestSupport?.hitCount ?? null,
      distanceAtr: safeDivide(
        nearestSupport == null ? null : price - nearestSupport.level,
        atr,
      ),
    },
    nearestResistance: {
      top: nearestResistance?.top ?? null,
      bottom: nearestResistance?.bottom ?? null,
      level: nearestResistance?.level ?? null,
      ageBars:
        nearestResistance == null
          ? null
          : lastIndex - nearestResistance.startIndex,
      hitCount: nearestResistance?.hitCount ?? null,
      distanceAtr: safeDivide(
        nearestResistance == null ? null : nearestResistance.level - price,
        atr,
      ),
    },
    activeRetestDirection: supportRetest
      ? 'LONG'
      : resistanceRetest
        ? 'SHORT'
        : null,
    retestPenetrationPct:
      retestPenetration == null || retestHeight == null || retestHeight <= 0
        ? null
        : (retestPenetration / retestHeight) * 100,
    crossedAbove:
      previousPrice == null || nearestResistance == null
        ? null
        : previousPrice <= nearestResistance.level &&
          price > nearestResistance.level,
    crossedBelow:
      previousPrice == null || nearestSupport == null
        ? null
        : previousPrice >= nearestSupport.level && price < nearestSupport.level,
  };
};

const buildLiquidityTailsContext = (
  candles: Candle[],
  price: number,
  atr: number | null,
) => {
  const emptyTailZone = {
    top: null,
    bottom: null,
    mid: null,
    touches: null,
    ageBars: null,
    distanceAtr: null,
  };
  const empty = {
    activeCount: 0,
    nearestBuyPressure: { ...emptyTailZone },
    nearestSellPressure: { ...emptyTailZone },
    currentTail: {
      side: null,
      wickAtr: null,
      wickBodyRatio: null,
      dominance: null,
    },
    activeRetestDirection: null,
  };

  if (candles.length === 0) {
    return empty;
  }

  const zones: LiquidityTailZoneSnapshot[] = [];
  const atrSeries = calculateAtrSeries(candles, LIQUIDITY_TAIL_ATR_LENGTH);
  let lastFireIndex = -Infinity;
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const atrAtIndex = atrSeries[index];
    const topShadow = candle.high - Math.max(candle.open, candle.close);
    const bottomShadow = Math.min(candle.open, candle.close) - candle.low;
    const body = Math.max(Math.abs(candle.close - candle.open), 1e-9);
    const canFire =
      atrAtIndex != null && index - lastFireIndex > LIQUIDITY_TAIL_MIN_GAP;
    const sellFire =
      canFire &&
      topShadow >= LIQUIDITY_TAIL_ATR_MULT * atrAtIndex &&
      topShadow >= LIQUIDITY_TAIL_MIN_WICK_RATIO * body &&
      topShadow > bottomShadow * LIQUIDITY_TAIL_WICK_DOMINANCE;
    const buyFire =
      canFire &&
      bottomShadow >= LIQUIDITY_TAIL_ATR_MULT * atrAtIndex &&
      bottomShadow >= LIQUIDITY_TAIL_MIN_WICK_RATIO * body &&
      bottomShadow > topShadow * LIQUIDITY_TAIL_WICK_DOMINANCE;

    if (sellFire) {
      lastFireIndex = index;
      const top = candle.high;
      const bottom = Math.max(candle.open, candle.close);
      zones.push({
        kind: 'sell_pressure',
        top,
        bottom,
        mid: (top + bottom) / 2,
        startIndex: index,
        touches: 0,
        spent: false,
      });
    } else if (buyFire) {
      lastFireIndex = index;
      const top = Math.min(candle.open, candle.close);
      const bottom = candle.low;
      zones.push({
        kind: 'buy_pressure',
        top,
        bottom,
        mid: (top + bottom) / 2,
        startIndex: index,
        touches: 0,
        spent: false,
      });
    }

    for (const zone of zones) {
      if (index <= zone.startIndex || zone.spent) {
        continue;
      }

      if (
        zone.kind === 'sell_pressure'
          ? candle.low >= zone.top
          : candle.high <= zone.bottom
      ) {
        zone.spent = true;
        continue;
      }

      const entry = zone.kind === 'sell_pressure' ? zone.bottom : zone.top;
      const inZone =
        zone.kind === 'sell_pressure'
          ? candle.high >= entry
          : candle.low <= entry;
      if (inZone) {
        zone.touches += 1;
      }
    }
  }

  const lastIndex = candles.length - 1;
  const current = candles[lastIndex];
  const activeZones = zones.filter(
    (zone) =>
      !zone.spent && lastIndex - zone.startIndex <= LIQUIDITY_TAIL_MAX_AGE,
  );
  const buyZones = activeZones.filter((zone) => zone.kind === 'buy_pressure');
  const sellZones = activeZones.filter((zone) => zone.kind === 'sell_pressure');
  const nearestBuy =
    buyZones.reduce<LiquidityTailZoneSnapshot | null>(
      (nearest, zone) =>
        nearest == null ||
        Math.abs(price - zone.mid) < Math.abs(price - nearest.mid)
          ? zone
          : nearest,
      null,
    ) ?? null;
  const nearestSell =
    sellZones.reduce<LiquidityTailZoneSnapshot | null>(
      (nearest, zone) =>
        nearest == null ||
        Math.abs(zone.mid - price) < Math.abs(nearest.mid - price)
          ? zone
          : nearest,
      null,
    ) ?? null;
  const topShadow = current.high - Math.max(current.open, current.close);
  const bottomShadow = Math.min(current.open, current.close) - current.low;
  const body = Math.max(Math.abs(current.close - current.open), 1e-9);
  const activeRetestDirection =
    nearestBuy != null && current.low <= nearestBuy.top
      ? 'LONG'
      : nearestSell != null && current.high >= nearestSell.bottom
        ? 'SHORT'
        : null;
  const dominantUpper = topShadow > bottomShadow;
  const dominantWick = dominantUpper ? topShadow : bottomShadow;
  const oppositeWick = dominantUpper ? bottomShadow : topShadow;

  return {
    activeCount: activeZones.length,
    nearestBuyPressure: {
      top: nearestBuy?.top ?? null,
      bottom: nearestBuy?.bottom ?? null,
      mid: nearestBuy?.mid ?? null,
      touches: nearestBuy?.touches ?? null,
      ageBars: nearestBuy == null ? null : lastIndex - nearestBuy.startIndex,
      distanceAtr: safeDivide(
        nearestBuy == null ? null : price - nearestBuy.mid,
        atr,
      ),
    },
    nearestSellPressure: {
      top: nearestSell?.top ?? null,
      bottom: nearestSell?.bottom ?? null,
      mid: nearestSell?.mid ?? null,
      touches: nearestSell?.touches ?? null,
      ageBars: nearestSell == null ? null : lastIndex - nearestSell.startIndex,
      distanceAtr: safeDivide(
        nearestSell == null ? null : nearestSell.mid - price,
        atr,
      ),
    },
    currentTail: {
      side: dominantWick <= 0 ? null : dominantUpper ? 'upper' : 'lower',
      wickAtr: safeDivide(dominantWick, atr),
      wickBodyRatio: safeDivide(dominantWick, body),
      dominance: safeDivide(dominantWick, oppositeWick || null),
    },
    activeRetestDirection,
  };
};

const calculateLinregNow = (
  values: number[],
  index: number,
  period: number,
): number | null => {
  const start = index + 1 - period;
  if (start < 0) {
    return null;
  }

  const xMean = (period - 1) / 2;
  let ySum = 0;
  let numerator = 0;
  let denominator = 0;
  for (let x = 0; x < period; x += 1) {
    const value = values[start + x];
    ySum += value;
    numerator += (x - xMean) * value;
    denominator += (x - xMean) ** 2;
  }

  const yMean = ySum / period;
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = yMean - slope * xMean;
  return intercept + slope * (period - 1);
};

const buildAdaptiveTrendChannelContext = (candles: Candle[], price: number) => {
  const window = candles.slice(-ADAPTIVE_CHANNEL_CALC_LOOKBACK);
  const empty = {
    centerline: null,
    upper: null,
    lower: null,
    direction: 'unknown',
    regime: 'unknown',
    roof: null,
    floor: null,
    flipUp: null,
    flipDown: null,
    halfChannelAtr: null,
    centerlineSlope: null,
    channelWidthAtr: null,
    pricePositionInChannel: null,
  } as const;

  if (window.length <= ADAPTIVE_CHANNEL_REGRESSION_BARS) {
    return empty;
  }

  const highs = window.map((item) => item.high);
  const lows = window.map((item) => item.low);
  const closes = window.map((item) => item.close);
  const regHigh: Array<number | null> = [];
  const regLow: Array<number | null> = [];
  const regClose: Array<number | null> = [];
  let regime: 1 | -1 | null = null;
  let previousRegime: 1 | -1 | null = null;
  let centerline: number | null = null;
  let previousCenterline: number | null = null;
  let bullSupportTrail = window[0].low;
  let bearResistanceTrail = window[0].high;

  for (let index = 0; index < window.length; index += 1) {
    regHigh[index] = calculateLinregNow(
      highs,
      index,
      ADAPTIVE_CHANNEL_REGRESSION_BARS,
    );
    regLow[index] = calculateLinregNow(
      lows,
      index,
      ADAPTIVE_CHANNEL_REGRESSION_BARS,
    );
    regClose[index] = calculateLinregNow(
      closes,
      index,
      ADAPTIVE_CHANNEL_REGRESSION_BARS,
    );

    let highCount = 0;
    let lowCount = 0;
    let highSum = 0;
    let lowSum = 0;
    let windowPeak = Number.NEGATIVE_INFINITY;
    let windowTrough = Number.POSITIVE_INFINITY;
    const envelopeStart = Math.max(
      0,
      index + 1 - ADAPTIVE_CHANNEL_ENVELOPE_BARS,
    );
    for (let cursor = envelopeStart; cursor <= index; cursor += 1) {
      const highValue = regHigh[cursor];
      if (highValue != null) {
        highCount += 1;
        highSum += highValue;
        windowPeak = Math.max(windowPeak, highValue);
      }

      const lowValue = regLow[cursor];
      if (lowValue != null) {
        lowCount += 1;
        lowSum += lowValue;
        windowTrough = Math.min(windowTrough, lowValue);
      }
    }

    if (
      highCount < ADAPTIVE_CHANNEL_ENVELOPE_BARS ||
      lowCount < ADAPTIVE_CHANNEL_ENVELOPE_BARS
    ) {
      continue;
    }

    const upperReaction = highSum / highCount;
    const lowerReaction = lowSum / lowCount;
    const previousRegLow = regLow[index - 1];
    const previousRegHigh = regHigh[index - 1];
    const currentRegClose = regClose[index];

    previousRegime = regime;
    previousCenterline = centerline;
    if (regime == null && index > ADAPTIVE_CHANNEL_REGRESSION_BARS) {
      regime = 1;
      centerline = windowTrough;
    } else if (regime === 1) {
      bullSupportTrail = Math.max(bullSupportTrail, windowTrough);
      if (
        upperReaction < bullSupportTrail &&
        currentRegClose != null &&
        previousRegLow != null &&
        currentRegClose < previousRegLow
      ) {
        regime = -1;
        centerline = windowPeak;
        bearResistanceTrail = regHigh[index] ?? window[index].high;
      }
    } else if (regime === -1) {
      bearResistanceTrail = Math.min(bearResistanceTrail, windowPeak);
      if (
        lowerReaction > bearResistanceTrail &&
        currentRegClose != null &&
        previousRegHigh != null &&
        currentRegClose > previousRegHigh
      ) {
        regime = 1;
        centerline = windowTrough;
        bullSupportTrail = regLow[index] ?? window[index].low;
      }
    }

    if (regime === 1) {
      centerline = Math.max(centerline ?? windowTrough, windowTrough);
    } else if (regime === -1) {
      centerline = Math.min(centerline ?? windowPeak, windowPeak);
    }
  }

  const lastIndex = window.length - 1;
  const atr100 = calculateAtrAt(
    window,
    lastIndex,
    Math.min(ADAPTIVE_CHANNEL_VOLATILITY_LOOKBACK, window.length),
  );
  const halfChannel =
    atr100 == null ? null : ADAPTIVE_CHANNEL_ATR_STRETCH * atr100 * 0.5;
  const roof =
    centerline == null || halfChannel == null ? null : centerline + halfChannel;
  const floor =
    centerline == null || halfChannel == null ? null : centerline - halfChannel;
  const centerlineSlope =
    centerline == null || previousCenterline == null
      ? null
      : centerline - previousCenterline;
  const regimeText =
    regime == null ? 'unknown' : regime === 1 ? 'bull' : 'bear';
  const direction =
    centerlineSlope == null
      ? regimeText
      : centerlineSlope > 0
        ? 'bull'
        : centerlineSlope < 0
          ? 'bear'
          : 'neutral';

  return {
    centerline,
    upper: roof,
    lower: floor,
    direction,
    regime: regimeText,
    roof,
    floor,
    flipUp: previousRegime === -1 && regime === 1,
    flipDown: previousRegime === 1 && regime === -1,
    halfChannelAtr: safeDivide(halfChannel, atr100),
    centerlineSlope,
    channelWidthAtr: safeDivide(
      halfChannel == null ? null : halfChannel * 2,
      atr100,
    ),
    pricePositionInChannel:
      floor == null || roof == null
        ? null
        : calculateRangePosition(price, floor, roof),
  };
};

const buildTrendFollowContext = (
  candles: Candle[],
  price: number,
  atr: number | null,
) => {
  let trendState: 1 | -1 | 0 = 0;
  let lastPivotHigh: number | null = null;
  let lastPivotLow: number | null = null;
  let lastSignalIndex: number | null = null;
  let lastSignalDirection: 'LONG' | 'SHORT' | null = null;
  let trailStop: number | null = null;
  let breakoutConfirmed: boolean | null = null;
  const atrSeries = calculateAtrSeries(candles, TREND_FOLLOW_ATR_LENGTH);

  for (let index = 0; index < candles.length; index += 1) {
    const candidateIndex = index - TREND_FOLLOW_PIVOT_LENGTH;
    if (candidateIndex >= TREND_FOLLOW_PIVOT_LENGTH) {
      if (
        isConfirmedPivotHigh(candles, candidateIndex, TREND_FOLLOW_PIVOT_LENGTH)
      ) {
        lastPivotHigh = candles[candidateIndex].high;
      }
      if (
        isConfirmedPivotLow(candles, candidateIndex, TREND_FOLLOW_PIVOT_LENGTH)
      ) {
        lastPivotLow = candles[candidateIndex].low;
      }
    }

    const candle = candles[index];
    const currentAtr = atrSeries[index] ?? atr;
    const previous = candles[index - 1] ?? null;
    const bullCross =
      previous != null &&
      lastPivotHigh != null &&
      previous.close <= lastPivotHigh &&
      candle.close > lastPivotHigh &&
      trendState !== 1;
    const bearCross =
      previous != null &&
      lastPivotLow != null &&
      previous.close >= lastPivotLow &&
      candle.close < lastPivotLow &&
      trendState !== -1;

    if (bullCross) {
      trendState = 1;
      trailStop =
        currentAtr == null
          ? null
          : candle.close - currentAtr * TREND_FOLLOW_ATR_MULT;
      lastSignalIndex = index;
      lastSignalDirection = 'LONG';
      breakoutConfirmed = true;
    } else if (bearCross) {
      trendState = -1;
      trailStop =
        currentAtr == null
          ? null
          : candle.close + currentAtr * TREND_FOLLOW_ATR_MULT;
      lastSignalIndex = index;
      lastSignalDirection = 'SHORT';
      breakoutConfirmed = true;
    } else if (trendState === 1 && currentAtr != null) {
      const newStop = candle.close - currentAtr * TREND_FOLLOW_ATR_MULT;
      trailStop = trailStop == null ? newStop : Math.max(trailStop, newStop);
    } else if (trendState === -1 && currentAtr != null) {
      const newStop = candle.close + currentAtr * TREND_FOLLOW_ATR_MULT;
      trailStop = trailStop == null ? newStop : Math.min(trailStop, newStop);
    }
  }

  return {
    state: trendState === 1 ? 'bull' : trendState === -1 ? 'bear' : 'neutral',
    lastSignalDirection,
    signalAgeBars:
      lastSignalIndex == null ? null : candles.length - 1 - lastSignalIndex,
    trailStop,
    distanceToTrailStopAtr: safeDivide(
      trailStop == null ? null : price - trailStop,
      atr,
    ),
    distanceToTrailStopPct:
      trailStop == null || price === 0
        ? null
        : ((price - trailStop) / price) * 100,
    lastPivotHigh,
    lastPivotLow,
    breakoutConfirmed,
  };
};

const buildStructureZonesContext = (
  swingContext: ReturnType<typeof buildSwingContext>,
  pivotContext: ReturnType<typeof buildPivotContext>,
  price: number,
  atr: number | null,
  recentCandles: Candle[],
) => {
  const halfWidth =
    atr == null || !Number.isFinite(atr)
      ? null
      : atr * STRUCTURE_ZONES_ZONE_WIDTH_ATR;
  const high = pivotContext.lastSwingHigh;
  const low = pivotContext.lastSwingLow;
  const resistanceTop =
    high == null || halfWidth == null ? null : high + halfWidth;
  const resistanceBottom =
    high == null || halfWidth == null ? null : high - halfWidth;
  const supportTop = low == null || halfWidth == null ? null : low + halfWidth;
  const supportBottom =
    low == null || halfWidth == null ? null : low - halfWidth;
  const acceptWindow = recentCandles.slice(-STRUCTURE_ZONES_ACCEPT_BARS);
  const acceptAboveResistance =
    resistanceTop == null || acceptWindow.length < STRUCTURE_ZONES_ACCEPT_BARS
      ? null
      : acceptWindow.every((item) => item.close > resistanceTop);
  const acceptBelowSupport =
    supportBottom == null || acceptWindow.length < STRUCTURE_ZONES_ACCEPT_BARS
      ? null
      : acceptWindow.every((item) => item.close < supportBottom);
  const state =
    swingContext.state === 'unknown'
      ? 'unknown'
      : (swingContext.bias === 'bull' && acceptBelowSupport) ||
          (swingContext.bias === 'bear' && acceptAboveResistance)
        ? 'transition'
        : swingContext.state === 'trend'
          ? 'trend'
          : 'range';

  return {
    state,
    bias: swingContext.bias,
    support: {
      top: supportTop,
      bottom: supportBottom,
      level: low,
      distanceAtr: safeDivide(low == null ? null : price - low, atr),
    },
    resistance: {
      top: resistanceTop,
      bottom: resistanceBottom,
      level: high,
      distanceAtr: safeDivide(high == null ? null : high - price, atr),
    },
    acceptAboveResistance,
    acceptBelowSupport,
  };
};

const buildMaLayersContext = (
  sourceSeries: number[],
  precomputedLayers?: BaseContextMaLayerInput[] | null,
) => {
  const layers = BASE_CONTEXT_MA_LAYER_PERIODS.map(
    ([fastPeriod, slowPeriod], index) => {
      const precomputed = precomputedLayers?.[index];
      const fast =
        precomputed?.fastPeriod === fastPeriod &&
        precomputed?.slowPeriod === slowPeriod
          ? normalizeContextNumber(precomputed.fast)
          : calculateEma(sourceSeries, fastPeriod);
      const slow =
        precomputed?.fastPeriod === fastPeriod &&
        precomputed?.slowPeriod === slowPeriod
          ? normalizeContextNumber(precomputed.slow)
          : calculateEma(sourceSeries, slowPeriod);
      const bias =
        fast == null || slow == null
          ? 'unknown'
          : fast > slow
            ? 'bull'
            : fast < slow
              ? 'bear'
              : 'neutral';

      return {
        fastPeriod,
        slowPeriod,
        fast,
        slow,
        bias,
      };
    },
  );
  const knownLayers = layers.filter((layer) => layer.bias !== 'unknown');
  const bullishLayerCount = knownLayers.filter(
    (layer) => layer.bias === 'bull',
  ).length;
  const bearishLayerCount = knownLayers.filter(
    (layer) => layer.bias === 'bear',
  ).length;
  const alignment =
    knownLayers.length === 0
      ? 'unknown'
      : bullishLayerCount >= 4
        ? 'bull'
        : bearishLayerCount >= 4
          ? 'bear'
          : 'mixed';

  return {
    bullishLayerCount: knownLayers.length === 0 ? null : bullishLayerCount,
    bearishLayerCount: knownLayers.length === 0 ? null : bearishLayerCount,
    stackScore: knownLayers.length === 0 ? null : bullishLayerCount,
    trendState:
      knownLayers.length === 0
        ? ('unknown' as const)
        : bullishLayerCount >= 4
          ? ('bull' as const)
          : bearishLayerCount >= 4
            ? ('bear' as const)
            : ('sideways' as const),
    alignment,
    fastImpulseBias: layers[0].bias,
    macroBias: layers[4].bias,
    layerConflict:
      knownLayers.length === 0
        ? null
        : bullishLayerCount > 0 && bearishLayerCount > 0,
    layers,
  };
};

const buildContextMaContext = (
  closeSeries: number[],
  price: number,
  atr: number | null,
  precomputed?: BaseContextContextMaInput | null,
) => {
  const baseline =
    precomputed === undefined
      ? calculateEma(closeSeries, 34)
      : normalizeContextNumber(precomputed?.baseline ?? null);
  const boundaryWidth = atr == null ? null : atr * 1.2;
  const upperBoundary =
    baseline == null || boundaryWidth == null ? null : baseline + boundaryWidth;
  const lowerBoundary =
    baseline == null || boundaryWidth == null ? null : baseline - boundaryWidth;
  const contextBias =
    baseline == null || upperBoundary == null || lowerBoundary == null
      ? 'unknown'
      : price > upperBoundary
        ? 'bull'
        : price < lowerBoundary
          ? 'bear'
          : 'neutral';
  const nearestBoundary =
    contextBias === 'bull'
      ? upperBoundary
      : contextBias === 'bear'
        ? lowerBoundary
        : baseline;

  return {
    baseline,
    upperBoundary,
    lowerBoundary,
    contextBias,
    distanceToBoundaryAtr:
      nearestBoundary == null ? null : safeDivide(price - nearestBoundary, atr),
  };
};

const buildAdaptiveChannelContext = (
  candles: Candle[],
  price: number,
  atr: number | null,
  precomputed?: BaseContextAdaptiveChannelInput | null,
) => {
  const fullChannel = buildAdaptiveTrendChannelContext(candles, price);
  if (fullChannel.centerline != null) {
    return fullChannel;
  }

  const centerline = normalizeContextNumber(precomputed?.centerline ?? null);
  const previousCenterline = normalizeContextNumber(
    precomputed?.previousCenterline ?? null,
  );
  const width = atr == null ? null : atr * 1.5;
  const upper = centerline == null || width == null ? null : centerline + width;
  const lower = centerline == null || width == null ? null : centerline - width;
  const centerlineSlope =
    centerline == null || previousCenterline == null
      ? null
      : centerline - previousCenterline;
  const direction =
    centerlineSlope == null
      ? 'unknown'
      : centerlineSlope > 0
        ? 'bull'
        : centerlineSlope < 0
          ? 'bear'
          : 'neutral';

  return {
    centerline,
    upper,
    lower,
    direction,
    regime: direction,
    roof: upper,
    floor: lower,
    flipUp: null,
    flipDown: null,
    halfChannelAtr: safeDivide(width, atr),
    centerlineSlope,
    channelWidthAtr: safeDivide(width == null ? null : width * 2, atr),
    pricePositionInChannel:
      lower == null || upper == null
        ? null
        : calculateRangePosition(price, lower, upper),
  };
};

const buildPivotContext = (
  pivots: PivotPoint[],
  candlesCount: number,
  atr: number | null,
) => {
  let lastHigh: PivotPoint | undefined;
  let lastLow: PivotPoint | undefined;
  for (let index = pivots.length - 1; index >= 0; index -= 1) {
    const pivot = pivots[index];
    if (!lastHigh && pivot.type === 'high') {
      lastHigh = pivot;
    }
    if (!lastLow && pivot.type === 'low') {
      lastLow = pivot;
    }
    if (lastHigh && lastLow) {
      break;
    }
  }
  const pivotDensity = (lookback: number) =>
    candlesCount === 0
      ? null
      : pivots.filter((pivot) => candlesCount - 1 - pivot.index < lookback)
          .length / Math.min(lookback, candlesCount);

  return {
    lastSwingHigh: lastHigh?.price ?? null,
    lastSwingLow: lastLow?.price ?? null,
    barsSinceSwingHigh:
      lastHigh == null ? null : candlesCount - 1 - lastHigh.index,
    barsSinceSwingLow:
      lastLow == null ? null : candlesCount - 1 - lastLow.index,
    swingAmplitudeAtr:
      lastHigh == null || lastLow == null
        ? null
        : safeDivide(Math.abs(lastHigh.price - lastLow.price), atr),
    pivotDensity20: pivotDensity(20),
    pivotDensity50: pivotDensity(50),
  };
};

const buildDeltaContext = (candles: Candle[]) => {
  const hasTakerVolume = candles.some(
    (item) =>
      typeof item.takerBuyBaseVolume === 'number' &&
      Number.isFinite(item.takerBuyBaseVolume),
  );
  const signedVolumes = candles.map((item) => {
    if (
      typeof item.takerBuyBaseVolume === 'number' &&
      Number.isFinite(item.takerBuyBaseVolume)
    ) {
      const buyVolume = item.takerBuyBaseVolume;
      const sellVolume =
        typeof item.takerSellBaseVolume === 'number' &&
        Number.isFinite(item.takerSellBaseVolume)
          ? item.takerSellBaseVolume
          : Math.max(0, item.volume - buyVolume);
      return buyVolume - sellVolume;
    }

    const range = item.high - item.low;
    const buyPressurePct =
      range > 0
        ? (item.close - item.low) / range
        : item.close >= item.open
          ? 1
          : 0;
    return (buyPressurePct * 2 - 1) * item.volume;
  });
  const latest = candles[candles.length - 1] ?? null;
  const latestRange = latest == null ? null : latest.high - latest.low;
  const latestBuyVolume =
    latest != null &&
    typeof latest.takerBuyBaseVolume === 'number' &&
    Number.isFinite(latest.takerBuyBaseVolume)
      ? latest.takerBuyBaseVolume
      : null;
  const latestSellVolume =
    latest != null &&
    typeof latest.takerSellBaseVolume === 'number' &&
    Number.isFinite(latest.takerSellBaseVolume)
      ? latest.takerSellBaseVolume
      : latestBuyVolume == null || latest == null
        ? null
        : Math.max(0, latest.volume - latestBuyVolume);
  const buyPressurePct =
    latestBuyVolume != null && latestSellVolume != null
      ? safeDivide(latestBuyVolume, latestBuyVolume + latestSellVolume)
      : latest == null || latestRange == null || latestRange <= 0
        ? null
        : (latest.close - latest.low) / latestRange;
  const signedVolume =
    signedVolumes.length > 0 ? signedVolumes[signedVolumes.length - 1] : null;
  const deltaSlope = calculateLineSlope(signedVolumes, 5);
  const priceSlope = calculateLineSlope(
    candles.map((item) => item.close),
    5,
  );
  const deltaDivergenceVsPrice =
    priceSlope == null || deltaSlope == null
      ? 'unknown'
      : priceSlope > 0 && deltaSlope < 0
        ? 'bearish'
        : priceSlope < 0 && deltaSlope > 0
          ? 'bullish'
          : 'none';

  return {
    source: hasTakerVolume ? 'kline_taker_volume' : 'ohlcv_proxy',
    buyPressurePct,
    buyVolume: latestBuyVolume,
    sellVolume: latestSellVolume,
    netDelta:
      latestBuyVolume == null || latestSellVolume == null
        ? signedVolume
        : latestBuyVolume - latestSellVolume,
    deltaPct:
      latestBuyVolume == null || latestSellVolume == null
        ? null
        : safeDivide(
            latestBuyVolume - latestSellVolume,
            latestBuyVolume + latestSellVolume,
          ),
    signedVolume,
    signedVolumeZScore: calculateZScore(signedVolumes, signedVolume),
    deltaSlope,
    deltaDivergenceVsPrice,
  };
};

export type BuildBaseContextParams = {
  candle: Candle;
  prevCandle: Candle | null;
  baseResult: BaseResultSnapshot;
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
  closeStreaks: CloseStreakRuntimeState;
  breakoutState: BreakoutRuntimeState;
  rsiValue?: number | null;
  adxValue?: {
    adx: number;
    pdi: number;
    mdi: number;
  } | null;
  maLayers?: BaseContextMaLayerInput[] | null;
  contextMa?: BaseContextContextMaInput | null;
  adaptiveChannel?: BaseContextAdaptiveChannelInput | null;
  psar?: BaseContextPsarInput | null;
  nativeOverlay?: BaseContextNativeOverlay | null;
};

export const buildBaseContextMtfSnapshot = ({
  candlesHistory,
  btcCandlesHistory,
  coinResampledCandles,
  btcResampledCandles,
  currentTrendBias,
}: Pick<
  BuildBaseContextParams,
  | 'candlesHistory'
  | 'btcCandlesHistory'
  | 'coinResampledCandles'
  | 'btcResampledCandles'
> & {
  currentTrendBias?: 'bull' | 'bear' | 'neutral';
}) => ({
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
  summary: buildMtfSummary(coinResampledCandles, currentTrendBias),
});

export const buildBaseContextSnapshot = ({
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
  closeStreaks,
  breakoutState: breakoutRuntimeState,
  rsiValue,
  adxValue,
  maLayers: precomputedMaLayers,
  contextMa: precomputedContextMa,
  adaptiveChannel: precomputedAdaptiveChannel,
  psar: precomputedPsar,
  nativeOverlay,
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
  const prior20 = candlesHistory.slice(-21, -1);
  const structureWindow = candlesHistory.slice(-STRUCTURE_LOOKBACK);
  const session = buildSessionContext(candle.timestamp);
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
  const atrSlope = calculateLineSlope(atrPctSeries, 5);
  const compressionScore = safeDivide(
    toNullable(baseResult.atrPct),
    getLastFiniteValue(atrPctSeries.slice(0, -1)),
  );
  const expansionScore =
    compressionScore == null || compressionScore === 0
      ? null
      : 1 / compressionScore;
  const bbWidthPctSeries = calculateRecentBbWidthPctSeries(closeSeries, 100);
  const rawAtrPctSeries = calculateRecentAtrPctSeries(candlesHistory, 100);
  const rawAtrPct = safeDivide(atr, candle.close);
  const realizedVolatility = calculateRealizedVolatility(closeSeries);
  const realizedVolatilitySeries = calculateRecentRealizedVolatilitySeries(
    closeSeries,
    100,
  );
  const rangeExpansionSeries = calculateRecentRangeExpansionSeries(
    candlesHistory,
    20,
  );
  const rangeExpansion =
    rangeExpansionSeries[rangeExpansionSeries.length - 1] ?? null;
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
  const touchTolerance =
    atr != null && Number.isFinite(atr) && atr > 0 ? atr * 0.15 : null;
  const highLevel = baseResult.highLevel;
  const lowLevel = baseResult.lowLevel;
  const highTouchCount20 =
    highLevel == null || touchTolerance == null
      ? null
      : recent20.filter(
          (item) => Math.abs(item.high - highLevel) <= touchTolerance,
        ).length;
  const lowTouchCount20 =
    lowLevel == null || touchTolerance == null
      ? null
      : recent20.filter(
          (item) => Math.abs(item.low - lowLevel) <= touchTolerance,
        ).length;
  const dominantTouchCount20 =
    highTouchCount20 == null && lowTouchCount20 == null
      ? null
      : Math.max(highTouchCount20 ?? 0, lowTouchCount20 ?? 0);
  const upperWick =
    highLowRange > 0
      ? (candle.high - Math.max(candle.open, candle.close)) / highLowRange
      : null;
  const lowerWick =
    highLowRange > 0
      ? (Math.min(candle.open, candle.close) - candle.low) / highLowRange
      : null;
  const breakoutRetestQuality =
    breakoutRuntimeState.side == null ||
    breakoutRuntimeState.barsSinceBreakout == null ||
    breakoutRuntimeState.barsSinceBreakout < 1 ||
    breakoutRuntimeState.barsSinceBreakout > 4 ||
    atr == null
      ? null
      : breakoutRuntimeState.side === 'high'
        ? highLevel == null
          ? null
          : (() => {
              const retestDistance = Math.abs(candle.low - highLevel);
              const wickSupport = lowerWick ?? 0;
              const closeAcceptance = candle.close > highLevel ? 1 : 0;
              const distanceScore = Math.max(0, 1 - retestDistance / atr);
              return Math.min(
                1,
                distanceScore * 0.45 +
                  wickSupport * 0.25 +
                  closeAcceptance * 0.3,
              );
            })()
        : lowLevel == null
          ? null
          : (() => {
              const retestDistance = Math.abs(candle.high - lowLevel);
              const wickSupport = upperWick ?? 0;
              const closeAcceptance = candle.close < lowLevel ? 1 : 0;
              const distanceScore = Math.max(0, 1 - retestDistance / atr);
              return Math.min(
                1,
                distanceScore * 0.45 +
                  wickSupport * 0.25 +
                  closeAcceptance * 0.3,
              );
            })();
  const recentFalseBreakoutDensity =
    highLevel == null || lowLevel == null || recent20.length < 2
      ? null
      : recent20.reduce((count, item, index) => {
          if (index === 0) {
            return count;
          }

          const prevItem = recent20[index - 1];
          if (!prevItem) {
            return count;
          }

          if (prevItem.close > highLevel && item.close <= highLevel) {
            return count + 1;
          }

          if (prevItem.close < lowLevel && item.close >= lowLevel) {
            return count + 1;
          }

          return count;
        }, 0) /
        (recent20.length - 1);
  const rejectionWickScore =
    trendBias === 'bull'
      ? lowerWick
      : trendBias === 'bear'
        ? upperWick
        : Math.max(upperWick ?? 0, lowerWick ?? 0);
  const adxContext =
    buildAdxContext(adxValue) ?? calculateAdxContext(candlesHistory);
  const rsiContext =
    buildRsiContext(rsiValue) ?? calculateRsiContext(closeSeries);
  const benchmarkMaFast = averageLastN(btcCloseSeries, indicatorPeriods.maFast);
  const benchmarkMaSlow = averageLastN(btcCloseSeries, indicatorPeriods.maSlow);
  const btc1h = btcResampledCandles.h1;
  const btc4h = btcResampledCandles.h4;
  const btc1d = btcResampledCandles.d1;
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
  const structurePivots = detectConfirmedPivots(structureWindow, atr);
  const structureZones = buildPriceZones(structureWindow, structurePivots, atr);
  const swingContext = buildSwingContext(structurePivots);
  const pivotContext = buildPivotContext(
    structurePivots,
    structureWindow.length,
    atr,
  );
  const nearestSupport = getNearestZone(
    structureZones,
    'support',
    candle.close,
  );
  const nearestResistance = getNearestZone(
    structureZones,
    'resistance',
    candle.close,
  );
  const totalStructureVolume = structureWindow.reduce(
    (sum, item) => sum + item.volume,
    0,
  );
  const priceInSupportZone =
    nearestSupport == null
      ? null
      : candle.close >= nearestSupport.lower &&
        candle.close <= nearestSupport.upper;
  const priceInResistanceZone =
    nearestResistance == null
      ? null
      : candle.close >= nearestResistance.lower &&
        candle.close <= nearestResistance.upper;
  const activeZoneType = priceInSupportZone
    ? 'support'
    : priceInResistanceZone
      ? 'resistance'
      : null;
  const priceInZone =
    priceInSupportZone == null && priceInResistanceZone == null
      ? null
      : Boolean(priceInSupportZone || priceInResistanceZone);
  const resistanceVolumeShare = safeDivide(
    nearestResistance?.volume ?? null,
    totalStructureVolume,
  );
  const supportVolumeShare = safeDivide(
    nearestSupport?.volume ?? null,
    totalStructureVolume,
  );
  const sweepState =
    nearestResistance == null && nearestSupport == null
      ? 'unknown'
      : nearestResistance != null &&
          candle.high > nearestResistance.upper &&
          candle.close < nearestResistance.level
        ? 'swept_high'
        : nearestSupport != null &&
            candle.low < nearestSupport.lower &&
            candle.close > nearestSupport.level
          ? 'swept_low'
          : nearestResistance != null && candle.close > nearestResistance.upper
            ? 'broken_high'
            : nearestSupport != null && candle.close < nearestSupport.lower
              ? 'broken_low'
              : 'none';
  const liquiditySide =
    sweepState === 'swept_high' || sweepState === 'broken_high'
      ? 'high'
      : sweepState === 'swept_low' || sweepState === 'broken_low'
        ? 'low'
        : null;
  const referenceZoneSide =
    liquiditySide === 'high'
      ? 'resistance'
      : liquiditySide === 'low'
        ? 'support'
        : null;
  const prior20High =
    prior20.length > 0 ? Math.max(...prior20.map((item) => item.high)) : null;
  const prior20Low =
    prior20.length > 0 ? Math.min(...prior20.map((item) => item.low)) : null;
  const sweepHigh20 =
    prior20High == null
      ? null
      : candle.high > prior20High && candle.close < prior20High;
  const sweepLow20 =
    prior20Low == null
      ? null
      : candle.low < prior20Low && candle.close > prior20Low;
  const closeBackInsideRange =
    sweepHigh20 == null && sweepLow20 == null
      ? null
      : Boolean(sweepHigh20 || sweepLow20);
  const stopRunDirection = sweepHigh20 ? 'up' : sweepLow20 ? 'down' : null;
  const sweepWickPct =
    stopRunDirection === 'up'
      ? upperWick
      : stopRunDirection === 'down'
        ? lowerWick
        : null;
  const recent3 = candlesHistory.slice(-3);
  const recent5 = candlesHistory.slice(-5);
  const closesAboveHighLevel3 =
    highLevel == null
      ? null
      : recent3.filter((item) => item.close > highLevel).length;
  const closesBelowLowLevel3 =
    lowLevel == null
      ? null
      : recent3.filter((item) => item.close < lowLevel).length;
  const failedAcceptanceBars =
    highLevel == null || lowLevel == null
      ? null
      : recent5.filter(
          (item) =>
            (item.high > highLevel && item.close <= highLevel) ||
            (item.low < lowLevel && item.close >= lowLevel),
        ).length;
  const acceptanceScore =
    closesAboveHighLevel3 == null || closesBelowLowLevel3 == null
      ? null
      : (closesAboveHighLevel3 - closesBelowLowLevel3) /
        Math.max(1, recent3.length);
  const breakoutBodyAtr = safeDivide(Math.abs(candle.close - candle.open), atr);
  const priceVolumeProfile = buildPriceVolumeProfileContext(
    structureWindow,
    candle.close,
    atr,
  );
  const volumeStructure =
    nativeOverlay?.volumeStructure ??
    buildVolumeStructureContext(candlesHistory, candle.close, atr);
  const srZones =
    nativeOverlay?.srZones ??
    buildSrZonesContext(
      structureWindow,
      candle.close,
      prevCandle?.close ?? null,
      atr,
    );
  const liquidityZones =
    nativeOverlay?.liquidityZones ??
    buildLiquidityZonesContext(
      candlesHistory.slice(-180),
      candle.close,
      prevCandle?.close ?? null,
      atr,
    );
  const liquidityTails =
    nativeOverlay?.liquidityTails ??
    buildLiquidityTailsContext(candlesHistory.slice(-180), candle.close, atr);
  const trendFollow =
    nativeOverlay?.trendFollow ??
    buildTrendFollowContext(candlesHistory.slice(-220), candle.close, atr);
  const structureZonesContext = buildStructureZonesContext(
    swingContext,
    pivotContext,
    candle.close,
    atr,
    structureWindow,
  );
  const hl2Series =
    precomputedMaLayers === undefined
      ? candlesHistory.map((item) => (item.high + item.low) / 2)
      : [];
  const maLayers = buildMaLayersContext(hl2Series, precomputedMaLayers);
  const contextMa = buildContextMaContext(
    closeSeries,
    candle.close,
    atr,
    precomputedContextMa,
  );
  const adaptiveChannel =
    nativeOverlay?.adaptiveChannel ??
    buildAdaptiveChannelContext(
      candlesHistory,
      candle.close,
      atr,
      precomputedAdaptiveChannel,
    );
  const deltaContext =
    nativeOverlay?.delta ?? buildDeltaContext(structureWindow);
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
      },
    },
    regime: {
      trend: {
        bias: trendBias,
        maStackScore,
        priceDistanceToMaFastAtr,
        priceDistanceToMaSlowAtr,
        persistence,
        adx: adxContext,
        maLayers,
        contextMa,
        adaptiveChannel,
        trendFollow,
        psar: precomputedPsar ?? {
          value: null,
          direction: 'unknown',
          rawBuySignal: null,
          rawSellSignal: null,
          buySignal: null,
          sellSignal: null,
          emaFilter: null,
          trendLongOk: null,
          trendShortOk: null,
          adxOk: null,
          candleLongOk: null,
          candleShortOk: null,
          cooldownOk: null,
          barsSinceSignal: null,
        },
      },
      volatility: {
        atrSlope,
        atrPctZScore,
        bbWidthPct,
        compressionScore,
        expansionScore,
        state: volatilityState,
        percentiles: {
          atrPctRank100: calculatePercentRank(rawAtrPctSeries, rawAtrPct, 100),
          bbWidthRank100: calculatePercentRank(
            bbWidthPctSeries,
            bbWidthPct,
            100,
          ),
          realizedVolRank100: calculatePercentRank(
            realizedVolatilitySeries,
            realizedVolatility,
            100,
          ),
          rangeExpansionRank20: calculatePercentRank(
            rangeExpansionSeries,
            rangeExpansion,
            20,
          ),
        },
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
        rsi: rsiContext.rsi,
        rsiState: rsiContext.rsiState,
        macdHistogramSlope: calculateLineSlope(macdHistogramSeries, 5),
        bodyStrength,
        closeLocationInRange,
        upCloseStreak: closeStreaks.up,
        downCloseStreak: closeStreaks.down,
      },
      session,
      memory: {
        recentFalseBreakoutDensity,
      },
    },
    structure: {
      swing: swingContext,
      zones: {
        support: {
          level: nearestSupport?.level ?? null,
          lower: nearestSupport?.lower ?? null,
          upper: nearestSupport?.upper ?? null,
          touches: nearestSupport?.touches ?? null,
          ageBars: nearestSupport?.ageBars ?? null,
          volumeShare: supportVolumeShare,
          distanceAtr: safeDivide(
            nearestSupport == null ? null : candle.close - nearestSupport.level,
            atr,
          ),
        },
        resistance: {
          level: nearestResistance?.level ?? null,
          lower: nearestResistance?.lower ?? null,
          upper: nearestResistance?.upper ?? null,
          touches: nearestResistance?.touches ?? null,
          ageBars: nearestResistance?.ageBars ?? null,
          volumeShare: resistanceVolumeShare,
          distanceAtr: safeDivide(
            nearestResistance == null
              ? null
              : nearestResistance.level - candle.close,
            atr,
          ),
        },
        active: {
          side: activeZoneType,
          priceInZone,
        },
      },
      srZones,
      liquidity: {
        sweepState,
        side: liquiditySide,
        referenceZoneSide,
        sweepHigh20,
        sweepLow20,
        closeBackInsideRange,
        stopRunDirection,
        sweepWickPct,
      },
      liquidityZones,
      liquidityTails,
      structureZones: structureZonesContext,
      pivots: pivotContext,
      acceptance: {
        closesAboveHighLevel3,
        closesBelowLowLevel3,
        failedAcceptanceBars,
        acceptanceScore,
        breakoutBodyAtr,
      },
      localRange: {
        rangePosition20: calculateRangePosition(
          candle.close,
          recent20Low,
          recent20High,
        ),
        distanceToHighLevelAtr,
        distanceToLowLevelAtr,
        breakoutState,
        barsSinceBreakout: breakoutRuntimeState.barsSinceBreakout,
        breakoutRetestQuality,
      },
      levels: {
        highTouchCount20,
        lowTouchCount20,
        dominantTouchCount20,
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
      priceVolumeProfile,
      volumeStructure,
      delta: deltaContext,
    },
    relative: {
      benchmark: {
        maFast: benchmarkMaFast,
        maSlow: benchmarkMaSlow,
        bias: benchmarkTrendBias,
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
          currentTrendBias: trendBias,
        });
      }

      return cachedMtfSnapshot;
    },
  });

  return snapshot as BaseStrategyContextSnapshot;
};
