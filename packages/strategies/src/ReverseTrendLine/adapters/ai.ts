import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import {
  AiPayload,
  BaseStrategyContextSnapshot,
  StrategyAiAdapter,
} from '@tradejs/types';
import { ReverseTrendLineConfig } from '../config';
import {
  buildReverseTrendlineStructuralContext,
  buildReverseTrendlineTimingContext,
  getTrendLineFromPayload,
} from '../guardrails';

const REVERSE_TRENDLINE_CONTEXT_PROMPT = `
ReverseTrendLine addon:
- This is a trendline bounce strategy, not a breakout strategy.
- For LONG on a support line (\`trendline.mode="lows"\`), you need a touch or false break of the line followed by a close back above it.
- For SHORT on a resistance line (\`trendline.mode="highs"\`), you need a touch or false break of the line followed by a close back below it.
- If price has already broken through the line with conviction in the opposite direction, this is not a bounce setup: use \`direction=null\` and \`quality <= 2\`.
- For bounce setups, prioritize candle reaction at the line, rejection wick quality, a close on the correct side, and next-bar follow-through.
- If \`payload.additionalIndicators.reverseTrendlineContext.failedBounceBreak=true\`, do not treat the signal as structurally confirmed.
- If \`payload.additionalIndicators.reverseTrendlineContext.entryTiming\` is not \`ready_rejection\` or \`ready_follow_through\`, quality is usually \`<= 3\`.
- Baseline deterministic approval for same-bar rejection is intentionally strict:
  - a strong conflict-only rejection may qualify for \`quality=4\`;
  - some same-bar rejections with \`conflictState=none\` or \`both\` may reach \`quality=4\` only with a very strong deterministic rejection score.
- For SHORT bounce setups with \`btc_bias_conflict\`, do not overstate quality; those cases usually stay in watch mode unless the structural confirmation is much stronger.
- If \`deterministicRejectionScore\` is low or medium, do not assign \`quality=4\` just because the candle visually resembles a rejection.
`;

const REVERSE_TRENDLINE_PAYLOAD_PROMPT = `
- \`payload.figures.trendline\` contains the line geometry.
- \`payload.additionalIndicators.reverseTrendlineContext\` contains a compact bounce summary: direction, price distance to the line, whether the line was touched, whether there was a rejection candle, rejection strength, timing stage, bias conflicts, and \`deterministicRejectionScore\`.
`;

type ReverseTimingContext = ReturnType<
  typeof buildReverseTrendlineTimingContext
>;
type ReverseStructuralContext = ReturnType<
  typeof buildReverseTrendlineStructuralContext
>;
type ReverseEntryTiming = ReverseTimingContext['entryTiming'];

type ReverseTrendlineAiContext = ReverseStructuralContext &
  ReverseTimingContext & {
    reverseTrendLineGateFeatures: ReverseTrendLineGateFeatures;
    deterministicQuality: number;
    deterministicRejectionScore: number | null;
    approvalAllowedNow: boolean;
    hardBlockReasons: string[];
    approvalBlockReasons: string[];
  };

type ReverseTrendlineQualityContext = ReverseStructuralContext &
  ReverseTimingContext & {
    hardBlockReasons: string[];
  };

type ReverseTrendLineGateFeatures = {
  bounceAcceptance:
    | 'failed_break'
    | 'rejection'
    | 'follow_through'
    | 'touch_wait'
    | 'stale'
    | 'unknown';
  rejectionStrength: 'weak' | 'confirmed' | 'elite' | 'unknown';
  biasAlignment:
    | 'aligned'
    | 'coin_conflict'
    | 'btc_conflict'
    | 'mixed'
    | 'unknown';
  baseContextState: 'clean' | 'blocked' | 'missing';
  participationState: 'thin' | 'normal' | 'strong' | 'unknown';
  volatilityState: 'normal' | 'elevated' | 'extreme' | 'unknown';
  rangePositionState: 'low' | 'middle' | 'high' | 'unknown';
  highQualityBouncePocket: boolean;
  extremeVolatilityRecoveryPocket: boolean;
  derivativesRecoveryPocket: boolean;
  approvalLane:
    | 'high_score_bounce'
    | 'extreme_volatility_recovery'
    | 'derivatives_recovery'
    | 'watch';
  deterministicRejectionScore: number | null;
};

const DERIVATIVES_RECOVERY_SOL_OI_1H_MIN = 0.35;
const DERIVATIVES_RECOVERY_SOL_OI_4H_MIN = 0.8;
const DERIVATIVES_RECOVERY_BTC_LIQ_TOTAL_MIN = 5;
const DERIVATIVES_RECOVERY_XRP_FUNDING_RATE_MIN = 0.0035;

const getReverseTrendlineBiasConflictState = (
  context: Pick<
    ReverseTrendlineQualityContext,
    'coinBiasAligned' | 'btcBiasAligned'
  >,
) => {
  const coinConflict = context.coinBiasAligned === false;
  const btcConflict = context.btcBiasAligned === false;

  if (coinConflict && btcConflict) {
    return 'both';
  }
  if (coinConflict) {
    return 'coin_only';
  }
  if (btcConflict) {
    return 'btc_only';
  }
  if (context.coinBiasAligned === true && context.btcBiasAligned === true) {
    return 'none';
  }

  return 'unknown';
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getNestedRecord = (
  value: unknown,
  path: string[],
): Record<string, unknown> | null => {
  let current = value;

  for (const segment of path) {
    if (!isRecord(current)) {
      return null;
    }
    current = current[segment];
  }

  return isRecord(current) ? current : null;
};

const getNestedNumber = (value: unknown, path: string[]) => {
  let current = value;

  for (const segment of path) {
    if (!isRecord(current)) {
      return null;
    }
    current = current[segment];
  }

  return typeof current === 'number' && Number.isFinite(current)
    ? current
    : null;
};

const getNestedString = (value: unknown, path: string[]) => {
  let current = value;

  for (const segment of path) {
    if (!isRecord(current)) {
      return null;
    }
    current = current[segment];
  }

  return typeof current === 'string' ? current : null;
};

const getNestedBoolean = (value: unknown, path: string[]) => {
  let current = value;

  for (const segment of path) {
    if (!isRecord(current)) {
      return null;
    }
    current = current[segment];
  }

  return typeof current === 'boolean' ? current : null;
};

const isShortBtcOnlyRecoveryLane = (
  context: ReverseTrendlineQualityContext & {
    deterministicRejectionScore: number | null;
  },
  baseContext: Record<string, unknown>,
) => {
  const riskFlags = getNestedRecord(baseContext, [
    'derivatives',
    'summary',
  ])?.riskFlags;
  const hasMissingDerivatives =
    Array.isArray(riskFlags) && riskFlags.includes('missing_derivatives');
  const derivativesPressure = getNestedString(baseContext, [
    'derivatives',
    'summary',
    'pressure',
  ]);
  const volumeRel20 = getNestedNumber(baseContext, [
    'participation',
    'volume',
    'volumeRel20',
  ]);
  const rangePosition20 = getNestedNumber(baseContext, [
    'structure',
    'localRange',
    'rangePosition20',
  ]);
  const biasConflictState = getReverseTrendlineBiasConflictState(context);

  return (
    context.signalDirection === 'SHORT' &&
    context.entryTiming === 'ready_rejection' &&
    biasConflictState === 'btc_only' &&
    context.deterministicRejectionScore != null &&
    context.deterministicRejectionScore >= 6 &&
    context.distance != null &&
    context.distance >= 61 &&
    !hasMissingDerivatives &&
    (derivativesPressure === 'long_flush' ||
      derivativesPressure === 'short_flush' ||
      derivativesPressure === 'crowded_long') &&
    volumeRel20 != null &&
    volumeRel20 >= 1.5 &&
    rangePosition20 != null &&
    rangePosition20 >= 0.2 &&
    rangePosition20 <= 0.7
  );
};

const hasMissingDerivativesRisk = (baseContext: Record<string, unknown>) => {
  const riskFlags = getNestedRecord(baseContext, [
    'derivatives',
    'summary',
  ])?.riskFlags;

  return Array.isArray(riskFlags) && riskFlags.includes('missing_derivatives');
};

const isExtremeVolatilityRecoveryLane = (
  context: Pick<ReverseTrendlineQualityContext, 'hardBlockReasons'>,
  baseContext: Record<string, unknown>,
) => {
  if (context.hardBlockReasons.length > 0) {
    return false;
  }

  const primaryIssue = getNestedString(baseContext, [
    'gateFeatures',
    'decisionHints',
    'primaryIssue',
  ]);
  const approveBias = getNestedString(baseContext, [
    'gateFeatures',
    'decisionHints',
    'approveBias',
  ]);
  const upCloseStreak = getNestedNumber(baseContext, [
    'regime',
    'momentum',
    'upCloseStreak',
  ]);
  const adaptiveChannelFlipUp = getNestedBoolean(baseContext, [
    'regime',
    'trend',
    'adaptiveChannel',
    'flipUp',
  ]);
  const atrPctRank100 = getNestedNumber(baseContext, [
    'regime',
    'volatility',
    'percentiles',
    'atrPctRank100',
  ]);

  return (
    primaryIssue === 'extreme_volatility' &&
    approveBias === 'reject' &&
    upCloseStreak != null &&
    upCloseStreak <= 2 &&
    adaptiveChannelFlipUp === false &&
    atrPctRank100 != null &&
    atrPctRank100 <= 99 &&
    !hasMissingDerivativesRisk(baseContext)
  );
};

const isDerivativesRecoveryLane = (
  context: Pick<ReverseTrendlineQualityContext, 'hardBlockReasons'> & {
    approvalBlockReasons: string[];
    deterministicRejectionScore: number | null;
  },
  baseContext: Record<string, unknown>,
) => {
  if (
    context.hardBlockReasons.length > 0 ||
    context.approvalBlockReasons.length > 0 ||
    context.deterministicRejectionScore == null ||
    context.deterministicRejectionScore < 4 ||
    hasMissingDerivativesRisk(baseContext)
  ) {
    return false;
  }

  const solOiChangePct1h = getNestedNumber(baseContext, [
    'derivatives',
    'referenceContexts',
    'SOLUSDT',
    'intervals',
    '15m',
    'oiChangePct1h',
  ]);
  const solOiChangePct4h = getNestedNumber(baseContext, [
    'derivatives',
    'referenceContexts',
    'SOLUSDT',
    'intervals',
    '15m',
    'oiChangePct4h',
  ]);
  const xrpFundingRate = getNestedNumber(baseContext, [
    'derivatives',
    'referenceContexts',
    'XRPUSDT',
    'intervals',
    '15m',
    'fundingRate',
  ]);
  const benchmarkLiqTotal = getNestedNumber(baseContext, [
    'derivatives',
    'intervals',
    '15m',
    'liqTotal',
  ]);

  const solXrpRecovery =
    solOiChangePct4h != null &&
    solOiChangePct4h >= DERIVATIVES_RECOVERY_SOL_OI_4H_MIN &&
    xrpFundingRate != null &&
    xrpFundingRate >= DERIVATIVES_RECOVERY_XRP_FUNDING_RATE_MIN;
  const solBenchmarkLiquidationRecovery =
    solOiChangePct1h != null &&
    solOiChangePct1h >= DERIVATIVES_RECOVERY_SOL_OI_1H_MIN &&
    benchmarkLiqTotal != null &&
    benchmarkLiqTotal >= DERIVATIVES_RECOVERY_BTC_LIQ_TOTAL_MIN;

  return solXrpRecovery || solBenchmarkLiquidationRecovery;
};

const getBaseContextQualityPromotion = (
  context: ReverseTrendlineQualityContext & {
    deterministicRejectionScore: number | null;
  },
  signal: Parameters<typeof buildReverseTrendlineAiContext>[0],
) => {
  const baseContext = isRecord(signal.additionalIndicators?.baseContext)
    ? signal.additionalIndicators.baseContext
    : null;
  if (!baseContext) {
    return null;
  }

  return isShortBtcOnlyRecoveryLane(context, baseContext) ||
    isExtremeVolatilityRecoveryLane(context, baseContext)
    ? 4
    : null;
};

const getBaseContextApprovalBlockReasons = (
  context: ReverseTrendlineQualityContext & {
    deterministicQuality: number;
    deterministicRejectionScore: number | null;
  },
  signal: Parameters<typeof buildReverseTrendlineAiContext>[0],
) => {
  const baseContext = isRecord(signal.additionalIndicators?.baseContext)
    ? signal.additionalIndicators.baseContext
    : null;
  if (!baseContext) {
    return [];
  }

  const hasMissingDerivatives = hasMissingDerivativesRisk(baseContext);
  const volumeRel20 = getNestedNumber(baseContext, [
    'participation',
    'volume',
    'volumeRel20',
  ]);
  const rangePosition20 = getNestedNumber(baseContext, [
    'structure',
    'localRange',
    'rangePosition20',
  ]);
  const activeLiquidityTails = getNestedNumber(baseContext, [
    'structure',
    'liquidityTails',
    'activeCount',
  ]);
  const atrPctZScore = getNestedNumber(baseContext, [
    'regime',
    'volatility',
    'atrPctZScore',
  ]);
  const benchmarkTrendAlignment = getNestedString(baseContext, [
    'relative',
    'benchmark',
    'trendAlignment',
  ]);
  const derivativesPressure = getNestedString(baseContext, [
    'derivatives',
    'summary',
    'pressure',
  ]);
  const biasConflictState = getReverseTrendlineBiasConflictState(context);
  const shortBtcOnlyRecoveryLane = isShortBtcOnlyRecoveryLane(
    context,
    baseContext,
  );
  const extremeVolatilityRecoveryLane = isExtremeVolatilityRecoveryLane(
    context,
    baseContext,
  );
  const reasons: string[] = [];

  if (hasMissingDerivatives) {
    reasons.push('missing_derivatives');
  }
  if (
    context.signalDirection === 'SHORT' &&
    derivativesPressure === 'crowded_short'
  ) {
    reasons.push('short_crowded_derivatives');
  }
  if (volumeRel20 != null && volumeRel20 < 0.8) {
    reasons.push('weak_volume_participation');
  }
  if (activeLiquidityTails != null && activeLiquidityTails > 4) {
    reasons.push('crowded_liquidity_tails');
  }
  if (
    context.signalDirection === 'SHORT' &&
    derivativesPressure === 'neutral' &&
    volumeRel20 != null &&
    volumeRel20 < 0.85
  ) {
    reasons.push('short_neutral_thin_participation');
  }
  if (
    context.signalDirection === 'SHORT' &&
    biasConflictState === 'btc_only' &&
    context.distance != null &&
    context.distance <= 60
  ) {
    reasons.push('short_btc_conflict_too_shallow');
  }
  if (
    context.signalDirection === 'SHORT' &&
    atrPctZScore != null &&
    atrPctZScore >= 2 &&
    !shortBtcOnlyRecoveryLane &&
    !extremeVolatilityRecoveryLane
  ) {
    reasons.push('short_extreme_volatility');
  }
  if (
    context.signalDirection === 'SHORT' &&
    rangePosition20 != null &&
    rangePosition20 < 0.2
  ) {
    reasons.push('short_low_range_position');
  }
  if (
    context.signalDirection === 'LONG' &&
    benchmarkTrendAlignment === 'against_benchmark'
  ) {
    reasons.push('long_against_benchmark');
  }
  if (
    context.signalDirection === 'LONG' &&
    context.distance != null &&
    context.distance > 150 &&
    context.distance <= 250
  ) {
    reasons.push('long_weak_mid_distance');
  }
  if (
    context.signalDirection === 'SHORT' &&
    context.entryTiming === 'ready_follow_through' &&
    biasConflictState === 'none' &&
    context.deterministicQuality >= 5
  ) {
    reasons.push('short_follow_through_overrated');
  }

  return reasons;
};

const buildReverseTrendLineGateFeatures = ({
  context,
  signal,
  approvalBlockReasons,
  deterministicRejectionScore,
  approvalLane,
  extremeVolatilityRecoveryPocket,
  derivativesRecoveryPocket,
}: {
  context: ReverseTrendlineQualityContext & { deterministicQuality: number };
  signal: Parameters<typeof buildReverseTrendlineAiContext>[0];
  approvalBlockReasons: string[];
  deterministicRejectionScore: number | null;
  approvalLane: ReverseTrendLineGateFeatures['approvalLane'];
  extremeVolatilityRecoveryPocket: boolean;
  derivativesRecoveryPocket: boolean;
}): ReverseTrendLineGateFeatures => {
  const baseContext = isRecord(signal.additionalIndicators?.baseContext)
    ? signal.additionalIndicators.baseContext
    : null;
  const volumeRel20 = getNestedNumber(baseContext, [
    'participation',
    'volume',
    'volumeRel20',
  ]);
  const rangePosition20 = getNestedNumber(baseContext, [
    'structure',
    'localRange',
    'rangePosition20',
  ]);
  const atrPctZScore = getNestedNumber(baseContext, [
    'regime',
    'volatility',
    'atrPctZScore',
  ]);
  const biasConflictState = getReverseTrendlineBiasConflictState(context);
  const bounceAcceptance =
    context.failedBounceBreak === true
      ? 'failed_break'
      : context.entryTiming === 'ready_follow_through'
        ? 'follow_through'
        : context.entryTiming === 'ready_rejection'
          ? 'rejection'
          : context.entryTiming === 'wait_touch' ||
              context.entryTiming === 'wait_reaction_confirmation'
            ? 'touch_wait'
            : context.entryTiming === 'stale_reaction'
              ? 'stale'
              : 'unknown';
  const rejectionStrength =
    deterministicRejectionScore == null
      ? 'unknown'
      : deterministicRejectionScore >= 7
        ? 'elite'
        : deterministicRejectionScore >= 4
          ? 'confirmed'
          : 'weak';
  const biasAlignment =
    biasConflictState === 'none'
      ? 'aligned'
      : biasConflictState === 'coin_only'
        ? 'coin_conflict'
        : biasConflictState === 'btc_only'
          ? 'btc_conflict'
          : biasConflictState === 'both'
            ? 'mixed'
            : 'unknown';
  const participationState =
    volumeRel20 == null
      ? 'unknown'
      : volumeRel20 < 0.8
        ? 'thin'
        : volumeRel20 >= 1.5
          ? 'strong'
          : 'normal';
  const volatilityState =
    atrPctZScore == null
      ? 'unknown'
      : atrPctZScore >= 2
        ? 'extreme'
        : atrPctZScore >= 1
          ? 'elevated'
          : 'normal';
  const rangePositionState =
    rangePosition20 == null
      ? 'unknown'
      : rangePosition20 < 0.2
        ? 'low'
        : rangePosition20 > 0.8
          ? 'high'
          : 'middle';

  return {
    bounceAcceptance,
    rejectionStrength,
    biasAlignment,
    baseContextState:
      baseContext == null
        ? 'missing'
        : approvalBlockReasons.length > 0
          ? 'blocked'
          : 'clean',
    participationState,
    volatilityState,
    rangePositionState,
    highQualityBouncePocket:
      context.deterministicQuality >= 4 &&
      approvalBlockReasons.length === 0 &&
      (bounceAcceptance === 'rejection' ||
        bounceAcceptance === 'follow_through'),
    extremeVolatilityRecoveryPocket,
    derivativesRecoveryPocket,
    approvalLane,
    deterministicRejectionScore,
  };
};

const getDeterministicReverseTrendlineQuality = (
  context: ReverseTrendlineQualityContext,
) => {
  if (context.hardBlockReasons.length > 0) {
    return 2;
  }

  if (
    context.entryTiming !== 'ready_rejection' &&
    context.entryTiming !== 'ready_follow_through'
  ) {
    return 3;
  }

  const rejectionStrengthPct = context.rejectionStrengthPct ?? 0;
  const rejectionWickPct = context.rejectionWickPct ?? 0;
  const touches = context.touches ?? 0;
  const distance = context.distance ?? Number.POSITIVE_INFINITY;
  const biasConflictState = getReverseTrendlineBiasConflictState(context);
  const noConflict = biasConflictState === 'none';
  const conflictOnly =
    biasConflictState === 'coin_only' || biasConflictState === 'btc_only';

  const quality5 =
    context.entryTiming === 'ready_follow_through' &&
    noConflict &&
    rejectionStrengthPct >= 0.25 &&
    rejectionWickPct >= 0.18 &&
    touches >= 4 &&
    distance < 500;

  if (quality5) {
    return 5;
  }

  const quality4FollowThrough =
    context.entryTiming === 'ready_follow_through' &&
    noConflict &&
    rejectionStrengthPct >= 0.22 &&
    rejectionWickPct >= 0.18 &&
    touches >= 4;

  if (quality4FollowThrough) {
    return 4;
  }

  const quality4ConflictRejection =
    context.entryTiming === 'ready_rejection' &&
    conflictOnly &&
    rejectionStrengthPct >= 0.45 &&
    touches >= 5 &&
    !(
      context.signalDirection === 'SHORT' &&
      biasConflictState === 'coin_only' &&
      distance <= 180 &&
      rejectionWickPct <= 0.45
    ) &&
    !(context.signalDirection === 'SHORT' && biasConflictState === 'btc_only');

  if (quality4ConflictRejection) {
    return 4;
  }

  const rejectionScore =
    getDeterministicReverseTrendlineRejectionScore(context);
  const quality4EliteShortBtcOnlyRejection =
    context.entryTiming === 'ready_rejection' &&
    context.signalDirection === 'SHORT' &&
    biasConflictState === 'btc_only' &&
    rejectionScore != null &&
    rejectionScore >= 5 &&
    rejectionWickPct >= 0.6 &&
    touches >= 5 &&
    distance <= 200;

  if (quality4EliteShortBtcOnlyRejection) {
    return 4;
  }

  const quality4ScoredRejection =
    context.entryTiming === 'ready_rejection' &&
    (biasConflictState === 'none' || biasConflictState === 'both') &&
    rejectionScore != null &&
    rejectionScore >= 7 &&
    !(
      context.signalDirection === 'SHORT' &&
      biasConflictState === 'none' &&
      distance <= 150 &&
      (rejectionWickPct >= 0.7 || rejectionStrengthPct >= 1.3)
    );

  if (quality4ScoredRejection) {
    return 4;
  }

  const quality4EliteAlignedRejection =
    context.entryTiming === 'ready_rejection' &&
    noConflict &&
    rejectionStrengthPct >= 0.9 &&
    rejectionWickPct >= 0.15 &&
    touches >= 5 &&
    distance <= 250;

  return quality4EliteAlignedRejection ? 4 : 3;
};

const getDeterministicReverseTrendlineRejectionScore = (
  context: ReverseTrendlineQualityContext,
) => {
  if (context.entryTiming !== 'ready_rejection') {
    return null;
  }

  const biasConflictState = getReverseTrendlineBiasConflictState(context);
  const rejectionStrengthPct = context.rejectionStrengthPct ?? 0;
  const rejectionWickPct = context.rejectionWickPct ?? 0;
  const touches = context.touches ?? 0;
  const distance = context.distance ?? Number.POSITIVE_INFINITY;

  let score = 0;

  if (rejectionStrengthPct >= 0.25) {
    score += 1;
  }
  if (rejectionStrengthPct >= 0.6) {
    score += 1;
  }
  if (rejectionWickPct >= 0.18) {
    score += 1;
  }
  if (touches >= 4) {
    score += 1;
  }
  if (distance <= 250) {
    score += 1;
  }

  if (context.signalDirection === 'LONG') {
    if (biasConflictState === 'both') {
      score += 1;
    }
    if (rejectionWickPct >= 0.75) {
      score += 1;
    }
  }

  if (context.signalDirection === 'SHORT') {
    if (biasConflictState === 'none') {
      score += 1;
    }
    if (distance <= 150) {
      score += 1;
    }
  }

  return score;
};

const buildReverseTrendlineAiContext = (signal: {
  direction?: unknown;
  prices?: { currentPrice?: unknown };
  indicators?: Record<string, unknown>;
  additionalIndicators?: Record<string, unknown>;
  figures?: Record<string, unknown>;
}): ReverseTrendlineAiContext => {
  const structural = buildReverseTrendlineStructuralContext(signal);
  const computedTiming = buildReverseTrendlineTimingContext({ signal });
  const timingFromSignal =
    typeof signal.additionalIndicators?.reverseTrendlineTiming === 'object' &&
    signal.additionalIndicators?.reverseTrendlineTiming &&
    typeof (
      signal.additionalIndicators.reverseTrendlineTiming as {
        entryTiming?: unknown;
      }
    ).entryTiming === 'string'
      ? (signal.additionalIndicators.reverseTrendlineTiming as {
          entryTiming: ReverseEntryTiming;
        })
      : null;
  const timing = timingFromSignal
    ? {
        ...computedTiming,
        ...timingFromSignal,
        entryReadyNow:
          timingFromSignal.entryTiming === 'ready_rejection' ||
          timingFromSignal.entryTiming === 'ready_follow_through',
      }
    : computedTiming;

  const hardBlockReasons = [...structural.structuralHardBlockReasons];
  const deterministicRejectionScore =
    getDeterministicReverseTrendlineRejectionScore({
      ...structural,
      ...timing,
      hardBlockReasons,
    });

  const deterministicQuality = getDeterministicReverseTrendlineQuality({
    ...structural,
    ...timing,
    hardBlockReasons,
  });
  const baseContextQualityPromotion = getBaseContextQualityPromotion(
    {
      ...structural,
      ...timing,
      hardBlockReasons,
      deterministicRejectionScore,
    },
    signal,
  );
  const promotedDeterministicQuality =
    baseContextQualityPromotion == null
      ? deterministicQuality
      : Math.max(deterministicQuality, baseContextQualityPromotion);
  const approvalBlockReasons = getBaseContextApprovalBlockReasons(
    {
      ...structural,
      ...timing,
      hardBlockReasons,
      deterministicQuality: promotedDeterministicQuality,
      deterministicRejectionScore,
    },
    signal,
  );
  const baseContext = isRecord(signal.additionalIndicators?.baseContext)
    ? signal.additionalIndicators.baseContext
    : null;
  const extremeVolatilityRecoveryPocket =
    baseContext != null
      ? isExtremeVolatilityRecoveryLane(
          {
            hardBlockReasons,
          },
          baseContext,
        )
      : false;
  const derivativesRecoveryPocket =
    baseContext != null
      ? isDerivativesRecoveryLane(
          {
            hardBlockReasons,
            approvalBlockReasons,
            deterministicRejectionScore,
          },
          baseContext,
        )
      : false;
  const baseReverseTrendLineGateFeatures = buildReverseTrendLineGateFeatures({
    context: {
      ...structural,
      ...timing,
      hardBlockReasons,
      deterministicQuality: promotedDeterministicQuality,
    },
    signal,
    approvalBlockReasons,
    deterministicRejectionScore,
    approvalLane: 'watch',
    extremeVolatilityRecoveryPocket,
    derivativesRecoveryPocket,
  });
  const highScoreBouncePocket =
    baseReverseTrendLineGateFeatures.highQualityBouncePocket &&
    deterministicRejectionScore != null &&
    deterministicRejectionScore >= 7;
  const approvalLane: ReverseTrendLineGateFeatures['approvalLane'] =
    highScoreBouncePocket
      ? 'high_score_bounce'
      : extremeVolatilityRecoveryPocket
        ? 'extreme_volatility_recovery'
        : derivativesRecoveryPocket
          ? 'derivatives_recovery'
          : 'watch';
  const approvalAllowedNow = approvalLane !== 'watch';
  const finalApprovalBlockReasons =
    !approvalAllowedNow &&
    promotedDeterministicQuality >= 4 &&
    approvalBlockReasons.length === 0
      ? [...approvalBlockReasons, 'rejection_score_below_gate']
      : approvalBlockReasons;
  const finalDeterministicQuality = approvalAllowedNow
    ? Math.max(promotedDeterministicQuality, 4)
    : promotedDeterministicQuality;
  const reverseTrendLineGateFeatures = {
    ...baseReverseTrendLineGateFeatures,
    approvalLane,
  };

  return {
    ...structural,
    ...timing,
    reverseTrendLineGateFeatures,
    deterministicQuality: finalDeterministicQuality,
    deterministicRejectionScore,
    approvalAllowedNow,
    hardBlockReasons,
    approvalBlockReasons: finalApprovalBlockReasons,
  };
};

const withReverseTrendLineGateFeatures = ({
  baseContext,
  context,
}: {
  baseContext: BaseStrategyContextSnapshot | null;
  context: ReverseTrendlineAiContext;
}) =>
  baseContext == null
    ? baseContext
    : ({
        ...(baseContext as unknown as Record<string, unknown>),
        reverseTrendLineGateFeatures: context.reverseTrendLineGateFeatures,
      } as BaseStrategyContextSnapshot & {
        reverseTrendLineGateFeatures: ReverseTrendLineGateFeatures;
      });

const getReverseTrendlineContextFromPayload = (
  payload: AiPayload,
  signal: Parameters<typeof buildReverseTrendlineAiContext>[0],
) => {
  const additional = payload.additionalIndicators as
    | Record<string, unknown>
    | undefined;
  const fromPayload = additional?.reverseTrendlineContext as
    | ReverseTrendlineAiContext
    | undefined;

  return fromPayload ?? buildReverseTrendlineAiContext(signal);
};

const getHardBlockReasonText = (reason: string) => {
  switch (reason) {
    case 'failed_bounce_break':
      return 'price broke through the line against the intended bounce';
    case 'coin_bias_conflict':
      return 'coin bias conflicts with the bounce direction';
    case 'btc_bias_conflict':
      return 'BTC context conflicts with the bounce direction';
    case 'missing_derivatives':
      return 'derivatives context is missing';
    case 'weak_volume_participation':
      return 'volume participation is too weak for this bounce';
    case 'crowded_liquidity_tails':
      return 'too many active liquidity-tail traps around the bounce';
    case 'short_neutral_thin_participation':
      return 'SHORT bounce has neutral derivatives and thin participation';
    case 'short_btc_conflict_too_shallow':
      return 'SHORT btc-conflict bounce is too shallow near the line';
    case 'short_extreme_volatility':
      return 'SHORT bounce appears in an extreme volatility regime';
    case 'short_low_range_position':
      return 'SHORT bounce starts too low in the local range';
    case 'short_crowded_derivatives':
      return 'SHORT bounce is too crowded on derivatives positioning';
    case 'long_against_benchmark':
      return 'LONG bounce is weak while the coin underperforms the benchmark';
    case 'long_weak_mid_distance':
      return 'LONG bounce distance sits in a weak mid-distance pocket';
    case 'short_follow_through_overrated':
      return 'SHORT follow-through bounce is not reliable enough for quality 5';
    case 'rejection_score_below_gate':
      return 'deterministic rejection score is below the current strict gate';
    default:
      return reason;
  }
};

export const reverseTrendLineAiAdapter: StrategyAiAdapter = {
  buildPayload: ({ signal, basePayload }) => {
    const baseAdditional =
      (basePayload.additionalIndicators as
        | Record<string, unknown>
        | undefined) ?? {};
    const context = buildReverseTrendlineAiContext({
      ...signal,
      additionalIndicators: {
        ...((signal.additionalIndicators as Record<string, unknown>) ?? {}),
        ...baseAdditional,
      },
    });
    const baseContext = (baseAdditional.baseContext ??
      null) as BaseStrategyContextSnapshot | null;

    return {
      ...basePayload,
      figures: {
        ...basePayload.figures,
        trendline: getTrendLineFromPayload(signal),
      },
      additionalIndicators: {
        ...baseAdditional,
        baseContext: withReverseTrendLineGateFeatures({
          baseContext,
          context,
        }),
        reverseTrendlineContext: context,
      } satisfies AiPayload['additionalIndicators'],
    };
  },
  postProcessAnalysis: ({ signal, payload, analysis }) => {
    const context = getReverseTrendlineContextFromPayload(payload, signal);
    const signalDirection =
      signal.direction === 'LONG' || signal.direction === 'SHORT'
        ? signal.direction
        : null;

    if (context.approvalAllowedNow === true && signalDirection != null) {
      return {
        ...analysis,
        direction: signalDirection,
        quality: context.deterministicQuality,
        needRetest: false,
        retestPrice: null,
        takeProfitPrice:
          analysis.takeProfitPrice ?? signal.prices?.takeProfitPrice ?? null,
        stopLossPrice:
          analysis.stopLossPrice ?? signal.prices?.stopLossPrice ?? null,
      };
    }

    return {
      ...analysis,
      direction: null,
      quality: context.deterministicQuality,
      needRetest: true,
      retestPrice: context.currentLinePrice ?? null,
      takeProfitPrice: null,
      stopLossPrice: null,
      qualityReason:
        context.hardBlockReasons.length > 0
          ? `ReverseTrendLine guardrail: ${context.hardBlockReasons
              .map(getHardBlockReasonText)
              .join('; ')}.`
          : context.approvalBlockReasons.length > 0
            ? `ReverseTrendLine base-context filter: ${context.approvalBlockReasons
                .map(getHardBlockReasonText)
                .join('; ')}.`
            : 'ReverseTrendLine deterministic quality requires either a strong conflict-only rejection or a confirmed aligned follow-through for a bounce.',
      triggerInvalidation:
        context.hardBlockReasons.length > 0
          ? `Wait for a new bounce setup: ${context.hardBlockReasons
              .map(getHardBlockReasonText)
              .join('; ')}.`
          : context.approvalBlockReasons.length > 0
            ? `Wait for a cleaner bounce context: ${context.approvalBlockReasons
                .map(getHardBlockReasonText)
                .join('; ')}.`
            : 'Wait for a line touch, a rejection candle, and a close held on the correct side of the line.',
      comment:
        context.hardBlockReasons.length > 0
          ? `ReverseTrendLine guardrail blocked the entry: ${context.hardBlockReasons
              .map(getHardBlockReasonText)
              .join('; ')}.`
          : context.approvalBlockReasons.length > 0
            ? `ReverseTrendLine base-context filter blocked the entry: ${context.approvalBlockReasons
                .map(getHardBlockReasonText)
                .join('; ')}.`
            : 'ReverseTrendLine keeps the setup in watch mode until the bounce is confirmed.',
    };
  },
  buildSystemPromptAddon: () =>
    `${REVERSE_TRENDLINE_CONTEXT_PROMPT}\n${REVERSE_TRENDLINE_PAYLOAD_PROMPT}`,
  buildHumanPromptAddon: ({ signal, payload }) => {
    const context = getReverseTrendlineContextFromPayload(payload, signal);
    return `

Additional ReverseTrendLine context:
- entryTiming=${context.entryTiming}
- lineTouchedNow=${context.lineTouchedNow}
- closeOnBounceSide=${context.closeOnBounceSide}
- failedBounceBreak=${context.failedBounceBreak}
- rejectionWickPct=${context.rejectionWickPct?.toFixed?.(3) ?? 'n/a'}%
- rejectionStrengthPct=${context.rejectionStrengthPct?.toFixed?.(3) ?? 'n/a'}%
- touches=${context.touches ?? 'n/a'}
- distance=${context.distance ?? 'n/a'}
- coinBiasAligned=${context.coinBiasAligned}
- btcBiasAligned=${context.btcBiasAligned}
- deterministicRejectionScore=${context.deterministicRejectionScore ?? 'n/a'}
- reverseTrendLineGateBounceAcceptance=${context.reverseTrendLineGateFeatures.bounceAcceptance}
- reverseTrendLineGateRejectionStrength=${context.reverseTrendLineGateFeatures.rejectionStrength}
- reverseTrendLineGateBiasAlignment=${context.reverseTrendLineGateFeatures.biasAlignment}
- reverseTrendLineGateBaseContextState=${context.reverseTrendLineGateFeatures.baseContextState}
- reverseTrendLineGateParticipationState=${context.reverseTrendLineGateFeatures.participationState}
- reverseTrendLineGateVolatilityState=${context.reverseTrendLineGateFeatures.volatilityState}
- reverseTrendLineGateRangePositionState=${context.reverseTrendLineGateFeatures.rangePositionState}
- reverseTrendLineGateHighQualityBouncePocket=${String(context.reverseTrendLineGateFeatures.highQualityBouncePocket)}
- reverseTrendLineGateExtremeVolatilityRecoveryPocket=${String(context.reverseTrendLineGateFeatures.extremeVolatilityRecoveryPocket)}
- reverseTrendLineGateDerivativesRecoveryPocket=${String(context.reverseTrendLineGateFeatures.derivativesRecoveryPocket)}
- reverseTrendLineGateApprovalLane=${context.reverseTrendLineGateFeatures.approvalLane}
- approvalAllowedNow=${context.approvalAllowedNow}
- hardBlockReasons=${context.hardBlockReasons.join(', ') || 'none'}
- approvalBlockReasons=${context.approvalBlockReasons.join(', ') || 'none'}

Interpretation rules for ReverseTrendLine:
- look for structural confirmation of a reaction from the line, not a breakout through the line;
- if \`failedBounceBreak=true\` is already present, do not treat the signal as confirmed;
- if the setup is still in \`wait_touch\`, \`wait_reaction_confirmation\`, or \`stale_reaction\`, do not overstate quality;
- if \`deterministicRejectionScore\` is high, use it only as an extra signal together with the proper bounce context, not as a replacement for structure.
`;
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<
        ReverseTrendLineConfig,
        'AI_ENABLED' | 'AI_MODE' | 'MIN_AI_QUALITY'
      >,
    ),
};
