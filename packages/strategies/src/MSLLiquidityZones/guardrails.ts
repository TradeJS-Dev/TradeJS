import { BaseStrategyContextSnapshot } from '@tradejs/types';
import { MSLLiquidityZonesSignalContext } from './engine';

export type MSLLiquidityZonesGuardrailContext =
  Partial<MSLLiquidityZonesSignalContext> & {
    baseContextAvailable: boolean;
    primarySession: string | null;
    trendBias: string | null;
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

export const buildMSLLiquidityZonesGuardrailContext = ({
  signalContext,
  baseContext,
}: {
  signalContext: Partial<MSLLiquidityZonesSignalContext>;
  baseContext?: BaseStrategyContextSnapshot | null;
}): MSLLiquidityZonesGuardrailContext => {
  const derivativesSummary = baseContext?.derivatives?.summary ?? null;
  const primarySession = baseContext?.regime?.session?.sessionPhase ?? null;
  const trendBias = baseContext?.regime?.trend?.bias ?? null;
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
  const reactionCloseDistancePct = signalContext.reactionCloseDistancePct ?? 0;
  const retestPenetrationPct = signalContext.retestPenetrationPct ?? 999;
  let deterministicQuality = 3;

  if (hardBlockReasons.length > 0) {
    deterministicQuality = 1;
  } else if (
    filterMetric >= 3 &&
    hitCount >= 2 &&
    reactionCloseDistancePct >= 0.08 &&
    retestPenetrationPct <= 90 &&
    (trendAligned || benchmarkAligned || failedBreakoutAligned || flushSupport)
  ) {
    deterministicQuality = flushSupport || failedBreakoutAligned ? 5 : 4;
  } else if (
    filterMetric >= 1 &&
    reactionCloseDistancePct > 0 &&
    retestPenetrationPct <= 125
  ) {
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
