import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import {
  AiPayload,
  BaseStrategyContextSnapshot,
  StrategyAiAdapter,
} from '@tradejs/types';
import type { TrendLineConfig } from '../config';
import {
  getSignalCoinMaFast,
  getSignalCoinMaSlow,
  getSignalDerivativesContext,
  getSignalSessionIsOverlap,
  getSignalSessionPrimary,
} from '../../shared/baseContext';
import {
  buildTrendlineStructuralContext,
  getBias,
  getSpreadPct,
  getTrendLineFromPayload,
} from '../guardrails';

/**
 * TrendLine AI adapter extends the shared AI pipeline (`src/utils/ai.ts`):
 * - `buildPayload` overrides payload fields when strategy needs richer context
 * - `buildSystemPromptAddon` appends strategy-specific analysis rules
 * - `buildHumanPromptAddon` is reserved for future per-strategy user-prompt additions
 *
 * Base prompt/payload stays in shared `ai.ts`; strategy adapters only add/override
 * strategy-specific context so the final prompt remains complete but modular.
 */
const TRENDLINE_CONTEXT_PROMPT = `
TrendLine addon:
- This setup is based on breakout or reaction around a trendline. 'payload.figures.trendline' contains the line geometry, and 'payload.additionalIndicators.trendlineContext' contains a compact summary of price location versus the line.
- For TrendLine, geometry and price structure have higher priority than indicator confirmation.
- Touches strengthen a line but do not confirm the signal by themselves. Without a confirmed breakout or retest, do not raise quality only because there were many touches.
- For SHORT on rising support ('trendline.mode=\"lows\"'), you usually need either a clear move below the line or a retest from below with rejection. If price remains above the line or directly on it, use 'direction=null' and usually 'quality <= 2'.
- For LONG on descending resistance ('trendline.mode=\"highs\"'), the mirror logic applies: you usually need a move above the line or a retest from above. If price remains below the line or directly on it, use 'direction=null' and usually 'quality <= 2'.
- If 'payload.additionalIndicators.trendlineContext.nearLineNoise=true', do not treat that as a confirmed breakout. Quality is usually '<= 2-3', and a retest or confirmation is still needed.
- If 'payload.additionalIndicators.trendlineContext.coinBiasAligned=false' or 'btcBiasAligned=false', treat it as a direct conflict with the signal direction. In that case, the signal is usually not confirmed unless the structural edge is exceptional.
- If 'payload.additionalIndicators.baseContext.derivatives' exists, use it as Coinalyze-based breakout confirmation or conflict: open interest should support the move, funding should not be extremely crowded against the entry quality, and liquidation spikes can indicate flush, squeeze, or exhaustion.
- If 'baseContext.derivatives.summary.riskFlags' contains 'oi_not_confirming', treat it as a direct sign that open interest does not confirm the breakout yet. Without very strong follow-through, do not elevate the signal to immediate entry.
- For SHORT during 'off_hours' or session overlap, require cleaner structural follow-through than during normal hours; those windows are noisier and less suitable for immediate approval.
- If 'payload.additionalIndicators.trendlineContext.clearBreak=false' and price is still near the line, do not describe it as a clean breakout.
- If 'clearBreak=true' but 'trendlineContext.weakCleanBreak=true', treat it as a formally valid but too-weak breakout: structure has been touched, but displacement margin is still limited. This usually calls for follow-through or retest, not immediate confirmation.
- If 'clearBreak=true' but 'trendlineContext.compressedCleanBreak=true', treat it as a compressed breakout after a cluster of close touches on a short line. Even with a formal line exit, this still usually calls for follow-through or retest rather than immediate confirmation.
- If 'clearBreak=true', 'trendlineContext.breakVsAtrRatio < 0.5', and 'trendlineContext.weakBtcLedBreak=true', treat it as a weak BTC-led break without enough coin-specific follow-through. This usually calls for retest or extra confirmation rather than immediate confirmation.
- For LONG on descending resistance, if the line is very long, the move above it is still modest, and BTC only weakly supports the break, treat it as an early breakout without sufficient follow-through. That usually needs retest or confirmation rather than immediate confirmation.
- For TrendLine, quality 4-5 is only allowed when all of the following are true at once: 'clearBreak=true', 'nearLineNoise=false', 'coinBiasAligned=true', and 'btcBiasAligned=true'. If any one of these conditions is not met, do not set quality above 3.
- Rare exception: if 'trendlineContext.aggressivePreBreakPressure=true', this is an aggressive pre-break-pressure setup. In that case 'quality=4' is allowed even without 'clearBreak', but only as early structural confirmation and only when coin/BTC bias is not conflicting.
- Another rare exception: if 'trendlineContext.strongNearBreakPressure=true', this is a mature line with pressure already building in the signal direction and very strong aligned pressure from both the coin and BTC. In that case 'quality=4' is allowed even when 'nearLineNoise=true', but only as early structural confirmation on strong structure.
`;

const TRENDLINE_PAYLOAD_PROMPT = `
- 'payload.figures.trendline' contains the full trendline geometry without trimming so touches and structure can be evaluated.
- 'payload.additionalIndicators.trendlineContext' contains 'mode / touches / distance / currentLinePrice / priceVsLinePct / priceVsLineSide / clearBreak / nearLineNoise / coinMaBias / btcMaBias / maxAllowedQuality / approvalAllowedNow / hardBlockReasons'.
- It also includes 'atrPct / breakVsAtrRatio / coinMaSpreadPct / btcMaSpreadPct / aggressivePreBreakPressure / strongNearBreakPressure / weakCleanBreak / compressedCleanBreak / weakBtcLedBreak / weakLongFarBreak'.
- If 'payload.additionalIndicators.baseContext.derivatives' exists, it contains Coinalyze-derived open interest, funding, and liquidation fields for the signal moment; do not treat 'stale' or 'missing_derivatives' as confirmation or conflict.
`;

const getRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const getNestedRecord = (
  source: Record<string, unknown> | null,
  path: string[],
) => {
  let current = source;

  for (const key of path) {
    current = getRecord(current?.[key]);
    if (current == null) {
      return null;
    }
  }

  return current;
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

type TrendLineGateFeatures = {
  setupBreakVsAtrRatio: number | null;
  setupPriceVsLinePctAbs: number | null;
  lineMaturity: 'fresh' | 'developing' | 'mature' | 'unknown';
  breakoutAcceptance:
    | 'pressure_exception'
    | 'clear_break'
    | 'weak_break'
    | 'compressed_break'
    | 'near_line_noise'
    | 'no_clear_break'
    | 'unknown';
  timingState:
    | 'ready_breakout'
    | 'ready_follow_through'
    | 'ready_retest'
    | 'wait_retest'
    | 'wait_retest_confirmation'
    | 'stale_breakout'
    | 'unknown'
    | null;
  biasAlignment:
    | 'aligned'
    | 'coin_conflict'
    | 'btc_conflict'
    | 'mixed'
    | 'unknown';
  derivativesConfirmation:
    | 'aligned'
    | 'oi_not_confirming'
    | 'conflict'
    | 'neutral'
    | 'unknown';
  participationState: 'thin' | 'normal' | 'strong' | 'unknown';
  relativeContinuation: 'aligned' | 'against' | 'neutral' | 'unknown';
  qualityPocket: 'approved' | 'pressure_exception' | 'watch' | 'blocked';
};

const buildTrendLineGateFeatures = ({
  structural,
  entryTiming,
  coinBiasAligned,
  volumeRel20,
  benchmarkTrendAlignment,
  derivativesDirectionAligned,
  derivativesRiskFlags,
  oiNotConfirming,
  aggressivePreBreakPressure,
  strongNearBreakPressure,
  approvalAllowedNow,
  hardBlockReasons,
}: {
  structural: ReturnType<typeof buildTrendlineStructuralContext>;
  entryTiming: TrendLineGateFeatures['timingState'];
  coinBiasAligned: boolean | null;
  volumeRel20: number | null;
  benchmarkTrendAlignment: string | null;
  derivativesDirectionAligned: boolean | null;
  derivativesRiskFlags: string[];
  oiNotConfirming: boolean;
  aggressivePreBreakPressure: boolean;
  strongNearBreakPressure: boolean;
  approvalAllowedNow: boolean;
  hardBlockReasons: string[];
}): TrendLineGateFeatures => {
  const touches = structural.touches ?? 0;
  const lineMaturity =
    structural.touches == null
      ? 'unknown'
      : touches >= 5
        ? 'mature'
        : touches >= 3
          ? 'developing'
          : 'fresh';
  const breakoutAcceptance =
    aggressivePreBreakPressure || strongNearBreakPressure
      ? 'pressure_exception'
      : structural.compressedCleanBreak
        ? 'compressed_break'
        : structural.weakCleanBreak || structural.weakLongFarBreak
          ? 'weak_break'
          : structural.clearBreak === true && structural.nearLineNoise === false
            ? 'clear_break'
            : structural.nearLineNoise === true
              ? 'near_line_noise'
              : structural.clearBreak === false
                ? 'no_clear_break'
                : 'unknown';
  const biasAlignment =
    coinBiasAligned === true && structural.btcBiasAligned === true
      ? 'aligned'
      : coinBiasAligned === false && structural.btcBiasAligned === false
        ? 'mixed'
        : coinBiasAligned === false
          ? 'coin_conflict'
          : structural.btcBiasAligned === false
            ? 'btc_conflict'
            : 'unknown';
  const participationState =
    volumeRel20 == null
      ? 'unknown'
      : volumeRel20 < 0.8
        ? 'thin'
        : volumeRel20 >= 1.5
          ? 'strong'
          : 'normal';
  const relativeContinuation =
    benchmarkTrendAlignment === 'against_benchmark'
      ? 'against'
      : benchmarkTrendAlignment === 'aligned_bull' ||
          benchmarkTrendAlignment === 'aligned_bear'
        ? 'aligned'
        : benchmarkTrendAlignment == null
          ? 'unknown'
          : 'neutral';

  return {
    setupBreakVsAtrRatio: structural.breakVsAtrRatio,
    setupPriceVsLinePctAbs: structural.priceVsLinePctAbs,
    lineMaturity,
    breakoutAcceptance,
    timingState: entryTiming,
    biasAlignment,
    derivativesConfirmation: oiNotConfirming
      ? 'oi_not_confirming'
      : derivativesDirectionAligned === true
        ? 'aligned'
        : derivativesDirectionAligned === false
          ? 'conflict'
          : derivativesRiskFlags.length > 0
            ? 'neutral'
            : 'unknown',
    participationState,
    relativeContinuation,
    qualityPocket:
      aggressivePreBreakPressure || strongNearBreakPressure
        ? 'pressure_exception'
        : approvalAllowedNow
          ? 'approved'
          : hardBlockReasons.length > 0
            ? 'blocked'
            : 'watch',
  };
};

const buildTrendlineContext = (signal: {
  direction?: unknown;
  prices?: { currentPrice?: unknown };
  indicators?: Record<string, unknown>;
  additionalIndicators?: Record<string, unknown>;
  figures?: Record<string, unknown>;
}) => {
  const sessionPrimary = getSignalSessionPrimary(signal);
  const sessionIsOverlap = getSignalSessionIsOverlap(signal);
  const additionalIndicators = getRecord(signal.additionalIndicators);
  const baseContext = getRecord(additionalIndicators?.baseContext);
  const participationVolume = getNestedRecord(baseContext, [
    'participation',
    'volume',
  ]);
  const benchmarkContext = getNestedRecord(baseContext, [
    'relative',
    'benchmark',
  ]);
  const volumeRel20 = toFiniteNumberOrNull(participationVolume?.volumeRel20);
  const benchmarkTrendAlignment =
    typeof benchmarkContext?.trendAlignment === 'string'
      ? benchmarkContext.trendAlignment
      : null;
  const executionContext = getNestedRecord(baseContext, [
    'relative',
    'execution',
  ]);
  const venueSpreadZScore = toFiniteNumberOrNull(
    executionContext?.venueSpreadZScore,
  );
  const derivativesContext = getSignalDerivativesContext(signal) as Record<
    string,
    unknown
  > | null;
  const derivativesSummary =
    derivativesContext &&
    typeof derivativesContext.summary === 'object' &&
    derivativesContext.summary &&
    !Array.isArray(derivativesContext.summary)
      ? (derivativesContext.summary as Record<string, unknown>)
      : null;
  const derivativesRiskFlags = Array.isArray(derivativesSummary?.riskFlags)
    ? derivativesSummary.riskFlags.filter(
        (flag): flag is string => typeof flag === 'string' && flag.length > 0,
      )
    : [];
  const derivativesDirectionAligned =
    typeof derivativesSummary?.directionAligned === 'boolean'
      ? derivativesSummary.directionAligned
      : null;
  const oiNotConfirming = derivativesRiskFlags.includes('oi_not_confirming');
  const structural = buildTrendlineStructuralContext(signal);
  const trendLine = getTrendLineFromPayload(signal);
  const coinMaFast = getSignalCoinMaFast(signal);
  const coinMaSlow = getSignalCoinMaSlow(signal);
  const coinMaBias = getBias(coinMaFast, coinMaSlow);
  const coinMaSpreadPct = getSpreadPct(coinMaFast, coinMaSlow);
  const entryTiming =
    typeof signal.additionalIndicators?.trendlineTiming === 'object' &&
    signal.additionalIndicators?.trendlineTiming &&
    typeof (
      signal.additionalIndicators.trendlineTiming as { entryTiming?: unknown }
    ).entryTiming === 'string'
      ? ((
          signal.additionalIndicators.trendlineTiming as { entryTiming: string }
        ).entryTiming as
          | 'ready_breakout'
          | 'ready_follow_through'
          | 'ready_retest'
          | 'wait_retest'
          | 'wait_retest_confirmation'
          | 'stale_breakout'
          | 'unknown')
      : null;
  const coinBiasAligned =
    structural.signalDirection == null || coinMaBias == null
      ? null
      : structural.signalDirection === 'SHORT'
        ? coinMaBias === 'bearish'
        : coinMaBias === 'bullish';
  const aggressivePreBreakPressure =
    structural.signalDirection === 'SHORT' &&
    trendLine?.mode === 'lows' &&
    structural.priceVsLinePct != null &&
    structural.priceVsLinePct > 0 &&
    structural.priceVsLinePct <= 0.15 &&
    (structural.touches ?? 0) >= 5 &&
    structural.distance != null &&
    structural.distance >= 90 &&
    structural.distance <= 120 &&
    coinBiasAligned === true &&
    structural.btcBiasAligned === true &&
    coinMaSpreadPct != null &&
    coinMaSpreadPct <= -1.0 &&
    structural.btcMaSpreadPct != null &&
    structural.btcMaSpreadPct <= -0.3;
  const strongNearBreakPressure =
    structural.signalDirection === 'SHORT' &&
    trendLine?.mode === 'lows' &&
    structural.clearBreak === false &&
    structural.nearLineNoise === true &&
    structural.priceVsLinePct != null &&
    structural.priceVsLinePct < 0 &&
    structural.breakVsAtrRatio != null &&
    structural.breakVsAtrRatio >= 0.25 &&
    structural.breakVsAtrRatio <= 0.35 &&
    coinBiasAligned === true &&
    structural.btcBiasAligned === true &&
    coinMaSpreadPct != null &&
    coinMaSpreadPct <= -1.5 &&
    structural.btcMaSpreadPct != null &&
    structural.btcMaSpreadPct <= -0.5 &&
    (structural.touches ?? 0) >= 5 &&
    structural.distance != null &&
    structural.distance >= 300;
  const weakBtcLedBreak =
    structural.signalDirection === 'SHORT'
      ? structural.clearBreak === true &&
        structural.breakVsAtrRatio != null &&
        structural.breakVsAtrRatio < 0.5 &&
        coinBiasAligned === true &&
        structural.btcBiasAligned === true &&
        coinMaSpreadPct != null &&
        coinMaSpreadPct > -0.6 &&
        structural.btcMaSpreadPct != null &&
        structural.btcMaSpreadPct <= -0.3
      : structural.signalDirection === 'LONG'
        ? structural.clearBreak === true &&
          structural.breakVsAtrRatio != null &&
          structural.breakVsAtrRatio < 0.5 &&
          coinBiasAligned === true &&
          structural.btcBiasAligned === true &&
          coinMaSpreadPct != null &&
          coinMaSpreadPct < 0.6 &&
          structural.btcMaSpreadPct != null &&
          structural.btcMaSpreadPct >= 0.3
        : false;
  const hardBlockReasons = [...structural.structuralHardBlockReasons];

  if (coinBiasAligned === false) {
    hardBlockReasons.push('coin_bias_conflict');
  }
  if (structural.btcBiasAligned === false) {
    hardBlockReasons.push('btc_bias_conflict');
  }
  if (weakBtcLedBreak) {
    hardBlockReasons.push('weak_btc_led_break');
  }
  if (oiNotConfirming && !hardBlockReasons.includes('oi_not_confirming')) {
    hardBlockReasons.push('oi_not_confirming');
  }
  if (
    structural.signalDirection === 'SHORT' &&
    (entryTiming === 'ready_follow_through' ||
      entryTiming === 'ready_retest') &&
    (sessionPrimary === 'off_hours' || sessionIsOverlap) &&
    !hardBlockReasons.includes('short_session_risk')
  ) {
    hardBlockReasons.push('short_session_risk');
  }

  const deterministicQuality = getDeterministicTrendlineQuality({
    signalDirection: structural.signalDirection,
    clearBreak: structural.clearBreak,
    nearLineNoise: structural.nearLineNoise,
    breakVsAtrRatio: structural.breakVsAtrRatio,
    priceVsLinePctAbs: structural.priceVsLinePctAbs,
    touches: structural.touches,
    distance: structural.distance,
    btcMaSpreadPct: structural.btcMaSpreadPct,
    aggressivePreBreakPressure,
    strongNearBreakPressure,
    hardBlockReasons,
    entryTiming,
    coinMaSpreadPct,
  });
  const maxAllowedQuality = deterministicQuality;
  const longUsLowVolumeCrowdedShortSqueeze =
    structural.signalDirection === 'LONG' &&
    sessionPrimary === 'us' &&
    volumeRel20 != null &&
    volumeRel20 < 0.8 &&
    derivativesRiskFlags.includes('crowded_short') &&
    benchmarkTrendAlignment !== 'against_benchmark';
  const longHistoricalApprovalPocket =
    (venueSpreadZScore != null && venueSpreadZScore <= -1) ||
    longUsLowVolumeCrowdedShortSqueeze ||
    (sessionPrimary !== 'europe' &&
      !derivativesRiskFlags.includes('missing_derivatives') &&
      !(
        structural.breakVsAtrRatio != null &&
        structural.breakVsAtrRatio >= 0.8 &&
        structural.breakVsAtrRatio < 1.2
      ) &&
      volumeRel20 != null &&
      volumeRel20 >= 0.8 &&
      benchmarkTrendAlignment !== 'against_benchmark');
  const longHighQualitySessionApproval =
    deterministicQuality >= 5 && sessionPrimary !== 'asia';
  const longStrongDerivativesAlignedApproval =
    volumeRel20 != null &&
    volumeRel20 >= 1.5 &&
    derivativesDirectionAligned === true;
  const longModerateRetestLiquidSessionApproval =
    structural.signalDirection === 'LONG' &&
    deterministicQuality === 4 &&
    entryTiming === 'ready_retest' &&
    (sessionPrimary === 'us' || sessionPrimary === 'europe') &&
    volumeRel20 != null &&
    volumeRel20 >= 0.8 &&
    volumeRel20 < 1.5 &&
    benchmarkTrendAlignment !== 'against_benchmark' &&
    derivativesDirectionAligned == null &&
    derivativesRiskFlags.length > 0 &&
    !oiNotConfirming;
  const longBaseContextApprovalPocket =
    structural.signalDirection !== 'LONG' ||
    longModerateRetestLiquidSessionApproval ||
    (longHistoricalApprovalPocket &&
      (longHighQualitySessionApproval || longStrongDerivativesAlignedApproval));
  const shortThinNeutralBenchmarkRisk =
    structural.signalDirection === 'SHORT' &&
    volumeRel20 != null &&
    volumeRel20 < 0.8 &&
    benchmarkTrendAlignment === 'neutral';
  const approvalAllowedNow =
    deterministicQuality >= 4 &&
    longBaseContextApprovalPocket &&
    !shortThinNeutralBenchmarkRisk;
  const trendLineGateFeatures = buildTrendLineGateFeatures({
    structural,
    entryTiming,
    coinBiasAligned,
    volumeRel20,
    benchmarkTrendAlignment,
    derivativesDirectionAligned,
    derivativesRiskFlags,
    oiNotConfirming,
    aggressivePreBreakPressure,
    strongNearBreakPressure,
    approvalAllowedNow,
    hardBlockReasons,
  });

  return {
    ...structural,
    entryTiming,
    coinMaFast,
    coinMaSlow,
    coinMaBias,
    coinMaSpreadPct,
    coinBiasAligned,
    aggressivePreBreakPressure,
    strongNearBreakPressure,
    weakBtcLedBreak,
    sessionPrimary,
    sessionIsOverlap,
    volumeRel20,
    benchmarkTrendAlignment,
    venueSpreadZScore,
    derivativesDirectionAligned,
    derivativesRiskFlags,
    oiNotConfirming,
    longUsLowVolumeCrowdedShortSqueeze,
    longHighQualitySessionApproval,
    longStrongDerivativesAlignedApproval,
    longModerateRetestLiquidSessionApproval,
    shortThinNeutralBenchmarkRisk,
    trendLineGateFeatures,
    deterministicQuality,
    maxAllowedQuality,
    approvalAllowedNow,
    hardBlockReasons,
  };
};

const withTrendLineGateFeatures = ({
  baseContext,
  context,
}: {
  baseContext: BaseStrategyContextSnapshot | null;
  context: ReturnType<typeof buildTrendlineContext>;
}) =>
  baseContext == null
    ? baseContext
    : ({
        ...(baseContext as unknown as Record<string, unknown>),
        trendLineGateFeatures: context.trendLineGateFeatures,
      } as BaseStrategyContextSnapshot & {
        trendLineGateFeatures: TrendLineGateFeatures;
      });

const formatPromptNumber = (
  value: number | null,
  fractionDigits = 4,
): string => {
  if (value == null) {
    return 'n/a';
  }
  return value.toFixed(fractionDigits);
};

const getHardBlockReasonText = (reason: string) => {
  switch (reason) {
    case 'no_clear_break':
      return 'there is no clean breakout of the line';
    case 'near_line_noise':
      return 'price is too close to the line and looks like noise';
    case 'coin_bias_conflict':
      return 'coin bias conflicts with the direction';
    case 'btc_bias_conflict':
      return 'BTC context conflicts with the direction';
    case 'weak_clean_break':
      return 'the formal breakout exists, but displacement is still too weak relative to ATR';
    case 'compressed_clean_break':
      return 'the breakout looks too compressed: clustered close touches on a short line without enough follow-through';
    case 'weak_btc_led_break':
      return 'the breakout is too small relative to ATR and looks more like a BTC-led move without enough coin follow-through';
    case 'weak_long_far_break':
      return 'for LONG, the breakout of the very long line is still too modest and BTC support is too weak';
    case 'oi_not_confirming':
      return 'open interest does not confirm the move, so the breakout still looks unconfirmed on derivatives context';
    case 'short_session_risk':
      return 'for SHORT, the current session is too noisy or thin (off-hours or overlap), so clearer follow-through is required';
    default:
      return reason;
  }
};

const mergeShortText = (
  primary: string,
  fallback: string,
  maxLength: number,
) => {
  const value = primary.trim() || fallback;
  return value.slice(0, maxLength);
};

type TrendlineQualityContext = {
  signalDirection: 'LONG' | 'SHORT' | null;
  clearBreak: boolean | null;
  nearLineNoise: boolean | null;
  hardBlockReasons: string[];
  aggressivePreBreakPressure: boolean;
  strongNearBreakPressure: boolean;
  breakVsAtrRatio: number | null;
  priceVsLinePctAbs: number | null;
  touches: number | null;
  distance: number | null;
  btcMaSpreadPct: number | null;
  coinMaSpreadPct: number | null;
  entryTiming:
    | 'ready_breakout'
    | 'ready_follow_through'
    | 'ready_retest'
    | 'wait_retest'
    | 'wait_retest_confirmation'
    | 'stale_breakout'
    | 'unknown'
    | null;
};

const getDeterministicTrendlineQuality = (
  trendlineContext: TrendlineQualityContext,
) => {
  if (
    trendlineContext.aggressivePreBreakPressure === true ||
    trendlineContext.strongNearBreakPressure === true
  ) {
    return 4;
  }

  if (trendlineContext.hardBlockReasons.length > 0) {
    return trendlineContext.clearBreak === true ? 3 : 2;
  }

  if (
    trendlineContext.clearBreak !== true ||
    trendlineContext.nearLineNoise !== false ||
    trendlineContext.signalDirection == null
  ) {
    return 2;
  }

  const breakVsAtrRatio = trendlineContext.breakVsAtrRatio ?? 0;
  const priceVsLinePctAbs = trendlineContext.priceVsLinePctAbs ?? 0;
  const touches = trendlineContext.touches ?? 0;
  const distance = trendlineContext.distance ?? Number.POSITIVE_INFINITY;
  const btcMaSpreadPct = trendlineContext.btcMaSpreadPct ?? 0;
  const coinMaSpreadPct = trendlineContext.coinMaSpreadPct ?? 0;
  const entryTiming = trendlineContext.entryTiming;

  if (trendlineContext.signalDirection === 'LONG') {
    const quality5 =
      breakVsAtrRatio >= 1.1 &&
      priceVsLinePctAbs >= 1.0 &&
      touches >= 5 &&
      distance < 250 &&
      btcMaSpreadPct >= 0.5;
    if (quality5) {
      return 5;
    }

    const compactBreakoutQuality4 =
      breakVsAtrRatio >= 0.75 &&
      priceVsLinePctAbs >= 0.7 &&
      distance < 150 &&
      (btcMaSpreadPct >= 0.4 || breakVsAtrRatio >= 1.0) &&
      (touches >= 5 || breakVsAtrRatio >= 0.85);
    const shortLineStrengthQuality4 =
      breakVsAtrRatio >= 0.6 &&
      priceVsLinePctAbs >= 0.65 &&
      touches >= 6 &&
      distance < 120 &&
      btcMaSpreadPct >= 0.75;
    const matureLineQuality4 =
      breakVsAtrRatio >= 0.8 &&
      priceVsLinePctAbs >= 0.7 &&
      touches >= 5 &&
      distance < 350 &&
      btcMaSpreadPct >= 0.4;
    const extendedHighConvictionQuality4 =
      breakVsAtrRatio >= 0.75 &&
      priceVsLinePctAbs >= 0.65 &&
      touches >= 5 &&
      distance < 600 &&
      btcMaSpreadPct >= 0.9;
    const alignedRecentFollowThroughQuality4 =
      (entryTiming === 'ready_follow_through' ||
        entryTiming === 'ready_retest') &&
      breakVsAtrRatio >= 0.58 &&
      breakVsAtrRatio <= 0.72 &&
      priceVsLinePctAbs >= 0.48 &&
      priceVsLinePctAbs <= 0.7 &&
      touches >= 5 &&
      distance <= 420 &&
      btcMaSpreadPct >= 0.45 &&
      coinMaSpreadPct >= 0.25;
    return compactBreakoutQuality4 ||
      shortLineStrengthQuality4 ||
      matureLineQuality4 ||
      extendedHighConvictionQuality4 ||
      alignedRecentFollowThroughQuality4
      ? 4
      : 3;
  }

  const quality5 =
    breakVsAtrRatio >= 5 &&
    priceVsLinePctAbs >= 10 &&
    touches >= 5 &&
    distance >= 240 &&
    distance <= 400 &&
    btcMaSpreadPct <= -1.0;
  if (quality5) {
    return 5;
  }

  const quality4 =
    breakVsAtrRatio >= 1.0 &&
    breakVsAtrRatio < 2.5 &&
    priceVsLinePctAbs >= 1.0 &&
    touches >= 5 &&
    distance < 300 &&
    btcMaSpreadPct <= -0.5;
  const strongReadyBreakoutQuality4 =
    entryTiming === 'ready_breakout' &&
    breakVsAtrRatio >= 2 &&
    priceVsLinePctAbs >= 1.8 &&
    touches >= 5 &&
    btcMaSpreadPct <= -1.0 &&
    (coinMaSpreadPct <= -1.0 || breakVsAtrRatio >= 3);
  const moderateReadyBreakoutQuality4 =
    entryTiming === 'ready_breakout' &&
    breakVsAtrRatio >= 0.65 &&
    breakVsAtrRatio <= 1.2 &&
    priceVsLinePctAbs >= 0.65 &&
    priceVsLinePctAbs <= 1.0 &&
    touches >= 5 &&
    distance >= 150 &&
    distance <= 320 &&
    btcMaSpreadPct <= -0.05 &&
    coinMaSpreadPct <= -0.25;

  if (
    (quality4 || moderateReadyBreakoutQuality4) &&
    entryTiming === 'ready_breakout'
  ) {
    return 4;
  }

  return strongReadyBreakoutQuality4 ? 4 : 3;
};

const getDeterministicTrendlineQualityReason = (
  trendlineContext: Pick<
    TrendlineQualityContext,
    'signalDirection' | 'hardBlockReasons'
  >,
) => {
  if (trendlineContext.hardBlockReasons.length > 0) {
    return `TrendLine guardrail: entry is blocked because ${trendlineContext.hardBlockReasons
      .map(getHardBlockReasonText)
      .join('; ')}.`;
  }

  if (trendlineContext.signalDirection === 'LONG') {
    return 'TrendLine deterministic quality: the breakout exists, but LONG still lacks enough displacement, BTC support, or a compact enough line for immediate entry.';
  }

  if (trendlineContext.signalDirection === 'SHORT') {
    return 'TrendLine deterministic quality: the breakout exists, but SHORT still lacks enough bearish displacement or follow-through, so entry is still too early.';
  }

  return 'TrendLine deterministic quality: the structure is still not strong enough for entry right now.';
};

const getTrendlineContextFromPayload = (
  payload: AiPayload,
  signal: Parameters<typeof buildTrendlineContext>[0],
) => {
  const additional = payload.additionalIndicators as
    | Record<string, unknown>
    | undefined;
  const fromPayload = additional?.trendlineContext as
    | ReturnType<typeof buildTrendlineContext>
    | undefined;

  return fromPayload ?? buildTrendlineContext(signal);
};

export const trendLineAiAdapter: StrategyAiAdapter = {
  // Shared builder trims nested series/figures; TrendLine keeps trendline geometry untrimmed on purpose.
  buildPayload: ({ signal, basePayload }) => {
    const mergedAdditionalIndicators = {
      ...((signal.additionalIndicators as Record<string, unknown>) ?? {}),
      ...((basePayload.additionalIndicators as Record<string, unknown>) ?? {}),
    };
    const trendlineContext = buildTrendlineContext({
      ...signal,
      additionalIndicators: mergedAdditionalIndicators,
    });

    return {
      ...basePayload,
      figures: {
        ...basePayload.figures,
        // Keep raw line geometry available exactly where the shared prompt expects it.
        trendline: getTrendLineFromPayload(signal),
      },
      additionalIndicators: {
        ...mergedAdditionalIndicators,
        baseContext: withTrendLineGateFeatures({
          baseContext: (mergedAdditionalIndicators.baseContext ??
            null) as BaseStrategyContextSnapshot | null,
          context: trendlineContext,
        }),
        trendlineContext,
      } satisfies AiPayload['additionalIndicators'],
    };
  },
  postProcessAnalysis: ({ signal, payload, analysis }) => {
    const trendlineContext = getTrendlineContextFromPayload(payload, signal);
    const quality = trendlineContext.deterministicQuality;
    const signalDirection =
      signal.direction === 'LONG' || signal.direction === 'SHORT'
        ? signal.direction
        : null;

    if (
      (trendlineContext.aggressivePreBreakPressure === true ||
        trendlineContext.strongNearBreakPressure === true) &&
      signalDirection != null
    ) {
      const fallbackReason =
        trendlineContext.strongNearBreakPressure === true
          ? 'TrendLine strong near-break pressure: a mature line is already compressing in the trade direction, so early entry is allowed by strategy code.'
          : 'TrendLine aggressive pre-break pressure: early structural confirmation is allowed under strong bearish pressure.';
      const fallbackComment =
        trendlineContext.strongNearBreakPressure === true
          ? 'TrendLine strong near-break pressure: early entry is allowed by strategy code.'
          : 'TrendLine aggressive pre-break pressure: early entry is allowed by strategy code.';

      return {
        ...analysis,
        direction: signalDirection,
        quality: 4,
        needRetest: false,
        retestPrice: null,
        takeProfitPrice:
          analysis.takeProfitPrice ?? signal.prices?.takeProfitPrice ?? null,
        stopLossPrice:
          analysis.stopLossPrice ?? signal.prices?.stopLossPrice ?? null,
        qualityReason: mergeShortText(
          analysis.qualityReason ?? '',
          fallbackReason,
          400,
        ),
        comment: mergeShortText(analysis.comment ?? '', fallbackComment, 1024),
      };
    }

    if (
      trendlineContext.approvalAllowedNow === true &&
      signalDirection != null
    ) {
      return {
        ...analysis,
        direction: signalDirection,
        quality,
        needRetest: false,
        retestPrice: null,
        takeProfitPrice:
          analysis.takeProfitPrice ?? signal.prices?.takeProfitPrice ?? null,
        stopLossPrice:
          analysis.stopLossPrice ?? signal.prices?.stopLossPrice ?? null,
      };
    }

    const retestPrice =
      trendlineContext.currentLinePrice ?? analysis.retestPrice ?? null;
    const qualityReason = mergeShortText(
      getDeterministicTrendlineQualityReason(trendlineContext),
      'TrendLine guardrail: entry is blocked until the structure is confirmed.',
      400,
    );
    const triggerInvalidation = mergeShortText(
      trendlineContext.hardBlockReasons.length > 0
        ? `Wait for a clean breakout or retest of the line and resolve the conflicts: ${trendlineContext.hardBlockReasons
            .map(getHardBlockReasonText)
            .join('; ')}.`
        : 'Wait for stronger breakout follow-through or a line retest confirmed by both the coin and BTC.',
      'Wait for a clean line breakout or retest plus confirmation from the coin and BTC.',
      400,
    );
    const comment = mergeShortText(
      trendlineContext.hardBlockReasons.length > 0
        ? `TrendLine guardrail blocked the entry: ${trendlineContext.hardBlockReasons
            .map(getHardBlockReasonText)
            .join('; ')}.`
        : 'TrendLine deterministic quality downgraded the entry to watch or reject until stronger structure appears.',
      'TrendLine guardrail blocked the entry until the structure is confirmed.',
      1024,
    );

    return {
      ...analysis,
      direction: null,
      quality,
      needRetest: true,
      retestPrice,
      takeProfitPrice: null,
      stopLossPrice: null,
      setup: mergeShortText(
        analysis.setup ?? '',
        'There is no confirmed trendline breakout or retest for entry right now.',
        400,
      ),
      retestPlan: mergeShortText(
        analysis.retestPlan ?? '',
        'Wait for a return to the line and a reaction in the trade direction before a new entry.',
        400,
      ),
      qualityReason,
      triggerInvalidation,
      comment,
    };
  },
  buildSystemPromptAddon: () =>
    `\n${TRENDLINE_CONTEXT_PROMPT}\n${TRENDLINE_PAYLOAD_PROMPT}\n`,
  buildHumanPromptAddon: ({ payload }) => {
    const additional = payload.additionalIndicators as
      | Record<string, unknown>
      | undefined;
    const trendlineContext = additional?.trendlineContext as
      | ReturnType<typeof buildTrendlineContext>
      | undefined;

    if (!trendlineContext) {
      return '';
    }

    return `

Additional TrendLine context:
- trendline.mode=${trendlineContext.mode ?? 'n/a'}
- trendline.touches=${formatPromptNumber(trendlineContext.touches, 0)}
- trendline.distance=${formatPromptNumber(trendlineContext.distance, 0)}
- trendline.currentLinePrice=${formatPromptNumber(trendlineContext.currentLinePrice, 6)}
- trendline.currentPrice=${formatPromptNumber(trendlineContext.currentPrice, 6)}
- trendline.priceVsLinePct=${formatPromptNumber(trendlineContext.priceVsLinePct, 3)}%
- trendline.priceVsLineSide=${trendlineContext.priceVsLineSide ?? 'n/a'}
- trendline.clearBreak=${String(trendlineContext.clearBreak)}
- trendline.nearLineNoise=${String(trendlineContext.nearLineNoise)}
- trendline.atrPct=${formatPromptNumber(trendlineContext.atrPct, 3)}%
- trendline.breakVsAtrRatio=${formatPromptNumber(trendlineContext.breakVsAtrRatio, 3)}
- trendline.aggressivePreBreakPressure=${String(trendlineContext.aggressivePreBreakPressure)}
- trendline.strongNearBreakPressure=${String(trendlineContext.strongNearBreakPressure)}
- trendline.longUsLowVolumeCrowdedShortSqueeze=${String(trendlineContext.longUsLowVolumeCrowdedShortSqueeze)}
- trendline.longHighQualitySessionApproval=${String(trendlineContext.longHighQualitySessionApproval)}
- trendline.longStrongDerivativesAlignedApproval=${String(trendlineContext.longStrongDerivativesAlignedApproval)}
- trendline.longModerateRetestLiquidSessionApproval=${String(trendlineContext.longModerateRetestLiquidSessionApproval)}
- trendline.shortThinNeutralBenchmarkRisk=${String(trendlineContext.shortThinNeutralBenchmarkRisk)}
- trendline.weakCleanBreak=${String(trendlineContext.weakCleanBreak)}
- trendline.compressedCleanBreak=${String(trendlineContext.compressedCleanBreak)}
- trendline.weakBtcLedBreak=${String(trendlineContext.weakBtcLedBreak)}
- trendline.weakLongFarBreak=${String(trendlineContext.weakLongFarBreak)}
- trendline.entryTiming=${trendlineContext.entryTiming ?? 'n/a'}
- trendline.deterministicQuality=${String(trendlineContext.deterministicQuality)}
- trendline.maxAllowedQuality=${String(trendlineContext.maxAllowedQuality)}
- trendline.approvalAllowedNow=${String(trendlineContext.approvalAllowedNow)}
- trendline.hardBlockReasons=${JSON.stringify(trendlineContext.hardBlockReasons)}
- trendLineGateLineMaturity=${trendlineContext.trendLineGateFeatures.lineMaturity}
- trendLineGateBreakoutAcceptance=${trendlineContext.trendLineGateFeatures.breakoutAcceptance}
- trendLineGateTimingState=${trendlineContext.trendLineGateFeatures.timingState ?? 'n/a'}
- trendLineGateBiasAlignment=${trendlineContext.trendLineGateFeatures.biasAlignment}
- trendLineGateDerivativesConfirmation=${trendlineContext.trendLineGateFeatures.derivativesConfirmation}
- trendLineGateParticipationState=${trendlineContext.trendLineGateFeatures.participationState}
- trendLineGateRelativeContinuation=${trendlineContext.trendLineGateFeatures.relativeContinuation}
- trendLineGateQualityPocket=${trendlineContext.trendLineGateFeatures.qualityPocket}
- coin.maFastLast=${formatPromptNumber(trendlineContext.coinMaFast, 6)}
- coin.maSlowLast=${formatPromptNumber(trendlineContext.coinMaSlow, 6)}
- coin.maBias=${trendlineContext.coinMaBias ?? 'n/a'}
- coin.maSpreadPct=${formatPromptNumber(trendlineContext.coinMaSpreadPct, 3)}%
- coin.biasAligned=${String(trendlineContext.coinBiasAligned)}
- btc.maFastLast=${formatPromptNumber(trendlineContext.btcMaFast, 2)}
- btc.maSlowLast=${formatPromptNumber(trendlineContext.btcMaSlow, 2)}
- btc.maBias=${trendlineContext.btcMaBias ?? 'n/a'}
- btc.maSpreadPct=${formatPromptNumber(trendlineContext.btcMaSpreadPct, 3)}%
- btc.biasAligned=${String(trendlineContext.btcBiasAligned)}

Interpretation rules for TrendLine:
- SHORT from a 'lows' line is confirmed only by a clear move below the line or a retest from below with rejection.
- LONG from a 'highs' line is confirmed only by a clear move above the line or a retest from above with rejection.
- If 'trendline.nearLineNoise=true' or any bias alignment is false, it is better to return 'direction=null' and quality 1-3 than to describe the signal as confirmed without margin.
- If 'trendline.weakCleanBreak=true', the formal breakout exists but is too weak in displacement; it needs follow-through or retest rather than quality 4-5.
- If 'trendline.compressedCleanBreak=true', the breakout exists formally, but the line is too short and compressed after clustered touches; this usually needs follow-through or retest rather than immediate confirmation.
- If 'trendline.weakBtcLedBreak=true', treat it as a small breakout driven more by BTC than by the coin itself; this usually calls for retest and quality 1-3.
- If 'clearBreak=false' or any alignment is false, do not raise quality above 3.
- If 'trendline.aggressivePreBreakPressure=true', an early SHORT before a clear breakout may be considered only as an exception: quality can be at most 4, and the explanation must clearly state that the structural confirmation is still aggressive.
- If 'trendline.strongNearBreakPressure=true', an early SHORT may be considered when pressure is already strong on the correct side of the line even if the breakout still falls short of the 'clearBreak' threshold: quality can be at most 4.
- The strategy deterministically normalizes final quality to 'trendline.deterministicQuality'; your job is to explain the decision within that frame, not to argue with the tier.
- If 'trendline.approvalAllowedNow=false', do not describe the signal as fully confirmed right now; explain what is still missing for confirmation.
`;
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<
        TrendLineConfig,
        'AI_ENABLED' | 'AI_MODE' | 'MIN_AI_QUALITY'
      >,
    ),
};
