import type { Candle } from '@tradejs/types';
import {
  calculateLineSlope,
  calculateZScore,
  safeDivide,
} from './indicatorMath';
import { getTypicalPrice } from './indicatorBaseContextTrend';

const PROFILE_BIN_COUNT = 24;
const VOLUME_STRUCTURE_CALC_BARS = 180;
const VOLUME_STRUCTURE_ROW_COUNT = 20;

export const buildPriceVolumeProfileContext = (
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

export const buildVolumeStructureContext = (
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

export const buildDeltaContext = (candles: Candle[]) => {
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
