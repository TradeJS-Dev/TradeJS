import type { BaseStrategyContextSnapshot, Direction } from '@tradejs/types';
import type { VolatilityCompressionBreakoutSignalContext } from './core';

export type VolatilityCompressionBreakoutGateFeatures = {
  stopDistanceBps: number | null;
  distanceToTrailStopPct: number | null;
  momentumRsi: number | null;
  price24hPct: number | null;
  freshShortBreakdown: boolean;
  highQualityFreshShortBreakdown: boolean;
};

export type VolatilityCompressionBreakoutGuardrailContext = Omit<
  Partial<VolatilityCompressionBreakoutSignalContext>,
  'signalDirection'
> & {
  signalDirection: Direction | null;
  deterministicQuality: number;
  approvalAllowedNow: boolean;
  approvalBlockReasons: string[];
  volatilityCompressionBreakoutGateFeatures: VolatilityCompressionBreakoutGateFeatures;
};

type SignalPrices = {
  currentPrice?: number | null;
  stopLossPrice?: number | null;
};

const MIN_STOP_DISTANCE_BPS = 125;
const MAX_TRAIL_DISTANCE_PCT = -3;
const MIN_MOMENTUM_RSI = 25;
const MIN_FRESH_BREAKDOWN_PRICE_24H_PCT = -6;
const MIN_HIGH_QUALITY_PRICE_24H_PCT = -5;

const toFiniteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getStopDistanceBps = (prices: SignalPrices | null | undefined) => {
  const currentPrice = toFiniteNumber(prices?.currentPrice);
  const stopLossPrice = toFiniteNumber(prices?.stopLossPrice);
  if (currentPrice == null || stopLossPrice == null || currentPrice === 0) {
    return null;
  }

  return (
    (Math.abs(currentPrice - stopLossPrice) / Math.abs(currentPrice)) * 10000
  );
};

export const buildVolatilityCompressionBreakoutGuardrailContext = ({
  signalContext,
  baseContext,
  prices,
}: {
  signalContext: Partial<VolatilityCompressionBreakoutSignalContext>;
  baseContext: BaseStrategyContextSnapshot | null;
  prices?: SignalPrices | null;
}): VolatilityCompressionBreakoutGuardrailContext => {
  const signalDirection =
    signalContext.signalDirection === 'LONG' ||
    signalContext.signalDirection === 'SHORT'
      ? signalContext.signalDirection
      : null;
  const stopDistanceBps = getStopDistanceBps(prices);
  const distanceToTrailStopPct = toFiniteNumber(
    baseContext?.regime?.trend?.trendFollow?.distanceToTrailStopPct,
  );
  const momentumRsi = toFiniteNumber(baseContext?.regime?.momentum?.rsi);
  const price24hPct = toFiniteNumber(baseContext?.raw?.price?.price24hPct);
  const shortStructureReady =
    signalDirection === 'SHORT' &&
    stopDistanceBps != null &&
    stopDistanceBps >= MIN_STOP_DISTANCE_BPS &&
    distanceToTrailStopPct != null &&
    distanceToTrailStopPct <= MAX_TRAIL_DISTANCE_PCT &&
    momentumRsi != null &&
    momentumRsi >= MIN_MOMENTUM_RSI;
  const freshShortBreakdown =
    shortStructureReady &&
    price24hPct != null &&
    price24hPct >= MIN_FRESH_BREAKDOWN_PRICE_24H_PCT;
  const highQualityFreshShortBreakdown =
    freshShortBreakdown &&
    price24hPct != null &&
    price24hPct >= MIN_HIGH_QUALITY_PRICE_24H_PCT;
  const deterministicQuality = highQualityFreshShortBreakdown
    ? 5
    : freshShortBreakdown
      ? 4
      : 3;
  const approvalBlockReasons: string[] = [];

  if (signalDirection !== 'SHORT') {
    approvalBlockReasons.push('only fresh SHORT breakouts are approved');
  }
  if (stopDistanceBps == null) {
    approvalBlockReasons.push('stop distance is unavailable');
  } else if (stopDistanceBps < MIN_STOP_DISTANCE_BPS) {
    approvalBlockReasons.push(
      'stop distance is too narrow after execution costs',
    );
  }
  if (distanceToTrailStopPct == null) {
    approvalBlockReasons.push('trend-follow trail distance is unavailable');
  } else if (distanceToTrailStopPct > MAX_TRAIL_DISTANCE_PCT) {
    approvalBlockReasons.push('breakdown displacement is insufficient');
  }
  if (momentumRsi == null) {
    approvalBlockReasons.push('momentum RSI is unavailable');
  } else if (momentumRsi < MIN_MOMENTUM_RSI) {
    approvalBlockReasons.push('breakdown is already oversold');
  }
  if (price24hPct == null) {
    approvalBlockReasons.push('24h price change is unavailable');
  } else if (price24hPct < MIN_FRESH_BREAKDOWN_PRICE_24H_PCT) {
    approvalBlockReasons.push(
      'breakdown is no longer fresh on the 24h horizon',
    );
  }

  return {
    ...signalContext,
    signalDirection,
    deterministicQuality,
    approvalAllowedNow: deterministicQuality >= 4,
    approvalBlockReasons,
    volatilityCompressionBreakoutGateFeatures: {
      stopDistanceBps,
      distanceToTrailStopPct,
      momentumRsi,
      price24hPct,
      freshShortBreakdown,
      highQualityFreshShortBreakdown,
    },
  };
};

export const getVolatilityCompressionBreakoutGuardrailRejectReason = (
  context: VolatilityCompressionBreakoutGuardrailContext,
) =>
  context.approvalBlockReasons.join('; ') ||
  'Volatility compression breakout is outside the fresh SHORT approval pocket.';
