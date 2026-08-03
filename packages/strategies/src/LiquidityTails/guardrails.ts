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
    priceDistanceToMaSlowAtr: number | null;
    liquidityZonesActiveCount: number | null;
    atrPctRankBucket: string | null;
    q4AtrRankEligible: boolean;
    liquidityRisk: string | null;
    cmcFearGreedValue: number | null;
    altBasketReturn24h: number | null;
    top100MarketBreadthDispersion: number | null;
    top100MarketBreadthPctAboveMa20: number | null;
    top100MarketBreadthStale: boolean | null;
    referenceTrx1hOiChangePct4h: number | null;
    referenceTrx1hStale: boolean | null;
    higherTimeframeConflict: boolean;
    benchmarkConflict: boolean;
    benchmarkConflictAvailable: boolean;
    derivativesPressure: string | null;
    derivativesDirectionAligned: boolean | null;
    derivativesRiskFlags: string[];
    derivativesRiskOffLongRecoveryCandidate: boolean;
    shortBreadthStressRecoveryCandidate: boolean;
    targetLongRetestRecoveryCandidate: boolean;
    liquidityTailsGateFeatures: LiquidityTailsGateFeatures;
    hardBlockReasons: string[];
    softBlockReasons: string[];
    deterministicQuality: number;
    approvalAllowedNow: boolean;
  };

export type LiquidityTailsGateFeatures = {
  zoneQuality: 'invalid' | 'weak' | 'formed' | 'mature' | 'unknown';
  retestAcceptance:
    | 'reaction_body_conflict'
    | 'shallow'
    | 'confirmed'
    | 'strong'
    | 'unknown';
  reactionMomentum: 'weak' | 'confirmed' | 'strong' | 'unknown';
  participationState: 'thin' | 'normal' | 'strong' | 'unknown';
  derivativesReversal:
    | 'flush_support'
    | 'aligned'
    | 'crowded'
    | 'conflict'
    | 'neutral'
    | 'unknown';
  trendContext: 'reversal' | 'with_trend' | 'neutral' | 'unknown';
  highQualityRetestPocket: boolean;
};

const asFiniteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asNullableFiniteNumber = (value: unknown): number | null =>
  value == null ? null : asFiniteNumber(value);

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === 'string' && entry.trim().length > 0,
      )
    : [];

const MIN_APPROVAL_BODY_STRENGTH = 0.4;
const MAX_APPROVAL_CMC_FEAR_GREED_VALUE = 39;
const MAX_APPROVAL_PRICE_DISTANCE_TO_MA_SLOW_ATR = 1.2;
const MIN_APPROVAL_ACTIVE_LIQUIDITY_ZONES = 1;
const MAX_DERIVATIVES_RISK_OFF_ALT_BASKET_RETURN_24H = -0.035;
const MAX_DERIVATIVES_RISK_OFF_TRX_OI_CHANGE_PCT_4H = -1.8;
const MIN_SHORT_BREADTH_STRESS_DISPERSION = 0.0065;
const MAX_SHORT_BREADTH_STRESS_PCT_ABOVE_MA20 = 0.08;
const MIN_SHORT_BREADTH_STRESS_REACTION_CLOSE_DISTANCE_PCT = 1.5;
const MIN_TARGET_LONG_RECOVERY_BODY_STRENGTH = 0.65;
const Q4_APPROVAL_ATR_RANK_BUCKETS = new Set(['high', 'extreme']);

const buildLiquidityTailsGateFeatures = ({
  signalContext,
  trendBias,
  volumeRel20,
  bodyStrength,
  adxValue,
  adxStrength,
  roc1h,
  roc4h,
  derivativesDirectionAligned,
  derivativesSummaryAvailable,
  flushSupport,
  directionalCrowding,
  actionableCloseAwayReaction,
}: {
  signalContext: Partial<LiquidityTailsSignalContext>;
  trendBias: string | null;
  volumeRel20: number | null;
  bodyStrength: number | null;
  adxValue: number | null;
  adxStrength: string | null;
  roc1h: number | null;
  roc4h: number | null;
  derivativesDirectionAligned: boolean | null;
  derivativesSummaryAvailable: boolean;
  flushSupport: boolean;
  directionalCrowding: boolean;
  actionableCloseAwayReaction: boolean;
}): LiquidityTailsGateFeatures => {
  const zoneHeight = asFiniteNumber(signalContext.zoneHeight);
  const zoneTouches = asFiniteNumber(signalContext.zoneTouches);
  const wickBodyRatio = asFiniteNumber(signalContext.wickBodyRatio);
  const wickDominanceRatio = asFiniteNumber(signalContext.wickDominanceRatio);
  const reactionCloseDistancePct = asFiniteNumber(
    signalContext.reactionCloseDistancePct,
  );
  const zoneQuality =
    zoneHeight == null || zoneHeight <= 0
      ? 'invalid'
      : (wickBodyRatio != null && wickBodyRatio >= 2) ||
          (wickDominanceRatio != null && wickDominanceRatio >= 1.5)
        ? (zoneTouches ?? 0) >= 2
          ? 'mature'
          : 'formed'
        : 'weak';
  const retestAcceptance =
    signalContext.reactionBodyAligned === false
      ? 'reaction_body_conflict'
      : reactionCloseDistancePct == null
        ? 'unknown'
        : reactionCloseDistancePct >= 2
          ? 'strong'
          : reactionCloseDistancePct >= 1
            ? 'confirmed'
            : 'shallow';
  const momentumConfirmed =
    (adxValue != null && adxValue >= 26.7) ||
    adxStrength === 'strong' ||
    (roc4h != null && roc4h >= 0.7) ||
    (roc1h != null && (roc1h >= 1.25 || roc1h <= -1.2));
  const reactionMomentum =
    bodyStrength == null && !momentumConfirmed
      ? 'unknown'
      : bodyStrength != null && bodyStrength < 0.25
        ? 'weak'
        : adxStrength === 'strong' || actionableCloseAwayReaction
          ? 'strong'
          : momentumConfirmed
            ? 'confirmed'
            : 'weak';
  const participationState =
    volumeRel20 == null
      ? 'unknown'
      : volumeRel20 < 0.75
        ? 'thin'
        : volumeRel20 >= 1.5
          ? 'strong'
          : 'normal';
  const derivativesReversal = flushSupport
    ? 'flush_support'
    : derivativesDirectionAligned === true
      ? 'aligned'
      : derivativesDirectionAligned === false
        ? 'conflict'
        : directionalCrowding
          ? 'crowded'
          : derivativesSummaryAvailable
            ? 'neutral'
            : 'unknown';
  const direction = signalContext.signalDirection;
  const trendContext =
    direction === 'LONG'
      ? trendBias === 'bear'
        ? 'reversal'
        : trendBias === 'bull'
          ? 'with_trend'
          : trendBias === 'neutral'
            ? 'neutral'
            : 'unknown'
      : direction === 'SHORT'
        ? trendBias === 'bull'
          ? 'reversal'
          : trendBias === 'bear'
            ? 'with_trend'
            : trendBias === 'neutral'
              ? 'neutral'
              : 'unknown'
        : 'unknown';

  return {
    zoneQuality,
    retestAcceptance,
    reactionMomentum,
    participationState,
    derivativesReversal,
    trendContext,
    highQualityRetestPocket:
      actionableCloseAwayReaction &&
      zoneQuality !== 'invalid' &&
      retestAcceptance === 'strong' &&
      participationState !== 'thin',
  };
};

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
  const priceDistanceToMaSlowAtr = asNullableFiniteNumber(
    baseContext?.regime?.trend?.priceDistanceToMaSlowAtr,
  );
  const liquidityZonesActiveCount = asNullableFiniteNumber(
    baseContext?.structure?.liquidityZones?.activeCount,
  );
  const atrPctRankBucket =
    typeof baseContext?.gateFeatures?.volatility?.atrPctRankBucket === 'string'
      ? baseContext.gateFeatures.volatility.atrPctRankBucket
      : null;
  const q4AtrRankEligible =
    atrPctRankBucket != null &&
    Q4_APPROVAL_ATR_RANK_BUCKETS.has(atrPctRankBucket);
  const liquidityRisk =
    typeof baseContext?.gateFeatures?.risk?.liquidityRisk === 'string'
      ? baseContext.gateFeatures.risk.liquidityRisk
      : null;
  const cmcFearGreedValue = asNullableFiniteNumber(
    baseContext?.relative?.cmcFearGreed?.value,
  );
  const altBasketReturn24h = asFiniteNumber(
    baseContext?.relative?.btcAltRegime?.altBasketReturn24h,
  );
  const top100MarketBreadth =
    baseContext?.relative?.marketBreadths?.top100 ?? null;
  const top100MarketBreadthDispersion = asNullableFiniteNumber(
    top100MarketBreadth?.dispersion,
  );
  const top100MarketBreadthPctAboveMa20 = asNullableFiniteNumber(
    top100MarketBreadth?.pctAboveMa20,
  );
  const top100MarketBreadthStale =
    typeof top100MarketBreadth?.stale === 'boolean'
      ? top100MarketBreadth.stale
      : null;
  const referenceTrx1h =
    baseContext?.derivatives?.referenceContexts?.TRXUSDT?.intervals?.['1h'];
  const referenceTrx1hOiChangePct4h = asFiniteNumber(
    referenceTrx1h?.oiChangePct4h,
  );
  const referenceTrx1hStale =
    typeof referenceTrx1h?.stale === 'boolean' ? referenceTrx1h.stale : null;
  const higherTimeframeConflict =
    baseContext?.gateFeatures?.mtf?.higherTimeframeConflict === true;
  const benchmarkConflictValue =
    baseContext?.gateFeatures?.relative?.benchmarkConflict;
  const benchmarkConflictAvailable =
    typeof benchmarkConflictValue === 'boolean';
  const benchmarkConflict = benchmarkConflictValue === true;
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
  if (signalContext.action === 'increase') {
    const level = asFiniteNumber(signalContext.level);
    const levelsFilled = asFiniteNumber(signalContext.levelsFilled);
    const positionQty = asFiniteNumber(signalContext.positionQty);
    const projectedQty = asFiniteNumber(signalContext.projectedQty);
    const riskBudgetUsedPct = asFiniteNumber(signalContext.riskBudgetUsedPct);
    if (
      level !== 2 ||
      levelsFilled !== 1 ||
      positionQty == null ||
      positionQty <= 0 ||
      projectedQty == null ||
      projectedQty <= positionQty
    ) {
      hardBlockReasons.push('invalid_scale_in_state');
    }
    if (riskBudgetUsedPct == null || riskBudgetUsedPct > 100.01) {
      hardBlockReasons.push('scale_in_risk_budget_exceeded');
    }
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
  const derivativesRiskOffLongRecoveryCandidate =
    direction === 'LONG' &&
    cmcFearGreedValue != null &&
    cmcFearGreedValue <= MAX_APPROVAL_CMC_FEAR_GREED_VALUE &&
    altBasketReturn24h != null &&
    altBasketReturn24h <= MAX_DERIVATIVES_RISK_OFF_ALT_BASKET_RETURN_24H &&
    referenceTrx1hStale === false &&
    referenceTrx1hOiChangePct4h != null &&
    referenceTrx1hOiChangePct4h <=
      MAX_DERIVATIVES_RISK_OFF_TRX_OI_CHANGE_PCT_4H;
  const shortBreadthStressRecoveryCandidate =
    direction === 'SHORT' &&
    benchmarkConflictAvailable &&
    !benchmarkConflict &&
    top100MarketBreadthStale === false &&
    top100MarketBreadthDispersion != null &&
    top100MarketBreadthDispersion >= MIN_SHORT_BREADTH_STRESS_DISPERSION &&
    top100MarketBreadthPctAboveMa20 != null &&
    top100MarketBreadthPctAboveMa20 <=
      MAX_SHORT_BREADTH_STRESS_PCT_ABOVE_MA20 &&
    (signalContext.reactionCloseDistancePct ?? 0) >=
      MIN_SHORT_BREADTH_STRESS_REACTION_CLOSE_DISTANCE_PCT &&
    bodyStrength != null &&
    bodyStrength >= MIN_APPROVAL_BODY_STRENGTH;
  if (volumeRel20 != null && volumeRel20 < 0.75) {
    softBlockReasons.push('thin_participation');
  }
  if (bodyStrength != null && bodyStrength < 0.25) {
    softBlockReasons.push('weak_reaction_body');
  }
  if (bodyStrength != null && bodyStrength < MIN_APPROVAL_BODY_STRENGTH) {
    softBlockReasons.push('insufficient_reaction_body_strength');
  }
  if (directionalCrowding && !flushSupport) {
    softBlockReasons.push('directional_crowding');
  }
  if (derivativesDirectionAligned === false && !flushSupport) {
    softBlockReasons.push('derivatives_not_aligned');
  }

  const reactionCloseDistancePct = signalContext.reactionCloseDistancePct ?? 0;
  const baseRequiredCloseAwayPct = direction === 'SHORT' ? 3 : 2;
  const requiredCloseAwayPct =
    primarySession === 'us'
      ? Math.max(baseRequiredCloseAwayPct, 2.5)
      : baseRequiredCloseAwayPct;
  const strongCloseAwayReaction =
    reactionCloseDistancePct >= requiredCloseAwayPct;
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
  const liquidityTailsGateFeatures = buildLiquidityTailsGateFeatures({
    signalContext,
    trendBias,
    volumeRel20,
    bodyStrength,
    adxValue,
    adxStrength,
    roc1h,
    roc4h,
    derivativesDirectionAligned,
    derivativesSummaryAvailable: derivativesSummary != null,
    flushSupport,
    directionalCrowding,
    actionableCloseAwayReaction,
  });
  const targetLongRetestRecoveryCandidate =
    direction === 'LONG' &&
    liquidityTailsGateFeatures.highQualityRetestPocket &&
    bodyStrength != null &&
    bodyStrength >= MIN_TARGET_LONG_RECOVERY_BODY_STRENGTH &&
    priceDistanceToMaSlowAtr != null &&
    priceDistanceToMaSlowAtr <= MAX_APPROVAL_PRICE_DISTANCE_TO_MA_SLOW_ATR &&
    liquidityZonesActiveCount != null &&
    liquidityZonesActiveCount >= MIN_APPROVAL_ACTIVE_LIQUIDITY_ZONES &&
    cmcFearGreedValue != null &&
    cmcFearGreedValue <= MAX_APPROVAL_CMC_FEAR_GREED_VALUE &&
    liquidityRisk !== 'high' &&
    q4AtrRankEligible;
  if (
    derivativesDirectionAligned === true &&
    !flushSupport &&
    !derivativesRiskOffLongRecoveryCandidate &&
    !shortBreadthStressRecoveryCandidate &&
    !targetLongRetestRecoveryCandidate
  ) {
    hardBlockReasons.push('derivatives_reversal_aligned');
  }
  if (
    derivativesDirectionAligned === false &&
    !flushSupport &&
    !derivativesRiskOffLongRecoveryCandidate &&
    !shortBreadthStressRecoveryCandidate &&
    !targetLongRetestRecoveryCandidate
  ) {
    hardBlockReasons.push('derivatives_reversal_conflict');
  }
  let deterministicQuality = 3;

  if (hardBlockReasons.length > 0) {
    deterministicQuality = 1;
  } else if (actionableCloseAwayReaction) {
    deterministicQuality = adxStrength === 'strong' ? 5 : 4;
  }

  if (deterministicQuality >= 5 && softBlockReasons.length > 0) {
    deterministicQuality = 4;
  }
  if (
    deterministicQuality >= 4 &&
    bodyStrength != null &&
    bodyStrength < MIN_APPROVAL_BODY_STRENGTH
  ) {
    deterministicQuality = 3;
  }
  if (deterministicQuality === 4 && !q4AtrRankEligible) {
    deterministicQuality = 3;
    softBlockReasons.push('q4_atr_rank_not_high');
  }
  if (deterministicQuality >= 4 && liquidityRisk === 'high') {
    deterministicQuality = 3;
    softBlockReasons.push('high_liquidity_risk');
  }
  if (deterministicQuality >= 4 && cmcFearGreedValue == null) {
    deterministicQuality = 3;
    softBlockReasons.push('cmc_fear_greed_unavailable');
  }
  if (
    deterministicQuality >= 4 &&
    cmcFearGreedValue != null &&
    cmcFearGreedValue > MAX_APPROVAL_CMC_FEAR_GREED_VALUE
  ) {
    deterministicQuality = 3;
    softBlockReasons.push('cmc_fear_greed_above_approval_max');
  }
  if (
    deterministicQuality === 3 &&
    hardBlockReasons.length === 0 &&
    derivativesRiskOffLongRecoveryCandidate
  ) {
    deterministicQuality = 4;
  }
  if (deterministicQuality >= 4) {
    const approvalContextReasons: string[] = [];
    if (priceDistanceToMaSlowAtr == null) {
      approvalContextReasons.push('price_distance_to_ma_slow_unavailable');
    } else if (
      priceDistanceToMaSlowAtr > MAX_APPROVAL_PRICE_DISTANCE_TO_MA_SLOW_ATR
    ) {
      approvalContextReasons.push('price_overextended_from_ma_slow');
    }
    if (
      liquidityZonesActiveCount == null ||
      liquidityZonesActiveCount < MIN_APPROVAL_ACTIVE_LIQUIDITY_ZONES
    ) {
      approvalContextReasons.push('liquidity_zone_confirmation_missing');
    }
    if (approvalContextReasons.length > 0) {
      deterministicQuality = 3;
      softBlockReasons.push(...approvalContextReasons);
    }
  }
  if (
    deterministicQuality === 3 &&
    hardBlockReasons.length === 0 &&
    shortBreadthStressRecoveryCandidate
  ) {
    deterministicQuality = 4;
  }
  if (
    targetLongRetestRecoveryCandidate &&
    derivativesDirectionAligned != null &&
    !flushSupport &&
    hardBlockReasons.length === 0
  ) {
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
    priceDistanceToMaSlowAtr,
    liquidityZonesActiveCount,
    atrPctRankBucket,
    q4AtrRankEligible,
    liquidityRisk,
    cmcFearGreedValue,
    altBasketReturn24h,
    top100MarketBreadthDispersion,
    top100MarketBreadthPctAboveMa20,
    top100MarketBreadthStale,
    referenceTrx1hOiChangePct4h,
    referenceTrx1hStale,
    higherTimeframeConflict,
    benchmarkConflict,
    benchmarkConflictAvailable,
    derivativesPressure,
    derivativesDirectionAligned,
    derivativesRiskFlags,
    derivativesRiskOffLongRecoveryCandidate,
    shortBreadthStressRecoveryCandidate,
    targetLongRetestRecoveryCandidate,
    liquidityTailsGateFeatures,
    hardBlockReasons,
    softBlockReasons,
    deterministicQuality,
    approvalAllowedNow:
      deterministicQuality >= 4 && hardBlockReasons.length === 0,
  };
};
