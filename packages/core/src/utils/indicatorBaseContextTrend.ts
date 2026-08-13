import type { Candle } from '@tradejs/types';
import { adx, rsi } from 'fast-technical-indicators';
import {
  calculateAtrAt,
  calculateAtrSeries,
  calculateTrueRange,
} from './indicatorBaseContextVolatility';
import {
  averageLastN,
  calculateRangePosition,
  safeDivide,
  toNullable,
} from './indicatorMath';
import {
  BASE_CONTEXT_MA_LAYER_PERIODS,
  type BaseContextAdaptiveChannelInput,
  type BaseContextContextMaInput,
  type BaseContextMaLayerInput,
  type BuildBaseContextParams,
} from './indicatorBaseContextContracts';
import {
  isConfirmedPivotHigh,
  isConfirmedPivotLow,
} from './indicatorBaseContextPivots';

const TREND_FOLLOW_PIVOT_LENGTH = 10;
const TREND_FOLLOW_ATR_LENGTH = 14;
const TREND_FOLLOW_ATR_MULT = 4;
const ADAPTIVE_CHANNEL_REGRESSION_BARS = 7;
const ADAPTIVE_CHANNEL_ENVELOPE_BARS = 2;
const ADAPTIVE_CHANNEL_ATR_STRETCH = 2;
const ADAPTIVE_CHANNEL_VOLATILITY_LOOKBACK = 100;
const ADAPTIVE_CHANNEL_CALC_LOOKBACK = 220;

export const getTypicalPrice = (candle: Candle) =>
  (candle.high + candle.low + candle.close) / 3;

export const normalizeContextNumber = (value: number | null): number | null =>
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

export const calculatePercentRank = (
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

export const calculateRsiContext = (closes: number[], period = 14) => {
  const values = rsi({ values: closes, period });
  const value = values.length > 0 ? values[values.length - 1] : null;
  return (
    buildRsiContext(value) ?? {
      rsi: null,
      rsiState: 'unknown',
    }
  );
};

export const buildRsiContext = (value: number | null | undefined) => {
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

export const buildAdxContext = (
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

export const calculateAdxContext = (candles: Candle[], period = 14) => {
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

export const buildMtfSummary = (
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

export const buildTrendFollowContext = (
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

export const buildMaLayersContext = (
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

export const buildContextMaContext = (
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

export const buildAdaptiveChannelContext = (
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
