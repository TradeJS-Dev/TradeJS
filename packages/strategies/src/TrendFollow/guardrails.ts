import { BaseStrategyContextSnapshot } from '@tradejs/types';
import { TrendFollowSignalContext } from './engine';

export type TrendFollowGuardrailContext = Partial<TrendFollowSignalContext> & {
  baseContextAvailable: boolean;
  primarySession: string | null;
  trendBias: string | null;
  trendFollowState: string | null;
  breakoutState: string | null;
  volumeRel20: number | null;
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

export const buildTrendFollowGuardrailContext = ({
  signalContext,
  baseContext,
}: {
  signalContext: Partial<TrendFollowSignalContext>;
  baseContext?: BaseStrategyContextSnapshot | null;
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
  const volumeRel20 = asFiniteNumber(
    baseContext?.participation?.volume?.volumeRel20,
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

  if (volumeRel20 != null && volumeRel20 < 0.8) {
    softBlockReasons.push('thin_participation');
  }
  if (directionalCrowding && !flushSupport) {
    softBlockReasons.push('directional_crowding');
  }
  if (derivativesDirectionAligned === false && !flushSupport) {
    softBlockReasons.push('derivatives_not_aligned');
  }

  const breakoutDistancePct = signalContext.breakoutDistancePct ?? 0;
  const distanceToStopPct = signalContext.distanceToStopPct ?? 0;
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
    volumeRel20,
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
