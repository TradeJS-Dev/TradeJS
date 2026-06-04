import { BaseStrategyContextSnapshot } from '@tradejs/types';
import { TrendFollowSignalContext } from './engine';

export type TrendFollowGuardrailContext = Partial<TrendFollowSignalContext> & {
  baseContextAvailable: boolean;
  primarySession: string | null;
  trendBias: string | null;
  trendFollowState: string | null;
  breakoutState: string | null;
  momentumRsi: number | null;
  volumeRel20: number | null;
  deltaDivergenceVsPrice: string | null;
  volumeStructureDirectionalShare: number | null;
  volumeStructureDirectionAligned: boolean | null;
  highConvictionApprovalPocket: boolean;
  benchmarkTrendAlignment: string | null;
  derivativesPressure: string | null;
  derivativesDirectionAligned: boolean | null;
  derivativesRiskFlags: string[];
  trendFollowGateFeatures: TrendFollowGateFeatures;
  hardBlockReasons: string[];
  softBlockReasons: string[];
  deterministicQuality: number;
  approvalAllowedNow: boolean;
};

export type TrendFollowGateFeatures = {
  setupStopDistanceAtr: number | null;
  setupTpDistanceAtr: number | null;
  setupRewardToVolatility: number | null;
  setupRiskShape: 'too_tight' | 'tight' | 'balanced' | 'wide' | 'unknown';
  breakoutBodyAtr: number | null;
  breakoutAcceptance:
    | 'failed_acceptance'
    | 'single_close'
    | 'confirmed'
    | 'unknown';
  continuationState:
    | 'breakout_confirmed'
    | 'failed_breakout'
    | 'inside_range'
    | 'unknown';
  participationState: 'thin' | 'weak' | 'confirmed' | 'unknown';
  directionalVolumeAligned: boolean | null;
  derivativesContinuation:
    | 'flush_support'
    | 'aligned'
    | 'crowded'
    | 'conflict'
    | 'neutral'
    | 'unknown';
  relativeContinuation: 'aligned' | 'against' | 'neutral' | 'unknown';
  marketBreadthContinuation: 'aligned' | 'against' | 'stale' | 'unknown';
  marketBreadthDispersion: number | null;
  targetVsBtcBeta20: number | null;
  highQualityCadencePocket: boolean;
};

type TrendFollowSignalPrices = {
  currentPrice?: number | null;
  takeProfitPrice?: number | null;
  stopLossPrice?: number | null;
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

const calculateDistanceAtr = ({
  atr,
  currentPrice,
  targetPrice,
  direction,
  longDistance,
}: {
  atr: number | null;
  currentPrice: number | null;
  targetPrice: number | null;
  direction: unknown;
  longDistance: 'target_above' | 'target_below';
}) => {
  if (
    atr == null ||
    atr <= 0 ||
    currentPrice == null ||
    targetPrice == null ||
    (direction !== 'LONG' && direction !== 'SHORT')
  ) {
    return null;
  }

  const distance =
    direction === 'LONG'
      ? longDistance === 'target_above'
        ? targetPrice - currentPrice
        : currentPrice - targetPrice
      : longDistance === 'target_above'
        ? currentPrice - targetPrice
        : targetPrice - currentPrice;

  return Number.isFinite(distance) ? distance / atr : null;
};

const toTrendFollowContinuationAlignment = ({
  direction,
  bullishValue,
  bearishValue,
  value,
}: {
  direction: unknown;
  bullishValue: string;
  bearishValue: string;
  value: string | null;
}) => {
  if (value == null || (direction !== 'LONG' && direction !== 'SHORT')) {
    return null;
  }
  return direction === 'LONG' ? value === bullishValue : value === bearishValue;
};

const buildTrendFollowGateFeatures = ({
  signalContext,
  baseContext,
  prices,
  highConvictionApprovalPocket,
  volumeStructureDirectionAligned,
  flushSupport,
  directionalCrowding,
}: {
  signalContext: Partial<TrendFollowSignalContext>;
  baseContext?: BaseStrategyContextSnapshot | null;
  prices?: TrendFollowSignalPrices | null;
  highConvictionApprovalPocket: boolean;
  volumeStructureDirectionAligned: boolean | null;
  flushSupport: boolean;
  directionalCrowding: boolean;
}): TrendFollowGateFeatures => {
  const direction = signalContext.signalDirection;
  const atr =
    asFiniteNumber(baseContext?.raw?.volatility?.atr) ??
    asFiniteNumber(signalContext.atr);
  const currentPrice =
    asFiniteNumber(prices?.currentPrice) ??
    asFiniteNumber(signalContext.currentPrice);
  const setupStopDistanceAtr =
    calculateDistanceAtr({
      atr,
      currentPrice,
      targetPrice:
        asFiniteNumber(prices?.stopLossPrice) ??
        asFiniteNumber(signalContext.trailStop),
      direction,
      longDistance: 'target_below',
    }) ?? asFiniteNumber(baseContext?.gateFeatures?.setup?.stopDistanceAtr);
  const setupTpDistanceAtr =
    calculateDistanceAtr({
      atr,
      currentPrice,
      targetPrice: asFiniteNumber(prices?.takeProfitPrice),
      direction,
      longDistance: 'target_above',
    }) ?? asFiniteNumber(baseContext?.gateFeatures?.setup?.tpDistanceAtr);
  const setupRewardToVolatility =
    setupTpDistanceAtr ??
    asFiniteNumber(baseContext?.gateFeatures?.setup?.rewardToVolatility);
  const setupRiskShape =
    setupStopDistanceAtr == null
      ? 'unknown'
      : setupStopDistanceAtr < 0.8
        ? 'too_tight'
        : setupStopDistanceAtr < 1.15
          ? 'tight'
          : setupStopDistanceAtr <= 3.5
            ? 'balanced'
            : 'wide';
  const breakoutBodyAtr = asFiniteNumber(
    baseContext?.structure?.acceptance?.breakoutBodyAtr,
  );
  const closesAboveHighLevel3 = asFiniteNumber(
    baseContext?.structure?.acceptance?.closesAboveHighLevel3,
  );
  const closesBelowLowLevel3 = asFiniteNumber(
    baseContext?.structure?.acceptance?.closesBelowLowLevel3,
  );
  const continuationCloses =
    direction === 'LONG'
      ? closesAboveHighLevel3
      : direction === 'SHORT'
        ? closesBelowLowLevel3
        : null;
  const breakoutAcceptance =
    continuationCloses == null
      ? 'unknown'
      : continuationCloses >= 2
        ? 'confirmed'
        : continuationCloses >= 1
          ? 'single_close'
          : 'failed_acceptance';
  const breakoutState =
    baseContext?.structure?.localRange?.breakoutState ?? null;
  const breakoutWithDirection = toTrendFollowContinuationAlignment({
    direction,
    bullishValue: 'above_high_level',
    bearishValue: 'below_low_level',
    value: breakoutState,
  });
  const failedBreakoutForDirection = toTrendFollowContinuationAlignment({
    direction,
    bullishValue: 'failed_low_breakout',
    bearishValue: 'failed_high_breakout',
    value: breakoutState,
  });
  const continuationState =
    breakoutWithDirection === true
      ? 'breakout_confirmed'
      : failedBreakoutForDirection === true
        ? 'failed_breakout'
        : breakoutState === 'inside_range'
          ? 'inside_range'
          : 'unknown';
  const volumeRel20 = asFiniteNumber(
    baseContext?.participation?.volume?.volumeRel20,
  );
  const participationState =
    volumeRel20 == null
      ? 'unknown'
      : volumeRel20 < 0.8
        ? 'thin'
        : volumeRel20 < 1.5
          ? 'weak'
          : 'confirmed';
  const derivativesDirectionAligned =
    typeof baseContext?.derivatives?.summary?.directionAligned === 'boolean'
      ? baseContext.derivatives.summary.directionAligned
      : null;
  const derivativesContinuation = flushSupport
    ? 'flush_support'
    : derivativesDirectionAligned === true
      ? 'aligned'
      : derivativesDirectionAligned === false
        ? 'conflict'
        : directionalCrowding
          ? 'crowded'
          : baseContext?.derivatives?.summary == null
            ? 'unknown'
            : 'neutral';
  const benchmarkTrendAlignment =
    baseContext?.relative?.benchmark?.trendAlignment ?? null;
  const benchmarkAligned =
    benchmarkTrendAlignment === 'against_benchmark'
      ? false
      : toTrendFollowContinuationAlignment({
          direction,
          bullishValue: 'aligned_bull',
          bearishValue: 'aligned_bear',
          value: benchmarkTrendAlignment,
        });
  const relativeContinuation =
    benchmarkAligned === true
      ? 'aligned'
      : benchmarkAligned === false
        ? 'against'
        : benchmarkTrendAlignment == null
          ? 'unknown'
          : 'neutral';
  const marketBreadth = baseContext?.relative?.marketBreadth;
  const marketBreadthReturn = asFiniteNumber(
    marketBreadth?.equalWeightedReturn,
  );
  const marketBreadthAligned =
    marketBreadthReturn == null || marketBreadth?.stale
      ? null
      : direction === 'LONG'
        ? marketBreadthReturn >= 0
        : direction === 'SHORT'
          ? marketBreadthReturn <= 0
          : null;
  const marketBreadthContinuation =
    marketBreadth?.stale === true
      ? 'stale'
      : marketBreadthAligned === true
        ? 'aligned'
        : marketBreadthAligned === false
          ? 'against'
          : 'unknown';
  const targetVsBtcBeta20 = asFiniteNumber(
    baseContext?.relative?.targetVsBtc?.betaToBtc20,
  );
  const legacyCadencePocket =
    highConvictionApprovalPocket &&
    setupStopDistanceAtr != null &&
    setupStopDistanceAtr >= 1.15 &&
    setupTpDistanceAtr != null &&
    setupTpDistanceAtr >= 1.5;
  const strongBreakoutCadencePocket =
    legacyCadencePocket && breakoutBodyAtr != null && breakoutBodyAtr >= 1.5;
  const shortRelativeBetaContinuationPocket =
    direction === 'SHORT' &&
    setupStopDistanceAtr != null &&
    setupStopDistanceAtr >= 1.5 &&
    setupStopDistanceAtr < 2 &&
    setupTpDistanceAtr != null &&
    setupTpDistanceAtr >= 2 &&
    setupTpDistanceAtr < 3 &&
    targetVsBtcBeta20 != null &&
    targetVsBtcBeta20 >= 1.25;
  const longRelativeBetaContinuationPocket =
    direction === 'LONG' &&
    setupStopDistanceAtr != null &&
    setupStopDistanceAtr >= 1.5 &&
    setupStopDistanceAtr < 2 &&
    setupTpDistanceAtr != null &&
    setupTpDistanceAtr >= 2 &&
    setupTpDistanceAtr < 3 &&
    targetVsBtcBeta20 != null &&
    targetVsBtcBeta20 >= 1.25;

  return {
    setupStopDistanceAtr,
    setupTpDistanceAtr,
    setupRewardToVolatility,
    setupRiskShape,
    breakoutBodyAtr,
    breakoutAcceptance,
    continuationState,
    participationState,
    directionalVolumeAligned: volumeStructureDirectionAligned,
    derivativesContinuation,
    relativeContinuation,
    marketBreadthContinuation,
    marketBreadthDispersion: asFiniteNumber(marketBreadth?.dispersion),
    targetVsBtcBeta20,
    highQualityCadencePocket:
      strongBreakoutCadencePocket ||
      shortRelativeBetaContinuationPocket ||
      longRelativeBetaContinuationPocket,
  };
};

export const buildTrendFollowGuardrailContext = ({
  signalContext,
  baseContext,
  prices,
}: {
  signalContext: Partial<TrendFollowSignalContext>;
  baseContext?: BaseStrategyContextSnapshot | null;
  prices?: TrendFollowSignalPrices | null;
}): TrendFollowGuardrailContext => {
  const derivativesSummary = baseContext?.derivatives?.summary ?? null;
  const primarySession = baseContext?.regime?.session?.sessionPhase ?? null;
  const trendBias = baseContext?.regime?.trend?.bias ?? null;
  const trendFollowState =
    signalContext.signalDirection === 'LONG'
      ? 'bull'
      : signalContext.signalDirection === 'SHORT'
        ? 'bear'
        : null;
  const breakoutState =
    baseContext?.structure?.localRange?.breakoutState ?? null;
  const momentumRsi = asFiniteNumber(baseContext?.regime?.momentum?.rsi);
  const volumeRel20 = asFiniteNumber(
    baseContext?.participation?.volume?.volumeRel20,
  );
  const deltaDivergenceVsPrice =
    baseContext?.participation?.delta?.deltaDivergenceVsPrice ?? null;
  const totalUpVolumeShare = asFiniteNumber(
    baseContext?.participation?.volumeStructure?.totalUpVolumeShare,
  );
  const totalDownVolumeShare = asFiniteNumber(
    baseContext?.participation?.volumeStructure?.totalDownVolumeShare,
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
  if ((signalContext.atr ?? 0) <= 0 || signalContext.trailStop == null) {
    hardBlockReasons.push('missing_trailing_stop');
  }
  if ((signalContext.breakoutDistancePct ?? 0) <= 0) {
    hardBlockReasons.push('missing_breakout');
  }
  if ((signalContext.distanceToStopPct ?? 0) <= 0) {
    hardBlockReasons.push('invalid_stop_distance');
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
  const breakoutAligned = isDirectionAligned({
    direction,
    bullishValue: 'above_high_level',
    bearishValue: 'below_low_level',
    value: breakoutState,
  });
  const strategyTrendFollowAligned = isDirectionAligned({
    direction,
    bullishValue: 'bull',
    bearishValue: 'bear',
    value: trendFollowState,
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
  const adverseDeltaDivergence =
    direction === 'LONG'
      ? deltaDivergenceVsPrice === 'bearish'
      : direction === 'SHORT'
        ? deltaDivergenceVsPrice === 'bullish'
        : false;
  const volumeStructureDirectionalShare =
    direction === 'LONG'
      ? totalUpVolumeShare
      : direction === 'SHORT'
        ? totalDownVolumeShare
        : null;
  const volumeStructureDirectionAligned =
    volumeStructureDirectionalShare == null
      ? null
      : volumeStructureDirectionalShare >= 0.48;
  const breakoutDistancePct = signalContext.breakoutDistancePct ?? 0;
  const distanceToStopPct = signalContext.distanceToStopPct ?? 0;
  const highConvictionApprovalPocket =
    direction === 'SHORT' &&
    (primarySession === 'off_hours' || primarySession === 'asia') &&
    breakoutDistancePct >= 0.5 &&
    breakoutDistancePct <= 2 &&
    distanceToStopPct >= 0.5 &&
    distanceToStopPct <= 3;
  const trendFollowGateFeatures = buildTrendFollowGateFeatures({
    signalContext,
    baseContext,
    prices,
    highConvictionApprovalPocket,
    volumeStructureDirectionAligned,
    flushSupport,
    directionalCrowding,
  });

  if (volumeRel20 != null && volumeRel20 < 0.8) {
    softBlockReasons.push('thin_participation');
  } else if (volumeRel20 != null && volumeRel20 < 1.5) {
    softBlockReasons.push('weak_relative_volume');
  }
  if (trendFollowGateFeatures.setupRiskShape === 'unknown') {
    softBlockReasons.push('missing_setup_stop_distance_atr');
  } else if (
    trendFollowGateFeatures.setupStopDistanceAtr != null &&
    trendFollowGateFeatures.setupStopDistanceAtr < 1.15
  ) {
    softBlockReasons.push('tight_setup_stop_distance_atr');
  }
  if (
    trendFollowGateFeatures.setupTpDistanceAtr != null &&
    trendFollowGateFeatures.setupTpDistanceAtr < 1.5
  ) {
    softBlockReasons.push('weak_setup_tp_distance_atr');
  }
  if (direction === 'SHORT' && momentumRsi != null && momentumRsi > 36.35) {
    softBlockReasons.push('weak_downside_momentum');
  }
  if (directionalCrowding && !flushSupport) {
    softBlockReasons.push('directional_crowding');
  }
  if (derivativesDirectionAligned === false && !flushSupport) {
    softBlockReasons.push('derivatives_not_aligned');
  }
  if (breakoutState === 'inside_range') {
    softBlockReasons.push('inside_range_breakout');
  }
  if (adverseDeltaDivergence) {
    softBlockReasons.push('adverse_delta_divergence');
  }
  if (volumeStructureDirectionAligned === false) {
    softBlockReasons.push('weak_volume_structure');
  }
  if (!trendFollowGateFeatures.highQualityCadencePocket) {
    softBlockReasons.push('outside_high_conviction_cadence_pocket');
  }

  let deterministicQuality = 3;

  if (hardBlockReasons.length > 0) {
    deterministicQuality = 1;
  } else if (
    breakoutDistancePct >= 0.25 &&
    breakoutDistancePct <= 2.5 &&
    distanceToStopPct >= 0.25 &&
    (trendAligned ||
      strategyTrendFollowAligned ||
      benchmarkAligned ||
      breakoutAligned ||
      flushSupport)
  ) {
    deterministicQuality =
      flushSupport || breakoutAligned || strategyTrendFollowAligned ? 5 : 4;
  } else if (breakoutDistancePct > 0 && distanceToStopPct > 0) {
    deterministicQuality = 4;
  }

  if (deterministicQuality >= 5 && softBlockReasons.length > 0) {
    deterministicQuality = 4;
  }
  return {
    ...signalContext,
    baseContextAvailable: Boolean(baseContext),
    primarySession,
    trendBias,
    trendFollowState,
    breakoutState,
    momentumRsi,
    volumeRel20,
    deltaDivergenceVsPrice,
    volumeStructureDirectionalShare,
    volumeStructureDirectionAligned,
    highConvictionApprovalPocket,
    benchmarkTrendAlignment,
    derivativesPressure,
    derivativesDirectionAligned,
    derivativesRiskFlags,
    trendFollowGateFeatures,
    hardBlockReasons,
    softBlockReasons,
    deterministicQuality,
    approvalAllowedNow:
      deterministicQuality >= 5 &&
      hardBlockReasons.length === 0 &&
      trendFollowGateFeatures.highQualityCadencePocket,
  };
};
