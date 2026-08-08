import { diffRel } from '@tradejs/core/math';
import { ATR_PCT } from '@tradejs/indicators';
import { getSma } from './utils';

import { KlineChartData } from '@tradejs/types';
import type { TrendLineConfig } from './config';

type TrendLineStructuralFilterContext = {
  breakVsAtrRatio: number | null;
  btcBiasAligned: boolean | null;
};

type TrendLineTimingFilterContext = {
  entryTiming: string;
  lineSlopeAligned: boolean | null;
};

const asPositiveThreshold = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const getTrendLineCoreFilterSkipCode = ({
  config,
  structuralContext,
  timingContext,
}: {
  config: TrendLineConfig;
  structuralContext: TrendLineStructuralFilterContext;
  timingContext: TrendLineTimingFilterContext;
}): string | null => {
  const minBreakAtrRatio = asPositiveThreshold(
    config.TRENDLINE_MIN_BREAK_ATR_RATIO,
  );
  if (
    minBreakAtrRatio != null &&
    (structuralContext.breakVsAtrRatio == null ||
      structuralContext.breakVsAtrRatio < minBreakAtrRatio)
  ) {
    return 'TRENDLINE_BREAK_TOO_WEAK_VS_ATR';
  }

  const maxBreakAtrRatio = asPositiveThreshold(
    config.TRENDLINE_MAX_BREAK_ATR_RATIO,
  );
  if (
    maxBreakAtrRatio != null &&
    (structuralContext.breakVsAtrRatio == null ||
      structuralContext.breakVsAtrRatio > maxBreakAtrRatio)
  ) {
    return 'TRENDLINE_BREAK_TOO_EXTENDED_VS_ATR';
  }

  if (
    config.TRENDLINE_REQUIRE_SLOPE_ALIGNMENT &&
    timingContext.lineSlopeAligned !== true
  ) {
    return 'TRENDLINE_SLOPE_NOT_ALIGNED';
  }

  if (
    config.TRENDLINE_REQUIRE_BTC_BIAS_ALIGNMENT &&
    structuralContext.btcBiasAligned !== true
  ) {
    return 'TRENDLINE_BTC_BIAS_NOT_ALIGNED';
  }

  const allowedEntryTimings = Array.isArray(
    config.TRENDLINE_ALLOWED_ENTRY_TIMINGS,
  )
    ? config.TRENDLINE_ALLOWED_ENTRY_TIMINGS
    : [];
  if (
    allowedEntryTimings.length > 0 &&
    !allowedEntryTimings.includes(timingContext.entryTiming)
  ) {
    return 'TRENDLINE_ENTRY_TIMING_NOT_ALLOWED';
  }

  return null;
};

const MIN_ATR = 0.94;
const SMA_SLOW = 200;
const MIN_DISTANCE_LOCAL_SMA_SLOW = 0.005;
const MAX_DISTANCE_LAST_ANCHOR = 0.02;
const MIN_BREAKOUT_PRICE = 0.002;

export const filterByLocalSmaSlow = (data: KlineChartData) => {
  const { last: currentLocalSmaSlow } = getSma(SMA_SLOW, data);
  const lastCandle = data[data.length - 1];

  if (
    diffRel(lastCandle.close, currentLocalSmaSlow) < MIN_DISTANCE_LOCAL_SMA_SLOW
  ) {
    // logger.warn('exit by local SMA SLOW is nearest: %s', symbol);

    return false;
  }

  return true;
};

export const filterByTooLate = (
  price: number,
  lineStart: number,
  lineEnd: number,
) => {
  if (
    diffRel(lineStart, price) < diffRel(lineEnd, price) ||
    diffRel(lineEnd, price) > MAX_DISTANCE_LAST_ANCHOR
  ) {
    // logger.warn('exit by is too late: %s', symbol);

    return false;
  }

  return true;
};

export const filterByBreakablePrice = (
  isLong: boolean,
  price: number,
  lineEnd: number,
) => {
  const priceIsBreakable =
    (isLong && price > lineEnd * (1 + MIN_BREAKOUT_PRICE)) ||
    (!isLong && price < lineEnd * (1 - MIN_BREAKOUT_PRICE));

  if (!priceIsBreakable) {
    // logger.warn('exit by price no breakable: %s %s', symbol);

    return false;
  }

  return true;
};

export const filterByATR = (data: KlineChartData) => {
  const { value: atr } = ATR_PCT(data, 14, 7, 30);

  if (atr < MIN_ATR) {
    // logger.warn('exit by ATR: %s %s', symbol, atr);

    return false;
  }

  return true;
};
