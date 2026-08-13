import type { Candle } from '@tradejs/types';
import { calculateAtrSeries } from './indicatorBaseContextVolatility';
import { safeDivide } from './indicatorMath';
import {
  isConfirmedPivotHigh,
  isConfirmedPivotLow,
} from './indicatorBaseContextPivots';

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

const LIQUIDITY_ZONE_LOOKBACK = 15;
const LIQUIDITY_ZONE_MAX_AGE = 120;
const LIQUIDITY_TAIL_ATR_LENGTH = 14;
const LIQUIDITY_TAIL_ATR_MULT = 0.8;
const LIQUIDITY_TAIL_MIN_WICK_RATIO = 1.3;
const LIQUIDITY_TAIL_WICK_DOMINANCE = 1.2;
const LIQUIDITY_TAIL_MIN_GAP = 5;
const LIQUIDITY_TAIL_MAX_AGE = 120;

export const buildLiquidityZonesContext = (
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

export const buildLiquidityTailsContext = (
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
