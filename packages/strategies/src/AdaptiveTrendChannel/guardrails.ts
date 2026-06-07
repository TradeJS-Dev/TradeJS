import { BaseStrategyContextSnapshot } from '@tradejs/types';
import { AdaptiveTrendChannelSignalContext } from './engine';

export type AdaptiveTrendChannelGuardrailContext =
  Partial<AdaptiveTrendChannelSignalContext> & {
    baseContextAvailable: boolean;
    primarySession: string | null;
    trendBias: string | null;
    adaptiveChannelRegime: string | null;
    breakoutState: string | null;
    volumeRel20: number | null;
    h4VolatilityState: string | null;
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

const MIN_APPROVAL_BREAKOUT_DISTANCE_PCT = 4;
const MIN_HIGH_CONFIDENCE_BREAKOUT_DISTANCE_PCT = 4;
const MIN_APPROVAL_CHANNEL_WIDTH_PCT = 1.6;
const MIN_HIGH_CONFIDENCE_CHANNEL_WIDTH_PCT = 2;
const MIN_APPROVAL_VOLUME_REL20 = 6;

export const buildAdaptiveTrendChannelGuardrailContext = ({
  signalContext,
  baseContext,
}: {
  signalContext: Partial<AdaptiveTrendChannelSignalContext>;
  baseContext?: BaseStrategyContextSnapshot | null;
}): AdaptiveTrendChannelGuardrailContext => {
  const derivativesSummary = baseContext?.derivatives?.summary ?? null;
  const primarySession = baseContext?.regime?.session?.sessionPhase ?? null;
  const trendBias = baseContext?.regime?.trend?.bias ?? null;
  const adaptiveChannelRegime =
    signalContext.regime === 1
      ? 'bull'
      : signalContext.regime === -1
        ? 'bear'
        : null;
  const breakoutState =
    baseContext?.structure?.localRange?.breakoutState ?? null;
  const volumeRel20 = asFiniteNumber(
    baseContext?.participation?.volume?.volumeRel20,
  );
  const h4VolatilityState =
    baseContext?.mtf?.summary?.h4VolatilityState ?? null;
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
  if ((signalContext.atr ?? 0) <= 0 || (signalContext.halfChannel ?? 0) <= 0) {
    hardBlockReasons.push('missing_channel_width');
  }
  if ((signalContext.channelWidthPct ?? 0) <= 0) {
    hardBlockReasons.push('invalid_channel');
  }

  const direction = signalContext.signalDirection;
  const breakoutAligned = isDirectionAligned({
    direction,
    bullishValue: 'above_high_level',
    bearishValue: 'below_low_level',
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

  if (volumeRel20 != null && volumeRel20 < 0.8) {
    softBlockReasons.push('thin_participation');
  }
  if (directionalCrowding && !flushSupport) {
    softBlockReasons.push('directional_crowding');
  }
  if (derivativesDirectionAligned === false && !flushSupport) {
    softBlockReasons.push('derivatives_not_aligned');
  }

  const breakoutDistancePct = Math.abs(signalContext.breakoutDistancePct ?? 0);
  const channelWidthPct = signalContext.channelWidthPct ?? 0;
  const approvalSetup =
    breakoutAligned &&
    h4VolatilityState === 'expanded' &&
    breakoutDistancePct >= MIN_APPROVAL_BREAKOUT_DISTANCE_PCT &&
    channelWidthPct >= MIN_APPROVAL_CHANNEL_WIDTH_PCT &&
    (volumeRel20 ?? 0) >= MIN_APPROVAL_VOLUME_REL20;
  const highConfidenceSetup =
    approvalSetup &&
    breakoutDistancePct >= MIN_HIGH_CONFIDENCE_BREAKOUT_DISTANCE_PCT &&
    channelWidthPct >= MIN_HIGH_CONFIDENCE_CHANNEL_WIDTH_PCT;
  let deterministicQuality = 3;

  if (hardBlockReasons.length > 0) {
    deterministicQuality = 1;
  } else if (highConfidenceSetup) {
    deterministicQuality = 5;
  } else if (approvalSetup) {
    deterministicQuality = 4;
  } else {
    if (!breakoutAligned) {
      softBlockReasons.push('breakout_not_aligned');
    }
    if (h4VolatilityState !== 'expanded') {
      softBlockReasons.push('h4_volatility_not_expanded');
    }
    if (breakoutDistancePct < MIN_APPROVAL_BREAKOUT_DISTANCE_PCT) {
      softBlockReasons.push('weak_breakout_distance');
    }
    if (channelWidthPct < MIN_APPROVAL_CHANNEL_WIDTH_PCT) {
      softBlockReasons.push('narrow_channel_width');
    }
    if ((volumeRel20 ?? 0) < MIN_APPROVAL_VOLUME_REL20) {
      softBlockReasons.push('weak_participation');
    }
  }

  if (deterministicQuality >= 5 && softBlockReasons.length > 0) {
    deterministicQuality = 4;
  }

  return {
    ...signalContext,
    baseContextAvailable: Boolean(baseContext),
    primarySession,
    trendBias,
    adaptiveChannelRegime,
    breakoutState,
    volumeRel20,
    h4VolatilityState,
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
