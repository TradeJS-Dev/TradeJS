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

export type TrendShiftGateFeatures = {
  reversalConfirmation: 'noise' | 'weak' | 'confirmed' | 'strong';
  exhaustionSignal:
    | 'none'
    | 'liquidation_flush'
    | 'oi_falling_flush'
    | 'crowded_pressure'
    | 'mixed_oi';
  oiConfirmation: 'expanding' | 'falling' | 'mixed' | 'unknown';
  flipStretch: 'too_small' | 'clean' | 'extended' | 'overextended';
  q4RecoveryProfile: 'none' | 'geometry_only' | 'context_supported' | 'blocked';
  derivativesReversalAlignment:
    | 'supports_reversal'
    | 'conflicts'
    | 'neutral'
    | 'unknown';
  relativeStrengthBucket:
    | 'strong_against'
    | 'mild_against'
    | 'neutral'
    | 'mild_with'
    | 'strong_with'
    | 'unknown';
  conflictCount: number;
  mtfAlignment: 'aligned' | 'against' | 'mixed' | 'neutral' | 'unknown';
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
  shortNeutralBearChannelBreakdownCandidate: boolean;
  selectiveNeutralQ4Candidate: boolean;
  longRelativeStrengthOverextended: boolean;
  longPriceUpOiDivergence: boolean;
  longLowerTailPriceUpOiDivergence: boolean;
  shortUsLongFlushRisk: boolean;
  shortFailedLowOiNotConfirming: boolean;
  shortBelowLowOiFallingLongFlushRisk: boolean;
  shortNearPointOfControlRisk: boolean;
  shortExtremeAtrHighBbRisk: boolean;
  shortBullSwingStructureRisk: boolean;
  shortLowBollingerWidthRisk: boolean;
  shortAsiaLongFlushLowCmcBreadthRisk: boolean;
  derivativesDataUnavailableStressRisk: boolean;
  lowRewardToVolatilityRisk: boolean;
  defensiveRewardToVolatilityRisk: boolean;
  bnbReferenceOiExpansionRisk: boolean;
  longBtcAltRegimeRisk: boolean;
  longBroadMarketShortFlushRisk: boolean;
  cmcExchangeLiquidityVolumeChangeRisk: boolean;
  q4TrendShiftGateFeaturesRecoveryCandidate: boolean;
  q4UsClosingOiConfirmationRecoveryCandidate: boolean;
  q4ShortBreadthShockLiquidationRecoveryCandidate: boolean;
  q4LongAltLeadershipRecoveryCandidate: boolean;
  breakoutState: string | null;
  swingBias: string | null;
  volumeRel20: number | null;
  atrPctZScore: number | null;
  bbWidthPct: number | null;
  adaptiveChannelDirection: string | null;
  liquidityTailSide: string | null;
  nearPointOfControl: boolean | null;
  relativeStrength1h: number | null;
  marketBreadthReturn: number | null;
  marketBreadthAdvancers: number | null;
  marketBreadthPctAboveMa20: number | null;
  btcVsAltReturn24h: number | null;
  btcVsAltReturn1h: number | null;
  cmcFearGreedValue: number | null;
  cmcFearGreedValueChange24h: number | null;
  derivatives1hLiqShort: number | null;
  bnbReferenceOiChangePct4h: number | null;
  btcAltRegime: string | null;
  cmcExchangeLiquidityVolumeChange24hPct: number | null;
  trendShiftGateFeatures: TrendShiftGateFeatures;
  sessionPrimary: string | null;
  sessionWindowPhase: string | null;
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

const SHORT_LOW_BB_WIDTH_PCT_MAX = 1.7584;
const SHORT_BREADTH_SHOCK_MARKET_BREADTH_RETURN_MAX = -0.0112952;
const SHORT_BREADTH_SHOCK_1H_LIQ_SHORT_MAX = 0.208;
const LONG_ALT_LEADERSHIP_BTC_VS_ALT_RETURN_24H_MAX = -0.00503054;
const LONG_ALT_LEADERSHIP_BTC_VS_ALT_RETURN_1H_MAX = -0.00581403;
const LONG_ALT_LEADERSHIP_FEAR_GREED_CHANGE_24H_MIN = -1;
const LONG_BROAD_MARKET_SHORT_FLUSH_ADVANCERS_MIN = 27;
const LONG_BROAD_MARKET_SHORT_FLUSH_PCT_ABOVE_MA20_MIN = 0.95;
const LONG_BROAD_MARKET_SHORT_FLUSH_BTC_VS_ALT_RETURN_24H_MIN = 0;
const SHORT_ASIA_LONG_FLUSH_LOW_CMC_FEAR_GREED_MAX = 18;
const SHORT_ASIA_LONG_FLUSH_ADVANCERS_MAX = 2;
const BNB_REFERENCE_OI_CHANGE_PCT_4H_RISK_MIN = 0;
const DERIVATIVES_DATA_UNAVAILABLE_STRESS_CMC_FEAR_GREED_MAX = 25;

const toMtfAlignmentForTrendShift = ({
  direction,
  mtfAlignment,
}: {
  direction: TrendShiftSignalContext['signalDirection'];
  mtfAlignment: string | null;
}): TrendShiftGateFeatures['mtfAlignment'] => {
  if (!direction || !mtfAlignment || mtfAlignment === 'unknown') {
    return 'unknown';
  }
  if (mtfAlignment === 'mixed') return 'mixed';
  if (mtfAlignment === 'neutral') return 'neutral';
  if (direction === 'LONG') {
    return mtfAlignment === 'aligned_bull'
      ? 'aligned'
      : mtfAlignment === 'aligned_bear'
        ? 'against'
        : 'unknown';
  }
  return mtfAlignment === 'aligned_bear'
    ? 'aligned'
    : mtfAlignment === 'aligned_bull'
      ? 'against'
      : 'unknown';
};

const toTrendShiftRelativeStrengthBucket = ({
  direction,
  value,
}: {
  direction: TrendShiftSignalContext['signalDirection'];
  value: number | null;
}): TrendShiftGateFeatures['relativeStrengthBucket'] => {
  if (!direction || value == null) return 'unknown';
  const signed = direction === 'LONG' ? value : -value;
  if (signed <= -3) return 'strong_against';
  if (signed < -1) return 'mild_against';
  if (signed >= 3) return 'strong_with';
  if (signed > 1) return 'mild_with';
  return 'neutral';
};

const toPressureBias = (value: number | null) =>
  value == null
    ? 'unknown'
    : value >= 0.55
      ? 'bull'
      : value <= 0.45
        ? 'bear'
        : 'neutral';

const toBiasAligned = ({
  direction,
  bias,
}: {
  direction: TrendShiftSignalContext['signalDirection'];
  bias: 'bull' | 'bear' | 'neutral' | 'unknown';
}) =>
  direction == null || bias === 'unknown' || bias === 'neutral'
    ? null
    : direction === 'LONG'
      ? bias === 'bull'
      : bias === 'bear';

const toDirectionalAlignment = ({
  direction,
  bullValue,
  bearValue,
  value,
}: {
  direction: TrendShiftSignalContext['signalDirection'];
  bullValue: string;
  bearValue: string;
  value: string | null;
}): boolean | null => {
  if (!direction || !value) return null;
  return direction === 'LONG' ? value === bullValue : value === bearValue;
};

const toTrendShiftOiConfirmation = ({
  direction,
  priceOiDivergenceType,
}: {
  direction: TrendShiftSignalContext['signalDirection'];
  priceOiDivergenceType: string | null;
}): TrendShiftGateFeatures['oiConfirmation'] => {
  if (
    !direction ||
    !priceOiDivergenceType ||
    priceOiDivergenceType === 'unknown'
  ) {
    return 'unknown';
  }
  if (priceOiDivergenceType === 'flat_or_mixed') return 'mixed';
  if (direction === 'LONG') {
    if (priceOiDivergenceType === 'price_up_oi_up') return 'expanding';
    if (priceOiDivergenceType === 'price_up_oi_down') return 'falling';
  }
  if (direction === 'SHORT') {
    if (priceOiDivergenceType === 'price_down_oi_up') return 'expanding';
    if (priceOiDivergenceType === 'price_down_oi_down') return 'falling';
  }
  return 'mixed';
};

const toTrendShiftReversalConfirmation = ({
  signalContext,
}: {
  signalContext: TrendShiftSignalContext;
}): TrendShiftGateFeatures['reversalConfirmation'] => {
  if (signalContext.confirmedFlip !== true) return 'noise';
  if (signalContext.flipDistanceOk !== true) return 'weak';

  const slopeAbs = Math.abs(signalContext.avgSlopePct ?? 0);
  const distanceAtrRatio = signalContext.distanceAtrRatio ?? 0;
  const closeVsAvgPctAbs = Math.abs(signalContext.closeVsAvgPct ?? 0);

  if (distanceAtrRatio >= 0.8 && slopeAbs >= 0.09 && closeVsAvgPctAbs >= 0.12) {
    return 'strong';
  }
  if (
    distanceAtrRatio >= 0.45 &&
    slopeAbs >= 0.04 &&
    closeVsAvgPctAbs >= 0.05
  ) {
    return 'confirmed';
  }
  return 'weak';
};

const toTrendShiftFlipStretch = ({
  signalContext,
}: {
  signalContext: TrendShiftSignalContext;
}): TrendShiftGateFeatures['flipStretch'] => {
  const distanceAtrRatio = signalContext.distanceAtrRatio ?? 0;
  const closeVsAvgPctAbs = Math.abs(signalContext.closeVsAvgPct ?? 0);

  if (distanceAtrRatio < 0.45 || closeVsAvgPctAbs < 0.05) {
    return 'too_small';
  }
  if (distanceAtrRatio > 1.2 || closeVsAvgPctAbs > 0.45) {
    return 'overextended';
  }
  if (distanceAtrRatio >= 0.8 || closeVsAvgPctAbs >= 0.12) {
    return 'extended';
  }
  return 'clean';
};

const buildTrendShiftGateFeatures = ({
  baseContext,
  signalContext,
}: {
  baseContext?: BaseStrategyContextSnapshot | null;
  signalContext: TrendShiftSignalContext;
}): TrendShiftGateFeatures => {
  const direction = signalContext.signalDirection;
  const reversalConfirmation = toTrendShiftReversalConfirmation({
    signalContext,
  });
  const flipStretch = toTrendShiftFlipStretch({ signalContext });

  if (!baseContext || !direction) {
    return {
      reversalConfirmation,
      exhaustionSignal: 'none',
      oiConfirmation: 'unknown',
      flipStretch,
      q4RecoveryProfile: 'none',
      derivativesReversalAlignment: 'unknown',
      relativeStrengthBucket: 'unknown',
      conflictCount: 0,
      mtfAlignment: 'unknown',
    };
  }

  const mtfAlignment = toMtfAlignmentForTrendShift({
    direction,
    mtfAlignment: baseContext.mtf?.summary?.mtfAlignment ?? null,
  });
  const benchmark = baseContext.relative?.benchmark;
  const relativeStrength1h = asFiniteNumber(benchmark?.relativeStrength1h);
  const relativeStrengthBucket = toTrendShiftRelativeStrengthBucket({
    direction,
    value: relativeStrength1h,
  });
  const benchmarkTrendAlignment = benchmark?.trendAlignment ?? null;
  const benchmarkAligned =
    benchmarkTrendAlignment === 'against_benchmark'
      ? false
      : toDirectionalAlignment({
          direction,
          bullValue: 'aligned_bull',
          bearValue: 'aligned_bear',
          value: benchmarkTrendAlignment,
        });
  const marketBreadth = baseContext.relative?.marketBreadth;
  const marketBreadthReturn = asFiniteNumber(
    marketBreadth?.equalWeightedReturn,
  );
  const marketBreadthAligned =
    marketBreadthReturn == null || marketBreadth?.stale
      ? null
      : direction === 'LONG'
        ? marketBreadthReturn >= 0
        : marketBreadthReturn <= 0;
  const delta = baseContext.participation?.delta;
  const deltaDivergenceVsPrice =
    typeof delta?.deltaDivergenceVsPrice === 'string'
      ? delta.deltaDivergenceVsPrice
      : null;
  const buyPressurePct = asFiniteNumber(delta?.buyPressurePct);
  const deltaBias =
    deltaDivergenceVsPrice === 'bullish' || deltaDivergenceVsPrice === 'bearish'
      ? deltaDivergenceVsPrice === 'bullish'
        ? 'bull'
        : 'bear'
      : toPressureBias(buyPressurePct);
  const deltaAligned = toBiasAligned({ direction, bias: deltaBias });
  const tradeFlow = baseContext.participation?.tradeFlow;
  const tradeFlowBias = tradeFlow?.stale
    ? 'unknown'
    : toPressureBias(asFiniteNumber(tradeFlow?.buyPressurePct));
  const tradeFlowAligned = toBiasAligned({ direction, bias: tradeFlowBias });
  const primaryReferenceSymbol =
    baseContext.relative?.referenceTradeFlow?.primaryReferenceSymbol;
  const primaryReferenceTradeFlow =
    primaryReferenceSymbol != null
      ? baseContext.relative?.referenceTradeFlow?.tradeFlowBySymbol?.[
          primaryReferenceSymbol
        ]
      : undefined;
  const referenceTradeFlowBias = primaryReferenceTradeFlow?.stale
    ? 'unknown'
    : toPressureBias(asFiniteNumber(primaryReferenceTradeFlow?.buyPressurePct));
  const referenceTradeFlowAligned = toBiasAligned({
    direction,
    bias: referenceTradeFlowBias,
  });
  const localRange = baseContext.structure?.localRange;
  const breakoutState = localRange?.breakoutState ?? null;
  const failedBreakoutForDirection = toDirectionalAlignment({
    direction,
    bullValue: 'failed_low_breakout',
    bearValue: 'failed_high_breakout',
    value: breakoutState,
  });
  const volatility = baseContext.regime?.volatility;
  const atrPctZScore = asFiniteNumber(volatility?.atrPctZScore);
  const extremeVolatilityRisk = Math.abs(atrPctZScore ?? 0) >= 2;
  const benchmarkDerivativesSummary = baseContext.derivatives?.summary;
  const derivativesSummary = benchmarkDerivativesSummary;
  const derivativesPressure =
    typeof derivativesSummary?.pressure === 'string'
      ? derivativesSummary.pressure
      : null;
  const priceOiDivergenceType =
    typeof derivativesSummary?.priceOiDivergenceType === 'string'
      ? derivativesSummary.priceOiDivergenceType
      : null;
  const oiConfirmation = toTrendShiftOiConfirmation({
    direction,
    priceOiDivergenceType,
  });
  const derivativesDirectionAligned =
    typeof derivativesSummary?.directionAligned === 'boolean'
      ? derivativesSummary.directionAligned
      : null;
  const derivativesRiskFlags = asStringArray(derivativesSummary?.riskFlags);
  const derivativesCrowdedForDirection =
    direction === 'LONG'
      ? derivativesRiskFlags.includes('crowded_long')
      : derivativesRiskFlags.includes('crowded_short');
  const derivativesFlushSupport =
    direction === 'SHORT'
      ? derivativesRiskFlags.includes('long_liquidation_spike') ||
        derivativesPressure === 'long_flush'
      : derivativesRiskFlags.includes('short_liquidation_spike') ||
        derivativesPressure === 'short_flush';
  const oiNotConfirming = derivativesRiskFlags.includes('oi_not_confirming');
  const exhaustionSignal: TrendShiftGateFeatures['exhaustionSignal'] =
    derivativesFlushSupport && oiConfirmation === 'falling'
      ? 'oi_falling_flush'
      : derivativesFlushSupport
        ? 'liquidation_flush'
        : derivativesCrowdedForDirection
          ? 'crowded_pressure'
          : oiConfirmation === 'mixed'
            ? 'mixed_oi'
            : 'none';
  const derivativesReversalAlignment: TrendShiftGateFeatures['derivativesReversalAlignment'] =
    derivativesSummary == null
      ? 'unknown'
      : derivativesFlushSupport ||
          (derivativesDirectionAligned === true && !oiNotConfirming)
        ? 'supports_reversal'
        : derivativesDirectionAligned === false ||
            oiNotConfirming ||
            oiConfirmation === 'mixed'
          ? 'conflicts'
          : derivativesPressure === 'neutral'
            ? 'neutral'
            : 'unknown';
  const conflicts: boolean[] = [];
  conflicts.push(mtfAlignment === 'against');
  conflicts.push(mtfAlignment === 'mixed');
  conflicts.push(benchmarkAligned === false);
  conflicts.push(relativeStrengthBucket.endsWith('_against'));
  conflicts.push(marketBreadthAligned === false);
  conflicts.push(deltaAligned === false);
  conflicts.push(tradeFlowAligned === false);
  conflicts.push(referenceTradeFlowAligned === false);
  conflicts.push(failedBreakoutForDirection === true);
  conflicts.push(extremeVolatilityRisk);
  conflicts.push(derivativesDirectionAligned === false);
  conflicts.push(derivativesCrowdedForDirection);
  const conflictCount = conflicts.filter(Boolean).length;
  const volumeRel20 = asFiniteNumber(
    baseContext.participation?.volume?.volumeRel20,
  );
  const q4GeometryCandidate = reversalConfirmation === 'confirmed';
  const q4RecoveryProfile: TrendShiftGateFeatures['q4RecoveryProfile'] =
    !q4GeometryCandidate
      ? 'none'
      : mtfAlignment === 'against' || conflictCount > 2
        ? 'blocked'
        : derivativesReversalAlignment === 'supports_reversal' &&
            (volumeRel20 == null || volumeRel20 >= 0.8)
          ? 'context_supported'
          : 'geometry_only';

  return {
    reversalConfirmation,
    exhaustionSignal,
    oiConfirmation,
    flipStretch,
    q4RecoveryProfile,
    derivativesReversalAlignment,
    relativeStrengthBucket,
    conflictCount,
    mtfAlignment,
  };
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
  const benchmarkDerivativesSummary = baseContext?.derivatives?.summary ?? null;
  const derivativesSummary = benchmarkDerivativesSummary;
  const hasDerivativesSummary = derivativesSummary != null;
  const session = baseContext?.regime?.session ?? null;
  const localRange = baseContext?.structure?.localRange ?? null;
  const volume = baseContext?.participation?.volume ?? null;
  const benchmark = baseContext?.relative?.benchmark ?? null;
  const volatility = baseContext?.regime?.volatility ?? null;
  const adaptiveChannel = baseContext?.regime?.trend?.adaptiveChannel ?? null;
  const trendShiftGateFeatures = buildTrendShiftGateFeatures({
    baseContext,
    signalContext,
  });
  const priceVolumeProfile =
    baseContext?.participation?.priceVolumeProfile ?? null;
  const liquidityTail =
    baseContext?.structure?.liquidityTails?.currentTail ?? null;
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
  const sessionWindowPhase =
    typeof session?.sessionWindowPhase === 'string'
      ? session.sessionWindowPhase
      : null;
  const sessionIsOverlap = session?.isOverlap === true;
  const breakoutState = localRange?.breakoutState ?? null;
  const swingBias =
    typeof baseContext?.structure?.swing?.bias === 'string'
      ? baseContext.structure.swing.bias
      : null;
  const volumeRel20 = asFiniteNumber(volume?.volumeRel20);
  const atrPctZScore = asFiniteNumber(volatility?.atrPctZScore);
  const adaptiveChannelDirection =
    typeof adaptiveChannel?.direction === 'string'
      ? adaptiveChannel.direction
      : null;
  const liquidityTailSide =
    typeof liquidityTail?.side === 'string' ? liquidityTail.side : null;
  const nearPointOfControl =
    typeof priceVolumeProfile?.nearPointOfControl === 'boolean'
      ? priceVolumeProfile.nearPointOfControl
      : null;
  const relativeStrength1h = asFiniteNumber(benchmark?.relativeStrength1h);
  const priceOiDivergenceType =
    typeof derivativesSummary?.priceOiDivergenceType === 'string'
      ? derivativesSummary.priceOiDivergenceType
      : null;
  const rewardToVolatility = asFiniteNumber(
    baseContext?.gateFeatures?.setup?.rewardToVolatility,
  );
  const gateVolatility = baseContext?.gateFeatures?.volatility;
  const gateRelative = baseContext?.gateFeatures?.relative;
  const baseMarketBreadth = baseContext?.relative?.marketBreadth;
  const baseBtcAltRegime = baseContext?.relative?.btcAltRegime;
  const baseCmcFearGreed = baseContext?.relative?.cmcFearGreed;
  const bbWidthPct = asFiniteNumber(volatility?.bbWidthPct);
  const marketBreadthReturn = asFiniteNumber(gateRelative?.marketBreadthReturn);
  const marketBreadthAdvancers = asFiniteNumber(baseMarketBreadth?.advancers);
  const marketBreadthPctAboveMa20 = asFiniteNumber(
    baseMarketBreadth?.pctAboveMa20,
  );
  const marketBreadthStale =
    gateRelative?.marketBreadthStale === true ||
    baseMarketBreadth?.stale === true;
  const btcVsAltReturn24h = asFiniteNumber(gateRelative?.btcVsAltReturn24h);
  const btcVsAltReturn1h = asFiniteNumber(baseBtcAltRegime?.btcVsAltReturn1h);
  const cmcFearGreedValue = asFiniteNumber(
    gateRelative?.cmcFearGreedValue ?? baseCmcFearGreed?.value,
  );
  const cmcFearGreedValueChange24h = asFiniteNumber(
    gateRelative?.cmcFearGreedValueChange24h ??
      baseCmcFearGreed?.valueChange24h,
  );
  const cmcFearGreedStale =
    gateRelative?.cmcFearGreedStale === true ||
    baseCmcFearGreed?.stale === true;
  const derivativesDataUnavailable =
    derivativesRiskFlags.includes('missing_derivatives') ||
    derivativesRiskFlags.includes('stale_derivatives');
  const derivativesDataUnavailableStressRisk =
    derivativesDataUnavailable &&
    cmcFearGreedStale !== true &&
    cmcFearGreedValue != null &&
    cmcFearGreedValue <= DERIVATIVES_DATA_UNAVAILABLE_STRESS_CMC_FEAR_GREED_MAX;
  const derivatives1hLiqShort = asFiniteNumber(
    baseContext?.derivatives?.intervals?.['1h']?.liqShort,
  );
  const bnbReferenceOiChangePct4h = asFiniteNumber(
    baseContext?.derivatives?.referenceContexts?.BNBUSDT?.intervals?.['1h']
      ?.oiChangePct4h,
  );
  const btcAltRegime =
    typeof gateRelative?.btcAltRegime === 'string'
      ? gateRelative.btcAltRegime
      : null;
  const btcAltRegimeStale = gateRelative?.btcAltRegimeStale === true;
  const cmcExchangeLiquidityVolumeChange24hPct = asFiniteNumber(
    gateRelative?.cmcExchangeLiquidityVolumeChange24hPct,
  );
  const cmcExchangeLiquidityStale =
    gateRelative?.cmcExchangeLiquidityStale === true;

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
  const hasOnlyOiFallingLongLiquidationSpike =
    derivativesRiskFlags.length === 2 &&
    derivativesRiskFlags.includes('oi_falling') &&
    derivativesRiskFlags.includes('long_liquidation_spike');
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
    !derivativesDataUnavailableStressRisk &&
    !sessionIsOverlap &&
    ((signalContext.signalDirection === 'LONG' &&
      sessionPrimary === 'europe' &&
      (breakoutState === 'above_high_level' ||
        breakoutState === 'failed_high_breakout')) ||
      (signalContext.signalDirection === 'SHORT' &&
        (sessionPrimary === 'off_hours' || sessionPrimary === 'asia') &&
        breakoutState === 'below_low_level'));
  const shortNeutralBearChannelBreakdownCandidate =
    signalContext.signalDirection === 'SHORT' &&
    breakoutState === 'below_low_level' &&
    derivativesPressure === 'neutral' &&
    !derivativesDataUnavailableStressRisk &&
    atrPctZScore != null &&
    atrPctZScore >= 0 &&
    atrPctZScore < 1 &&
    adaptiveChannelDirection === 'bear';
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

  if (deterministicQuality === 4 && shortNeutralBearChannelBreakdownCandidate) {
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

  if (deterministicQuality >= 5 && derivativesDataUnavailableStressRisk) {
    deterministicQuality = 4;
    hardBlockReasons.push('derivatives_data_unavailable_stress');
  }

  if (
    deterministicQuality >= 5 &&
    hasDerivativesSummary &&
    !selectiveNeutralQ4Candidate &&
    !shortNeutralBearChannelBreakdownCandidate &&
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
    !shortNeutralBearChannelBreakdownCandidate &&
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
  const longLowerTailPriceUpOiDivergence =
    signalContext.signalDirection === 'LONG' &&
    liquidityTailSide === 'lower' &&
    priceOiDivergenceType === 'price_up_oi_up';
  const shortUsLongFlushRisk =
    signalContext.signalDirection === 'SHORT' &&
    sessionPrimary === 'us' &&
    derivativesPressure === 'long_flush';
  const shortFailedLowOiNotConfirming =
    signalContext.signalDirection === 'SHORT' &&
    breakoutState === 'failed_low_breakout' &&
    priceOiDivergenceType === 'price_down_oi_down';
  const shortBelowLowOiFallingLongFlushRisk =
    signalContext.signalDirection === 'SHORT' &&
    breakoutState === 'below_low_level' &&
    sessionPrimary != null &&
    sessionPrimary !== 'asia' &&
    derivativesPressure === 'long_flush' &&
    priceOiDivergenceType === 'price_down_oi_down' &&
    hasOnlyOiFallingLongLiquidationSpike;
  const shortNearPointOfControlRisk =
    signalContext.signalDirection === 'SHORT' && nearPointOfControl === true;
  const shortExtremeAtrHighBbRisk =
    signalContext.signalDirection === 'SHORT' &&
    gateVolatility?.state === 'normal' &&
    gateVolatility.atrPctRankBucket === 'extreme' &&
    gateVolatility.bbWidthRankBucket === 'high';
  const shortBullSwingStructureRisk =
    signalContext.signalDirection === 'SHORT' && swingBias === 'bull';
  const shortLowBollingerWidthRisk =
    signalContext.signalDirection === 'SHORT' &&
    bbWidthPct != null &&
    bbWidthPct <= SHORT_LOW_BB_WIDTH_PCT_MAX;
  const shortAsiaLongFlushLowCmcBreadthRisk =
    signalContext.signalDirection === 'SHORT' &&
    sessionPrimary === 'asia' &&
    derivativesPressure === 'long_flush' &&
    cmcFearGreedStale !== true &&
    marketBreadthStale !== true &&
    cmcFearGreedValue != null &&
    cmcFearGreedValue <= SHORT_ASIA_LONG_FLUSH_LOW_CMC_FEAR_GREED_MAX &&
    marketBreadthAdvancers != null &&
    marketBreadthAdvancers <= SHORT_ASIA_LONG_FLUSH_ADVANCERS_MAX;
  const lowRewardToVolatilityRisk =
    rewardToVolatility != null && rewardToVolatility < 0.25;
  const defensiveRewardToVolatilityRisk =
    rewardToVolatility != null &&
    rewardToVolatility >= 0.25 &&
    rewardToVolatility < 8;
  const bnbReferenceOiExpansionRisk =
    bnbReferenceOiChangePct4h != null &&
    bnbReferenceOiChangePct4h >= BNB_REFERENCE_OI_CHANGE_PCT_4H_RISK_MIN;
  const longBtcAltRegimeRisk =
    signalContext.signalDirection === 'LONG' &&
    btcAltRegimeStale !== true &&
    (btcAltRegime === 'btc_lead' || btcAltRegime === 'risk_off');
  const longBroadMarketShortFlushRisk =
    signalContext.signalDirection === 'LONG' &&
    derivativesPressure === 'short_flush' &&
    marketBreadthAdvancers != null &&
    marketBreadthAdvancers >= LONG_BROAD_MARKET_SHORT_FLUSH_ADVANCERS_MIN &&
    marketBreadthPctAboveMa20 != null &&
    marketBreadthPctAboveMa20 >=
      LONG_BROAD_MARKET_SHORT_FLUSH_PCT_ABOVE_MA20_MIN &&
    btcVsAltReturn24h != null &&
    btcVsAltReturn24h >=
      LONG_BROAD_MARKET_SHORT_FLUSH_BTC_VS_ALT_RETURN_24H_MIN;
  const cmcExchangeLiquidityVolumeChangeRisk =
    cmcExchangeLiquidityStale !== true &&
    cmcExchangeLiquidityVolumeChange24hPct != null &&
    ((cmcExchangeLiquidityVolumeChange24hPct > -0.1 &&
      cmcExchangeLiquidityVolumeChange24hPct < 0) ||
      (cmcExchangeLiquidityVolumeChange24hPct >= 0.1 &&
        cmcExchangeLiquidityVolumeChange24hPct < 0.3));

  if (deterministicQuality >= 5 && longRelativeStrengthOverextended) {
    deterministicQuality = 4;
    hardBlockReasons.push('long_relative_strength_overextended');
  }

  if (deterministicQuality >= 5 && longPriceUpOiDivergence) {
    deterministicQuality = 4;
    hardBlockReasons.push('long_price_up_oi_down');
  }

  if (deterministicQuality >= 5 && longLowerTailPriceUpOiDivergence) {
    deterministicQuality = 4;
    hardBlockReasons.push('long_lower_tail_price_up_oi_up');
  }

  if (deterministicQuality >= 5 && shortUsLongFlushRisk) {
    deterministicQuality = 4;
    hardBlockReasons.push('short_us_long_flush');
  }

  if (deterministicQuality >= 5 && shortFailedLowOiNotConfirming) {
    deterministicQuality = 4;
    hardBlockReasons.push('short_failed_low_oi_not_confirming');
  }

  if (deterministicQuality >= 5 && shortBelowLowOiFallingLongFlushRisk) {
    deterministicQuality = 4;
    hardBlockReasons.push('short_below_low_oi_falling_long_flush');
  }

  if (deterministicQuality >= 5 && shortNearPointOfControlRisk) {
    deterministicQuality = 4;
    hardBlockReasons.push('short_near_point_of_control');
  }

  if (deterministicQuality >= 5 && shortExtremeAtrHighBbRisk) {
    deterministicQuality = 4;
    hardBlockReasons.push('short_extreme_atr_high_bb');
  }

  if (deterministicQuality >= 5 && shortBullSwingStructureRisk) {
    deterministicQuality = 4;
    hardBlockReasons.push('short_bull_swing_structure');
  }

  if (deterministicQuality >= 5 && shortAsiaLongFlushLowCmcBreadthRisk) {
    deterministicQuality = 4;
    hardBlockReasons.push('short_asia_long_flush_low_cmc_breadth');
  }

  if (deterministicQuality >= 4 && lowRewardToVolatilityRisk) {
    deterministicQuality = 4;
    hardBlockReasons.push('low_reward_to_volatility');
  }

  if (deterministicQuality >= 4 && defensiveRewardToVolatilityRisk) {
    deterministicQuality = 4;
    hardBlockReasons.push('reward_to_volatility_below_defensive_threshold');
  }

  if (deterministicQuality >= 5 && bnbReferenceOiExpansionRisk) {
    deterministicQuality = 4;
    hardBlockReasons.push('bnb_reference_1h_oi4h_expansion_risk');
  }

  if (deterministicQuality >= 4 && longBtcAltRegimeRisk) {
    deterministicQuality = 4;
    hardBlockReasons.push('long_btc_alt_regime_risk');
  }

  if (deterministicQuality >= 5 && longBroadMarketShortFlushRisk) {
    deterministicQuality = 4;
    hardBlockReasons.push('long_broad_market_short_flush_risk');
  }

  if (deterministicQuality >= 4 && cmcExchangeLiquidityVolumeChangeRisk) {
    deterministicQuality = 4;
    hardBlockReasons.push('cmc_exchange_liquidity_volume_change_risk');
  }

  const trendShiftGateFeaturesRecoveryAllowedReasons = [
    'neutral_derivatives_pressure',
    'us_short_oi_not_expanding',
  ];
  const q4TrendShiftGateFeaturesRecoveryCandidate =
    deterministicQuality === 4 &&
    signalContext.confirmedFlip === true &&
    signalContext.flipDistanceOk === true &&
    trendShiftGateFeatures.relativeStrengthBucket === 'neutral' &&
    trendShiftGateFeatures.conflictCount === 2 &&
    trendShiftGateFeatures.mtfAlignment !== 'against' &&
    hardBlockReasons.length > 0 &&
    hardBlockReasons.every((reason) =>
      trendShiftGateFeaturesRecoveryAllowedReasons.includes(reason),
    );
  const q4UsClosingOiConfirmationRecoveryAllowedReasons = [
    'long_us_oi_not_confirming',
    'us_short_oi_not_expanding',
  ];
  const q4UsClosingOiConfirmationRecoveryCandidate =
    deterministicQuality === 4 &&
    signalContext.confirmedFlip === true &&
    signalContext.flipDistanceOk === true &&
    sessionPrimary === 'us' &&
    sessionWindowPhase === 'closing' &&
    hardBlockReasons.length > 0 &&
    hardBlockReasons.every((reason) =>
      q4UsClosingOiConfirmationRecoveryAllowedReasons.includes(reason),
    );
  const q4ShortBreadthShockLiquidationRecoveryCandidate =
    deterministicQuality === 4 &&
    signalContext.signalDirection === 'SHORT' &&
    signalContext.confirmedFlip === true &&
    signalContext.flipDistanceOk === true &&
    hardBlockReasons.length === 0 &&
    !derivativesDataUnavailableStressRisk &&
    marketBreadthReturn != null &&
    marketBreadthReturn <= SHORT_BREADTH_SHOCK_MARKET_BREADTH_RETURN_MAX &&
    derivatives1hLiqShort != null &&
    derivatives1hLiqShort <= SHORT_BREADTH_SHOCK_1H_LIQ_SHORT_MAX;
  const q4LongAltLeadershipRecoveryAllowedReasons = [
    'flat_or_mixed_oi',
    'neutral_derivatives_pressure',
    'oi_not_confirming',
    'long_us_oi_not_confirming',
    'long_asia_short_flush',
    'reward_to_volatility_below_defensive_threshold',
  ];
  const q4LongAltLeadershipRecoveryCandidate =
    deterministicQuality === 4 &&
    signalContext.signalDirection === 'LONG' &&
    signalContext.confirmedFlip === true &&
    signalContext.flipDistanceOk === true &&
    btcAltRegimeStale !== true &&
    cmcFearGreedStale !== true &&
    btcVsAltReturn24h != null &&
    btcVsAltReturn24h <= LONG_ALT_LEADERSHIP_BTC_VS_ALT_RETURN_24H_MAX &&
    btcVsAltReturn1h != null &&
    btcVsAltReturn1h <= LONG_ALT_LEADERSHIP_BTC_VS_ALT_RETURN_1H_MAX &&
    cmcFearGreedValueChange24h != null &&
    cmcFearGreedValueChange24h >=
      LONG_ALT_LEADERSHIP_FEAR_GREED_CHANGE_24H_MIN &&
    hardBlockReasons.length > 0 &&
    hardBlockReasons.every((reason) =>
      q4LongAltLeadershipRecoveryAllowedReasons.includes(reason),
    );

  if (
    q4TrendShiftGateFeaturesRecoveryCandidate ||
    q4UsClosingOiConfirmationRecoveryCandidate ||
    q4ShortBreadthShockLiquidationRecoveryCandidate ||
    q4LongAltLeadershipRecoveryCandidate
  ) {
    deterministicQuality = 5;
    hardBlockReasons.length = 0;
  }

  if (deterministicQuality >= 5 && shortLowBollingerWidthRisk) {
    deterministicQuality = 4;
    hardBlockReasons.push('short_low_bollinger_width');
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
    shortNeutralBearChannelBreakdownCandidate,
    selectiveNeutralQ4Candidate,
    longRelativeStrengthOverextended,
    longPriceUpOiDivergence,
    longLowerTailPriceUpOiDivergence,
    shortUsLongFlushRisk,
    shortFailedLowOiNotConfirming,
    shortBelowLowOiFallingLongFlushRisk,
    shortNearPointOfControlRisk,
    shortExtremeAtrHighBbRisk,
    shortBullSwingStructureRisk,
    shortLowBollingerWidthRisk,
    shortAsiaLongFlushLowCmcBreadthRisk,
    derivativesDataUnavailableStressRisk,
    lowRewardToVolatilityRisk,
    defensiveRewardToVolatilityRisk,
    bnbReferenceOiExpansionRisk,
    longBtcAltRegimeRisk,
    longBroadMarketShortFlushRisk,
    cmcExchangeLiquidityVolumeChangeRisk,
    q4TrendShiftGateFeaturesRecoveryCandidate,
    q4UsClosingOiConfirmationRecoveryCandidate,
    q4ShortBreadthShockLiquidationRecoveryCandidate,
    q4LongAltLeadershipRecoveryCandidate,
    breakoutState,
    swingBias,
    volumeRel20,
    atrPctZScore,
    bbWidthPct,
    adaptiveChannelDirection,
    liquidityTailSide,
    nearPointOfControl,
    relativeStrength1h,
    marketBreadthReturn,
    marketBreadthAdvancers,
    marketBreadthPctAboveMa20,
    btcVsAltReturn24h,
    btcVsAltReturn1h,
    cmcFearGreedValue,
    cmcFearGreedValueChange24h,
    derivatives1hLiqShort,
    bnbReferenceOiChangePct4h,
    btcAltRegime,
    cmcExchangeLiquidityVolumeChange24hPct,
    trendShiftGateFeatures,
    sessionPrimary,
    sessionWindowPhase,
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
    case 'long_lower_tail_price_up_oi_up':
      return 'the LONG flip is chasing a lower liquidity tail after price and open interest already expanded';
    case 'short_us_long_flush':
      return 'the US-session SHORT long-flush pocket has not been reliable enough for live approval';
    case 'short_failed_low_oi_not_confirming':
      return 'the SHORT failed-low-breakout setup lacks expanding open-interest confirmation';
    case 'short_below_low_oi_falling_long_flush':
      return 'the SHORT breakdown is a long-liquidation flush with falling open interest, so continuation confirmation is weak outside Asia';
    case 'short_near_point_of_control':
      return 'the SHORT flip is too close to the price-volume point of control, where continuation has been less reliable';
    case 'short_extreme_atr_high_bb':
      return 'the SHORT flip is in a normal-volatility regime but ATR is already extreme with a high Bollinger width, so keep it in watch mode';
    case 'short_bull_swing_structure':
      return 'the SHORT flip is still fighting a bullish swing structure, so keep it in watch mode';
    case 'short_low_bollinger_width':
      return 'the SHORT flip is in a narrow Bollinger-width compression pocket that has been less reliable, so keep it in watch mode';
    case 'short_asia_long_flush_low_cmc_breadth':
      return 'the SHORT flip is selling an Asia-session long flush while CMC fear/greed and market breadth are already in capitulation, so keep it in watch mode';
    case 'derivatives_data_unavailable_stress':
      return 'benchmark derivatives data is missing or stale during CMC stress, so keep the flip in watch mode instead of treating neutral derivatives as confirmation';
    case 'low_reward_to_volatility':
      return 'the expected reward is too small relative to current volatility after costs, so keep the flip in watch mode';
    case 'reward_to_volatility_below_defensive_threshold':
      return 'the expected reward is not large enough relative to current volatility for the defensive TrendShift gate after costs';
    case 'bnb_reference_1h_oi4h_expansion_risk':
      return 'BNB reference 1h open interest is expanding over 4h, a historically fragile cross-market state for TrendShift approvals';
    case 'long_btc_alt_regime_risk':
      return 'the LONG flip is fighting a BTC-led or risk-off alt regime, so keep it in watch mode';
    case 'long_broad_market_short_flush_risk':
      return 'the LONG flip is chasing a broad-market squeeze while BTC is leading alts and benchmark derivatives show a short flush, so keep it in watch mode';
    case 'cmc_exchange_liquidity_volume_change_risk':
      return 'major-exchange liquidity change is in a historically choppy CMC band, so keep the flip in watch mode';
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
