import type { BaseStrategyContextSnapshot, Direction } from '@tradejs/types';
import type { RelativeRotationSignalContext } from './core';

export type RelativeRotationGuardrailContext = Omit<
  Partial<RelativeRotationSignalContext>,
  'signalDirection'
> & {
  signalDirection: Direction | null;
  baseContextAvailable: boolean;
  targetVsBtcRatioReturn1h: number | null;
  targetVsBtcAlpha1h: number | null;
  targetVsEthAligned: boolean | null;
  trendBias: string | null;
  distanceToLowLevelAtr: number | null;
  adxDiMinus: number | null;
  contextConflictCount: number | null;
  totalContextScore: number | null;
  hardBlockReasons: string[];
  softBlockReasons: string[];
  deterministicQuality: number;
  approvalAllowedNow: boolean;
};

const asFiniteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asDirection = (value: unknown): Direction | null =>
  value === 'LONG' || value === 'SHORT' ? value : null;

const isTrendAligned = ({
  direction,
  trend,
}: {
  direction: Direction | null;
  trend: string | null | undefined;
}): boolean | null => {
  if (!direction || !trend || trend === 'unknown' || trend === 'flat') {
    return null;
  }

  return direction === 'LONG' ? trend === 'up' : trend === 'down';
};

export const buildRelativeRotationGuardrailContext = ({
  signalContext,
  baseContext,
}: {
  signalContext: Partial<RelativeRotationSignalContext>;
  baseContext?: BaseStrategyContextSnapshot | null;
}): RelativeRotationGuardrailContext => {
  const signalDirection = asDirection(signalContext.signalDirection);
  const targetVsBtc = baseContext?.relative?.targetVsBtc;
  const targetVsEth = baseContext?.relative?.targetVsEth;
  const targetVsBtcRatioReturn1h = asFiniteNumber(targetVsBtc?.ratioReturn1h);
  const targetVsBtcAlpha1h = asFiniteNumber(targetVsBtc?.alphaVsBtc1h);
  const targetVsBtcAlpha24h =
    asFiniteNumber(signalContext.targetVsBtcAlpha24h) ??
    asFiniteNumber(targetVsBtc?.alphaVsBtc24h);
  const targetVsBtcRatioReturn24h =
    asFiniteNumber(signalContext.targetVsBtcRatioReturn24h) ??
    asFiniteNumber(targetVsBtc?.ratioReturn24h);
  const targetVsEthAlpha24h =
    asFiniteNumber(signalContext.targetVsEthAlpha24h) ??
    asFiniteNumber(targetVsEth?.alphaVsEth24h);
  const targetVsEthRatioReturn24h =
    asFiniteNumber(signalContext.targetVsEthRatioReturn24h) ??
    asFiniteNumber(targetVsEth?.ratioReturn24h);
  const targetVsEthRatioTrend =
    signalContext.targetVsEthRatioTrend ?? targetVsEth?.ratioTrend ?? null;
  const targetVsEthAligned = isTrendAligned({
    direction: signalDirection,
    trend: targetVsEthRatioTrend,
  });
  const btcAltRegime =
    signalContext.btcAltRegime ??
    baseContext?.relative?.btcAltRegime?.regime ??
    null;
  const marketBreadthReturn =
    asFiniteNumber(signalContext.marketBreadthReturn) ??
    asFiniteNumber(baseContext?.relative?.marketBreadth?.equalWeightedReturn);
  const volumeRel20 =
    asFiniteNumber(signalContext.volumeRel20) ??
    asFiniteNumber(baseContext?.participation?.volume?.volumeRel20);
  const trendBias = baseContext?.regime?.trend?.bias ?? null;
  const distanceToLowLevelAtr = asFiniteNumber(
    baseContext?.structure?.localRange?.distanceToLowLevelAtr,
  );
  const adxDiMinus = asFiniteNumber(baseContext?.regime?.trend?.adx?.diMinus);
  const contextConflictCount = asFiniteNumber(
    baseContext?.gateFeatures?.conflicts?.count,
  );
  const totalContextScore = asFiniteNumber(
    baseContext?.gateFeatures?.scores?.totalContext,
  );
  const hardBlockReasons: string[] = [];
  const softBlockReasons: string[] = [];

  if (!signalDirection) {
    hardBlockReasons.push('missing_direction');
  }
  if (
    targetVsBtcRatioReturn1h == null ||
    targetVsBtcAlpha24h == null ||
    targetVsBtcRatioReturn24h == null
  ) {
    hardBlockReasons.push('missing_target_vs_btc_context');
  }
  if (distanceToLowLevelAtr == null) {
    hardBlockReasons.push('missing_distance_to_low_level_atr');
  }
  if (adxDiMinus == null) {
    hardBlockReasons.push('missing_adx_di_minus');
  }
  if (signalDirection && signalDirection !== 'SHORT') {
    softBlockReasons.push('long_direction_not_validated');
  }
  if (distanceToLowLevelAtr != null && distanceToLowLevelAtr > -2.75) {
    softBlockReasons.push('insufficient_breakdown_distance');
  }
  if (adxDiMinus != null && adxDiMinus > 50) {
    softBlockReasons.push('adx_di_minus_above_stable_range');
  }

  const stableShortBreakdown =
    signalDirection === 'SHORT' &&
    distanceToLowLevelAtr != null &&
    distanceToLowLevelAtr <= -2.75 &&
    adxDiMinus != null &&
    adxDiMinus <= 50;
  const deterministicQuality =
    hardBlockReasons.length > 0 ? 1 : stableShortBreakdown ? 4 : 3;

  return {
    ...signalContext,
    signalDirection,
    baseContextAvailable: Boolean(baseContext),
    targetVsBtcRatioReturn1h,
    targetVsBtcAlpha1h,
    targetVsBtcAlpha24h,
    targetVsBtcRatioReturn24h,
    targetVsEthAlpha24h,
    targetVsEthRatioReturn24h,
    targetVsEthRatioTrend,
    targetVsEthAligned,
    btcAltRegime,
    marketBreadthReturn,
    volumeRel20,
    trendBias,
    distanceToLowLevelAtr,
    adxDiMinus,
    contextConflictCount,
    totalContextScore,
    hardBlockReasons,
    softBlockReasons,
    deterministicQuality,
    approvalAllowedNow:
      deterministicQuality >= 4 && hardBlockReasons.length === 0,
  };
};
