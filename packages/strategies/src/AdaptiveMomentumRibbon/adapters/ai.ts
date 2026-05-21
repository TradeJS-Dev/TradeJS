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
- \`derivativesDirectionAligned\`, \`derivativesRiskFlags\`, and \`derivativesFundingZScore\` are required confirmation for q4 live approvals. If derivatives are not aligned, if \`riskFlags\` contains \`oi_not_confirming\`, or if funding is too crowded, keep the setup in watch mode.
- \`quality=5\` requires very clean momentum: correct channel side, strong \`signalOsc\`, sane invalidation distance, and no coin/BTC bias conflicts.
- If \`approvalAllowedNow=false\` or \`deterministicQuality<4\`, this is usually watch mode rather than a ready live approval.
`;

const ADAPTIVE_MOMENTUM_RIBBON_PAYLOAD_PROMPT = `
- \`payload.additionalIndicators.adaptiveMomentumRibbonContext\` contains a compact signal summary:
  signalOsc / oscillatorStrength / channelState / channelExtensionPct / invalidationDistancePct / structuralRewardRiskRatio / coinBiasAligned / btcBiasAligned / derivativesDirectionAligned / derivativesRiskFlags / derivativesFundingZScore / deterministicQuality / approvalAllowedNow / structuralHardBlockReasons.
- Use this context as the primary strategy-specific interpretation instead of re-deriving it only from generic series.
`;

type Direction = 'LONG' | 'SHORT';
type Bias = 'bullish' | 'bearish' | null;
type PrimaryTradingSession = 'asia' | 'europe' | 'us' | 'off_hours';
type AmrHardBlockReason =
  | 'invalidated'
  | 'inactive_signal_state'
  | 'oscillator_conflict'
  | 'invalidation_wrong_side';
type SpreadSeverity = 'normal' | 'elevated' | 'wide' | null;
type SpreadBias = 'coinbase_premium' | 'binance_premium' | 'flat' | null;
type AmrChannelState =
  | 'above_upper'
  | 'above_midline'
  | 'inside_channel'
  | 'below_midline'
  | 'below_lower'
  | 'unknown';
type AmrStructuralReason =
  | AmrHardBlockReason
  | 'session_thin'
  | 'missing_base_context'
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
  breakoutState: string | null;
  breakoutRetestQuality: number | null;
  volumeRel20: number | null;
  effortVsResult: number | null;
  spreadBps: number | null;
  spreadBias: SpreadBias;
  spreadSeverity: SpreadSeverity;
  hardBlockReasons: AmrHardBlockReason[];
  structuralHardBlockReasons: AmrStructuralReason[];
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

const getDeterministicAdaptiveMomentumRibbonQuality = (
  context: Omit<
    AdaptiveMomentumRibbonAiContext,
    | 'deterministicQuality'
    | 'approvalAllowedNow'
    | 'maxAllowedQuality'
    | 'hardBlockReasons'
    | 'structuralHardBlockReasons'
  > & {
    hardBlockReasons: AmrHardBlockReason[];
    structuralHardBlockReasons: AmrStructuralReason[];
  },
) => {
  if (context.hardBlockReasons.length > 0) {
    return 2;
  }

  const biasConflictCount =
    Number(context.coinBiasAligned === false) +
    Number(context.btcBiasAligned === false);
  const noBiasConflict = biasConflictCount === 0;
  const oscillatorModerate = isAtLeast(context.oscillatorStrength, 0.3);
  const oscillatorStrong = isAtLeast(context.oscillatorStrength, 0.55);
  const oscillatorElite = isAtLeast(context.oscillatorStrength, 0.9);
  const invalidationCompact = isInRange(
    context.invalidationDistancePct,
    0.15,
    1.8,
  );
  const invalidationTight = isInRange(
    context.invalidationDistancePct,
    0.2,
    1.25,
  );
  const structuralRrModerate = isAtLeast(
    context.structuralRewardRiskRatio,
    1.2,
  );
  const structuralRrStrong = isAtLeast(context.structuralRewardRiskRatio, 1.8);
  const channelSupportive = context.channelBiasAligned === true;
  const channelExpansion =
    context.signalDirection === 'LONG'
      ? context.channelState === 'above_upper'
      : context.channelState === 'below_lower';
  const channelExtensionStrong = isAtLeast(context.channelExtensionPct, 0.08);
  const sessionAllowsApproval = context.sessionAllowsApproval !== false;
  const slowestDetector =
    context.momentumPeriod === 48 && context.butterworthSmoothing === 6;
  const benchmarkConflict =
    context.benchmarkTrendAlignment === 'against_benchmark' ||
    getDirectionalAlignment({
      signalDirection: context.signalDirection,
      value: context.benchmarkRelativeStrength1h,
    }) === false;
  const weakParticipation =
    (context.volumeRel20 != null &&
      (context.volumeRel20 < 0.8 || context.volumeRel20 > 1.5)) ||
    (context.effortVsResult != null &&
      (context.effortVsResult < -0.1 || context.effortVsResult > 500));
  const weakRetestQuality =
    context.breakoutRetestQuality != null &&
    context.breakoutRetestQuality < 0.25;
  const elevatedVenueSpread =
    context.spreadSeverity === 'wide' ||
    (context.spreadSeverity === 'elevated' &&
      (benchmarkConflict || weakParticipation));
  const derivativesPressureConflict =
    (context.signalDirection === 'LONG' &&
      context.derivativesPressure === 'crowded_long') ||
    (context.signalDirection === 'SHORT' &&
      context.derivativesPressure === 'crowded_short');
  const q4DerivativesSupported =
    context.derivativesDirectionAligned === true &&
    !context.derivativesRiskFlags.includes('oi_not_confirming') &&
    context.derivativesFundingZScore != null &&
    context.derivativesFundingZScore <= 0.5;
  const directionalBreakoutConfirmed =
    context.signalDirection === 'LONG'
      ? context.breakoutState === 'above_high_level'
      : context.signalDirection === 'SHORT'
        ? context.breakoutState === 'below_low_level'
        : false;
  const participationSweetSpot =
    isInRange(context.volumeRel20, 1.05, 1.5) &&
    isInRange(context.effortVsResult, 100, 500);
  const rangeBoundStructure =
    context.baseContextAvailable &&
    context.breakoutState != null &&
    !directionalBreakoutConfirmed;
  const localExpansionPromotionCandidate =
    context.baseContextAvailable &&
    channelSupportive &&
    channelExpansion &&
    oscillatorElite &&
    invalidationCompact &&
    structuralRrStrong &&
    directionalBreakoutConfirmed &&
    biasConflictCount < 2 &&
    !(context.momentumPeriod === 48 && context.butterworthSmoothing === 4) &&
    !(
      context.momentumPeriod === 48 &&
      context.butterworthSmoothing === 6 &&
      !invalidationTight &&
      !isAtLeast(context.structuralRewardRiskRatio, 3)
    ) &&
    !context.derivativesRiskFlags.includes('oi_not_confirming') &&
    context.derivativesPressure !== 'crowded_long' &&
    context.derivativesPressure !== 'crowded_short';
  const confirmedBreakoutSweetSpotCandidate =
    context.baseContextAvailable &&
    directionalBreakoutConfirmed &&
    participationSweetSpot &&
    channelSupportive &&
    channelExpansion &&
    oscillatorStrong &&
    invalidationCompact &&
    structuralRrStrong &&
    noBiasConflict &&
    !(context.momentumPeriod === 48 && context.butterworthSmoothing === 4) &&
    context.derivativesDirectionAligned !== false &&
    !context.derivativesRiskFlags.includes('oi_not_confirming') &&
    (context.derivativesFundingZScore == null ||
      context.derivativesFundingZScore <= 0.5) &&
    !benchmarkConflict &&
    !weakRetestQuality &&
    !elevatedVenueSpread &&
    !derivativesPressureConflict;

  if (derivativesPressureConflict) {
    return 3;
  }

  if (!sessionAllowsApproval && !q4DerivativesSupported) {
    return 3;
  }

  let quality =
    channelSupportive &&
    channelExpansion &&
    channelExtensionStrong &&
    oscillatorElite &&
    invalidationTight &&
    structuralRrStrong &&
    noBiasConflict
      ? 5
      : channelSupportive &&
          channelExpansion &&
          !slowestDetector &&
          oscillatorModerate &&
          invalidationCompact &&
          structuralRrModerate &&
          biasConflictCount < 2 &&
          (biasConflictCount === 0 || oscillatorStrong)
        ? q4DerivativesSupported
          ? 4
          : localExpansionPromotionCandidate ||
              confirmedBreakoutSweetSpotCandidate
            ? 4
            : 3
        : 3;

  if (
    quality >= 4 &&
    (!context.baseContextAvailable || rangeBoundStructure || weakParticipation)
  ) {
    quality = 3;
  }

  if (
    quality >= 4 &&
    (benchmarkConflict ||
      rangeBoundStructure ||
      weakParticipation ||
      weakRetestQuality ||
      elevatedVenueSpread ||
      derivativesPressureConflict)
  ) {
    quality -= 1;
  }

  if (
    quality >= 4 &&
    (!sessionAllowsApproval || elevatedVenueSpread) &&
    (benchmarkConflict || weakParticipation)
  ) {
    quality = 3;
  }

  if (
    quality === 5 &&
    q4DerivativesSupported &&
    sessionAllowsApproval &&
    !benchmarkConflict &&
    !weakParticipation &&
    !weakRetestQuality &&
    !elevatedVenueSpread &&
    !derivativesPressureConflict
  ) {
    return 5;
  }

  if (
    quality === 5 &&
    channelSupportive &&
    channelExpansion &&
    channelExtensionStrong &&
    oscillatorElite &&
    invalidationTight &&
    structuralRrStrong &&
    noBiasConflict
  ) {
    return quality;
  }

  return Math.max(3, quality);
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
  const regime = getRecord(baseContext?.regime);
  const regimeSession = getRecord(regime?.session);
  const structure = getRecord(baseContext?.structure);
  const localRange = getRecord(structure?.localRange);
  const participation = getRecord(baseContext?.participation);
  const volumeContext = getRecord(participation?.volume);
  const relative = getRecord(baseContext?.relative);
  const benchmark = getRecord(relative?.benchmark);
  const marketContext = getRecord(additional?.marketContext);
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
  const benchmarkTrendAlignment =
    typeof benchmark?.trendAlignment === 'string'
      ? benchmark.trendAlignment
      : null;
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

  const structuralHardBlockReasons: AmrStructuralReason[] = [
    ...hardBlockReasons,
  ];

  if (!baseContextAvailable) {
    structuralHardBlockReasons.push('missing_base_context');
  }

  if (sessionAllowsApproval === false) {
    structuralHardBlockReasons.push('session_thin');
  }

  if (
    baseContextAvailable &&
    breakoutState != null &&
    !(
      (signalDirection === 'LONG' && breakoutState === 'above_high_level') ||
      (signalDirection === 'SHORT' && breakoutState === 'below_low_level')
    )
  ) {
    structuralHardBlockReasons.push('range_bound_structure');
  }

  if (
    benchmarkTrendAlignment === 'against_benchmark' ||
    getDirectionalAlignment({
      signalDirection,
      value: benchmarkRelativeStrength1h,
    }) === false
  ) {
    structuralHardBlockReasons.push('benchmark_conflict');
  }

  if (
    (volumeRel20 != null && (volumeRel20 < 0.8 || volumeRel20 > 1.5)) ||
    (effortVsResult != null && (effortVsResult < -0.1 || effortVsResult > 500))
  ) {
    structuralHardBlockReasons.push('weak_participation');
  }

  if (breakoutRetestQuality != null && breakoutRetestQuality < 0.25) {
    structuralHardBlockReasons.push('weak_retest_quality');
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
    structuralHardBlockReasons.push('elevated_venue_spread');
  }

  if (
    (signalDirection === 'LONG' && derivativesPressure === 'crowded_long') ||
    (signalDirection === 'SHORT' && derivativesPressure === 'crowded_short')
  ) {
    structuralHardBlockReasons.push('derivatives_pressure_conflict');
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
    breakoutState,
    breakoutRetestQuality,
    volumeRel20,
    effortVsResult,
    spreadBps,
    spreadBias,
    spreadSeverity,
    hardBlockReasons,
    structuralHardBlockReasons,
  });

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
    breakoutState,
    breakoutRetestQuality,
    volumeRel20,
    effortVsResult,
    spreadBps,
    spreadBias,
    spreadSeverity,
    hardBlockReasons,
    structuralHardBlockReasons,
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
          : context.structuralHardBlockReasons.length > 0
            ? `AdaptiveMomentumRibbon watch mode: ${context.structuralHardBlockReasons.join(
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
          : context.structuralHardBlockReasons.length > 0
            ? `AdaptiveMomentumRibbon waiting: ${context.structuralHardBlockReasons.join(
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
- breakoutState=${context.breakoutState ?? 'n/a'}
- breakoutRetestQuality=${context.breakoutRetestQuality?.toFixed?.(3) ?? 'n/a'}
- volumeRel20=${context.volumeRel20?.toFixed?.(3) ?? 'n/a'}
- effortVsResult=${context.effortVsResult?.toFixed?.(3) ?? 'n/a'}
- spreadBps=${context.spreadBps?.toFixed?.(2) ?? 'n/a'}
- spreadBias=${context.spreadBias ?? 'n/a'}
- spreadSeverity=${context.spreadSeverity ?? 'n/a'}
- deterministicQuality=${context.deterministicQuality}
- approvalAllowedNow=${context.approvalAllowedNow}
- hardBlockReasons=${context.hardBlockReasons.join(', ') || 'none'}
- structuralHardBlockReasons=${context.structuralHardBlockReasons.join(', ') || 'none'}

Interpretation rules for AdaptiveMomentumRibbon:
- a zero-cross alone does not make quality high;
- pay attention to Keltner channel side, sane invalidation distance, bias alignment, and derivatives confirmation for q4 setups;
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
