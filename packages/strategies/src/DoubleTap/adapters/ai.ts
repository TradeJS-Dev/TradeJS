import { intervalToMs } from '@tradejs/core/data';
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
const Q4_DERIVATIVES_BTC_VS_ALT_RETURN_24H_MAX = -0.009;
const Q4_DERIVATIVES_ETH_CROWDING_PERSISTENCE_MIN = 140;
const Q4_DERIVATIVES_SOL_FUNDING_Z_SCORE_15M_MAX = 0.2;
const Q4_DERIVATIVES_BAD_BTC_VS_ALT_RETURN_24H_MAX = -0.014;
const Q4_DERIVATIVES_BAD_CMC20_TO_CMC100_CHANGE_24H_MAX = -0.0007;
const BNB_OI_ROTATION_CHANGE_24H_15M_MIN = 0.65;
const BNB_OI_ROTATION_CHANGE_1H_1H_MAX = -0.28;
const XRP_OI_SHORT_NO_HTF_CHANGE_1H_15M_MIN = 0.32;
const STRICT_MOMENTUM_ROC1D_MIN = -5.25;
const PROTECTIVE_RELATIVE_STRENGTH_4H_MAX = 7.77009;
const PROTECTIVE_CMC_EXCHANGE_LIQUIDITY_CHANGE_24H_MIN = -0.378662;
const PROTECTIVE_BNB_REFERENCE_PRESSURE_BLOCK = 'crowded_long';

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
  benchmarkRelativeStrength4h: number | null;
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
  cmcExchangeLiquidityVolumeChange24hPct: number | null;
  cmcBtcDominanceChange24hPct: number | null;
  cmc20ToCmc100RatioChange24hPct: number | null;
  btcVsAltReturn24h: number | null;
  ethCrowdingPersistenceBars: number | null;
  solFundingZScore15m: number | null;
  bnbOiChangePct24h15m: number | null;
  bnbOiChangePct1h1h: number | null;
  bnbReferencePressure: string | null;
  xrpOiChangePct1h15m: number | null;
  higherTimeframeConflict: boolean | null;
  altDispersion24h: number | null;
  q4DerivativesDirectionSessionOk: boolean | null;
  doubleTapGateFeatures: DoubleTapGateFeatures;
  structuralHardBlockReasons: string[];
  softBlockReasons: string[];
  strictMomentumBlockReasons: string[];
  deterministicQuality: number;
  approvalAllowedNow: boolean;
  protectiveApprovalContextAvailable: boolean;
  protectiveApprovalContextOk: boolean;
  strictMomentumApprovalAllowedNow: boolean;
  maxAllowedQuality: number;
};

type DoubleTapGateFeatures = {
  geometry: DoubleTapGeometryFeatures;
  path: DoubleTapPathFeatures;
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
    | 'bnb_oi_rotation'
    | 'bnb_oi_rotation_blocked'
    | 'xrp_oi_short_no_htf'
    | 'xrp_oi_short_no_htf_blocked'
    | 'high_precision'
    | 'high_precision_blocked'
    | 'q4_derivatives'
    | 'q4_derivatives_blocked'
    | 'q4'
    | 'q4_blocked'
    | 'watch';
  highQualityCadencePocket: boolean;
  defaultApprovalAllowed: boolean;
  q4AltDispersionOk: boolean | null;
  q4DerivativesPocket: boolean;
  q4DerivativesCmcRiskOk: boolean | null;
  q4DerivativesDirectionSessionOk: boolean | null;
  bnbOiRotationPocket: boolean;
  bnbOiRotationContextAvailable: boolean;
  bnbOiRotationMomentumOk: boolean;
  xrpOiShortNoHtfPocket: boolean;
  xrpOiShortNoHtfContextAvailable: boolean;
  strictMomentumApproved: boolean;
  strictMomentumRoc1dOk: boolean | null;
  protectiveApprovalContextAvailable: boolean;
  protectiveApprovalContextOk: boolean;
};

type DoubleTapGeometryFeatures = {
  patternHeightPct: number | null;
  breakoutDistanceHeightRatio: number | null;
  tapPriceDeviationPct: number | null;
  tapDeviationHeightRatio: number | null;
  stopDistanceHeightRatio: number | null;
  targetDistanceHeightRatio: number | null;
};

type DoubleTapPathFeatures = {
  leadInBars: number | null;
  firstLegBars: number | null;
  secondLegBars: number | null;
  tapSpacingBars: number | null;
  breakoutLagBars: number | null;
  legDurationSymmetryRatio: number | null;
  firstLegSlopePctPerBar: number | null;
  secondLegSlopePctPerBar: number | null;
  legSlopeSymmetryRatio: number | null;
  breakoutSpeedHeightRatioPerBar: number | null;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value != null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
};

const divideFinite = (
  numerator: number | null,
  denominator: number | null,
): number | null =>
  numerator != null &&
  denominator != null &&
  Number.isFinite(numerator) &&
  Number.isFinite(denominator) &&
  Math.abs(denominator) > Number.EPSILON
    ? numerator / Math.abs(denominator)
    : null;

const resolveIntervalMs = (interval: unknown): number | null => {
  if (typeof interval !== 'string' || interval.length === 0) {
    return null;
  }
  try {
    const value = intervalToMs(interval as AiPayload['signal']['interval']);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
};

const resolveElapsedBars = ({
  from,
  to,
  intervalMs,
}: {
  from: number | null;
  to: number | null;
  intervalMs: number | null;
}): number | null => {
  if (from == null || to == null || intervalMs == null || to < from) {
    return null;
  }
  const bars = (to - from) / intervalMs;
  return Number.isFinite(bars) ? bars : null;
};

const resolveSlopePctPerBar = ({
  fromValue,
  toValue,
  bars,
}: {
  fromValue: number | null;
  toValue: number | null;
  bars: number | null;
}): number | null => {
  if (
    fromValue == null ||
    toValue == null ||
    bars == null ||
    bars <= 0 ||
    Math.abs(fromValue) <= Number.EPSILON
  ) {
    return null;
  }
  return (Math.abs(toValue - fromValue) / Math.abs(fromValue) / bars) * 100;
};

export const buildDoubleTapSetupFeatures = ({
  context,
  interval,
  signalTimestamp,
}: {
  context: Partial<DoubleTapSignalContext>;
  interval: unknown;
  signalTimestamp: unknown;
}): {
  geometry: DoubleTapGeometryFeatures;
  path: DoubleTapPathFeatures;
} => {
  const pivots = Array.isArray(context.pivots) ? context.pivots : [];
  const readPivotNumber = (index: number, key: 'timestamp' | 'value') =>
    asNumber(asRecord(pivots[index])?.[key]);
  const p1Timestamp = readPivotNumber(0, 'timestamp');
  const p2Timestamp = readPivotNumber(1, 'timestamp');
  const p3Timestamp = readPivotNumber(2, 'timestamp');
  const p4Timestamp = readPivotNumber(3, 'timestamp');
  const p2Value = readPivotNumber(1, 'value');
  const p3Value = readPivotNumber(2, 'value');
  const p4Value = readPivotNumber(3, 'value');
  const intervalMs = resolveIntervalMs(interval);
  const leadInBars = resolveElapsedBars({
    from: p1Timestamp,
    to: p2Timestamp,
    intervalMs,
  });
  const firstLegBars = resolveElapsedBars({
    from: p2Timestamp,
    to: p3Timestamp,
    intervalMs,
  });
  const secondLegBars = resolveElapsedBars({
    from: p3Timestamp,
    to: p4Timestamp,
    intervalMs,
  });
  const tapSpacingBars = resolveElapsedBars({
    from: p2Timestamp,
    to: p4Timestamp,
    intervalMs,
  });
  const breakoutLagBars = resolveElapsedBars({
    from: p4Timestamp,
    to: asNumber(signalTimestamp),
    intervalMs,
  });
  const heightValue = asNumber(context.height);
  const height = heightValue == null ? null : Math.abs(heightValue);
  const neckline = asNumber(context.neckline);
  const currentPrice = asNumber(context.currentPrice);
  const stopLossPrice = asNumber(context.stopLossPrice);
  const targetPrice = asNumber(context.targetPrice);
  const breakoutDistance =
    currentPrice == null || neckline == null
      ? null
      : Math.abs(currentPrice - neckline);
  const breakoutDistanceHeightRatio = divideFinite(breakoutDistance, height);
  const tapPriceDeviation =
    p2Value == null || p4Value == null ? null : Math.abs(p2Value - p4Value);
  const averageTapPrice =
    p2Value == null || p4Value == null
      ? null
      : (Math.abs(p2Value) + Math.abs(p4Value)) / 2;
  const patternHeightPriceRatio = divideFinite(height, neckline);
  const tapPriceDeviationRatio = divideFinite(
    tapPriceDeviation,
    averageTapPrice,
  );
  const firstLegSlopePctPerBar = resolveSlopePctPerBar({
    fromValue: p2Value,
    toValue: p3Value,
    bars: firstLegBars,
  });
  const secondLegSlopePctPerBar = resolveSlopePctPerBar({
    fromValue: p3Value,
    toValue: p4Value,
    bars: secondLegBars,
  });

  return {
    geometry: {
      patternHeightPct:
        patternHeightPriceRatio == null ? null : patternHeightPriceRatio * 100,
      breakoutDistanceHeightRatio,
      tapPriceDeviationPct:
        tapPriceDeviationRatio == null ? null : tapPriceDeviationRatio * 100,
      tapDeviationHeightRatio: divideFinite(tapPriceDeviation, height),
      stopDistanceHeightRatio:
        currentPrice == null || stopLossPrice == null
          ? null
          : divideFinite(Math.abs(currentPrice - stopLossPrice), height),
      targetDistanceHeightRatio:
        currentPrice == null || targetPrice == null
          ? null
          : divideFinite(Math.abs(targetPrice - currentPrice), height),
    },
    path: {
      leadInBars,
      firstLegBars,
      secondLegBars,
      tapSpacingBars,
      breakoutLagBars,
      legDurationSymmetryRatio:
        firstLegBars == null || secondLegBars == null
          ? null
          : divideFinite(
              Math.min(firstLegBars, secondLegBars),
              Math.max(firstLegBars, secondLegBars),
            ),
      firstLegSlopePctPerBar,
      secondLegSlopePctPerBar,
      legSlopeSymmetryRatio:
        firstLegSlopePctPerBar == null || secondLegSlopePctPerBar == null
          ? null
          : divideFinite(
              Math.min(firstLegSlopePctPerBar, secondLegSlopePctPerBar),
              Math.max(firstLegSlopePctPerBar, secondLegSlopePctPerBar),
            ),
      breakoutSpeedHeightRatioPerBar:
        breakoutDistanceHeightRatio == null || breakoutLagBars == null
          ? null
          : breakoutDistanceHeightRatio / Math.max(1, breakoutLagBars),
    },
  };
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
  setupFeatures,
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
  bnbOiRotationPocket,
  bnbOiRotationBlocked,
  xrpOiShortNoHtfPocket,
  xrpOiShortNoHtfBlocked,
  highPrecisionPocket,
  highPrecisionApprovalBlocked,
  q4DerivativesPocket,
  q4DerivativesApprovalBlocked,
  q4ApprovalBlocked,
  defaultApprovalAllowed,
  q4AltDispersionOk,
  q4DerivativesCmcRiskOk,
  q4DerivativesDirectionSessionOk,
  bnbOiRotationContextAvailable,
  bnbOiRotationMomentumOk,
  xrpOiShortNoHtfContextAvailable,
  strictMomentumApproved,
  strictMomentumRoc1dOk,
  protectiveApprovalContextAvailable,
  protectiveApprovalContextOk,
}: {
  setupFeatures: ReturnType<typeof buildDoubleTapSetupFeatures>;
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
  bnbOiRotationPocket: boolean;
  bnbOiRotationBlocked: boolean;
  xrpOiShortNoHtfPocket: boolean;
  xrpOiShortNoHtfBlocked: boolean;
  highPrecisionPocket: boolean;
  highPrecisionApprovalBlocked: boolean;
  q4DerivativesPocket: boolean;
  q4DerivativesApprovalBlocked: boolean;
  q4ApprovalBlocked: boolean;
  defaultApprovalAllowed: boolean;
  q4AltDispersionOk: boolean | null;
  q4DerivativesCmcRiskOk: boolean | null;
  q4DerivativesDirectionSessionOk: boolean | null;
  bnbOiRotationContextAvailable: boolean;
  bnbOiRotationMomentumOk: boolean;
  xrpOiShortNoHtfContextAvailable: boolean;
  strictMomentumApproved: boolean;
  strictMomentumRoc1dOk: boolean | null;
  protectiveApprovalContextAvailable: boolean;
  protectiveApprovalContextOk: boolean;
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
    ...setupFeatures,
    patternGeometry,
    necklineBreakout,
    trendContext,
    participationState,
    derivativesState,
    executionSpreadState,
    approvalPocket: bnbOiRotationMomentumOk
      ? bnbOiRotationBlocked
        ? 'bnb_oi_rotation_blocked'
        : 'bnb_oi_rotation'
      : xrpOiShortNoHtfPocket
        ? xrpOiShortNoHtfBlocked
          ? 'xrp_oi_short_no_htf_blocked'
          : 'xrp_oi_short_no_htf'
        : bnbOiRotationPocket
          ? bnbOiRotationBlocked
            ? 'bnb_oi_rotation_blocked'
            : 'bnb_oi_rotation'
          : highPrecisionPocket
            ? highPrecisionApprovalBlocked
              ? 'high_precision_blocked'
              : 'high_precision'
            : q4DerivativesPocket
              ? q4DerivativesApprovalBlocked
                ? 'q4_derivatives_blocked'
                : 'q4_derivatives'
              : approvalPocket && q4ApprovalBlocked
                ? 'q4_blocked'
                : approvalPocket
                  ? 'q4'
                  : 'watch',
    highQualityCadencePocket:
      (bnbOiRotationMomentumOk && !bnbOiRotationBlocked) ||
      (xrpOiShortNoHtfPocket && !xrpOiShortNoHtfBlocked),
    defaultApprovalAllowed,
    q4AltDispersionOk,
    q4DerivativesPocket,
    q4DerivativesCmcRiskOk,
    q4DerivativesDirectionSessionOk,
    bnbOiRotationPocket,
    bnbOiRotationContextAvailable,
    bnbOiRotationMomentumOk,
    xrpOiShortNoHtfPocket,
    xrpOiShortNoHtfContextAvailable,
    strictMomentumApproved,
    strictMomentumRoc1dOk,
    protectiveApprovalContextAvailable,
    protectiveApprovalContextOk,
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
  const benchmarkRelativeStrength4h = getNestedNumber(baseContext, [
    'relative',
    'benchmark',
    'relativeStrength4h',
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
  const cmcExchangeLiquidityVolumeChange24hPct =
    getNestedNumber(baseContext, [
      'gateFeatures',
      'relative',
      'cmcExchangeLiquidityVolumeChange24hPct',
    ]) ??
    getNestedNumber(baseContext, [
      'relative',
      'cmcExchangeLiquidity',
      'totalVolumeChange24hPct',
    ]);
  const cmcBtcDominanceChange24hPct = getNestedNumber(baseContext, [
    'relative',
    'cmcGlobal',
    'btcDominanceChange24hPct',
  ]);
  const cmc20ToCmc100RatioChange24hPct =
    getNestedNumber(baseContext, [
      'relative',
      'cmcIndexes',
      'cmc20ToCmc100RatioChange24hPct',
    ]) ??
    getNestedNumber(baseContext, [
      'gateFeatures',
      'relative',
      'cmc20ToCmc100RatioChange24hPct',
    ]);
  const btcVsAltReturn24h =
    getNestedNumber(baseContext, [
      'relative',
      'btcAltRegime',
      'btcVsAltReturn24h',
    ]) ??
    getNestedNumber(baseContext, [
      'gateFeatures',
      'relative',
      'btcVsAltReturn24h',
    ]);
  const ethCrowdingPersistenceBars = getNestedNumber(baseContext, [
    'derivatives',
    'referenceContexts',
    'ETHUSDT',
    'summary',
    'crowdingPersistenceBars',
  ]);
  const solFundingZScore15m = getNestedNumber(baseContext, [
    'derivatives',
    'referenceContexts',
    'SOLUSDT',
    'intervals',
    '15m',
    'fundingZScore',
  ]);
  const bnbOiChangePct24h15m = getNestedNumber(baseContext, [
    'derivatives',
    'referenceContexts',
    'BNBUSDT',
    'intervals',
    '15m',
    'oiChangePct24h',
  ]);
  const bnbOiChangePct1h1h = getNestedNumber(baseContext, [
    'derivatives',
    'referenceContexts',
    'BNBUSDT',
    'intervals',
    '1h',
    'oiChangePct1h',
  ]);
  const bnbReferencePressure = getNestedString(baseContext, [
    'derivatives',
    'referenceContexts',
    'BNBUSDT',
    'summary',
    'pressure',
  ]);
  const xrpOiChangePct1h15m = getNestedNumber(baseContext, [
    'derivatives',
    'referenceContexts',
    'XRPUSDT',
    'intervals',
    '15m',
    'oiChangePct1h',
  ]);
  const higherTimeframeConflict = getNestedBoolean(baseContext, [
    'gateFeatures',
    'mtf',
    'higherTimeframeConflict',
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
  const q4CmcApproval =
    legacyShapeCandidate &&
    !legacyHighPrecisionShapeCandidate &&
    baseIndicatorCandidate &&
    cmcBtcDominanceChange24hPct != null &&
    cmcBtcDominanceChange24hPct > Q4_CMC_BTC_DOMINANCE_CHANGE_MIN &&
    cmcBtcDominanceChange24hPct <= Q4_CMC_BTC_DOMINANCE_CHANGE_MAX &&
    altDispersion24h != null &&
    altDispersion24h < Q4_ALT_DISPERSION_24H_MAX;
  const q4DerivativesBadCmcPocket =
    btcVsAltReturn24h != null &&
    cmc20ToCmc100RatioChange24hPct != null &&
    btcVsAltReturn24h <= Q4_DERIVATIVES_BAD_BTC_VS_ALT_RETURN_24H_MAX &&
    cmc20ToCmc100RatioChange24hPct <=
      Q4_DERIVATIVES_BAD_CMC20_TO_CMC100_CHANGE_24H_MAX;
  const q4DerivativesPocket =
    baseContextAvailable &&
    btcVsAltReturn24h != null &&
    ethCrowdingPersistenceBars != null &&
    solFundingZScore15m != null &&
    btcVsAltReturn24h <= Q4_DERIVATIVES_BTC_VS_ALT_RETURN_24H_MAX &&
    ethCrowdingPersistenceBars >= Q4_DERIVATIVES_ETH_CROWDING_PERSISTENCE_MIN &&
    solFundingZScore15m <= Q4_DERIVATIVES_SOL_FUNDING_Z_SCORE_15M_MAX;
  const q4DerivativesDirectionSessionOk = q4DerivativesPocket
    ? signalDirection === 'LONG'
      ? primarySession === 'europe'
      : signalDirection === 'SHORT'
        ? true
        : false
    : null;
  const bnbOiRotationContextAvailable =
    bnbOiChangePct24h15m != null && bnbOiChangePct1h1h != null;
  const bnbOiRotationPocket =
    baseContextAvailable &&
    bnbOiChangePct24h15m != null &&
    bnbOiChangePct1h1h != null &&
    bnbOiChangePct24h15m >= BNB_OI_ROTATION_CHANGE_24H_15M_MIN &&
    bnbOiChangePct1h1h <= BNB_OI_ROTATION_CHANGE_1H_1H_MAX;
  const strictMomentumRoc1dOk =
    roc1d == null ? null : roc1d >= STRICT_MOMENTUM_ROC1D_MIN;
  const bnbOiRotationMomentumOk =
    bnbOiRotationPocket && strictMomentumRoc1dOk === true;
  const xrpOiShortNoHtfContextAvailable =
    xrpOiChangePct1h15m != null && higherTimeframeConflict != null;
  const xrpOiShortNoHtfPocket =
    baseContextAvailable &&
    signalDirection === 'SHORT' &&
    xrpOiChangePct1h15m != null &&
    xrpOiChangePct1h15m >= XRP_OI_SHORT_NO_HTF_CHANGE_1H_15M_MIN &&
    higherTimeframeConflict === false;
  const protectiveApprovalContextAvailable =
    benchmarkRelativeStrength4h != null &&
    cmcExchangeLiquidityVolumeChange24hPct != null &&
    bnbReferencePressure != null;
  const protectiveApprovalContextOk =
    benchmarkRelativeStrength4h != null &&
    benchmarkRelativeStrength4h <= PROTECTIVE_RELATIVE_STRENGTH_4H_MAX &&
    cmcExchangeLiquidityVolumeChange24hPct != null &&
    cmcExchangeLiquidityVolumeChange24hPct >=
      PROTECTIVE_CMC_EXCHANGE_LIQUIDITY_CHANGE_24H_MIN &&
    bnbReferencePressure != null &&
    bnbReferencePressure !== PROTECTIVE_BNB_REFERENCE_PRESSURE_BLOCK;
  const approvalSourceAllowed =
    bnbOiRotationMomentumOk || xrpOiShortNoHtfPocket;
  const xrpOiShortNoHtfMissingContext =
    !bnbOiRotationMomentumOk &&
    signalDirection === 'SHORT' &&
    !xrpOiShortNoHtfContextAvailable;
  const bnbOiRotationMissingContext =
    !xrpOiShortNoHtfPocket && !bnbOiRotationContextAvailable;
  const bnbOiRotationOutsideGate =
    !xrpOiShortNoHtfPocket &&
    bnbOiRotationContextAvailable &&
    !bnbOiRotationPocket;
  const softBlockReasons = [
    ...(bnbOiRotationMissingContext ? ['missing_bnb_oi_rotation_context'] : []),
    ...(bnbOiRotationOutsideGate ? ['bnb_oi_rotation_outside_gate'] : []),
    ...(bnbOiRotationPocket && strictMomentumRoc1dOk === false
      ? ['bnb_oi_rotation_roc1d_below_gate']
      : []),
    ...(bnbOiRotationPocket && strictMomentumRoc1dOk == null
      ? ['missing_roc1d_for_bnb_oi_rotation']
      : []),
    ...(xrpOiShortNoHtfMissingContext
      ? ['missing_xrp_oi_short_no_htf_context']
      : []),
    ...(xrpOiChangePct1h15m != null &&
    xrpOiChangePct1h15m < XRP_OI_SHORT_NO_HTF_CHANGE_1H_15M_MIN
      ? ['xrp_oi_short_no_htf_outside_gate']
      : []),
    ...(xrpOiChangePct1h15m != null &&
    xrpOiChangePct1h15m >= XRP_OI_SHORT_NO_HTF_CHANGE_1H_15M_MIN &&
    signalDirection !== 'SHORT'
      ? ['xrp_oi_short_no_htf_requires_short_signal']
      : []),
    ...(xrpOiChangePct1h15m != null &&
    xrpOiChangePct1h15m >= XRP_OI_SHORT_NO_HTF_CHANGE_1H_15M_MIN &&
    signalDirection === 'SHORT' &&
    higherTimeframeConflict !== false
      ? ['xrp_oi_short_no_htf_higher_timeframe_conflict']
      : []),
    ...(approvalSourceAllowed && benchmarkRelativeStrength4h == null
      ? ['missing_relative_strength_4h_for_protective_gate']
      : []),
    ...(approvalSourceAllowed &&
    benchmarkRelativeStrength4h != null &&
    benchmarkRelativeStrength4h > PROTECTIVE_RELATIVE_STRENGTH_4H_MAX
      ? ['relative_strength_4h_above_protective_gate']
      : []),
    ...(approvalSourceAllowed && cmcExchangeLiquidityVolumeChange24hPct == null
      ? ['missing_cmc_exchange_liquidity_change_for_protective_gate']
      : []),
    ...(approvalSourceAllowed &&
    cmcExchangeLiquidityVolumeChange24hPct != null &&
    cmcExchangeLiquidityVolumeChange24hPct <
      PROTECTIVE_CMC_EXCHANGE_LIQUIDITY_CHANGE_24H_MIN
      ? ['cmc_exchange_liquidity_change_below_protective_gate']
      : []),
    ...(approvalSourceAllowed && bnbReferencePressure == null
      ? ['missing_bnb_reference_pressure_for_protective_gate']
      : []),
    ...(approvalSourceAllowed &&
    bnbReferencePressure === PROTECTIVE_BNB_REFERENCE_PRESSURE_BLOCK
      ? ['bnb_reference_pressure_crowded_long_protective_gate']
      : []),
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
    ...(q4CmcApproval ? ['legacy_q4_structural_observation_only'] : []),
    ...(q4DerivativesPocket &&
    signalDirection === 'LONG' &&
    q4DerivativesDirectionSessionOk === false
      ? ['long_q4_derivatives_outside_europe_session']
      : []),
    ...(q4DerivativesPocket && signalDirection == null
      ? ['missing_signal_direction_for_q4_derivatives']
      : []),
  ];
  const highPrecisionApprovalBlocked =
    legacyHighPrecisionShapeCandidate &&
    !bnbOiRotationMomentumOk &&
    !xrpOiShortNoHtfPocket;
  const q4DerivativesApprovalBlocked =
    q4DerivativesPocket && !bnbOiRotationMomentumOk && !xrpOiShortNoHtfPocket;
  const q4ApprovalBlocked =
    legacyShapeCandidate &&
    !legacyHighPrecisionShapeCandidate &&
    !bnbOiRotationMomentumOk &&
    !xrpOiShortNoHtfPocket;
  const protectiveApprovalBlocked =
    approvalSourceAllowed && !protectiveApprovalContextOk;
  const approvalBlocked =
    !approvalSourceAllowed &&
    (highPrecisionApprovalBlocked ||
      q4ApprovalBlocked ||
      q4DerivativesApprovalBlocked);
  const defaultApprovalAllowed =
    structuralHardBlockReasons.length === 0 &&
    approvalSourceAllowed &&
    protectiveApprovalContextOk &&
    !approvalBlocked;
  const bnbOiRotationBlocked =
    bnbOiRotationPocket &&
    (structuralHardBlockReasons.length > 0 ||
      !bnbOiRotationMomentumOk ||
      protectiveApprovalBlocked);
  const xrpOiShortNoHtfBlocked =
    xrpOiShortNoHtfPocket &&
    (structuralHardBlockReasons.length > 0 || protectiveApprovalBlocked);
  const strictMomentumBlockReasons: string[] = [];
  const strictMomentumApprovalAllowedNow =
    bnbOiRotationMomentumOk &&
    structuralHardBlockReasons.length === 0 &&
    protectiveApprovalContextOk &&
    strictMomentumRoc1dOk === true;
  const approvalAllowedNow = defaultApprovalAllowed;
  const setupFeatures = buildDoubleTapSetupFeatures({
    context,
    interval: payload.signal?.interval,
    signalTimestamp: payload.signal?.timestamp,
  });
  const doubleTapGateFeatures = buildDoubleTapGateFeatures({
    setupFeatures,
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
    bnbOiRotationPocket,
    bnbOiRotationBlocked,
    xrpOiShortNoHtfPocket,
    xrpOiShortNoHtfBlocked,
    highPrecisionPocket: legacyHighPrecisionShapeCandidate,
    highPrecisionApprovalBlocked,
    q4DerivativesPocket,
    q4DerivativesApprovalBlocked,
    q4ApprovalBlocked,
    defaultApprovalAllowed,
    q4AltDispersionOk:
      altDispersion24h == null
        ? null
        : altDispersion24h < Q4_ALT_DISPERSION_24H_MAX,
    q4DerivativesCmcRiskOk:
      btcVsAltReturn24h == null || cmc20ToCmc100RatioChange24hPct == null
        ? null
        : !q4DerivativesBadCmcPocket,
    q4DerivativesDirectionSessionOk,
    bnbOiRotationContextAvailable,
    bnbOiRotationMomentumOk,
    xrpOiShortNoHtfContextAvailable,
    strictMomentumApproved: strictMomentumApprovalAllowedNow,
    strictMomentumRoc1dOk,
    protectiveApprovalContextAvailable,
    protectiveApprovalContextOk,
  });

  const deterministicQuality =
    structuralHardBlockReasons.length > 0
      ? Math.min(geometryQuality, 2)
      : approvalSourceAllowed && protectiveApprovalContextOk
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
    benchmarkRelativeStrength4h,
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
    cmcExchangeLiquidityVolumeChange24hPct,
    cmcBtcDominanceChange24hPct,
    cmc20ToCmc100RatioChange24hPct,
    btcVsAltReturn24h,
    ethCrowdingPersistenceBars,
    solFundingZScore15m,
    bnbOiChangePct24h15m,
    bnbOiChangePct1h1h,
    bnbReferencePressure,
    xrpOiChangePct1h15m,
    higherTimeframeConflict,
    altDispersion24h,
    q4DerivativesDirectionSessionOk,
    doubleTapGateFeatures,
    structuralHardBlockReasons,
    softBlockReasons,
    strictMomentumBlockReasons,
    deterministicQuality,
    approvalAllowedNow: deterministicQuality >= 4 && approvalAllowedNow,
    protectiveApprovalContextAvailable,
    protectiveApprovalContextOk,
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
- benchmarkRelativeStrength4h=${String(context.benchmarkRelativeStrength4h ?? 'n/a')}
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
- cmcExchangeLiquidityVolumeChange24hPct=${String(context.cmcExchangeLiquidityVolumeChange24hPct ?? 'n/a')}
- cmcBtcDominanceChange24hPct=${String(context.cmcBtcDominanceChange24hPct ?? 'n/a')}
- cmc20ToCmc100RatioChange24hPct=${String(context.cmc20ToCmc100RatioChange24hPct ?? 'n/a')}
- btcVsAltReturn24h=${String(context.btcVsAltReturn24h ?? 'n/a')}
- ethCrowdingPersistenceBars=${String(context.ethCrowdingPersistenceBars ?? 'n/a')}
- solFundingZScore15m=${String(context.solFundingZScore15m ?? 'n/a')}
- bnbOiChangePct24h15m=${String(context.bnbOiChangePct24h15m ?? 'n/a')}
- bnbOiChangePct1h1h=${String(context.bnbOiChangePct1h1h ?? 'n/a')}
- bnbReferencePressure=${context.bnbReferencePressure ?? 'n/a'}
- xrpOiChangePct1h15m=${String(context.xrpOiChangePct1h15m ?? 'n/a')}
- higherTimeframeConflict=${String(context.higherTimeframeConflict ?? 'n/a')}
- altDispersion24h=${String(context.altDispersion24h ?? 'n/a')}
- doubleTapGatePatternGeometry=${context.doubleTapGateFeatures.patternGeometry}
- doubleTapGateNecklineBreakout=${context.doubleTapGateFeatures.necklineBreakout}
- doubleTapGateTrendContext=${context.doubleTapGateFeatures.trendContext}
- doubleTapGateParticipationState=${context.doubleTapGateFeatures.participationState}
- doubleTapGateDerivativesState=${context.doubleTapGateFeatures.derivativesState}
- doubleTapGateExecutionSpreadState=${context.doubleTapGateFeatures.executionSpreadState}
- doubleTapGateGeometry=${JSON.stringify(context.doubleTapGateFeatures.geometry)}
- doubleTapGatePath=${JSON.stringify(context.doubleTapGateFeatures.path)}
- doubleTapGateApprovalPocket=${context.doubleTapGateFeatures.approvalPocket}
- doubleTapGateHighQualityCadencePocket=${String(context.doubleTapGateFeatures.highQualityCadencePocket)}
- doubleTapGateDefaultApprovalAllowed=${String(context.doubleTapGateFeatures.defaultApprovalAllowed)}
- doubleTapGateQ4AltDispersionOk=${String(context.doubleTapGateFeatures.q4AltDispersionOk ?? 'n/a')}
- doubleTapGateQ4DerivativesPocket=${String(context.doubleTapGateFeatures.q4DerivativesPocket)}
- doubleTapGateQ4DerivativesCmcRiskOk=${String(context.doubleTapGateFeatures.q4DerivativesCmcRiskOk ?? 'n/a')}
- doubleTapGateQ4DerivativesDirectionSessionOk=${String(context.doubleTapGateFeatures.q4DerivativesDirectionSessionOk ?? 'n/a')}
- doubleTapGateBnbOiRotationPocket=${String(context.doubleTapGateFeatures.bnbOiRotationPocket)}
- doubleTapGateBnbOiRotationContextAvailable=${String(context.doubleTapGateFeatures.bnbOiRotationContextAvailable)}
- doubleTapGateBnbOiRotationMomentumOk=${String(context.doubleTapGateFeatures.bnbOiRotationMomentumOk)}
- doubleTapGateXrpOiShortNoHtfPocket=${String(context.doubleTapGateFeatures.xrpOiShortNoHtfPocket)}
- doubleTapGateXrpOiShortNoHtfContextAvailable=${String(context.doubleTapGateFeatures.xrpOiShortNoHtfContextAvailable)}
- doubleTapGateStrictMomentumApproved=${String(context.doubleTapGateFeatures.strictMomentumApproved)}
- doubleTapGateStrictMomentumRoc1dOk=${String(context.doubleTapGateFeatures.strictMomentumRoc1dOk ?? 'n/a')}
- doubleTapGateProtectiveApprovalContextAvailable=${String(context.doubleTapGateFeatures.protectiveApprovalContextAvailable)}
- doubleTapGateProtectiveApprovalContextOk=${String(context.doubleTapGateFeatures.protectiveApprovalContextOk)}
- deterministicQuality=${String(context.deterministicQuality)}
- approvalAllowedNow=${String(context.approvalAllowedNow)}
- protectiveApprovalContextAvailable=${String(context.protectiveApprovalContextAvailable)}
- protectiveApprovalContextOk=${String(context.protectiveApprovalContextOk)}
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
- Local q4 approval comes from either BNB reference OI rotation with ROC1D confirmation, or an XRP OI short/no-HTF-conflict pocket, after the shared protective context gate passes.
- BNB approval requires BNB 15m oiChangePct24h >= 0.65, BNB 1h oiChangePct1h <= -0.28, and roc1d >= -5.25.
- XRP approval requires a SHORT signal, XRP 15m oiChangePct1h >= 0.32, and higherTimeframeConflict=false.
- The protective gate requires benchmark relativeStrength4h <= 7.77009, CMC exchange liquidity volume change >= -0.378662, and BNB reference pressure not crowded_long.
- Legacy high-precision CMC, structural q4 CMC, and old BTC/ETH/SOL derivatives pockets are retained only as observation context and should not be treated as local approval.
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
