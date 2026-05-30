import { BaseStrategyContextSnapshot } from '@tradejs/types';
import { LiquidityTailsSignalContext } from './engine';

export type LiquidityTailsGuardrailContext =
  Partial<LiquidityTailsSignalContext> & {
    baseContextAvailable: boolean;
    primarySession: string | null;
    trendBias: string | null;
    breakoutState: string | null;
    liquidityTailRetestDirection: string | null;
    volumeRel20: number | null;
    bodyStrength: number | null;
    adxValue: number | null;
    adxStrength: string | null;
    roc1h: number | null;
    roc4h: number | null;
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

export const buildLiquidityTailsGuardrailContext = ({
  signalContext,
  baseContext,
}: {
  signalContext: Partial<LiquidityTailsSignalContext>;
  baseContext?: BaseStrategyContextSnapshot | null;
}): LiquidityTailsGuardrailContext => {
  const derivativesSummary = baseContext?.derivatives?.summary ?? null;
  const primarySession = baseContext?.regime?.session?.sessionPhase ?? null;
  const trendBias = baseContext?.regime?.trend?.bias ?? null;
  const breakoutState =
    baseContext?.structure?.localRange?.breakoutState ?? null;
  const liquidityTailRetestDirection = signalContext.signalDirection ?? null;
  const volumeRel20 = asFiniteNumber(
    baseContext?.participation?.volume?.volumeRel20,
  );
  const bodyStrength = asFiniteNumber(
    baseContext?.regime?.momentum?.bodyStrength,
  );
  const adxValue = asFiniteNumber(baseContext?.regime?.trend?.adx?.adx);
  const adxStrength =
    typeof baseContext?.regime?.trend?.adx?.strength === 'string'
      ? baseContext.regime.trend.adx.strength
      : null;
  const roc1h = asFiniteNumber(baseContext?.regime?.momentum?.roc1h);
  const roc4h = asFiniteNumber(baseContext?.regime?.momentum?.roc4h);
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
  if (bodyStrength != null && bodyStrength < 0.25) {
    softBlockReasons.push('weak_reaction_body');
  }
  if (directionalCrowding && !flushSupport) {
    softBlockReasons.push('directional_crowding');
  }
  if (derivativesDirectionAligned === false && !flushSupport) {
    softBlockReasons.push('derivatives_not_aligned');
  }

  const reactionCloseDistancePct = signalContext.reactionCloseDistancePct ?? 0;
  const strongCloseAwayReaction = reactionCloseDistancePct >= 2;
  const nonBullTrendContext = trendBias === 'bear' || trendBias === 'neutral';
  const strongAdxExpansion =
    (adxValue != null && adxValue >= 26.7) || adxStrength === 'strong';
  const momentumExpansion =
    (roc4h != null && roc4h >= 0.7) ||
    (roc1h != null && (roc1h >= 1.25 || roc1h <= -1.2));
  const actionableCloseAwayReaction =
    strongCloseAwayReaction &&
    nonBullTrendContext &&
    (strongAdxExpansion || momentumExpansion);
  let deterministicQuality = 3;

  if (hardBlockReasons.length > 0) {
    deterministicQuality = 1;
  } else if (actionableCloseAwayReaction) {
    deterministicQuality = adxStrength === 'strong' ? 5 : 4;
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
    liquidityTailRetestDirection,
    volumeRel20,
    bodyStrength,
    adxValue,
    adxStrength,
    roc1h,
    roc4h,
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
