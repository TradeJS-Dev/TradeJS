import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import {
  AiPayload,
  Signal,
  SignalAnalysis,
  StrategyAiAdapter,
} from '@tradejs/types';
import { AdaptiveMomentumRibbonConfig } from '../config';
import {
  getSignalBtcMaFast,
  getSignalBtcMaSlow,
  getSignalCoinMaFast,
  getSignalCoinMaSlow,
  getSignalDerivativesContext,
  getSignalSessionPrimary,
} from '../../shared/baseContext';

const ADAPTIVE_MOMENTUM_RIBBON_CONTEXT_PROMPT = `
AdaptiveMomentumRibbon addon:
- This is a momentum entry based on an oscillator zero-cross, not a trendline breakout and not a line-reversal setup.
- LONG appears when \`signalOsc\` crosses above 0 and the ribbon switches into \`activeBuy\`; SHORT is the mirror case.
- \`invalidationLevel\` is the structural invalidation level on the signal bar. If \`invalidated=true\` or \`invalidationLevel\` sits on the wrong side of the current price, do not treat the setup as confirmed.
- \`channelState\` and \`channelBiasAligned\` describe where price sits relative to the Keltner Channel. For LONG it is a negative sign if price is still below \`kcMidline\`; for SHORT it is a negative sign if price is above \`kcMidline\`.
- \`invalidationDistancePct\` and \`structuralRewardRiskRatio\` describe how compact the structure is. Do not overstate quality when invalidation is too wide or reward/risk versus invalidation is weak.
- The deterministic gate is strictly signal-time causal: do not use delayed execution, exit reason, or final trade outcome as decision inputs.
- \`quality=5\` is reserved for the strongest momentum/low-effort pocket: oscillatorStrength >= 1.5, volumeRel20 <= 1.2, and effortVsResult <= 100.
- \`quality=4\` additionally allows two narrower continuation pockets: oscillatorStrength >= 1.2 with coin bias conflict, structuralRewardRiskRatio >= 2.2 and volumeRel20 <= 1.2, or Europe-session oscillatorStrength >= 1.5 with effortVsResult <= 120.
- If signal candle range is available, \`signalRangeAtrRatio\` must be >= 1.05 for live approval; weaker signal candles stay in watch mode.
- The local deterministic gate approves LONG by default. SHORT stays in watch mode except for separately calibrated market-breadth shock pockets.
- SHORT watch-mode approvals use three calibrated pockets: BTC-favored breadth shock, neutral shared-context breadth exhaustion with marketBreadth.advancers <= 0 and effortVsResult <= 800, or low-CMC benchmark OI contraction with BTC net flow <= 0.
- SHORT approvals are disabled during the off_hours session, even when a calibrated SHORT pocket is present.
- A reference-derivatives rotation pocket can approve q4 when XRP 15m OI 4h change >= 1.6 and TRX 15m OI 4h change <= -0.2. It may override weak signal range and the default SHORT watch mode, but never hard signal invalidation.
- Non-derivatives approvals are demoted when stopDistanceAtr > 4.5 and breakoutBodyAtr > 2.25, because that combination behaves like a chase entry.
- All live approvals require a calibrated market-regime floor: tpDistanceAtr >= 2.9, trendAdx >= 15, and benchmarkRelativeStrength1d <= 4 when available.
- All live approvals require enough broad alt participation: cmcAltVolumeReportedUsd >= 250B and targetVsBtcAlpha4h >= -2.5 when those fields are available.
- LONG approvals require cmcAltLiquidityRegime to be anything except \`btc_favored\` when that CMC field is available.
- Non-q5 LONG approvals require targetVsBtcAlpha1h <= 2.4 when that field is available, to avoid chase entries after target already outran BTC.
- \`quality=4\` continuation approvals require targetVsBtcAlpha4h >= 1, spreadBps >= -10, and cmcFearGreedValueChange7d >= -15 when those fields are available. \`quality=5\` is not capped by this q4-only continuation guard.
- A blocked q4 continuation may recover to \`quality=4\` when effortVsResult <= 60 and cmcBtcDominanceChange24hPct <= 0, but not when targetVsBtcAlpha1h is above the q4 chase cap.
- If \`approvalAllowedNow=false\` or \`deterministicQuality<4\`, this is usually watch mode rather than a ready live approval.
`;

const ADAPTIVE_MOMENTUM_RIBBON_PAYLOAD_PROMPT = `
- \`payload.additionalIndicators.adaptiveMomentumRibbonContext\` contains a compact signal summary:
  signalOsc / oscillatorStrength / signalRangeAtrRatio / stopDistanceAtr / tpDistanceAtr / breakoutBodyAtr / trendAdx / benchmarkRelativeStrength1d / chaseRiskBlocked / approvalRegimeAllowed / approvalRegimeBlockReasons / channelState / channelExtensionPct / invalidationDistancePct / structuralRewardRiskRatio / coinBiasAligned / btcBiasAligned / targetVsBtcAlpha1h / targetVsBtcAlpha4h / spreadBps / cmcAltLiquidityRegime / cmcAltVolumeReportedUsd / cmcTotalMarketCapUsd / cmcFearGreedValueChange7d / cmcBtcDominanceChange24hPct / benchmarkOiChangePct24h1h / btcReferenceTradeFlowNetBaseDelta / baseDecisionApproveBias / marketBreadthAdvancers / marketBreadthAdvanceDeclineRatio / marketBreadthReturn / shortBreadthShockPocket / shortBreadthNeutralPocket / shortCmcBenchmarkContractionPocket / shortOffHoursBlocked / referenceDerivativesRotationPocket / referenceXrpOiChangePct4h15m / referenceTrxOiChangePct4h15m / q4TargetAlpha1Allowed / q4ContinuationAllowed / q4ContinuationBlockReasons / q4ContinuationRecoveryAllowed / derivativesDirectionAligned / derivativesRiskFlags / derivativesFundingZScore / deterministicQuality / approvalAllowedNow / approvalBlockReasons / riskAnnotations.
- Use this context as the primary strategy-specific interpretation instead of re-deriving it only from generic series.
`;

const SHORT_BREADTH_SHOCK_MARKET_BREADTH_RETURN_MAX = -0.01;
const SHORT_BREADTH_NEUTRAL_EFFORT_VS_RESULT_MAX = 800;
const SHORT_CMC_TOTAL_MARKET_CAP_USD_MAX = 2_290_000_000_000;
const SHORT_BENCHMARK_OI_CHANGE_PCT_24H_1H_MAX = -4;
const SHORT_BTC_REFERENCE_TRADE_FLOW_NET_BASE_DELTA_MAX = 0;
const Q4_TARGET_VS_BTC_ALPHA_1H_MAX = 2.4;
const REFERENCE_XRP_OI_CHANGE_PCT_4H_15M_MIN = 1.6;
const REFERENCE_TRX_OI_CHANGE_PCT_4H_15M_MAX = -0.2;
const CHASE_STOP_DISTANCE_ATR_MAX = 4.5;
const CHASE_BREAKOUT_BODY_ATR_MAX = 2.25;
const MIN_APPROVAL_TP_DISTANCE_ATR = 2.9;
const MIN_APPROVAL_TREND_ADX = 15;
const MAX_APPROVAL_BENCHMARK_RELATIVE_STRENGTH_1D = 4;
const MIN_APPROVAL_CMC_ALT_VOLUME_REPORTED_USD = 250_000_000_000;
const MIN_APPROVAL_TARGET_VS_BTC_ALPHA_4H = -2.5;

type Direction = 'LONG' | 'SHORT';
type Bias = 'bullish' | 'bearish' | null;
type BaseDecisionApproveBias = 'support' | 'neutral' | 'reject' | null;
type PrimaryTradingSession = 'asia' | 'europe' | 'us' | 'off_hours';
type AmrHardBlockReason =
  | 'invalidated'
  | 'inactive_signal_state'
  | 'oscillator_conflict'
  | 'invalidation_wrong_side';
type SpreadSeverity = 'normal' | 'elevated' | 'wide' | null;
type SpreadBias = 'coinbase_premium' | 'binance_premium' | 'flat' | null;
type AmrQ4ContinuationBlockReason =
  | 'weak_target_vs_btc_alpha_4h'
  | 'binance_btc_premium_risk'
  | 'cmc_fear_greed_deteriorating';
type AmrApprovalRegimeBlockReason =
  | 'low_tp_distance_atr'
  | 'weak_trend_adx'
  | 'benchmark_1d_chase_risk'
  | 'low_cmc_alt_reported_volume'
  | 'target_vs_btc_alpha_4h_lag';
type AmrChannelState =
  | 'above_upper'
  | 'above_midline'
  | 'inside_channel'
  | 'below_midline'
  | 'below_lower'
  | 'unknown';
type AmrApprovalBlockReason =
  | AmrHardBlockReason
  | 'missing_base_context'
  | 'weak_signal_range'
  | 'chase_entry_risk'
  | AmrApprovalRegimeBlockReason
  | 'target_vs_btc_alpha_1h_chase'
  | 'short_disabled'
  | 'short_off_hours'
  | 'cmc_alt_liquidity_btc_favored';
type AmrRiskAnnotation =
  | 'session_thin'
  | 'range_bound_structure'
  | 'benchmark_conflict'
  | 'weak_participation'
  | 'weak_retest_quality'
  | 'elevated_venue_spread'
  | 'derivatives_pressure_conflict';

type AdaptiveMomentumRibbonSnapshot = {
  entryLong?: unknown;
  entryShort?: unknown;
  invalidated?: unknown;
  activeBuy?: unknown;
  activeSell?: unknown;
  signalOsc?: unknown;
  kcMidline?: unknown;
  kcUpper?: unknown;
  kcLower?: unknown;
  invalidationLevel?: unknown;
};

type AdaptiveMomentumRibbonAiContext = {
  signalDirection: Direction | null;
  momentumPeriod: number | null;
  butterworthSmoothing: number | null;
  entryLong: boolean;
  entryShort: boolean;
  activeBuy: boolean;
  activeSell: boolean;
  invalidated: boolean;
  signalOsc: number | null;
  oscillatorStrength: number | null;
  signalRangeAtrRatio: number | null;
  stopDistanceAtr: number | null;
  tpDistanceAtr: number | null;
  breakoutBodyAtr: number | null;
  trendAdx: number | null;
  benchmarkRelativeStrength1d: number | null;
  chaseRiskBlocked: boolean;
  approvalRegimeAllowed: boolean;
  approvalRegimeBlockReasons: AmrApprovalRegimeBlockReason[];
  kcMidline: number | null;
  kcUpper: number | null;
  kcLower: number | null;
  invalidationLevel: number | null;
  channelState: AmrChannelState;
  channelBiasAligned: boolean | null;
  channelExtensionPct: number | null;
  invalidationDistancePct: number | null;
  structuralRewardRiskRatio: number | null;
  coinMaBias: Bias;
  btcMaBias: Bias;
  coinBiasAligned: boolean | null;
  btcBiasAligned: boolean | null;
  derivativesDirectionAligned: boolean | null;
  derivativesRiskFlags: string[];
  derivativesFundingZScore: number | null;
  derivativesPressure: string | null;
  baseContextAvailable: boolean;
  primarySession: PrimaryTradingSession | null;
  sessionIsOverlap: boolean;
  fundingWindowNearby: boolean;
  sessionAllowsApproval: boolean | null;
  benchmarkRelativeStrength1h: number | null;
  benchmarkTrendAlignment: string | null;
  targetVsBtcAlpha1h: number | null;
  targetVsBtcAlpha4h: number | null;
  targetVsBtcAlpha24h: number | null;
  targetVsBtcRatioTrend: string | null;
  breakoutState: string | null;
  breakoutRetestQuality: number | null;
  volumeRel20: number | null;
  effortVsResult: number | null;
  spreadBps: number | null;
  spreadBias: SpreadBias;
  spreadSeverity: SpreadSeverity;
  cmcAltLiquidityRegime: string | null;
  cmcAltVolumeReportedUsd: number | null;
  cmcTotalMarketCapUsd: number | null;
  cmcFearGreedValueChange7d: number | null;
  cmcBtcDominanceChange24hPct: number | null;
  benchmarkOiChangePct24h1h: number | null;
  btcReferenceTradeFlowNetBaseDelta: number | null;
  baseDecisionApproveBias: BaseDecisionApproveBias;
  marketBreadthAdvancers: number | null;
  marketBreadthAdvanceDeclineRatio: number | null;
  marketBreadthReturn: number | null;
  shortBreadthShockPocket: boolean;
  shortBreadthNeutralPocket: boolean;
  shortCmcBenchmarkContractionPocket: boolean;
  shortOffHoursBlocked: boolean;
  referenceDerivativesRotationPocket: boolean;
  referenceXrpOiChangePct4h15m: number | null;
  referenceTrxOiChangePct4h15m: number | null;
  q4TargetAlpha1Allowed: boolean;
  q4ContinuationAllowed: boolean;
  q4ContinuationBlockReasons: AmrQ4ContinuationBlockReason[];
  q4ContinuationRecoveryAllowed: boolean;
  hardBlockReasons: AmrHardBlockReason[];
  approvalBlockReasons: AmrApprovalBlockReason[];
  riskAnnotations: AmrRiskAnnotation[];
  deterministicQuality: number;
  approvalAllowedNow: boolean;
  maxAllowedQuality: number;
};

const toFiniteNumberOrNull = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const getLastFiniteNumber = (value: unknown): number | null => {
  if (Array.isArray(value)) {
    for (let i = value.length - 1; i >= 0; i -= 1) {
      const item = toFiniteNumberOrNull(value[i]);
      if (item != null) {
        return item;
      }
    }
    return null;
  }

  return toFiniteNumberOrNull(value);
};

const getBias = (fast: number | null, slow: number | null): Bias => {
  if (fast == null || slow == null) {
    return null;
  }
  if (fast > slow) {
    return 'bullish';
  }
  if (fast < slow) {
    return 'bearish';
  }
  return null;
};

const getSignalDirection = (signal: Signal): Direction | null =>
  signal.direction === 'LONG' || signal.direction === 'SHORT'
    ? signal.direction
    : null;

const asBoolean = (value: unknown) => value === true || value === 1;

const getRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const getStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === 'string' && entry.trim().length > 0,
      )
    : [];

const getPrimarySession = (signal: Signal): PrimaryTradingSession | null => {
  const session = getSignalSessionPrimary(signal);
  return session === 'asia' ||
    session === 'europe' ||
    session === 'us' ||
    session === 'off_hours'
    ? session
    : null;
};

const getDirectionalAlignment = ({
  signalDirection,
  value,
}: {
  signalDirection: Direction | null;
  value: number | null;
}) => {
  if (signalDirection == null || value == null) {
    return null;
  }

  return signalDirection === 'LONG' ? value > 0 : value < 0;
};

const isDirectionallyAtLeast = ({
  signalDirection,
  value,
  threshold,
}: {
  signalDirection: Direction | null;
  value: number | null;
  threshold: number;
}) => {
  if (signalDirection == null || value == null) {
    return false;
  }

  return signalDirection === 'LONG' ? value >= threshold : value <= -threshold;
};

const getAdditionalIndicators = (
  signal: Signal,
  additionalIndicators?: Record<string, unknown> | null,
) => additionalIndicators ?? getRecord(signal.additionalIndicators);

const getAdaptiveMomentumRibbonSnapshot = (
  signal: Signal,
): AdaptiveMomentumRibbonSnapshot => {
  const additional = getRecord(signal.additionalIndicators);
  const amr = additional?.amr;

  return amr && typeof amr === 'object'
    ? (amr as AdaptiveMomentumRibbonSnapshot)
    : {};
};

const getAdaptiveMomentumRibbonConfigSnapshot = (
  signal: Signal,
): Record<string, unknown> | null => {
  const additional = getRecord(signal.additionalIndicators);
  return getRecord(additional?.amrConfigSnapshot);
};

const isAtLeast = (value: number | null, threshold: number) =>
  value != null && value >= threshold;

const isInRange = (value: number | null, min: number, max: number) =>
  value != null && value >= min && value <= max;

const getDirectionalInvalidationDistancePct = ({
  signalDirection,
  currentPrice,
  invalidationLevel,
}: {
  signalDirection: Direction | null;
  currentPrice: number | null;
  invalidationLevel: number | null;
}) => {
  if (
    signalDirection == null ||
    currentPrice == null ||
    currentPrice <= 0 ||
    invalidationLevel == null
  ) {
    return null;
  }

  if (signalDirection === 'LONG') {
    if (invalidationLevel >= currentPrice) {
      return null;
    }
    return ((currentPrice - invalidationLevel) / currentPrice) * 100;
  }

  if (invalidationLevel <= currentPrice) {
    return null;
  }

  return ((invalidationLevel - currentPrice) / currentPrice) * 100;
};

const getDirectionalRewardPct = ({
  signalDirection,
  currentPrice,
  takeProfitPrice,
}: {
  signalDirection: Direction | null;
  currentPrice: number | null;
  takeProfitPrice: number | null;
}) => {
  if (
    signalDirection == null ||
    currentPrice == null ||
    currentPrice <= 0 ||
    takeProfitPrice == null
  ) {
    return null;
  }

  return signalDirection === 'LONG'
    ? ((takeProfitPrice - currentPrice) / currentPrice) * 100
    : ((currentPrice - takeProfitPrice) / currentPrice) * 100;
};

const getDirectionalChannelExtensionPct = ({
  signalDirection,
  currentPrice,
  kcUpper,
  kcLower,
}: {
  signalDirection: Direction | null;
  currentPrice: number | null;
  kcUpper: number | null;
  kcLower: number | null;
}) => {
  if (signalDirection == null || currentPrice == null || currentPrice <= 0) {
    return null;
  }

  if (signalDirection === 'LONG') {
    if (kcUpper == null || currentPrice <= kcUpper) {
      return null;
    }

    return ((currentPrice - kcUpper) / currentPrice) * 100;
  }

  if (kcLower == null || currentPrice >= kcLower) {
    return null;
  }

  return ((kcLower - currentPrice) / currentPrice) * 100;
};

const getChannelState = ({
  signalDirection,
  currentPrice,
  kcMidline,
  kcUpper,
  kcLower,
}: {
  signalDirection: Direction | null;
  currentPrice: number | null;
  kcMidline: number | null;
  kcUpper: number | null;
  kcLower: number | null;
}): AmrChannelState => {
  if (signalDirection == null || currentPrice == null || kcMidline == null) {
    return 'unknown';
  }

  if (signalDirection === 'LONG') {
    if (kcUpper != null && currentPrice >= kcUpper) {
      return 'above_upper';
    }
    if (currentPrice >= kcMidline) {
      return 'inside_channel';
    }
    if (kcLower != null && currentPrice <= kcLower) {
      return 'below_lower';
    }
    return 'below_midline';
  }

  if (kcLower != null && currentPrice <= kcLower) {
    return 'below_lower';
  }
  if (currentPrice <= kcMidline) {
    return 'inside_channel';
  }
  if (kcUpper != null && currentPrice >= kcUpper) {
    return 'above_upper';
  }
  return 'above_midline';
};

const getRetestPrice = (context: AdaptiveMomentumRibbonAiContext) => {
  if (context.signalDirection === 'LONG') {
    if (context.kcMidline != null && context.channelState === 'below_midline') {
      return context.kcMidline;
    }
    return context.kcUpper ?? context.kcMidline ?? context.invalidationLevel;
  }

  if (context.signalDirection === 'SHORT') {
    if (context.kcMidline != null && context.channelState === 'above_midline') {
      return context.kcMidline;
    }
    return context.kcLower ?? context.kcMidline ?? context.invalidationLevel;
  }

  return null;
};

const getSignalRangeAtrRatio = (
  candle: Record<string, unknown> | null,
  raw: Record<string, unknown> | null,
) => {
  const high = toFiniteNumberOrNull(candle?.high);
  const low = toFiniteNumberOrNull(candle?.low);
  const volatility = getRecord(raw?.volatility);
  const atr = toFiniteNumberOrNull(volatility?.atr);

  if (high == null || low == null || atr == null || atr <= 0 || high < low) {
    return null;
  }

  return (high - low) / atr;
};

const getQ4ContinuationBlockReasons = (
  context: Pick<
    AdaptiveMomentumRibbonAiContext,
    'targetVsBtcAlpha4h' | 'spreadBps' | 'cmcFearGreedValueChange7d'
  >,
): AmrQ4ContinuationBlockReason[] => {
  const reasons: AmrQ4ContinuationBlockReason[] = [];

  if (context.targetVsBtcAlpha4h != null && context.targetVsBtcAlpha4h < 1) {
    reasons.push('weak_target_vs_btc_alpha_4h');
  }

  if (context.spreadBps != null && context.spreadBps < -10) {
    reasons.push('binance_btc_premium_risk');
  }

  if (
    context.cmcFearGreedValueChange7d != null &&
    context.cmcFearGreedValueChange7d < -15
  ) {
    reasons.push('cmc_fear_greed_deteriorating');
  }

  return reasons;
};

const getQ4ContinuationRecoveryAllowed = (
  context: Pick<
    AdaptiveMomentumRibbonAiContext,
    | 'q4TargetAlpha1Allowed'
    | 'q4ContinuationAllowed'
    | 'effortVsResult'
    | 'cmcBtcDominanceChange24hPct'
  >,
) =>
  context.q4TargetAlpha1Allowed &&
  !context.q4ContinuationAllowed &&
  isInRange(context.effortVsResult, 0, 60) &&
  context.cmcBtcDominanceChange24hPct != null &&
  context.cmcBtcDominanceChange24hPct <= 0;

const getApprovalRegimeBlockReasons = (
  context: Pick<
    AdaptiveMomentumRibbonAiContext,
    | 'tpDistanceAtr'
    | 'trendAdx'
    | 'benchmarkRelativeStrength1d'
    | 'cmcAltVolumeReportedUsd'
    | 'targetVsBtcAlpha4h'
  >,
): AmrApprovalRegimeBlockReason[] => {
  const reasons: AmrApprovalRegimeBlockReason[] = [];

  if (
    context.tpDistanceAtr == null ||
    context.tpDistanceAtr < MIN_APPROVAL_TP_DISTANCE_ATR
  ) {
    reasons.push('low_tp_distance_atr');
  }

  if (context.trendAdx == null || context.trendAdx < MIN_APPROVAL_TREND_ADX) {
    reasons.push('weak_trend_adx');
  }

  if (
    context.benchmarkRelativeStrength1d != null &&
    context.benchmarkRelativeStrength1d >
      MAX_APPROVAL_BENCHMARK_RELATIVE_STRENGTH_1D
  ) {
    reasons.push('benchmark_1d_chase_risk');
  }

  if (
    context.cmcAltVolumeReportedUsd != null &&
    context.cmcAltVolumeReportedUsd < MIN_APPROVAL_CMC_ALT_VOLUME_REPORTED_USD
  ) {
    reasons.push('low_cmc_alt_reported_volume');
  }

  if (
    context.targetVsBtcAlpha4h != null &&
    context.targetVsBtcAlpha4h < MIN_APPROVAL_TARGET_VS_BTC_ALPHA_4H
  ) {
    reasons.push('target_vs_btc_alpha_4h_lag');
  }

  return reasons;
};

const getDeterministicAdaptiveMomentumRibbonQuality = (
  context: Omit<
    AdaptiveMomentumRibbonAiContext,
    | 'deterministicQuality'
    | 'approvalAllowedNow'
    | 'maxAllowedQuality'
    | 'hardBlockReasons'
    | 'approvalBlockReasons'
    | 'riskAnnotations'
  > & {
    hardBlockReasons: AmrHardBlockReason[];
    approvalBlockReasons: AmrApprovalBlockReason[];
    riskAnnotations: AmrRiskAnnotation[];
  },
) => {
  if (context.hardBlockReasons.length > 0) {
    return 2;
  }

  if (!context.baseContextAvailable) {
    return 3;
  }

  if (
    context.signalRangeAtrRatio != null &&
    context.signalRangeAtrRatio < 1.05 &&
    !context.referenceDerivativesRotationPocket
  ) {
    return 3;
  }

  if (context.chaseRiskBlocked && !context.referenceDerivativesRotationPocket) {
    return 3;
  }

  if (!context.approvalRegimeAllowed) {
    return 3;
  }

  if (context.signalDirection === 'SHORT') {
    if (context.shortOffHoursBlocked) {
      return 3;
    }

    return context.shortBreadthShockPocket ||
      context.shortBreadthNeutralPocket ||
      context.shortCmcBenchmarkContractionPocket ||
      context.referenceDerivativesRotationPocket
      ? 4
      : 3;
  }

  if (
    context.signalDirection === 'LONG' &&
    context.cmcAltLiquidityRegime === 'btc_favored'
  ) {
    return 3;
  }

  const causalMomentumLowEffortPocket =
    isAtLeast(context.oscillatorStrength, 1.5) &&
    isInRange(context.volumeRel20, 0, 1.2) &&
    isInRange(context.effortVsResult, 0, 100);
  const causalRewardRiskLowVolumePocket =
    isAtLeast(context.oscillatorStrength, 1.2) &&
    context.coinBiasAligned === false &&
    isAtLeast(context.structuralRewardRiskRatio, 2.2) &&
    isInRange(context.volumeRel20, 0, 1.2);
  const causalEuropeLowEffortPocket =
    context.primarySession === 'europe' &&
    isAtLeast(context.oscillatorStrength, 1.5) &&
    isInRange(context.effortVsResult, 0, 120);

  if (causalMomentumLowEffortPocket) {
    return 5;
  }

  if (context.signalDirection === 'LONG' && !context.q4TargetAlpha1Allowed) {
    return 3;
  }

  if (context.referenceDerivativesRotationPocket) {
    return 4;
  }

  if (context.q4ContinuationRecoveryAllowed) {
    return 4;
  }

  if (!context.q4ContinuationAllowed) {
    return 3;
  }

  if (causalRewardRiskLowVolumePocket || causalEuropeLowEffortPocket) {
    return 4;
  }

  return 3;
};

const getHardBlockReasonText = (reason: AmrHardBlockReason) => {
  switch (reason) {
    case 'invalidated':
      return 'the signal is already invalidated relative to invalidationLevel';
    case 'inactive_signal_state':
      return 'the active ribbon state does not confirm the current direction';
    case 'oscillator_conflict':
      return 'signalOsc conflicts with the signal direction';
    case 'invalidation_wrong_side':
      return 'invalidationLevel is on the wrong side of the current price';
    default:
      return reason;
  }
};

const buildAdaptiveMomentumRibbonContext = (
  signal: Signal,
  additionalIndicators?: Record<string, unknown> | null,
): AdaptiveMomentumRibbonAiContext => {
  const additional = getAdditionalIndicators(signal, additionalIndicators);
  const signalDirection = getSignalDirection(signal);
  const snapshot = getAdaptiveMomentumRibbonSnapshot(signal);
  const configSnapshot = getAdaptiveMomentumRibbonConfigSnapshot(signal);
  const momentumPeriod = toFiniteNumberOrNull(configSnapshot?.momentumPeriod);
  const butterworthSmoothing = toFiniteNumberOrNull(
    configSnapshot?.butterworthSmoothing,
  );
  const currentPrice = toFiniteNumberOrNull(signal.prices?.currentPrice);
  const takeProfitPrice = toFiniteNumberOrNull(signal.prices?.takeProfitPrice);
  const signalOsc = toFiniteNumberOrNull(snapshot.signalOsc);
  const oscillatorStrength = signalOsc != null ? Math.abs(signalOsc) : null;
  const kcMidline = toFiniteNumberOrNull(snapshot.kcMidline);
  const kcUpper = toFiniteNumberOrNull(snapshot.kcUpper);
  const kcLower = toFiniteNumberOrNull(snapshot.kcLower);
  const invalidationLevel = toFiniteNumberOrNull(snapshot.invalidationLevel);
  const entryLong = asBoolean(snapshot.entryLong);
  const entryShort = asBoolean(snapshot.entryShort);
  const activeBuy = asBoolean(snapshot.activeBuy);
  const activeSell = asBoolean(snapshot.activeSell);
  const invalidated = asBoolean(snapshot.invalidated);
  const channelState = getChannelState({
    signalDirection,
    currentPrice,
    kcMidline,
    kcUpper,
    kcLower,
  });
  const channelBiasAligned =
    signalDirection === 'LONG'
      ? kcMidline != null && currentPrice != null
        ? currentPrice >= kcMidline
        : null
      : signalDirection === 'SHORT'
        ? kcMidline != null && currentPrice != null
          ? currentPrice <= kcMidline
          : null
        : null;
  const channelExtensionPct = getDirectionalChannelExtensionPct({
    signalDirection,
    currentPrice,
    kcUpper,
    kcLower,
  });
  const invalidationDistancePct = getDirectionalInvalidationDistancePct({
    signalDirection,
    currentPrice,
    invalidationLevel,
  });
  const rewardPct = getDirectionalRewardPct({
    signalDirection,
    currentPrice,
    takeProfitPrice,
  });
  const structuralRewardRiskRatio =
    rewardPct != null &&
    invalidationDistancePct != null &&
    invalidationDistancePct > 0
      ? rewardPct / invalidationDistancePct
      : null;
  const coinBias = getBias(
    getSignalCoinMaFast(signal),
    getSignalCoinMaSlow(signal),
  );
  const btcBias = getBias(
    getSignalBtcMaFast(signal),
    getSignalBtcMaSlow(signal),
  );
  const coinBiasAligned =
    signalDirection === 'LONG'
      ? coinBias == null
        ? null
        : coinBias === 'bullish'
      : signalDirection === 'SHORT'
        ? coinBias == null
          ? null
          : coinBias === 'bearish'
        : null;
  const btcBiasAligned =
    signalDirection === 'LONG'
      ? btcBias == null
        ? null
        : btcBias === 'bullish'
      : signalDirection === 'SHORT'
        ? btcBias == null
          ? null
          : btcBias === 'bearish'
        : null;
  const derivativesContext = getRecord(getSignalDerivativesContext(signal));
  const derivativesSummary = getRecord(derivativesContext?.summary);
  const derivativesIntervals = getRecord(derivativesContext?.intervals);
  const derivatives15m = getRecord(derivativesIntervals?.['15m']);
  const derivatives1h = getRecord(derivativesIntervals?.['1h']);
  const derivativesDirectionAligned =
    typeof derivativesSummary?.directionAligned === 'boolean'
      ? derivativesSummary.directionAligned
      : null;
  const derivativesRiskFlags = getStringArray(derivativesSummary?.riskFlags);
  const derivativesPressure =
    typeof derivativesSummary?.pressure === 'string' &&
    derivativesSummary.pressure.trim().length > 0
      ? derivativesSummary.pressure
      : null;
  const derivativesFundingZScore =
    toFiniteNumberOrNull(derivatives15m?.fundingZScore) ??
    toFiniteNumberOrNull(derivatives1h?.fundingZScore);
  const baseContext = getRecord(additional?.baseContext);
  const baseContextAvailable = baseContext != null;
  const candle = getRecord(baseContext?.candle);
  const raw = getRecord(baseContext?.raw);
  const regime = getRecord(baseContext?.regime);
  const regimeTrend = getRecord(regime?.trend);
  const regimeTrendAdx = getRecord(regimeTrend?.adx);
  const regimeSession = getRecord(regime?.session);
  const structure = getRecord(baseContext?.structure);
  const localRange = getRecord(structure?.localRange);
  const participation = getRecord(baseContext?.participation);
  const volumeContext = getRecord(participation?.volume);
  const relative = getRecord(baseContext?.relative);
  const gateFeatures = getRecord(baseContext?.gateFeatures);
  const gateFeaturesSetup = getRecord(gateFeatures?.setup);
  const gateFeaturesRelative = getRecord(gateFeatures?.relative);
  const gateFeaturesDecisionHints = getRecord(gateFeatures?.decisionHints);
  const baseDerivativesContext = getRecord(baseContext?.derivatives);
  const baseDerivativesIntervals = getRecord(baseDerivativesContext?.intervals);
  const baseDerivatives1h = getRecord(baseDerivativesIntervals?.['1h']);
  const referenceDerivativeContexts = getRecord(
    baseDerivativesContext?.referenceContexts,
  );
  const referenceXrpContext = getRecord(referenceDerivativeContexts?.XRPUSDT);
  const referenceTrxContext = getRecord(referenceDerivativeContexts?.TRXUSDT);
  const referenceXrpIntervals = getRecord(referenceXrpContext?.intervals);
  const referenceTrxIntervals = getRecord(referenceTrxContext?.intervals);
  const referenceXrp15m = getRecord(referenceXrpIntervals?.['15m']);
  const referenceTrx15m = getRecord(referenceTrxIntervals?.['15m']);
  const benchmark = getRecord(relative?.benchmark);
  const targetVsBtc = getRecord(relative?.targetVsBtc);
  const cmcGlobal = getRecord(relative?.cmcGlobal);
  const cmcFearGreed = getRecord(relative?.cmcFearGreed);
  const referenceTradeFlow = getRecord(relative?.referenceTradeFlow);
  const referenceTradeFlowBySymbol = getRecord(
    referenceTradeFlow?.tradeFlowBySymbol,
  );
  const btcReferenceTradeFlow = getRecord(referenceTradeFlowBySymbol?.BTCUSDT);
  const baseMarketBreadth = getRecord(relative?.marketBreadth);
  const structureAcceptance = getRecord(structure?.acceptance);
  const marketContext = getRecord(additional?.marketContext);
  const marketContextRelative = getRecord(marketContext?.relative);
  const marketContextBreadth = getRecord(marketContextRelative?.marketBreadth);
  const marketBreadth = baseMarketBreadth ?? marketContextBreadth;
  const marketExecution = getRecord(marketContext?.execution);
  const spreadContext = getRecord(marketExecution?.binanceCoinbaseSpread);
  const primarySession = getPrimarySession(signal);
  const sessionIsOverlap = regimeSession?.isOverlap === true;
  const fundingWindowNearby = regimeSession?.fundingWindowNearby === true;
  const sessionAllowsApproval =
    primarySession == null
      ? null
      : primarySession === 'asia' && !sessionIsOverlap && !fundingWindowNearby
        ? false
        : true;
  const benchmarkRelativeStrength1h = toFiniteNumberOrNull(
    benchmark?.relativeStrength1h,
  );
  const benchmarkRelativeStrength1d = toFiniteNumberOrNull(
    benchmark?.relativeStrength1d,
  );
  const benchmarkTrendAlignment =
    typeof benchmark?.trendAlignment === 'string'
      ? benchmark.trendAlignment
      : null;
  const targetVsBtcAlpha1h = toFiniteNumberOrNull(targetVsBtc?.alphaVsBtc1h);
  const targetVsBtcAlpha4h = toFiniteNumberOrNull(targetVsBtc?.alphaVsBtc4h);
  const targetVsBtcAlpha24h = toFiniteNumberOrNull(targetVsBtc?.alphaVsBtc24h);
  const targetVsBtcRatioTrend =
    typeof targetVsBtc?.ratioTrend === 'string' ? targetVsBtc.ratioTrend : null;
  const breakoutState =
    typeof localRange?.breakoutState === 'string'
      ? localRange.breakoutState
      : null;
  const breakoutRetestQuality = toFiniteNumberOrNull(
    localRange?.breakoutRetestQuality,
  );
  const volumeRel20 = toFiniteNumberOrNull(volumeContext?.volumeRel20);
  const effortVsResult = toFiniteNumberOrNull(volumeContext?.effortVsResult);
  const spreadBps = toFiniteNumberOrNull(spreadContext?.bps);
  const spreadBias =
    spreadContext?.bias === 'coinbase_premium' ||
    spreadContext?.bias === 'binance_premium' ||
    spreadContext?.bias === 'flat'
      ? spreadContext.bias
      : null;
  const spreadSeverity =
    spreadContext?.severity === 'normal' ||
    spreadContext?.severity === 'elevated' ||
    spreadContext?.severity === 'wide'
      ? spreadContext.severity
      : null;
  const signalRangeAtrRatio = getSignalRangeAtrRatio(candle, raw);
  const stopDistanceAtr = toFiniteNumberOrNull(
    gateFeaturesSetup?.stopDistanceAtr,
  );
  const tpDistanceAtr = toFiniteNumberOrNull(gateFeaturesSetup?.tpDistanceAtr);
  const trendAdx = toFiniteNumberOrNull(regimeTrendAdx?.adx);
  const breakoutBodyAtr = toFiniteNumberOrNull(
    structureAcceptance?.breakoutBodyAtr,
  );
  const chaseRiskBlocked =
    stopDistanceAtr != null &&
    stopDistanceAtr > CHASE_STOP_DISTANCE_ATR_MAX &&
    breakoutBodyAtr != null &&
    breakoutBodyAtr > CHASE_BREAKOUT_BODY_ATR_MAX;
  const referenceXrpOiChangePct4h15m = toFiniteNumberOrNull(
    referenceXrp15m?.oiChangePct4h,
  );
  const referenceTrxOiChangePct4h15m = toFiniteNumberOrNull(
    referenceTrx15m?.oiChangePct4h,
  );
  const referenceDerivativesRotationPocket =
    referenceXrpOiChangePct4h15m != null &&
    referenceXrpOiChangePct4h15m >= REFERENCE_XRP_OI_CHANGE_PCT_4H_15M_MIN &&
    referenceTrxOiChangePct4h15m != null &&
    referenceTrxOiChangePct4h15m <= REFERENCE_TRX_OI_CHANGE_PCT_4H_15M_MAX;
  const cmcAltLiquidityRegime =
    typeof cmcGlobal?.altLiquidityRegime === 'string' &&
    cmcGlobal.altLiquidityRegime.trim().length > 0
      ? cmcGlobal.altLiquidityRegime
      : null;
  const cmcAltVolumeReportedUsd = toFiniteNumberOrNull(
    cmcGlobal?.altVolumeReportedUsd,
  );
  const cmcTotalMarketCapUsd = toFiniteNumberOrNull(
    cmcGlobal?.totalMarketCapUsd,
  );
  const cmcFearGreedValueChange7d = toFiniteNumberOrNull(
    cmcFearGreed?.valueChange7d,
  );
  const cmcBtcDominanceChange24hPct = toFiniteNumberOrNull(
    cmcGlobal?.btcDominanceChange24hPct,
  );
  const benchmarkOiChangePct24h1h = toFiniteNumberOrNull(
    baseDerivatives1h?.oiChangePct24h,
  );
  const btcReferenceTradeFlowNetBaseDelta = toFiniteNumberOrNull(
    btcReferenceTradeFlow?.netBaseDelta,
  );
  const baseDecisionApproveBias =
    gateFeaturesDecisionHints?.approveBias === 'support' ||
    gateFeaturesDecisionHints?.approveBias === 'neutral' ||
    gateFeaturesDecisionHints?.approveBias === 'reject'
      ? gateFeaturesDecisionHints.approveBias
      : null;
  const marketBreadthAdvanceDeclineRatio = toFiniteNumberOrNull(
    marketBreadth?.advanceDeclineRatio,
  );
  const marketBreadthAdvancers = toFiniteNumberOrNull(marketBreadth?.advancers);
  const marketBreadthReturn =
    toFiniteNumberOrNull(gateFeaturesRelative?.marketBreadthReturn) ??
    toFiniteNumberOrNull(marketBreadth?.equalWeightedReturn);
  const shortBreadthShockPocket =
    signalDirection === 'SHORT' &&
    cmcAltLiquidityRegime === 'btc_favored' &&
    marketBreadthAdvanceDeclineRatio != null &&
    marketBreadthAdvanceDeclineRatio <= 0 &&
    marketBreadthReturn != null &&
    marketBreadthReturn <= SHORT_BREADTH_SHOCK_MARKET_BREADTH_RETURN_MAX;
  const shortBreadthNeutralPocket =
    signalDirection === 'SHORT' &&
    baseDecisionApproveBias === 'neutral' &&
    marketBreadthAdvancers != null &&
    marketBreadthAdvancers <= 0 &&
    marketBreadthReturn != null &&
    marketBreadthReturn <= 0 &&
    isInRange(effortVsResult, 0, SHORT_BREADTH_NEUTRAL_EFFORT_VS_RESULT_MAX);
  const shortCmcBenchmarkContractionPocket =
    signalDirection === 'SHORT' &&
    cmcTotalMarketCapUsd != null &&
    cmcTotalMarketCapUsd <= SHORT_CMC_TOTAL_MARKET_CAP_USD_MAX &&
    benchmarkOiChangePct24h1h != null &&
    benchmarkOiChangePct24h1h <= SHORT_BENCHMARK_OI_CHANGE_PCT_24H_1H_MAX &&
    btcReferenceTradeFlowNetBaseDelta != null &&
    btcReferenceTradeFlowNetBaseDelta <=
      SHORT_BTC_REFERENCE_TRADE_FLOW_NET_BASE_DELTA_MAX;
  const shortOffHoursBlocked =
    signalDirection === 'SHORT' && primarySession === 'off_hours';
  const q4TargetAlpha1Allowed =
    targetVsBtcAlpha1h == null ||
    targetVsBtcAlpha1h <= Q4_TARGET_VS_BTC_ALPHA_1H_MAX;
  const q4ContinuationBlockReasons = getQ4ContinuationBlockReasons({
    targetVsBtcAlpha4h,
    spreadBps,
    cmcFearGreedValueChange7d,
  });
  const q4ContinuationAllowed = q4ContinuationBlockReasons.length === 0;
  const q4ContinuationRecoveryAllowed = getQ4ContinuationRecoveryAllowed({
    q4TargetAlpha1Allowed,
    q4ContinuationAllowed,
    effortVsResult,
    cmcBtcDominanceChange24hPct,
  });
  const approvalRegimeBlockReasons = baseContextAvailable
    ? getApprovalRegimeBlockReasons({
        tpDistanceAtr,
        trendAdx,
        benchmarkRelativeStrength1d,
        cmcAltVolumeReportedUsd,
        targetVsBtcAlpha4h,
      })
    : [];
  const approvalRegimeAllowed = approvalRegimeBlockReasons.length === 0;

  const hardBlockReasons: AmrHardBlockReason[] = [];

  if (invalidated) {
    hardBlockReasons.push('invalidated');
  }
  if (
    (signalDirection === 'LONG' && (!entryLong || !activeBuy)) ||
    (signalDirection === 'SHORT' && (!entryShort || !activeSell))
  ) {
    hardBlockReasons.push('inactive_signal_state');
  }
  if (
    (signalDirection === 'LONG' && !isAtLeast(signalOsc, Number.EPSILON)) ||
    (signalDirection === 'SHORT' &&
      !(signalOsc != null && signalOsc < -Number.EPSILON))
  ) {
    hardBlockReasons.push('oscillator_conflict');
  }
  if (
    signalDirection != null &&
    invalidationLevel != null &&
    currentPrice != null &&
    ((signalDirection === 'LONG' && invalidationLevel >= currentPrice) ||
      (signalDirection === 'SHORT' && invalidationLevel <= currentPrice))
  ) {
    hardBlockReasons.push('invalidation_wrong_side');
  }

  const approvalBlockReasons: AmrApprovalBlockReason[] = [...hardBlockReasons];
  const riskAnnotations: AmrRiskAnnotation[] = [];

  if (!baseContextAvailable) {
    approvalBlockReasons.push('missing_base_context');
  }

  if (sessionAllowsApproval === false) {
    riskAnnotations.push('session_thin');
  }

  if (
    baseContextAvailable &&
    breakoutState != null &&
    !(
      (signalDirection === 'LONG' && breakoutState === 'above_high_level') ||
      (signalDirection === 'SHORT' && breakoutState === 'below_low_level')
    )
  ) {
    riskAnnotations.push('range_bound_structure');
  }

  if (
    benchmarkTrendAlignment === 'against_benchmark' ||
    getDirectionalAlignment({
      signalDirection,
      value: benchmarkRelativeStrength1h,
    }) === false
  ) {
    riskAnnotations.push('benchmark_conflict');
  }

  if (
    (volumeRel20 != null && (volumeRel20 < 0.8 || volumeRel20 > 1.5)) ||
    (effortVsResult != null && (effortVsResult < -0.1 || effortVsResult > 500))
  ) {
    riskAnnotations.push('weak_participation');
  }

  if (
    signalRangeAtrRatio != null &&
    signalRangeAtrRatio < 1.05 &&
    !referenceDerivativesRotationPocket
  ) {
    approvalBlockReasons.push('weak_signal_range');
  }

  if (chaseRiskBlocked && !referenceDerivativesRotationPocket) {
    approvalBlockReasons.push('chase_entry_risk');
  }

  approvalBlockReasons.push(...approvalRegimeBlockReasons);

  if (breakoutRetestQuality != null && breakoutRetestQuality < 0.25) {
    riskAnnotations.push('weak_retest_quality');
  }

  if (
    spreadSeverity === 'wide' ||
    (spreadSeverity === 'elevated' &&
      (benchmarkTrendAlignment === 'against_benchmark' ||
        getDirectionalAlignment({
          signalDirection,
          value: benchmarkRelativeStrength1h,
        }) === false))
  ) {
    riskAnnotations.push('elevated_venue_spread');
  }

  if (
    (signalDirection === 'LONG' && derivativesPressure === 'crowded_long') ||
    (signalDirection === 'SHORT' && derivativesPressure === 'crowded_short')
  ) {
    riskAnnotations.push('derivatives_pressure_conflict');
  }

  if (signalDirection === 'SHORT' && shortOffHoursBlocked) {
    approvalBlockReasons.push('short_off_hours');
  } else if (
    signalDirection === 'SHORT' &&
    !(
      shortBreadthShockPocket ||
      shortBreadthNeutralPocket ||
      shortCmcBenchmarkContractionPocket ||
      referenceDerivativesRotationPocket
    )
  ) {
    approvalBlockReasons.push('short_disabled');
  }

  if (signalDirection === 'LONG' && cmcAltLiquidityRegime === 'btc_favored') {
    approvalBlockReasons.push('cmc_alt_liquidity_btc_favored');
  }

  const deterministicQuality = getDeterministicAdaptiveMomentumRibbonQuality({
    signalDirection,
    momentumPeriod,
    butterworthSmoothing,
    entryLong,
    entryShort,
    activeBuy,
    activeSell,
    invalidated,
    signalOsc,
    oscillatorStrength,
    signalRangeAtrRatio,
    stopDistanceAtr,
    tpDistanceAtr,
    breakoutBodyAtr,
    trendAdx,
    benchmarkRelativeStrength1d,
    chaseRiskBlocked,
    approvalRegimeAllowed,
    approvalRegimeBlockReasons,
    kcMidline,
    kcUpper,
    kcLower,
    invalidationLevel,
    channelState,
    channelBiasAligned,
    channelExtensionPct,
    invalidationDistancePct,
    structuralRewardRiskRatio,
    coinMaBias: coinBias,
    btcMaBias: btcBias,
    coinBiasAligned,
    btcBiasAligned,
    derivativesDirectionAligned,
    derivativesRiskFlags,
    derivativesFundingZScore,
    derivativesPressure,
    baseContextAvailable,
    primarySession,
    sessionIsOverlap,
    fundingWindowNearby,
    sessionAllowsApproval,
    benchmarkRelativeStrength1h,
    benchmarkTrendAlignment,
    targetVsBtcAlpha1h,
    targetVsBtcAlpha4h,
    targetVsBtcAlpha24h,
    targetVsBtcRatioTrend,
    breakoutState,
    breakoutRetestQuality,
    volumeRel20,
    effortVsResult,
    spreadBps,
    spreadBias,
    spreadSeverity,
    cmcAltLiquidityRegime,
    cmcAltVolumeReportedUsd,
    cmcTotalMarketCapUsd,
    cmcFearGreedValueChange7d,
    cmcBtcDominanceChange24hPct,
    benchmarkOiChangePct24h1h,
    btcReferenceTradeFlowNetBaseDelta,
    baseDecisionApproveBias,
    marketBreadthAdvancers,
    marketBreadthAdvanceDeclineRatio,
    marketBreadthReturn,
    shortBreadthShockPocket,
    shortBreadthNeutralPocket,
    shortCmcBenchmarkContractionPocket,
    shortOffHoursBlocked,
    referenceDerivativesRotationPocket,
    referenceXrpOiChangePct4h15m,
    referenceTrxOiChangePct4h15m,
    q4TargetAlpha1Allowed,
    q4ContinuationAllowed,
    q4ContinuationBlockReasons,
    q4ContinuationRecoveryAllowed,
    hardBlockReasons,
    approvalBlockReasons,
    riskAnnotations,
  });

  if (
    signalDirection === 'LONG' &&
    !q4TargetAlpha1Allowed &&
    deterministicQuality < 4 &&
    hardBlockReasons.length === 0 &&
    approvalBlockReasons.length === 0 &&
    riskAnnotations.length === 0
  ) {
    approvalBlockReasons.push('target_vs_btc_alpha_1h_chase');
  }

  return {
    signalDirection,
    momentumPeriod,
    butterworthSmoothing,
    entryLong,
    entryShort,
    activeBuy,
    activeSell,
    invalidated,
    signalOsc,
    oscillatorStrength,
    signalRangeAtrRatio,
    stopDistanceAtr,
    tpDistanceAtr,
    breakoutBodyAtr,
    trendAdx,
    benchmarkRelativeStrength1d,
    chaseRiskBlocked,
    approvalRegimeAllowed,
    approvalRegimeBlockReasons,
    kcMidline,
    kcUpper,
    kcLower,
    invalidationLevel,
    channelState,
    channelBiasAligned,
    channelExtensionPct,
    invalidationDistancePct,
    structuralRewardRiskRatio,
    coinMaBias: coinBias,
    btcMaBias: btcBias,
    coinBiasAligned,
    btcBiasAligned,
    derivativesDirectionAligned,
    derivativesRiskFlags,
    derivativesFundingZScore,
    derivativesPressure,
    baseContextAvailable,
    primarySession,
    sessionIsOverlap,
    fundingWindowNearby,
    sessionAllowsApproval,
    benchmarkRelativeStrength1h,
    benchmarkTrendAlignment,
    targetVsBtcAlpha1h,
    targetVsBtcAlpha4h,
    targetVsBtcAlpha24h,
    targetVsBtcRatioTrend,
    breakoutState,
    breakoutRetestQuality,
    volumeRel20,
    effortVsResult,
    spreadBps,
    spreadBias,
    spreadSeverity,
    cmcAltLiquidityRegime,
    cmcAltVolumeReportedUsd,
    cmcTotalMarketCapUsd,
    cmcFearGreedValueChange7d,
    cmcBtcDominanceChange24hPct,
    benchmarkOiChangePct24h1h,
    btcReferenceTradeFlowNetBaseDelta,
    baseDecisionApproveBias,
    marketBreadthAdvancers,
    marketBreadthAdvanceDeclineRatio,
    marketBreadthReturn,
    shortBreadthShockPocket,
    shortBreadthNeutralPocket,
    shortCmcBenchmarkContractionPocket,
    shortOffHoursBlocked,
    referenceDerivativesRotationPocket,
    referenceXrpOiChangePct4h15m,
    referenceTrxOiChangePct4h15m,
    q4TargetAlpha1Allowed,
    q4ContinuationAllowed,
    q4ContinuationBlockReasons,
    q4ContinuationRecoveryAllowed,
    hardBlockReasons,
    approvalBlockReasons,
    riskAnnotations,
    deterministicQuality,
    approvalAllowedNow: deterministicQuality >= 4,
    maxAllowedQuality: deterministicQuality,
  };
};

const getAdaptiveMomentumRibbonContextFromPayload = (
  payload: AiPayload,
  signal: Signal,
): AdaptiveMomentumRibbonAiContext => {
  const additional = payload.additionalIndicators as Record<
    string,
    unknown
  > | null;
  const context = additional?.adaptiveMomentumRibbonContext;

  return context && typeof context === 'object'
    ? (context as AdaptiveMomentumRibbonAiContext)
    : buildAdaptiveMomentumRibbonContext(signal);
};

const clampQuality = (value: number | undefined, maxAllowedQuality: number) => {
  const resolved = typeof value === 'number' ? value : maxAllowedQuality;
  return Math.max(1, Math.min(maxAllowedQuality, Math.round(resolved)));
};

const postProcessAnalysis = ({
  signal,
  payload,
  analysis,
}: {
  signal: Signal;
  payload: AiPayload;
  analysis: Partial<SignalAnalysis>;
}): Partial<SignalAnalysis> => {
  const context = getAdaptiveMomentumRibbonContextFromPayload(payload, signal);
  const signalDirection = getSignalDirection(signal);
  const requestedDirection =
    analysis.direction === signalDirection ? signalDirection : null;
  const finalDirection =
    requestedDirection != null && context.approvalAllowedNow
      ? requestedDirection
      : null;
  const finalQuality = clampQuality(
    typeof analysis.quality === 'number'
      ? analysis.quality
      : context.deterministicQuality,
    context.maxAllowedQuality,
  );
  const needRetest = finalDirection == null;
  const retestPrice = needRetest ? getRetestPrice(context) : null;

  if (finalDirection == null) {
    return {
      ...analysis,
      direction: null,
      quality: finalQuality,
      needRetest: true,
      retestPrice,
      takeProfitPrice: null,
      stopLossPrice: null,
      qualityReason:
        analysis.qualityReason ||
        (context.hardBlockReasons.length > 0
          ? `AdaptiveMomentumRibbon guardrail: ${context.hardBlockReasons
              .map(getHardBlockReasonText)
              .join('; ')}.`
          : context.approvalBlockReasons.length > 0
            ? `AdaptiveMomentumRibbon approval blocked: ${context.approvalBlockReasons.join(
                ', ',
              )}.`
            : context.riskAnnotations.length > 0
              ? `AdaptiveMomentumRibbon risk annotations: ${context.riskAnnotations.join(
                  ', ',
                )}.`
              : 'AdaptiveMomentumRibbon keeps the setup in watch mode until momentum confirmation becomes cleaner.'),
      triggerInvalidation:
        analysis.triggerInvalidation ||
        (retestPrice != null
          ? `Wait for confirmation relative to level ${retestPrice}.`
          : 'Wait for cleaner momentum confirmation and better price positioning inside the Keltner channel.'),
      comment:
        analysis.comment ||
        (context.hardBlockReasons.length > 0
          ? `AdaptiveMomentumRibbon rejected: ${context.hardBlockReasons
              .map(getHardBlockReasonText)
              .join('; ')}.`
          : context.approvalBlockReasons.length > 0
            ? `AdaptiveMomentumRibbon blocked: ${context.approvalBlockReasons.join(
                ', ',
              )}.`
            : context.riskAnnotations.length > 0
              ? `AdaptiveMomentumRibbon waiting with risk annotations: ${context.riskAnnotations.join(
                  ', ',
                )}.`
              : 'AdaptiveMomentumRibbon keeps the signal in watch mode until continuation confirmation becomes cleaner.'),
    };
  }

  return {
    ...analysis,
    direction: finalDirection,
    quality: finalQuality,
    needRetest: false,
    retestPrice: null,
    takeProfitPrice: signal.prices?.takeProfitPrice ?? null,
    stopLossPrice: signal.prices?.stopLossPrice ?? null,
  };
};

export const adaptiveMomentumRibbonAiAdapter: StrategyAiAdapter = {
  buildPayload: ({ signal, basePayload }) => {
    const additionalIndicators = getRecord(basePayload.additionalIndicators);

    return {
      ...basePayload,
      additionalIndicators: {
        ...(additionalIndicators ?? {}),
        adaptiveMomentumRibbonContext: buildAdaptiveMomentumRibbonContext(
          signal,
          additionalIndicators,
        ),
      } satisfies AiPayload['additionalIndicators'],
    };
  },
  postProcessAnalysis,
  buildSystemPromptAddon: () =>
    `${ADAPTIVE_MOMENTUM_RIBBON_CONTEXT_PROMPT}\n${ADAPTIVE_MOMENTUM_RIBBON_PAYLOAD_PROMPT}`,
  buildHumanPromptAddon: ({ signal, payload }) => {
    const context = getAdaptiveMomentumRibbonContextFromPayload(
      payload,
      signal,
    );

    return `

Additional AdaptiveMomentumRibbon context:
- momentumPeriod=${context.momentumPeriod ?? 'n/a'}
- butterworthSmoothing=${context.butterworthSmoothing ?? 'n/a'}
- signalOsc=${context.signalOsc?.toFixed?.(3) ?? 'n/a'}
- oscillatorStrength=${context.oscillatorStrength?.toFixed?.(3) ?? 'n/a'}
- signalRangeAtrRatio=${context.signalRangeAtrRatio?.toFixed?.(3) ?? 'n/a'}
- stopDistanceAtr=${context.stopDistanceAtr?.toFixed?.(3) ?? 'n/a'}
- tpDistanceAtr=${context.tpDistanceAtr?.toFixed?.(3) ?? 'n/a'}
- breakoutBodyAtr=${context.breakoutBodyAtr?.toFixed?.(3) ?? 'n/a'}
- trendAdx=${context.trendAdx?.toFixed?.(3) ?? 'n/a'}
- benchmarkRelativeStrength1d=${context.benchmarkRelativeStrength1d?.toFixed?.(3) ?? 'n/a'}
- chaseRiskBlocked=${context.chaseRiskBlocked}
- approvalRegimeAllowed=${context.approvalRegimeAllowed}
- approvalRegimeBlockReasons=${context.approvalRegimeBlockReasons.join(', ') || 'none'}
- channelState=${context.channelState}
- channelBiasAligned=${context.channelBiasAligned}
- channelExtensionPct=${context.channelExtensionPct?.toFixed?.(3) ?? 'n/a'}%
- invalidationDistancePct=${context.invalidationDistancePct?.toFixed?.(3) ?? 'n/a'}%
- structuralRewardRiskRatio=${context.structuralRewardRiskRatio?.toFixed?.(3) ?? 'n/a'}
- coinBiasAligned=${context.coinBiasAligned}
- btcBiasAligned=${context.btcBiasAligned}
- derivativesDirectionAligned=${context.derivativesDirectionAligned}
- derivativesRiskFlags=${context.derivativesRiskFlags.join(', ') || 'none'}
- derivativesFundingZScore=${context.derivativesFundingZScore?.toFixed?.(3) ?? 'n/a'}
- derivativesPressure=${context.derivativesPressure ?? 'n/a'}
- primarySession=${context.primarySession ?? 'n/a'}
- sessionIsOverlap=${context.sessionIsOverlap}
- fundingWindowNearby=${context.fundingWindowNearby}
- sessionAllowsApproval=${context.sessionAllowsApproval}
- benchmarkRelativeStrength1h=${context.benchmarkRelativeStrength1h?.toFixed?.(3) ?? 'n/a'}
- benchmarkTrendAlignment=${context.benchmarkTrendAlignment ?? 'n/a'}
- targetVsBtcAlpha1h=${context.targetVsBtcAlpha1h?.toFixed?.(3) ?? 'n/a'}
- targetVsBtcAlpha4h=${context.targetVsBtcAlpha4h?.toFixed?.(3) ?? 'n/a'}
- targetVsBtcAlpha24h=${context.targetVsBtcAlpha24h?.toFixed?.(3) ?? 'n/a'}
- targetVsBtcRatioTrend=${context.targetVsBtcRatioTrend ?? 'n/a'}
- breakoutState=${context.breakoutState ?? 'n/a'}
- breakoutRetestQuality=${context.breakoutRetestQuality?.toFixed?.(3) ?? 'n/a'}
- volumeRel20=${context.volumeRel20?.toFixed?.(3) ?? 'n/a'}
- effortVsResult=${context.effortVsResult?.toFixed?.(3) ?? 'n/a'}
- spreadBps=${context.spreadBps?.toFixed?.(2) ?? 'n/a'}
- spreadBias=${context.spreadBias ?? 'n/a'}
- spreadSeverity=${context.spreadSeverity ?? 'n/a'}
- cmcAltLiquidityRegime=${context.cmcAltLiquidityRegime ?? 'n/a'}
- cmcAltVolumeReportedUsd=${context.cmcAltVolumeReportedUsd?.toFixed?.(0) ?? 'n/a'}
- cmcTotalMarketCapUsd=${context.cmcTotalMarketCapUsd?.toFixed?.(0) ?? 'n/a'}
- cmcFearGreedValueChange7d=${context.cmcFearGreedValueChange7d?.toFixed?.(3) ?? 'n/a'}
- cmcBtcDominanceChange24hPct=${context.cmcBtcDominanceChange24hPct?.toFixed?.(3) ?? 'n/a'}
- benchmarkOiChangePct24h1h=${context.benchmarkOiChangePct24h1h?.toFixed?.(3) ?? 'n/a'}
- btcReferenceTradeFlowNetBaseDelta=${context.btcReferenceTradeFlowNetBaseDelta?.toFixed?.(3) ?? 'n/a'}
- baseDecisionApproveBias=${context.baseDecisionApproveBias ?? 'n/a'}
- marketBreadthAdvancers=${context.marketBreadthAdvancers?.toFixed?.(0) ?? 'n/a'}
- marketBreadthAdvanceDeclineRatio=${context.marketBreadthAdvanceDeclineRatio?.toFixed?.(3) ?? 'n/a'}
- marketBreadthReturn=${context.marketBreadthReturn?.toFixed?.(5) ?? 'n/a'}
- shortBreadthShockPocket=${context.shortBreadthShockPocket}
- shortBreadthNeutralPocket=${context.shortBreadthNeutralPocket}
- shortCmcBenchmarkContractionPocket=${context.shortCmcBenchmarkContractionPocket}
- shortOffHoursBlocked=${context.shortOffHoursBlocked}
- referenceDerivativesRotationPocket=${context.referenceDerivativesRotationPocket}
- referenceXrpOiChangePct4h15m=${context.referenceXrpOiChangePct4h15m?.toFixed?.(3) ?? 'n/a'}
- referenceTrxOiChangePct4h15m=${context.referenceTrxOiChangePct4h15m?.toFixed?.(3) ?? 'n/a'}
- q4TargetAlpha1Allowed=${context.q4TargetAlpha1Allowed}
- q4ContinuationAllowed=${context.q4ContinuationAllowed}
- q4ContinuationBlockReasons=${context.q4ContinuationBlockReasons.join(', ') || 'none'}
- q4ContinuationRecoveryAllowed=${context.q4ContinuationRecoveryAllowed}
- deterministicQuality=${context.deterministicQuality}
- approvalAllowedNow=${context.approvalAllowedNow}
- hardBlockReasons=${context.hardBlockReasons.join(', ') || 'none'}
- approvalBlockReasons=${context.approvalBlockReasons.join(', ') || 'none'}
- riskAnnotations=${context.riskAnnotations.join(', ') || 'none'}

Interpretation rules for AdaptiveMomentumRibbon:
- a zero-cross alone does not make quality high;
- pay attention to Keltner channel side, sane invalidation distance, bias alignment, derivatives confirmation, and risk annotations for q4 setups;
- if \`signalOsc\` already conflicts with direction or the signal is invalidated, do not treat the entry as confirmed.
`;
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<
        AdaptiveMomentumRibbonConfig,
        'AI_ENABLED' | 'AI_MODE' | 'MIN_AI_QUALITY'
      >,
    ),
};
