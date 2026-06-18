import { BaseStrategyContextSnapshot } from '@tradejs/types';
import { LiquidityZonesSignalContext } from './engine';

export type LiquidityZonesGuardrailContext =
  Partial<LiquidityZonesSignalContext> & {
    baseContextAvailable: boolean;
    primarySession: string | null;
    trendBias: string | null;
    breakoutState: string | null;
    entryLocation: string | null;
    liquidityZoneRetestDirection: string | null;
    volumeRel20: number | null;
    turnoverRel20: number | null;
    effortVsResult: number | null;
    maFast: number | null;
    maMedium: number | null;
    maSlow: number | null;
    macd: number | null;
    macdSignal: number | null;
    macdHistogram: number | null;
    macdHistogramSlope: number | null;
    obv: number | null;
    obvSma: number | null;
    obvSlope: number | null;
    priceVsMaFastAligned: boolean | null;
    priceVsMaSlowAligned: boolean | null;
    macdHistogramAligned: boolean | null;
    macdHistogramSlopeAligned: boolean | null;
    obvLevelAligned: boolean | null;
    obvSlopeAligned: boolean | null;
    directIndicatorSupportCount: number | null;
    venueSpreadZScore: number | null;
    benchmarkTrendAlignment: string | null;
    derivativesPressure: string | null;
    derivativesDirectionAligned: boolean | null;
    derivativesRiskFlags: string[];
    hardBlockReasons: string[];
    softBlockReasons: string[];
    deterministicQuality: number;
    approvalAllowedNow: boolean;
  };

const asFiniteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === 'string' && entry.trim().length > 0,
      )
    : [];

const isDirectionAligned = ({
  direction,
  bullishValue,
  bearishValue,
  value,
}: {
  direction: unknown;
  bullishValue: string;
  bearishValue: string;
  value: string | null;
}) =>
  direction === 'LONG'
    ? value === bullishValue
    : direction === 'SHORT'
      ? value === bearishValue
      : false;

const isDirectionalNumberAligned = ({
  direction,
  value,
}: {
  direction: unknown;
  value: number | null;
}) =>
  direction === 'LONG'
    ? value != null && value > 0
    : direction === 'SHORT'
      ? value != null && value < 0
      : null;

const isDirectionalPriceAboveLevel = ({
  direction,
  price,
  level,
}: {
  direction: unknown;
  price: number | null;
  level: number | null;
}) =>
  direction === 'LONG'
    ? price != null && level != null && price > level
    : direction === 'SHORT'
      ? price != null && level != null && price < level
      : null;

export const buildLiquidityZonesGuardrailContext = ({
  signalContext,
  baseContext,
}: {
  signalContext: Partial<LiquidityZonesSignalContext>;
  baseContext?: BaseStrategyContextSnapshot | null;
}): LiquidityZonesGuardrailContext => {
  const derivativesSummary = baseContext?.derivatives?.summary ?? null;
  const primarySession = baseContext?.regime?.session?.sessionPhase ?? null;
  const trendBias = baseContext?.regime?.trend?.bias ?? null;
  const breakoutState =
    baseContext?.structure?.localRange?.breakoutState ?? null;
  const entryLocation = baseContext?.gateFeatures?.setup?.entryLocation ?? null;
  const liquidityZoneRetestDirection = signalContext.signalDirection ?? null;
  const volumeRel20 = asFiniteNumber(
    baseContext?.participation?.volume?.volumeRel20,
  );
  const turnoverRel20 = asFiniteNumber(
    baseContext?.participation?.volume?.turnoverRel20,
  );
  const effortVsResult = asFiniteNumber(
    baseContext?.participation?.volume?.effortVsResult,
  );
  const maFast = asFiniteNumber(baseContext?.raw?.trend?.maFast);
  const maMedium = asFiniteNumber(baseContext?.raw?.trend?.maMedium);
  const maSlow = asFiniteNumber(baseContext?.raw?.trend?.maSlow);
  const macd = asFiniteNumber(baseContext?.raw?.momentum?.macd);
  const macdSignal = asFiniteNumber(baseContext?.raw?.momentum?.macdSignal);
  const macdHistogram = asFiniteNumber(
    baseContext?.raw?.momentum?.macdHistogram,
  );
  const macdHistogramSlope = asFiniteNumber(
    baseContext?.regime?.momentum?.macdHistogramSlope,
  );
  const obv = asFiniteNumber(baseContext?.raw?.volume?.obv);
  const obvSma = asFiniteNumber(baseContext?.raw?.volume?.obvSma);
  const obvSlope = asFiniteNumber(baseContext?.participation?.volume?.obvSlope);
  const venueSpreadZScore = asFiniteNumber(
    baseContext?.relative?.execution?.venueSpreadZScore,
  );
  const benchmarkTrendAlignment =
    baseContext?.relative?.benchmark?.trendAlignment ?? null;
  const derivativesPressure =
    typeof derivativesSummary?.pressure === 'string'
      ? derivativesSummary.pressure
      : null;
  const derivativesDirectionAligned =
    typeof derivativesSummary?.directionAligned === 'boolean'
      ? derivativesSummary.directionAligned
      : null;
  const derivativesRiskFlags = asStringArray(derivativesSummary?.riskFlags);
  const hardBlockReasons: string[] = [];
  const softBlockReasons: string[] = [];

  if (
    signalContext.signalDirection !== 'LONG' &&
    signalContext.signalDirection !== 'SHORT'
  ) {
    hardBlockReasons.push('missing_direction');
  }
  if ((signalContext.zoneHeight ?? 0) <= 0) {
    hardBlockReasons.push('invalid_zone');
  }
  if (!signalContext.reactionBodyAligned) {
    hardBlockReasons.push('reaction_body_not_aligned');
  }
  if ((signalContext.reactionCloseDistancePct ?? 0) <= 0) {
    hardBlockReasons.push('weak_reaction_close');
  }

  const direction = signalContext.signalDirection;
  const trendAligned = isDirectionAligned({
    direction,
    bullishValue: 'bull',
    bearishValue: 'bear',
    value: trendBias,
  });
  const benchmarkAligned = isDirectionAligned({
    direction,
    bullishValue: 'aligned_bull',
    bearishValue: 'aligned_bear',
    value: benchmarkTrendAlignment,
  });
  const failedBreakoutAligned = isDirectionAligned({
    direction,
    bullishValue: 'failed_low_breakout',
    bearishValue: 'failed_high_breakout',
    value: breakoutState,
  });
  const flushSupport =
    direction === 'LONG'
      ? derivativesRiskFlags.includes('short_liquidation_spike') ||
        derivativesPressure === 'short_flush'
      : direction === 'SHORT'
        ? derivativesRiskFlags.includes('long_liquidation_spike') ||
          derivativesPressure === 'long_flush'
        : false;
  const directionalCrowding =
    direction === 'LONG'
      ? derivativesRiskFlags.includes('crowded_long')
      : direction === 'SHORT'
        ? derivativesRiskFlags.includes('crowded_short')
        : false;

  if (volumeRel20 != null && volumeRel20 < 0.75) {
    softBlockReasons.push('thin_participation');
  }
  if (directionalCrowding && !flushSupport) {
    softBlockReasons.push('directional_crowding');
  }
  if (derivativesDirectionAligned === false && !flushSupport) {
    softBlockReasons.push('derivatives_not_aligned');
  }

  const filterMetric = signalContext.filterMetric ?? 0;
  const hitCount = signalContext.hitCount ?? 0;
  const currentPrice = asFiniteNumber(signalContext.currentPrice);
  const reactionCloseDistancePct = signalContext.reactionCloseDistancePct ?? 0;
  const retestPenetrationPct = signalContext.retestPenetrationPct ?? 999;
  const priceVsMaFastAligned = isDirectionalPriceAboveLevel({
    direction,
    price: currentPrice,
    level: maFast,
  });
  const priceVsMaSlowAligned = isDirectionalPriceAboveLevel({
    direction,
    price: currentPrice,
    level: maSlow,
  });
  const macdHistogramAligned = isDirectionalNumberAligned({
    direction,
    value: macdHistogram,
  });
  const macdHistogramSlopeAligned = isDirectionalNumberAligned({
    direction,
    value: macdHistogramSlope,
  });
  const obvLevelAligned =
    direction === 'LONG'
      ? obv != null && obvSma != null && obv > obvSma
      : direction === 'SHORT'
        ? obv != null && obvSma != null && obv < obvSma
        : null;
  const obvSlopeAligned = isDirectionalNumberAligned({
    direction,
    value: obvSlope,
  });
  const directIndicatorAlignments = [
    priceVsMaFastAligned,
    priceVsMaSlowAligned,
    macdHistogramAligned,
    macdHistogramSlopeAligned,
    obvLevelAligned,
    obvSlopeAligned,
  ];
  const directIndicatorsAvailable = directIndicatorAlignments.every(
    (value) => value != null,
  );
  const directIndicatorSupportCount = directIndicatorsAvailable
    ? directIndicatorAlignments.filter(Boolean).length
    : null;
  const hasIsolatedIndicatorSupport = directIndicatorSupportCount === 1;
  const hasVolumeConfirmation =
    volumeRel20 != null &&
    volumeRel20 >= 1 &&
    effortVsResult != null &&
    effortVsResult <= 100;
  const hasOverextendedVolumeConfirmation =
    hasVolumeConfirmation && volumeRel20 >= 2;
  const hasStrongVolumeConfirmation =
    hasVolumeConfirmation && volumeRel20 >= 1.5 && volumeRel20 < 2;
  const isContinuationBreakoutRetest =
    direction === 'LONG'
      ? breakoutState === 'above_high_level' || entryLocation === 'breakout'
      : direction === 'SHORT'
        ? breakoutState === 'below_low_level' || entryLocation === 'breakdown'
        : false;
  const approvalDisqualifiedByCalibration =
    direction === 'LONG' ||
    isContinuationBreakoutRetest ||
    hasOverextendedVolumeConfirmation ||
    hasIsolatedIndicatorSupport;

  if (direction === 'LONG') {
    softBlockReasons.push('long_liquidity_retest_requires_recalibration');
  }
  if (isContinuationBreakoutRetest) {
    softBlockReasons.push('continuation_breakout_retest');
  }
  if (hasOverextendedVolumeConfirmation) {
    softBlockReasons.push('overextended_volume_confirmation');
  }
  if (hasIsolatedIndicatorSupport) {
    softBlockReasons.push('isolated_indicator_support');
  }

  const hasLongBreakoutConfirmation =
    direction === 'LONG' &&
    (breakoutState === 'below_low_level' ||
      breakoutState === 'above_high_level') &&
    reactionCloseDistancePct >= 1 &&
    volumeRel20 != null &&
    volumeRel20 >= 2 &&
    venueSpreadZScore != null &&
    venueSpreadZScore >= 0;
  const hasShortContinuationConfirmation =
    direction === 'SHORT' && hasVolumeConfirmation;
  let deterministicQuality = 3;

  if (hardBlockReasons.length > 0) {
    deterministicQuality = 1;
  } else if (
    hasLongBreakoutConfirmation ||
    (direction === 'SHORT' && hasStrongVolumeConfirmation)
  ) {
    deterministicQuality = 5;
  } else if (hasShortContinuationConfirmation) {
    deterministicQuality = 4;
  } else if (
    filterMetric >= 3 &&
    hitCount >= 2 &&
    reactionCloseDistancePct >= 0.08 &&
    retestPenetrationPct <= 90 &&
    (trendAligned || benchmarkAligned || failedBreakoutAligned || flushSupport)
  ) {
    deterministicQuality = 3;
  }

  if (deterministicQuality >= 5 && softBlockReasons.length > 0) {
    deterministicQuality = 4;
  }
  if (deterministicQuality >= 4 && approvalDisqualifiedByCalibration) {
    deterministicQuality = 3;
  }

  return {
    ...signalContext,
    baseContextAvailable: Boolean(baseContext),
    primarySession,
    trendBias,
    breakoutState,
    entryLocation,
    liquidityZoneRetestDirection,
    volumeRel20,
    turnoverRel20,
    effortVsResult,
    maFast,
    maMedium,
    maSlow,
    macd,
    macdSignal,
    macdHistogram,
    macdHistogramSlope,
    obv,
    obvSma,
    obvSlope,
    priceVsMaFastAligned,
    priceVsMaSlowAligned,
    macdHistogramAligned,
    macdHistogramSlopeAligned,
    obvLevelAligned,
    obvSlopeAligned,
    directIndicatorSupportCount,
    venueSpreadZScore,
    benchmarkTrendAlignment,
    derivativesPressure,
    derivativesDirectionAligned,
    derivativesRiskFlags,
    hardBlockReasons,
    softBlockReasons,
    deterministicQuality,
    approvalAllowedNow:
      deterministicQuality >= 4 && hardBlockReasons.length === 0,
  };
};
