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
  const rsiState =
    value == null
      ? 'unknown'
      : value >= 70
        ? 'overbought'
        : value <= 30
          ? 'oversold'
          : 'neutral';

  return {
    rsi: value,
    rsiState,
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
  const adxValue = latest?.adx ?? null;
  const diPlus = latest?.pdi ?? null;
  const diMinus = latest?.mdi ?? null;
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

const calculateTrueRange = (current: Candle, previous: Candle | null) =>
  previous == null
    ? current.high - current.low
    : Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close),
      );

const calculateRealizedVolatility = (closes: number[], period = 20) => {
  const window = closes.slice(-(period + 1));
  if (window.length < period + 1) {
    return null;
  }

  const returns = window.slice(1).map((close, index) => {
    const previous = window[index];
    return previous > 0 ? Math.log(close / previous) : 0;
  });
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    returns.length;

  return Math.sqrt(variance);
};

const calculateRealizedVolatilitySeries = (closes: number[], period = 20) =>
  closes.map((_, index) =>
    calculateRealizedVolatility(closes.slice(0, index + 1), period),
  );

const calculateBbWidthPctSeries = (
  closes: number[],
  period = 20,
  stdMultiplier = 2,
) =>
  closes.map((_, index) => {
    const window = closes.slice(Math.max(0, index + 1 - period), index + 1);
    if (window.length < period) {
      return null;
    }

    const mean = window.reduce((sum, value) => sum + value, 0) / window.length;
    const variance =
      window.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      window.length;
    const std = Math.sqrt(variance);

    return mean === 0 ? null : ((std * stdMultiplier * 2) / mean) * 100;
  });

const calculateAtrPctSeries = (candles: Candle[], period = 14) =>
  candles.map((_, index) => {
    const window = candles.slice(Math.max(0, index + 1 - period), index + 1);
    if (window.length < period) {
      return null;
    }

    const atrValue =
      window.reduce((sum, item, windowIndex) => {
        const absoluteIndex = index + 1 - window.length + windowIndex;
        const previous = absoluteIndex > 0 ? candles[absoluteIndex - 1] : null;
        return sum + calculateTrueRange(item, previous);
      }, 0) / period;

    return safeDivide(atrValue, candles[index].close);
  });

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
    const left = candles.slice(index - PIVOT_LEFT_RIGHT, index);
    const right = candles.slice(index + 1, index + PIVOT_LEFT_RIGHT + 1);
    const surrounding = [...left, ...right];
    const maxOtherHigh = Math.max(...surrounding.map((item) => item.high));
    const minOtherLow = Math.min(...surrounding.map((item) => item.low));

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

const buildMaLayersContext = (sourceSeries: number[]) => {
  const periods = [
    [5, 12],
    [9, 13],
    [34, 50],
    [72, 89],
    [180, 200],
  ] as const;
  const layers = periods.map(([fastPeriod, slowPeriod]) => {
    const fast = calculateEma(sourceSeries, fastPeriod);
    const slow = calculateEma(sourceSeries, slowPeriod);
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
  });
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
) => {
  const baseline = calculateEma(closeSeries, 34);
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
) => {
  const typicalSeries = candles.map(getTypicalPrice);
  const centerline = calculateSma(typicalSeries, 20);
  const previousCenterline = calculateSma(typicalSeries.slice(0, -1), 20);
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
  const lastHigh = [...pivots].reverse().find((pivot) => pivot.type === 'high');
  const lastLow = [...pivots].reverse().find((pivot) => pivot.type === 'low');
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
  const bbWidthPctSeries = calculateBbWidthPctSeries(closeSeries);
  const rawAtrPctSeries = calculateAtrPctSeries(candlesHistory);
  const rawAtrPct = safeDivide(atr, candle.close);
  const realizedVolatility = calculateRealizedVolatility(closeSeries);
  const realizedVolatilitySeries =
    calculateRealizedVolatilitySeries(closeSeries);
  const rangeExpansionSeries = candlesHistory.map((item, index) => {
    const previous = index > 0 ? candlesHistory[index - 1] : null;
    return safeDivide(item.high - item.low, calculateTrueRange(item, previous));
  });
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
  const adxContext = calculateAdxContext(candlesHistory);
  const rsiContext = calculateRsiContext(closeSeries);
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
  const hl2Series = candlesHistory.map((item) => (item.high + item.low) / 2);
  const maLayers = buildMaLayersContext(hl2Series);
  const contextMa = buildContextMaContext(closeSeries, candle.close, atr);
  const adaptiveChannel = buildAdaptiveChannelContext(
    structureWindow,
    candle.close,
    atr,
  );
  const deltaContext = buildDeltaContext(structureWindow);
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
