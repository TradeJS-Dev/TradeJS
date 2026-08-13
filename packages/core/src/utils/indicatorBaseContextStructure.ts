import type { Candle } from '@tradejs/types';
import { safeDivide } from './indicatorMath';
import { getTypicalPrice } from './indicatorBaseContextTrend';

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

type SrZoneLevel = {
  level: number;
  upper: number;
  lower: number;
  strength: number;
  distancePct: number | null;
  side: 'support' | 'resistance';
};

const PIVOT_LEFT_RIGHT = 2;
const ZONE_ATR_FACTOR = 0.5;
const SR_ZONE_PIVOT_PERIOD = 9;
const SR_ZONE_MIN_STRENGTH = 2;
const SR_ZONE_MAX_PIVOTS = 15;
const SR_ZONE_CHANNEL_WIDTH_PCT = 8;
const SR_ZONE_MAX_LEVELS = 6;
const STRUCTURE_ZONES_ZONE_WIDTH_ATR = 0.5;
const STRUCTURE_ZONES_ACCEPT_BARS = 2;

export const detectConfirmedPivots = (
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

export const buildPriceZones = (
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

export const getNearestZone = (
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

export const buildSwingContext = (pivots: PivotPoint[]) => {
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

export const buildSrZonesContext = (
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

export const buildStructureZonesContext = (
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

export const buildPivotContext = (
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
