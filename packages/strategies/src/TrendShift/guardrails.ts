import { BaseStrategyContextSnapshot } from '@tradejs/types';

export type TrendShiftSignalContext = {
  signalDirection?: 'LONG' | 'SHORT';
  confirmedFlip?: boolean;
  bullFlip?: boolean;
  bearFlip?: boolean;
  flipDistanceOk?: boolean;
  closeVsAvgPct?: number;
  bandWidthPct?: number;
  avgSlopePct?: number;
  distanceAtrRatio?: number;
  coinBias?: 'bullish' | 'bearish' | 'neutral' | 'unknown';
  coinBiasAligned?: boolean | null;
  currentPrice?: number;
  avg?: number;
};

export type TrendShiftGuardrailContext = TrendShiftSignalContext & {
  deterministicQuality: number;
  approvalAllowedNow: boolean;
  hardBlockReasons: string[];
  coinBiasConflict: boolean;
  derivativesRiskFlags: string[];
  derivativesDirectionAligned: boolean | null;
  derivativesPressure: string | null;
  derivativesFlushSupport: boolean;
  coreLongQ5Candidate: boolean;
  coreShortQ5Candidate: boolean;
  q4LongBreakoutCandidate: boolean;
  q4ShortBreakoutCandidate: boolean;
  q4ShortFailedLowBreakoutCandidate: boolean;
  selectiveNeutralQ4Candidate: boolean;
  longRelativeStrengthOverextended: boolean;
  longPriceUpOiDivergence: boolean;
  shortUsLongFlushRisk: boolean;
  shortFailedLowOiNotConfirming: boolean;
  breakoutState: string | null;
  volumeRel20: number | null;
  atrPctZScore: number | null;
  relativeStrength1h: number | null;
  sessionPrimary: string | null;
  sessionIsOverlap: boolean;
  priceOiDivergenceType: string | null;
};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === 'string' && entry.trim().length > 0,
      )
    : [];

const asFiniteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const buildTrendShiftGuardrailContext = ({
  signalContext,
  baseContext,
  includeCoreTransferredFilters = true,
}: {
  signalContext: TrendShiftSignalContext;
  baseContext?: BaseStrategyContextSnapshot | null;
  includeCoreTransferredFilters?: boolean;
}): TrendShiftGuardrailContext => {
  const derivativesSummary = baseContext?.derivatives?.summary ?? null;
  const hasDerivativesSummary = derivativesSummary != null;
  const session = baseContext?.regime?.session ?? null;
  const localRange = baseContext?.structure?.localRange ?? null;
  const volume = baseContext?.participation?.volume ?? null;
  const benchmark = baseContext?.relative?.benchmark ?? null;
  const volatility = baseContext?.regime?.volatility ?? null;
  const hardBlockReasons: string[] = [];
  const coinBiasConflict = signalContext.coinBiasAligned === false;
  const derivativesRiskFlags = asStringArray(derivativesSummary?.riskFlags);
  const derivativesDirectionAligned =
    typeof derivativesSummary?.directionAligned === 'boolean'
      ? derivativesSummary.directionAligned
      : null;
  const derivativesPressure =
    typeof derivativesSummary?.pressure === 'string' &&
    derivativesSummary.pressure.trim().length > 0
      ? derivativesSummary.pressure
      : null;
  const sessionPrimary = session?.sessionPhase ?? null;
  const sessionIsOverlap = session?.isOverlap === true;
  const breakoutState = localRange?.breakoutState ?? null;
  const volumeRel20 = asFiniteNumber(volume?.volumeRel20);
  const atrPctZScore = asFiniteNumber(volatility?.atrPctZScore);
  const relativeStrength1h = asFiniteNumber(benchmark?.relativeStrength1h);
  const priceOiDivergenceType =
    typeof derivativesSummary?.priceOiDivergenceType === 'string'
      ? derivativesSummary.priceOiDivergenceType
      : null;

  if (!signalContext.confirmedFlip) {
    hardBlockReasons.push('unconfirmed_flip');
  }
  if (!signalContext.flipDistanceOk) {
    hardBlockReasons.push('weak_flip_distance');
  }

  const slopeAbs = Math.abs(signalContext.avgSlopePct ?? 0);
  const distanceAtrRatio = signalContext.distanceAtrRatio ?? 0;
  const closeVsAvgPctAbs = Math.abs(signalContext.closeVsAvgPct ?? 0);
  const derivativesFlushSupport =
    signalContext.signalDirection === 'SHORT'
      ? derivativesRiskFlags.includes('long_liquidation_spike')
      : signalContext.signalDirection === 'LONG'
        ? derivativesRiskFlags.includes('short_liquidation_spike')
        : false;
  const oiNotConfirming = derivativesRiskFlags.includes('oi_not_confirming');
  const coreLongQ5Candidate =
    signalContext.signalDirection === 'LONG' &&
    distanceAtrRatio >= 0.8 &&
    slopeAbs >= 0.09 &&
    closeVsAvgPctAbs >= 0.12;
  const coreShortQ5Candidate =
    signalContext.signalDirection === 'SHORT' &&
    distanceAtrRatio >= 0.8 &&
    slopeAbs >= 0.09 &&
    closeVsAvgPctAbs >= 0.12;
  const overextendedShortWithoutFlush =
    signalContext.signalDirection === 'SHORT' &&
    distanceAtrRatio > 1.2 &&
    !derivativesFlushSupport;
  const q4LongBreakoutCandidate =
    signalContext.signalDirection === 'LONG' &&
    breakoutState === 'above_high_level' &&
    volumeRel20 != null &&
    volumeRel20 >= 1.2 &&
    atrPctZScore != null &&
    atrPctZScore >= 0 &&
    relativeStrength1h != null &&
    relativeStrength1h > -1 &&
    derivativesPressure === 'short_flush';
  const q4ShortBreakoutCandidate =
    signalContext.signalDirection === 'SHORT' &&
    breakoutState === 'below_low_level' &&
    volumeRel20 != null &&
    volumeRel20 >= 1.2 &&
    atrPctZScore != null &&
    atrPctZScore >= 0 &&
    relativeStrength1h != null &&
    relativeStrength1h < 1 &&
    derivativesPressure === 'long_flush';
  const q4ShortAsiaFlushCandidate =
    signalContext.signalDirection === 'SHORT' &&
    derivativesPressure === 'neutral' &&
    derivativesFlushSupport &&
    sessionPrimary === 'asia' &&
    !sessionIsOverlap &&
    distanceAtrRatio < 0.7 &&
    slopeAbs >= 0.08 &&
    closeVsAvgPctAbs >= 0.12;
  const selectiveNeutralQ4Candidate =
    hasDerivativesSummary &&
    derivativesPressure === 'neutral' &&
    !sessionIsOverlap &&
    ((signalContext.signalDirection === 'LONG' &&
      sessionPrimary === 'europe' &&
      (breakoutState === 'above_high_level' ||
        breakoutState === 'failed_high_breakout')) ||
      (signalContext.signalDirection === 'SHORT' &&
        (sessionPrimary === 'off_hours' || sessionPrimary === 'asia') &&
        breakoutState === 'below_low_level'));
  let deterministicQuality = 3;
  if (hardBlockReasons.length > 0) {
    deterministicQuality = signalContext.confirmedFlip ? 2 : 1;
  } else if (
    distanceAtrRatio >= 0.8 &&
    slopeAbs >= 0.09 &&
    closeVsAvgPctAbs >= 0.12
  ) {
    deterministicQuality = 5;
  } else if (
    distanceAtrRatio >= 0.45 &&
    slopeAbs >= 0.04 &&
    closeVsAvgPctAbs >= 0.05
  ) {
    deterministicQuality = 4;
  }

  if (deterministicQuality === 4 && q4ShortAsiaFlushCandidate) {
    deterministicQuality = 5;
  }

  if (deterministicQuality === 4 && selectiveNeutralQ4Candidate) {
    deterministicQuality = 5;
  }

  if (deterministicQuality >= 5 && priceOiDivergenceType === 'flat_or_mixed') {
    deterministicQuality = 4;
    hardBlockReasons.push('flat_or_mixed_oi');
  }

  if (deterministicQuality >= 5 && volumeRel20 != null && volumeRel20 < 0.8) {
    deterministicQuality = 4;
    hardBlockReasons.push('thin_participation');
  }

  if (
    deterministicQuality >= 5 &&
    oiNotConfirming &&
    !derivativesFlushSupport
  ) {
    deterministicQuality = 4;
    hardBlockReasons.push('oi_not_confirming');
  }

  if (deterministicQuality >= 5 && overextendedShortWithoutFlush) {
    deterministicQuality = 4;
    hardBlockReasons.push('overextended_without_flush');
  }

  if (
    deterministicQuality >= 5 &&
    coreLongQ5Candidate &&
    derivativesPressure === 'crowded_short' &&
    !derivativesFlushSupport
  ) {
    deterministicQuality = 4;
    hardBlockReasons.push('long_pressure_conflict');
  }

  if (
    deterministicQuality >= 5 &&
    coreShortQ5Candidate &&
    derivativesPressure === 'crowded_long'
  ) {
    deterministicQuality = 4;
    hardBlockReasons.push('short_crowded_long_pressure');
  }

  if (
    deterministicQuality >= 5 &&
    coreLongQ5Candidate &&
    breakoutState === 'inside_range'
  ) {
    deterministicQuality = 4;
    hardBlockReasons.push('long_inside_range');
  }

  if (
    deterministicQuality >= 5 &&
    coreLongQ5Candidate &&
    sessionPrimary === 'us' &&
    derivativesPressure === 'short_flush' &&
    priceOiDivergenceType === 'price_up_oi_down'
  ) {
    deterministicQuality = 4;
    hardBlockReasons.push('long_us_oi_not_confirming');
  }

  if (
    deterministicQuality >= 5 &&
    coreLongQ5Candidate &&
    sessionPrimary === 'asia' &&
    derivativesPressure === 'short_flush'
  ) {
    deterministicQuality = 4;
    hardBlockReasons.push('long_asia_short_flush');
  }

  if (
    deterministicQuality >= 5 &&
    coreShortQ5Candidate &&
    breakoutState === 'below_low_level' &&
    derivativesPressure === 'crowded_short' &&
    !derivativesFlushSupport
  ) {
    deterministicQuality = 4;
    hardBlockReasons.push('short_pressure_conflict');
  }

  if (includeCoreTransferredFilters) {
    if (
      deterministicQuality >= 5 &&
      signalContext.signalDirection === 'LONG' &&
      derivativesPressure === 'crowded_long' &&
      derivativesDirectionAligned === false
    ) {
      deterministicQuality = 4;
      hardBlockReasons.push('long_crowded_pressure');
    }

    if (
      deterministicQuality >= 5 &&
      signalContext.signalDirection === 'SHORT' &&
      sessionPrimary === 'us' &&
      derivativesPressure === 'long_flush' &&
      (priceOiDivergenceType == null ||
        priceOiDivergenceType === 'unknown' ||
        priceOiDivergenceType === 'price_down_oi_down')
    ) {
      deterministicQuality = 4;
      hardBlockReasons.push('us_short_oi_not_expanding');
    }
  }

  if (
    deterministicQuality >= 5 &&
    hasDerivativesSummary &&
    !selectiveNeutralQ4Candidate &&
    derivativesPressure === 'neutral' &&
    !derivativesFlushSupport
  ) {
    deterministicQuality = 4;
    hardBlockReasons.push('neutral_derivatives_pressure');
  }

  if (
    deterministicQuality >= 5 &&
    hasDerivativesSummary &&
    !selectiveNeutralQ4Candidate &&
    derivativesDirectionAligned == null &&
    !derivativesFlushSupport
  ) {
    deterministicQuality = 4;
    hardBlockReasons.push('derivatives_alignment_unknown');
  }

  const q4ShortFailedLowBreakoutCandidate =
    deterministicQuality === 4 &&
    signalContext.signalDirection === 'SHORT' &&
    breakoutState === 'failed_low_breakout';
  const longRelativeStrengthOverextended =
    signalContext.signalDirection === 'LONG' &&
    relativeStrength1h != null &&
    relativeStrength1h >= 5;
  const longPriceUpOiDivergence =
    signalContext.signalDirection === 'LONG' &&
    priceOiDivergenceType === 'price_up_oi_down';
  const shortUsLongFlushRisk =
    signalContext.signalDirection === 'SHORT' &&
    sessionPrimary === 'us' &&
    derivativesPressure === 'long_flush';
  const shortFailedLowOiNotConfirming =
    signalContext.signalDirection === 'SHORT' &&
    breakoutState === 'failed_low_breakout' &&
    priceOiDivergenceType === 'price_down_oi_down';

  if (deterministicQuality >= 5 && longRelativeStrengthOverextended) {
    deterministicQuality = 4;
    hardBlockReasons.push('long_relative_strength_overextended');
  }

  if (deterministicQuality >= 5 && longPriceUpOiDivergence) {
    deterministicQuality = 4;
    hardBlockReasons.push('long_price_up_oi_down');
  }

  if (deterministicQuality >= 5 && shortUsLongFlushRisk) {
    deterministicQuality = 4;
    hardBlockReasons.push('short_us_long_flush');
  }

  if (deterministicQuality >= 5 && shortFailedLowOiNotConfirming) {
    deterministicQuality = 4;
    hardBlockReasons.push('short_failed_low_oi_not_confirming');
  }

  return {
    ...signalContext,
    deterministicQuality,
    approvalAllowedNow: deterministicQuality >= 5,
    hardBlockReasons,
    coinBiasConflict,
    derivativesRiskFlags,
    derivativesDirectionAligned,
    derivativesPressure,
    derivativesFlushSupport,
    coreLongQ5Candidate,
    coreShortQ5Candidate,
    q4LongBreakoutCandidate,
    q4ShortBreakoutCandidate,
    q4ShortFailedLowBreakoutCandidate,
    selectiveNeutralQ4Candidate,
    longRelativeStrengthOverextended,
    longPriceUpOiDivergence,
    shortUsLongFlushRisk,
    shortFailedLowOiNotConfirming,
    breakoutState,
    volumeRel20,
    atrPctZScore,
    relativeStrength1h,
    sessionPrimary,
    sessionIsOverlap,
    priceOiDivergenceType,
  };
};

export const getTrendShiftGuardrailReasonText = (reason: string) => {
  switch (reason) {
    case 'unconfirmed_flip':
      return 'the internal flip is not confirmed yet';
    case 'weak_flip_distance':
      return 'price moved away from the adaptive average too weakly';
    case 'coin_bias_conflict':
      return 'coin MA bias conflicts with the flip direction';
    case 'oi_not_confirming':
      return 'open interest does not confirm the flip yet';
    case 'overextended_without_flush':
      return 'the SHORT flip already looks overstretched away from the average without a liquidation flush';
    case 'thin_participation':
      return 'participation is too thin versus recent volume for live approval';
    case 'long_pressure_conflict':
      return 'the LONG flip is running into crowded-short derivatives pressure without a supporting short-liquidation flush';
    case 'short_pressure_conflict':
      return 'the SHORT flip is running into crowded-short positioning at the breakdown, so keep it in watch mode unless a liquidation flush confirms continuation';
    case 'short_crowded_long_pressure':
      return 'the SHORT flip is running into crowded-long derivatives pressure, so keep it in watch mode';
    case 'long_inside_range':
      return 'the LONG flip is still inside the local range, so keep it in watch mode';
    case 'long_us_oi_not_confirming':
      return 'the US-session LONG flush still lacks expanding OI confirmation, so keep it in watch mode';
    case 'long_asia_short_flush':
      return 'the Asia-session LONG short-flush pocket is too weak for live approval';
    case 'long_crowded_pressure':
      return 'the LONG flip is running into crowded-long positioning while derivatives still disagree, so keep it in watch mode';
    case 'us_short_oi_not_expanding':
      return 'the US-session SHORT flush still lacks expanding OI confirmation, so keep it in watch mode';
    case 'neutral_derivatives_pressure':
      return 'derivatives pressure is neutral, so the flip still lacks conviction';
    case 'derivatives_alignment_unknown':
      return 'derivatives alignment is still unclear, so keep the flip in watch mode';
    case 'flat_or_mixed_oi':
      return 'price and open-interest divergence still looks mixed, so keep the flip in watch mode';
    case 'long_relative_strength_overextended':
      return 'the LONG flip is already too extended versus BTC on the 1h relative-strength read';
    case 'long_price_up_oi_down':
      return 'the LONG flip is rising while open interest falls, so continuation confirmation is weak';
    case 'short_us_long_flush':
      return 'the US-session SHORT long-flush pocket has not been reliable enough for live approval';
    case 'short_failed_low_oi_not_confirming':
      return 'the SHORT failed-low-breakout setup lacks expanding open-interest confirmation';
    default:
      return reason;
  }
};

export const getTrendShiftGuardrailRejectReason = (
  context: TrendShiftGuardrailContext,
) => {
  if (context.hardBlockReasons.length > 0) {
    return context.hardBlockReasons
      .map(getTrendShiftGuardrailReasonText)
      .join('; ');
  }

  if (context.coinBiasConflict) {
    return 'coin MA bias still conflicts with the flip; require q5-strength continuation to override it';
  }

  return 'the flip still does not look strong enough for live approval';
};

export const getTrendShiftGuardrailSkipCode = (
  context: TrendShiftGuardrailContext,
) => {
  if (context.hardBlockReasons.length > 0) {
    return `TRENDSHIFT_GUARDRAIL_${context.hardBlockReasons[0].toUpperCase()}`;
  }

  if (context.coinBiasConflict) {
    return 'TRENDSHIFT_GUARDRAIL_COIN_BIAS_CONFLICT';
  }

  return `TRENDSHIFT_GUARDRAIL_Q${context.deterministicQuality}_WATCH_ONLY`;
};
