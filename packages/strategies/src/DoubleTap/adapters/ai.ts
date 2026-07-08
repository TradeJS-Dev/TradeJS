import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import {
  AiPayload,
  BaseStrategyContextSnapshot,
  StrategyAiAdapter,
} from '@tradejs/types';
import { DoubleTapConfig } from '../config';
import { DoubleTapSignalContext } from '../engine';

type Direction = 'LONG' | 'SHORT';

const MIN_EXECUTION_SCORE_FOR_AI_GATE = 35;
const MIN_LOW_TOUCH_COUNT20_FOR_AI_GATE = 1;
const HIGH_PRECISION_CMC_ALT_VOLUME_CHANGE_MAX = 0.5;
const Q4_CMC_BTC_DOMINANCE_CHANGE_MIN = -0.3;
const Q4_CMC_BTC_DOMINANCE_CHANGE_MAX = -0.05;
const Q4_ALT_DISPERSION_24H_MAX = 0.06;
const STRICT_MOMENTUM_ROC1D_MIN = -5.25;

type DoubleTapAiContext = Partial<DoubleTapSignalContext> & {
  baseContextAvailable: boolean;
  primarySession: string | null;
  sessionWindowPhase: string | null;
  trendBias: string | null;
  swingBias: string | null;
  breakoutState: string | null;
  barsSinceBreakout: number | null;
  lowTouchCount20: number | null;
  volumeRel20: number | null;
  benchmarkTrendAlignment: string | null;
  benchmarkBias: string | null;
  derivativesDirectionAligned: boolean | null;
  derivativesRiskFlags: string[];
  bodyStrength: number | null;
  roc1d: number | null;
  venueSpreadZScore: number | null;
  rewardToVolatility: number | null;
  executionScore: number | null;
  volumeStructureAligned: boolean | null;
  benchmarkConflict: boolean | null;
  cmcAltVolumeChange24hPct: number | null;
  cmcBtcDominanceChange24hPct: number | null;
  altDispersion24h: number | null;
  doubleTapGateFeatures: DoubleTapGateFeatures;
  structuralHardBlockReasons: string[];
  softBlockReasons: string[];
  strictMomentumBlockReasons: string[];
  deterministicQuality: number;
  approvalAllowedNow: boolean;
  strictMomentumApprovalAllowedNow: boolean;
  maxAllowedQuality: number;
};

type DoubleTapGateFeatures = {
  patternGeometry: 'invalid' | 'compact' | 'extended' | 'unknown';
  necklineBreakout:
    | 'missing'
    | 'early_noise'
    | 'compact'
    | 'confirmed'
    | 'extended';
  trendContext: 'aligned' | 'against' | 'neutral' | 'unknown';
  participationState: 'thin' | 'normal' | 'strong' | 'unknown';
  derivativesState: 'aligned' | 'crowded' | 'conflict' | 'neutral' | 'unknown';
  executionSpreadState: 'supportive' | 'neutral' | 'adverse' | 'unknown';
  approvalPocket:
    | 'high_precision'
    | 'high_precision_blocked'
    | 'q4'
    | 'q4_blocked'
    | 'watch';
  highQualityCadencePocket: boolean;
  defaultApprovalAllowed: boolean;
  q4AltDispersionOk: boolean | null;
  strictMomentumApproved: boolean;
  strictMomentumRoc1dOk: boolean | null;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value != null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asNumber = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const getDoubleTapContext = (payload: AiPayload) => {
  const additional = asRecord(payload.additionalIndicators);
  return ((additional?.doubleTapContext ?? {}) ||
    {}) as Partial<DoubleTapSignalContext>;
};

const getNestedRecord = (
  record: Record<string, unknown> | null,
  path: string[],
): Record<string, unknown> | null =>
  path.reduce<Record<string, unknown> | null>(
    (current, key) => asRecord(current?.[key]),
    record,
  );

const getNestedNumber = (
  record: Record<string, unknown> | null,
  path: string[],
): number | null =>
  asNumber(
    path.reduce<unknown>((current, key) => {
      return asRecord(current)?.[key];
    }, record),
  );

const getNestedString = (
  record: Record<string, unknown> | null,
  path: string[],
): string | null => {
  const value = path.reduce<unknown>((current, key) => {
    return asRecord(current)?.[key];
  }, record);
  return typeof value === 'string' && value.trim() ? value : null;
};

const getNestedBoolean = (
  record: Record<string, unknown> | null,
  path: string[],
): boolean | null => {
  const value = path.reduce<unknown>((current, key) => {
    return asRecord(current)?.[key];
  }, record);
  return typeof value === 'boolean' ? value : null;
};

const getStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === 'string' && entry.trim().length > 0,
      )
    : [];

const resolveGeometryQuality = (context: Partial<DoubleTapSignalContext>) => {
  const breakoutDistancePct = asNumber(context.breakoutDistancePct) ?? 999;
  const height = asNumber(context.height) ?? 0;
  if (height <= 0) {
    return 1;
  }
  if (breakoutDistancePct <= 0.8) {
    return 4;
  }
  if (breakoutDistancePct <= 1.4) {
    return 3;
  }
  if (breakoutDistancePct <= 2.5) {
    return 2;
  }
  return 1;
};

const isDirectionalCrowding = (
  direction: Direction | null,
  riskFlags: string[],
) =>
  direction === 'LONG'
    ? riskFlags.includes('crowded_long')
    : direction === 'SHORT'
      ? riskFlags.includes('crowded_short')
      : false;

const isBenchmarkAligned = ({
  direction,
  trendAlignment,
  benchmarkBias,
}: {
  direction: Direction | null;
  trendAlignment: string | null;
  benchmarkBias: string | null;
}) =>
  direction === 'LONG'
    ? trendAlignment === 'aligned_bull' || benchmarkBias === 'bull'
    : direction === 'SHORT'
      ? trendAlignment === 'aligned_bear' || benchmarkBias === 'bear'
      : false;

const buildDoubleTapGateFeatures = ({
  signalDirection,
  height,
  breakoutDistancePct,
  trendAligned,
  benchmarkAligned,
  volumeRel20,
  derivativesDirectionAligned,
  derivativesRiskFlags,
  venueSpreadZScore,
  directionalCrowding,
  approvalPocket,
  highPrecisionPocket,
  highPrecisionApprovalBlocked,
  q4ApprovalBlocked,
  defaultApprovalAllowed,
  q4AltDispersionOk,
  strictMomentumApproved,
  strictMomentumRoc1dOk,
}: {
  signalDirection: Direction | null;
  height: number | null;
  breakoutDistancePct: number | null;
  trendAligned: boolean;
  benchmarkAligned: boolean;
  volumeRel20: number | null;
  derivativesDirectionAligned: boolean | null;
  derivativesRiskFlags: string[];
  venueSpreadZScore: number | null;
  directionalCrowding: boolean;
  approvalPocket: boolean;
  highPrecisionPocket: boolean;
  highPrecisionApprovalBlocked: boolean;
  q4ApprovalBlocked: boolean;
  defaultApprovalAllowed: boolean;
  q4AltDispersionOk: boolean | null;
  strictMomentumApproved: boolean;
  strictMomentumRoc1dOk: boolean | null;
}): DoubleTapGateFeatures => {
  const patternGeometry =
    height == null
      ? 'unknown'
      : height <= 0
        ? 'invalid'
        : breakoutDistancePct != null && breakoutDistancePct <= 1.4
          ? 'compact'
          : 'extended';
  const necklineBreakout =
    breakoutDistancePct == null
      ? 'missing'
      : breakoutDistancePct <= 0.25
        ? 'early_noise'
        : breakoutDistancePct <= 0.8
          ? 'compact'
          : breakoutDistancePct <= 1.4
            ? 'confirmed'
            : 'extended';
  const trendContext =
    signalDirection == null
      ? 'unknown'
      : trendAligned || benchmarkAligned
        ? 'aligned'
        : 'neutral';
  const participationState =
    volumeRel20 == null
      ? 'unknown'
      : volumeRel20 < 0.8
        ? 'thin'
        : volumeRel20 >= 2
          ? 'strong'
          : 'normal';
  const derivativesState =
    derivativesDirectionAligned === true
      ? 'aligned'
      : derivativesDirectionAligned === false
        ? 'conflict'
        : directionalCrowding
          ? 'crowded'
          : derivativesRiskFlags.length > 0
            ? 'neutral'
            : 'unknown';
  const executionSpreadState =
    venueSpreadZScore == null
      ? 'unknown'
      : venueSpreadZScore >= 1
        ? 'supportive'
        : venueSpreadZScore <= -1
          ? 'adverse'
          : 'neutral';

  return {
    patternGeometry,
    necklineBreakout,
    trendContext,
    participationState,
    derivativesState,
    executionSpreadState,
    approvalPocket: highPrecisionPocket
      ? highPrecisionApprovalBlocked
        ? 'high_precision_blocked'
        : 'high_precision'
      : approvalPocket && q4ApprovalBlocked
        ? 'q4_blocked'
        : approvalPocket
          ? 'q4'
          : 'watch',
    highQualityCadencePocket: highPrecisionPocket,
    defaultApprovalAllowed,
    q4AltDispersionOk,
    strictMomentumApproved,
    strictMomentumRoc1dOk,
  };
};

const buildDoubleTapAiContext = (payload: AiPayload): DoubleTapAiContext => {
  const context = getDoubleTapContext(payload);
  const additional = asRecord(payload.additionalIndicators);
  const baseContext = asRecord(additional?.baseContext);
  const derivativesSummary = getNestedRecord(baseContext, [
    'derivatives',
    'summary',
  ]);
  const signalDirection =
    context.signalDirection === 'LONG' || context.signalDirection === 'SHORT'
      ? context.signalDirection
      : null;
  const breakoutDistancePct = asNumber(context.breakoutDistancePct);
  const height = asNumber(context.height);
  const baseContextAvailable = Boolean(baseContext);
  const primarySession = getNestedString(baseContext, [
    'regime',
    'session',
    'sessionPhase',
  ]);
  const sessionWindowPhase = getNestedString(baseContext, [
    'regime',
    'session',
    'sessionWindowPhase',
  ]);
  const trendBias = getNestedString(baseContext, ['regime', 'trend', 'bias']);
  const swingBias = getNestedString(baseContext, [
    'structure',
    'swing',
    'bias',
  ]);
  const breakoutState = getNestedString(baseContext, [
    'structure',
    'localRange',
    'breakoutState',
  ]);
  const barsSinceBreakout = getNestedNumber(baseContext, [
    'structure',
    'localRange',
    'barsSinceBreakout',
  ]);
  const lowTouchCount20 = getNestedNumber(baseContext, [
    'structure',
    'levels',
    'lowTouchCount20',
  ]);
  const volumeRel20 = getNestedNumber(baseContext, [
    'participation',
    'volume',
    'volumeRel20',
  ]);
  const benchmarkTrendAlignment = getNestedString(baseContext, [
    'relative',
    'benchmark',
    'trendAlignment',
  ]);
  const benchmarkBias = getNestedString(baseContext, [
    'relative',
    'benchmark',
    'bias',
  ]);
  const derivativesDirectionAligned =
    typeof derivativesSummary?.directionAligned === 'boolean'
      ? derivativesSummary.directionAligned
      : null;
  const derivativesRiskFlags = getStringArray(derivativesSummary?.riskFlags);
  const bodyStrength = getNestedNumber(baseContext, [
    'regime',
    'momentum',
    'bodyStrength',
  ]);
  const roc1d = getNestedNumber(baseContext, ['regime', 'momentum', 'roc1d']);
  const venueSpreadZScore = getNestedNumber(baseContext, [
    'relative',
    'execution',
    'venueSpreadZScore',
  ]);
  const rewardToVolatility = getNestedNumber(baseContext, [
    'gateFeatures',
    'setup',
    'rewardToVolatility',
  ]);
  const executionScore = getNestedNumber(baseContext, [
    'gateFeatures',
    'scores',
    'execution',
  ]);
  const volumeStructureAligned = getNestedBoolean(baseContext, [
    'gateFeatures',
    'participation',
    'volumeStructureAligned',
  ]);
  const benchmarkConflict = getNestedBoolean(baseContext, [
    'gateFeatures',
    'relative',
    'benchmarkConflict',
  ]);
  const cmcAltVolumeChange24hPct = getNestedNumber(baseContext, [
    'relative',
    'cmcGlobal',
    'altVolumeChange24hPct',
  ]);
  const cmcBtcDominanceChange24hPct = getNestedNumber(baseContext, [
    'relative',
    'cmcGlobal',
    'btcDominanceChange24hPct',
  ]);
  const altDispersion24h = getNestedNumber(baseContext, [
    'relative',
    'btcAltRegime',
    'altDispersion24h',
  ]);

  const structuralHardBlockReasons: string[] = [];
  if (!baseContextAvailable) {
    structuralHardBlockReasons.push('missing_base_context');
  }
  if ((height ?? 0) <= 0) {
    structuralHardBlockReasons.push('invalid_pattern_height');
  }
  if (breakoutDistancePct == null || breakoutDistancePct > 1.4) {
    structuralHardBlockReasons.push('extended_or_missing_breakout');
  }

  const geometryQuality = resolveGeometryQuality(context);
  const compactButNotTooEarly =
    breakoutDistancePct != null &&
    breakoutDistancePct > 0.35 &&
    breakoutDistancePct <= 0.8;
  const directionalCrowding = isDirectionalCrowding(
    signalDirection,
    derivativesRiskFlags,
  );
  const benchmarkAligned = isBenchmarkAligned({
    direction: signalDirection,
    trendAlignment: benchmarkTrendAlignment,
    benchmarkBias,
  });
  const trendAligned =
    signalDirection === 'LONG'
      ? trendBias === 'bull'
      : signalDirection === 'SHORT'
        ? trendBias === 'bear'
        : false;
  const breakoutAligned =
    signalDirection === 'LONG'
      ? breakoutState === 'above_high_level'
      : signalDirection === 'SHORT'
        ? breakoutState === 'below_low_level'
        : false;
  const legacyLongHighPrecisionShapeCandidate =
    signalDirection === 'LONG' &&
    breakoutDistancePct != null &&
    breakoutDistancePct > 0.5 &&
    breakoutDistancePct <= 1.4 &&
    primarySession !== 'us' &&
    volumeRel20 != null &&
    volumeRel20 > 2 &&
    barsSinceBreakout != null &&
    barsSinceBreakout <= 1;
  const legacyShortHighPrecisionShapeCandidate =
    signalDirection === 'SHORT' &&
    breakoutDistancePct != null &&
    breakoutDistancePct > 0.25 &&
    breakoutDistancePct <= 0.8 &&
    (primarySession === 'europe' || primarySession === 'off_hours') &&
    volumeRel20 != null &&
    volumeRel20 > 0.8 &&
    !directionalCrowding &&
    trendAligned;
  const legacyHighPrecisionShapeCandidate =
    legacyLongHighPrecisionShapeCandidate ||
    legacyShortHighPrecisionShapeCandidate;
  const legacyLongStructuralShapeCandidate =
    signalDirection === 'LONG' &&
    breakoutDistancePct != null &&
    breakoutDistancePct > 0.25 &&
    breakoutDistancePct <= 0.8 &&
    primarySession !== 'us' &&
    volumeRel20 != null &&
    volumeRel20 > 0.8 &&
    breakoutAligned;
  const legacyShortStructuralShapeCandidate =
    signalDirection === 'SHORT' &&
    compactButNotTooEarly &&
    !directionalCrowding &&
    (primarySession === 'europe' ||
      primarySession === 'off_hours' ||
      (volumeRel20 != null && volumeRel20 > 1.2) ||
      benchmarkAligned) &&
    (primarySession !== 'us' ||
      trendAligned ||
      (volumeRel20 != null && volumeRel20 > 2));
  const legacyStructuralShapeCandidate =
    legacyLongStructuralShapeCandidate || legacyShortStructuralShapeCandidate;
  const legacyShapeCandidate =
    baseContextAvailable &&
    (legacyStructuralShapeCandidate || legacyHighPrecisionShapeCandidate);
  const baseIndicatorCandidate =
    sessionWindowPhase === 'active' &&
    executionScore != null &&
    executionScore >= MIN_EXECUTION_SCORE_FOR_AI_GATE &&
    lowTouchCount20 != null &&
    lowTouchCount20 >= MIN_LOW_TOUCH_COUNT20_FOR_AI_GATE;
  const highPrecisionCmcApproval =
    legacyHighPrecisionShapeCandidate &&
    baseIndicatorCandidate &&
    volumeStructureAligned === true &&
    benchmarkConflict === false &&
    cmcAltVolumeChange24hPct != null &&
    cmcAltVolumeChange24hPct <= HIGH_PRECISION_CMC_ALT_VOLUME_CHANGE_MAX;
  const q4CmcApproval =
    legacyShapeCandidate &&
    !legacyHighPrecisionShapeCandidate &&
    baseIndicatorCandidate &&
    cmcBtcDominanceChange24hPct != null &&
    cmcBtcDominanceChange24hPct > Q4_CMC_BTC_DOMINANCE_CHANGE_MIN &&
    cmcBtcDominanceChange24hPct <= Q4_CMC_BTC_DOMINANCE_CHANGE_MAX &&
    altDispersion24h != null &&
    altDispersion24h < Q4_ALT_DISPERSION_24H_MAX;
  const softBlockReasons = [
    ...(legacyShapeCandidate && sessionWindowPhase !== 'active'
      ? ['inactive_session_window']
      : []),
    ...(legacyShapeCandidate &&
    (executionScore == null || executionScore < MIN_EXECUTION_SCORE_FOR_AI_GATE)
      ? ['low_or_missing_execution_score']
      : []),
    ...(legacyShapeCandidate &&
    (lowTouchCount20 == null ||
      lowTouchCount20 < MIN_LOW_TOUCH_COUNT20_FOR_AI_GATE)
      ? ['low_touch_count_below_gate']
      : []),
    ...(legacyHighPrecisionShapeCandidate && volumeStructureAligned !== true
      ? ['high_precision_volume_structure_not_aligned']
      : []),
    ...(legacyHighPrecisionShapeCandidate && benchmarkConflict !== false
      ? ['high_precision_benchmark_conflict_or_missing']
      : []),
    ...(legacyHighPrecisionShapeCandidate && cmcAltVolumeChange24hPct == null
      ? ['missing_cmc_alt_volume_change']
      : []),
    ...(legacyHighPrecisionShapeCandidate &&
    cmcAltVolumeChange24hPct != null &&
    cmcAltVolumeChange24hPct > HIGH_PRECISION_CMC_ALT_VOLUME_CHANGE_MAX
      ? ['cmc_alt_volume_change_too_hot']
      : []),
    ...(legacyShapeCandidate &&
    !legacyHighPrecisionShapeCandidate &&
    cmcBtcDominanceChange24hPct == null
      ? ['missing_cmc_btc_dominance_change']
      : []),
    ...(legacyShapeCandidate &&
    !legacyHighPrecisionShapeCandidate &&
    cmcBtcDominanceChange24hPct != null &&
    (cmcBtcDominanceChange24hPct <= Q4_CMC_BTC_DOMINANCE_CHANGE_MIN ||
      cmcBtcDominanceChange24hPct > Q4_CMC_BTC_DOMINANCE_CHANGE_MAX)
      ? ['cmc_btc_dominance_change_outside_band']
      : []),
    ...(legacyShapeCandidate &&
    !legacyHighPrecisionShapeCandidate &&
    cmcBtcDominanceChange24hPct != null &&
    cmcBtcDominanceChange24hPct > Q4_CMC_BTC_DOMINANCE_CHANGE_MIN &&
    cmcBtcDominanceChange24hPct <= Q4_CMC_BTC_DOMINANCE_CHANGE_MAX &&
    altDispersion24h == null
      ? ['missing_alt_dispersion_24h_for_q4']
      : []),
    ...(legacyShapeCandidate &&
    !legacyHighPrecisionShapeCandidate &&
    altDispersion24h != null &&
    altDispersion24h >= Q4_ALT_DISPERSION_24H_MAX
      ? ['alt_dispersion_24h_too_high_for_q4']
      : []),
  ];
  const highPrecisionApprovalBlocked =
    legacyHighPrecisionShapeCandidate && !highPrecisionCmcApproval;
  const q4ApprovalBlocked =
    legacyShapeCandidate &&
    !legacyHighPrecisionShapeCandidate &&
    !q4CmcApproval;
  const approvalBlocked = highPrecisionApprovalBlocked || q4ApprovalBlocked;
  const defaultApprovalAllowed =
    structuralHardBlockReasons.length === 0 &&
    (highPrecisionCmcApproval || q4CmcApproval) &&
    legacyShapeCandidate &&
    !approvalBlocked;
  const strictMomentumRoc1dOk =
    roc1d == null ? null : roc1d >= STRICT_MOMENTUM_ROC1D_MIN;
  const strictMomentumBlockReasons = [
    ...(defaultApprovalAllowed && roc1d == null
      ? ['missing_roc1d_for_strict_momentum']
      : []),
    ...(defaultApprovalAllowed &&
    roc1d != null &&
    roc1d < STRICT_MOMENTUM_ROC1D_MIN
      ? ['roc1d_below_strict_momentum_gate']
      : []),
  ];
  const strictMomentumApprovalAllowedNow =
    defaultApprovalAllowed && strictMomentumRoc1dOk === true;
  const doubleTapGateFeatures = buildDoubleTapGateFeatures({
    signalDirection,
    height,
    breakoutDistancePct,
    trendAligned,
    benchmarkAligned,
    volumeRel20,
    derivativesDirectionAligned,
    derivativesRiskFlags,
    venueSpreadZScore,
    directionalCrowding,
    approvalPocket: legacyShapeCandidate,
    highPrecisionPocket: legacyHighPrecisionShapeCandidate,
    highPrecisionApprovalBlocked,
    q4ApprovalBlocked,
    defaultApprovalAllowed,
    q4AltDispersionOk:
      altDispersion24h == null
        ? null
        : altDispersion24h < Q4_ALT_DISPERSION_24H_MAX,
    strictMomentumApproved: strictMomentumApprovalAllowedNow,
    strictMomentumRoc1dOk,
  });

  const deterministicQuality =
    structuralHardBlockReasons.length > 0
      ? Math.min(geometryQuality, 2)
      : highPrecisionCmcApproval
        ? 5
        : q4CmcApproval
          ? 4
          : Math.min(geometryQuality, 3);

  return {
    ...context,
    baseContextAvailable,
    primarySession,
    sessionWindowPhase,
    trendBias,
    swingBias,
    breakoutState,
    barsSinceBreakout,
    lowTouchCount20,
    volumeRel20,
    benchmarkTrendAlignment,
    benchmarkBias,
    derivativesDirectionAligned,
    derivativesRiskFlags,
    bodyStrength,
    roc1d,
    venueSpreadZScore,
    rewardToVolatility,
    executionScore,
    volumeStructureAligned,
    benchmarkConflict,
    cmcAltVolumeChange24hPct,
    cmcBtcDominanceChange24hPct,
    altDispersion24h,
    doubleTapGateFeatures,
    structuralHardBlockReasons,
    softBlockReasons,
    strictMomentumBlockReasons,
    deterministicQuality,
    approvalAllowedNow:
      deterministicQuality >= 4 && strictMomentumApprovalAllowedNow,
    strictMomentumApprovalAllowedNow,
    maxAllowedQuality: deterministicQuality,
  };
};

const withDoubleTapGateFeatures = ({
  baseContext,
  context,
}: {
  baseContext: BaseStrategyContextSnapshot | null;
  context: DoubleTapAiContext;
}) =>
  baseContext == null
    ? baseContext
    : {
        ...baseContext,
        doubleTapGateFeatures: context.doubleTapGateFeatures,
      };

export const doubleTapAiAdapter: StrategyAiAdapter = {
  buildPayload: ({ signal, basePayload }) => {
    const baseAdditional =
      (basePayload.additionalIndicators as
        | Record<string, unknown>
        | undefined) ?? {};
    const payload = {
      ...basePayload,
      additionalIndicators: {
        ...baseAdditional,
        doubleTapContext: (
          signal.additionalIndicators as Record<string, unknown> | undefined
        )?.doubleTapContext,
      },
    };
    const context = buildDoubleTapAiContext(payload);
    const baseContext = (baseAdditional.baseContext ??
      null) as BaseStrategyContextSnapshot | null;

    return {
      ...payload,
      additionalIndicators: {
        ...(payload.additionalIndicators as Record<string, unknown>),
        baseContext: withDoubleTapGateFeatures({
          baseContext,
          context,
        }),
        doubleTapContext: context,
      },
    };
  },
  postProcessAnalysis: ({ payload, analysis }) => {
    const context = buildDoubleTapAiContext(payload);
    const direction =
      analysis.direction === 'LONG' || analysis.direction === 'SHORT'
        ? analysis.direction
        : context.signalDirection;
    const quality = context.deterministicQuality;
    const approved = context.approvalAllowedNow && Boolean(direction);

    return {
      ...analysis,
      direction: approved ? direction ?? null : null,
      quality,
      qualityReason: approved
        ? analysis.qualityReason
        : 'DoubleTap breakout is not in a strict baseContext-supported approval pocket.',
    };
  },
  buildHumanPromptAddon: ({ payload }) => {
    const context = buildDoubleTapAiContext(payload);
    return `
Additional DoubleTap context:
- patternKind=${context.patternKind ?? 'n/a'}
- signalDirection=${context.signalDirection ?? 'n/a'}
- neckline=${String(context.neckline ?? 'n/a')}
- targetPrice=${String(context.targetPrice ?? 'n/a')}
- stopLossPrice=${String(context.stopLossPrice ?? 'n/a')}
- height=${String(context.height ?? 'n/a')}
- pivotTolerancePct=${String(context.pivotTolerancePct ?? 'n/a')}
- breakoutDistancePct=${String(context.breakoutDistancePct ?? 'n/a')}
- currentPrice=${String(context.currentPrice ?? 'n/a')}
- baseContextAvailable=${String(context.baseContextAvailable)}
- primarySession=${context.primarySession ?? 'n/a'}
- sessionWindowPhase=${context.sessionWindowPhase ?? 'n/a'}
- trendBias=${context.trendBias ?? 'n/a'}
- swingBias=${context.swingBias ?? 'n/a'}
- breakoutState=${context.breakoutState ?? 'n/a'}
- barsSinceBreakout=${String(context.barsSinceBreakout ?? 'n/a')}
- lowTouchCount20=${String(context.lowTouchCount20 ?? 'n/a')}
- volumeRel20=${String(context.volumeRel20 ?? 'n/a')}
- benchmarkTrendAlignment=${context.benchmarkTrendAlignment ?? 'n/a'}
- derivativesDirectionAligned=${String(context.derivativesDirectionAligned ?? 'n/a')}
- derivativesRiskFlags=${JSON.stringify(context.derivativesRiskFlags)}
- bodyStrength=${String(context.bodyStrength ?? 'n/a')}
- roc1d=${String(context.roc1d ?? 'n/a')}
- venueSpreadZScore=${String(context.venueSpreadZScore ?? 'n/a')}
- rewardToVolatility=${String(context.rewardToVolatility ?? 'n/a')}
- executionScore=${String(context.executionScore ?? 'n/a')}
- volumeStructureAligned=${String(context.volumeStructureAligned ?? 'n/a')}
- benchmarkConflict=${String(context.benchmarkConflict ?? 'n/a')}
- cmcAltVolumeChange24hPct=${String(context.cmcAltVolumeChange24hPct ?? 'n/a')}
- cmcBtcDominanceChange24hPct=${String(context.cmcBtcDominanceChange24hPct ?? 'n/a')}
- altDispersion24h=${String(context.altDispersion24h ?? 'n/a')}
- doubleTapGatePatternGeometry=${context.doubleTapGateFeatures.patternGeometry}
- doubleTapGateNecklineBreakout=${context.doubleTapGateFeatures.necklineBreakout}
- doubleTapGateTrendContext=${context.doubleTapGateFeatures.trendContext}
- doubleTapGateParticipationState=${context.doubleTapGateFeatures.participationState}
- doubleTapGateDerivativesState=${context.doubleTapGateFeatures.derivativesState}
- doubleTapGateExecutionSpreadState=${context.doubleTapGateFeatures.executionSpreadState}
- doubleTapGateApprovalPocket=${context.doubleTapGateFeatures.approvalPocket}
- doubleTapGateHighQualityCadencePocket=${String(context.doubleTapGateFeatures.highQualityCadencePocket)}
- doubleTapGateDefaultApprovalAllowed=${String(context.doubleTapGateFeatures.defaultApprovalAllowed)}
- doubleTapGateQ4AltDispersionOk=${String(context.doubleTapGateFeatures.q4AltDispersionOk ?? 'n/a')}
- doubleTapGateStrictMomentumApproved=${String(context.doubleTapGateFeatures.strictMomentumApproved)}
- doubleTapGateStrictMomentumRoc1dOk=${String(context.doubleTapGateFeatures.strictMomentumRoc1dOk ?? 'n/a')}
- deterministicQuality=${String(context.deterministicQuality)}
- approvalAllowedNow=${String(context.approvalAllowedNow)}
- strictMomentumApprovalAllowedNow=${String(context.strictMomentumApprovalAllowedNow)}
- structuralHardBlockReasons=${JSON.stringify(context.structuralHardBlockReasons)}
- softBlockReasons=${JSON.stringify(context.softBlockReasons)}
- strictMomentumBlockReasons=${JSON.stringify(context.strictMomentumBlockReasons)}
- pivots=${JSON.stringify(context.pivots ?? [])}

Interpretation rules for DoubleTap:
- This strategy enters only after a confirmed neckline break of a double bottom or double top.
- Prefer compact breaks close to the neckline; late/extended breaks should be downgraded.
- Extremely tiny breaks can still be early noise; live approval needs support from baseContext.
- Treat deterministicQuality and approvalAllowedNow as the normalized local gate result.
- Local q5 approval needs the high-precision pocket plus active session window, execution score >= 35, lowTouchCount20 >= 1, aligned volume structure, no benchmark conflict, and CMC alt volume change <= 0.5.
- Local q4 approval needs the structural approval pocket plus active session window, execution score >= 35, lowTouchCount20 >= 1, -0.3 < CMC BTC dominance change <= -0.05, and BTC/alt dispersion 24h < 0.06.
- Main local approval additionally needs strict momentum confirmation with ROC1D >= -5.25 on top of the local q4/q5 approval.
- A good long has two comparable lows and a clean close above the neckline.
- A good short has two comparable highs and a clean close below the neckline.
- Venue spread, trend bias, body strength, and reward-to-volatility are diagnostics for this gate, not strict local blockers.
`.trim();
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<
        DoubleTapConfig,
        'AI_ENABLED' | 'AI_MODE' | 'MIN_AI_QUALITY'
      >,
    ),
};
