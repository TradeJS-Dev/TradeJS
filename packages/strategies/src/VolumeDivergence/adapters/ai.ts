import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import { AiPayload, StrategyAiAdapter } from '@tradejs/types';
import type { Signal, SignalAnalysis } from '@tradejs/types';
import type { VolumeDivergenceConfig } from '../config';
import {
  getSignalBtcMaFast,
  getSignalBtcMaSlow,
  getSignalCoinMaFast,
  getSignalCoinMaSlow,
  getSignalDerivativesContext,
} from '../../shared/baseContext';
import {
  DEFAULT_VOLUME_DIVERGENCE_ENTRY_THRESHOLDS,
  getVolumeDivergenceAiThresholds,
  VolumeDivergenceAiThresholds,
  VolumeDivergenceEntryThresholdSnapshot,
  VolumeDivergenceSetupFeatures,
} from '../setup';

const VOLUME_DIVERGENCE_CONTEXT_PROMPT = `
VolumeDivergence addon:
- This is a reversal setup built on price and normalized-volume divergence, not a breakout strategy.
- Bullish divergence means price makes a lower low while volume makes a higher low.
- Bearish divergence means price makes a higher high while volume makes a lower high.
- For a bullish signal, do not overstate quality if price still failed to bounce meaningfully away from the current pivot low or failed to reclaim enough structure.
- For a bearish signal, mirror that logic: do not overstate quality if price failed to move down meaningfully away from the current pivot high.
- If \`payload.additionalIndicators.volumeDivergenceContext.confirmationReady=false\`, this is usually not a fully confirmed reversal yet; quality is often \`<= 4\` and a retest or confirmation is often still needed.
- For live approval, treat \`confirmationReady\` as much more important than \`structureAdvanced\`; structure advance alone does not mean the reversal is entry-ready.
- For a reversal setup, do not automatically reward quality just because the coin or BTC MA bias already matches the signal direction.
- For LONG with \`entryTiming=structure_advance\`, avoid \`quality=5\`; that is an intermediate phase, not a fully confirmed reversal.
- Be stricter for SHORT than for LONG: a bearish reversal should require cleaner follow-through, and bias or delta conflict should reduce quality more aggressively.
- If \`deltaAtPivot\` conflicts with the reversal direction or the coin/BTC bias conflicts with the signal, do not overstate quality just because divergence exists.
- Use \`divergenceAmplitudeAtrRatio\`, \`reclaimPct\`, and \`confirmationCandleQuality\` as explicit setup features describing how meaningful the divergence is relative to ATR, how much structure price reclaimed, and how strong the confirmation candle was.
- \`confirmationDistancePct\` tells you how far price moved beyond the confirmation level; do not overstate quality when confirmation exists only marginally.
- \`additionalIndicators.deltaAtPivot\` is a proxy net-volume value on the pivot candle, not true lower-timeframe TradingView volume delta.
- If \`payload.additionalIndicators.baseContext.derivatives\` exists, use Coinalyze-derived open interest, funding, and liquidations as positioning context: a liquidation flush can strengthen reversal odds, while crowded positioning against the trade or stale or missing data should not mechanically increase quality.
- Adaptive exception: a bearish \`confirmation_ready\` setup may still deserve live approval even with positive pivot delta if price already advanced structurally and derivatives show a real liquidation flush. This is a regime-sensitive reversal exception, not a blanket permission for weak SHORTs.
`;

const VOLUME_DIVERGENCE_PAYLOAD_PROMPT = `
- \`payload.additionalIndicators.volumeDivergenceContext\` contains a compact divergence-strength summary:
  divergenceKind / confirmationPrice / confirmationReady / structureAdvanced / reboundFromPivotPct / confirmationDistancePct / priceDisplacementPct / divergenceAmplitudeAtrRatio / reclaimPct / confirmationCandleQuality / volumeDivergenceStrength / deltaAligned / coinBiasAligned / btcBiasAligned / derivativesDirectionAligned / derivativesRiskFlags / derivativesLiqSpikeRatio / venueSpreadZScore / volumeRel20 / rangePosition20 / btcOiChangePct1h15m / solOpenInterest15m / xrpFundingZScore15m / derivativesRegimePocket / deterministicQuality / approvalAllowedNow / structuralHardBlockReasons / maxAllowedQuality.
- Use this context as the explicit strategy-specific summary instead of trying to derive the same conclusion again only from generic candles.
- If \`payload.additionalIndicators.baseContext.derivatives\` exists, it is a Coinalyze-derived summary of derivatives state at signal time; \`stale\` or \`missing_derivatives\` means that Coinalyze context must not be used.
`;

const BTC_OI_CHANGE_PCT_1H_15M_MAX = -0.25;
const SOL_OPEN_INTEREST_15M_MIN = 10_100_000;
const XRP_FUNDING_Z_SCORE_15M_MAX = -1.2;

type Direction = 'LONG' | 'SHORT';
type Bias = 'bullish' | 'bearish' | null;
type DivergenceKind = 'bullish' | 'bearish';
type HardBlockReason =
  | 'no_rebound_from_pivot'
  | 'weak_divergence_amplitude'
  | 'weak_reclaim'
  | 'weak_confirmation_candle';
type EntryTiming = 'confirmation_ready' | 'structure_advance';

type PivotSummary = {
  index?: number;
  timestamp?: number;
  priceLow?: number;
  priceHigh?: number;
  volumeNorm?: number;
};

type DivergenceSummary = {
  kind?: DivergenceKind;
  pivotLookbackLeft?: number;
  pivotLookbackRight?: number;
  currentPivot?: PivotSummary;
  previousPivot?: PivotSummary;
  barsBetweenPivotConfirmations?: number;
};

type VolumeDivergenceAiContext = {
  signalDirection: Direction | null;
  divergenceKind: DivergenceKind | null;
  confirmationPrice: number | null;
  confirmationReady: boolean;
  structureAdvanced: boolean;
  reboundFromPivotPct: number | null;
  confirmationDistancePct: number | null;
  priceDisplacementPct: number | null;
  atrPct: number | null;
  divergenceAmplitudeAtrRatio: number | null;
  reclaimPct: number | null;
  confirmationCandleQuality: number | null;
  volumeDivergenceStrength: number | null;
  volumeDivergenceRatio: number | null;
  deltaAtPivot: number | null;
  deltaAligned: boolean | null;
  barsSincePivot: number | null;
  barsBetweenPivotConfirmations: number | null;
  entryTiming: EntryTiming | null;
  barsSinceDetection: number | null;
  coinMaBias: Bias;
  btcMaBias: Bias;
  coinBiasAligned: boolean | null;
  btcBiasAligned: boolean | null;
  derivativesDirectionAligned: boolean | null;
  derivativesRiskFlags: string[];
  derivativesFundingZScore: number | null;
  derivativesLiqSpikeRatio: number | null;
  venueSpreadZScore: number | null;
  volumeRel20: number | null;
  rangePosition20: number | null;
  btcOiChangePct1h15m: number | null;
  solOpenInterest15m: number | null;
  xrpFundingZScore15m: number | null;
  derivativesRegimePocket: boolean;
  sessionPhase: string | null;
  hardBlockReasons: HardBlockReason[];
  structuralHardBlockReasons: string[];
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

const getDivergenceSummary = (
  signal: Signal,
): DivergenceSummary | Record<string, never> => {
  const additional = signal.additionalIndicators as Record<
    string,
    unknown
  > | null;
  const divergence = additional?.divergence;

  return divergence && typeof divergence === 'object'
    ? (divergence as DivergenceSummary)
    : {};
};

const getVolumeDivergenceSetupSummary = (
  signal: Signal,
): Partial<VolumeDivergenceSetupFeatures> => {
  const additional = signal.additionalIndicators as Record<
    string,
    unknown
  > | null;
  const setup = additional?.volumeDivergenceSetup;

  return setup && typeof setup === 'object'
    ? (setup as Partial<VolumeDivergenceSetupFeatures>)
    : {};
};

const getVolumeDivergenceThresholdSummary = (
  signal: Signal,
): VolumeDivergenceEntryThresholdSnapshot => {
  const additional = signal.additionalIndicators as Record<
    string,
    unknown
  > | null;
  const thresholds = additional?.volumeDivergenceThresholds;

  if (!thresholds || typeof thresholds !== 'object') {
    return DEFAULT_VOLUME_DIVERGENCE_ENTRY_THRESHOLDS;
  }

  const candidate =
    thresholds as Partial<VolumeDivergenceEntryThresholdSnapshot>;

  return {
    allowStructureAdvanceEntry:
      typeof candidate.allowStructureAdvanceEntry === 'boolean'
        ? candidate.allowStructureAdvanceEntry
        : DEFAULT_VOLUME_DIVERGENCE_ENTRY_THRESHOLDS.allowStructureAdvanceEntry,
    minDivergenceAmplitudeAtrRatio:
      toFiniteNumberOrNull(candidate.minDivergenceAmplitudeAtrRatio) ??
      DEFAULT_VOLUME_DIVERGENCE_ENTRY_THRESHOLDS.minDivergenceAmplitudeAtrRatio,
    minReclaimPct:
      toFiniteNumberOrNull(candidate.minReclaimPct) ??
      DEFAULT_VOLUME_DIVERGENCE_ENTRY_THRESHOLDS.minReclaimPct,
    minConfirmationCandleQuality:
      toFiniteNumberOrNull(candidate.minConfirmationCandleQuality) ??
      DEFAULT_VOLUME_DIVERGENCE_ENTRY_THRESHOLDS.minConfirmationCandleQuality,
  };
};

const isAtLeast = (value: number | null, threshold: number) =>
  value != null && value >= threshold;

const isAtMost = (value: number | null, threshold: number) =>
  value != null && value <= threshold;

const isInRange = (value: number | null, min: number, max: number) =>
  value != null && value >= min && value <= max;

const hasOnlyWeakAmplitudeBlock = (reasons: HardBlockReason[]) =>
  reasons.length > 0 &&
  reasons.every((reason) => reason === 'weak_divergence_amplitude');

const getNestedRecord = (
  source: Record<string, unknown> | null,
  path: string[],
) => {
  let current: Record<string, unknown> | null = source;

  for (const key of path) {
    current = getRecord(current?.[key]);
    if (current == null) {
      return null;
    }
  }

  return current;
};

const getNestedNumber = (
  source: Record<string, unknown> | null,
  path: string[],
) => {
  if (path.length === 0) {
    return null;
  }

  const parent = getNestedRecord(source, path.slice(0, -1));
  return toFiniteNumberOrNull(parent?.[path[path.length - 1]]);
};

const getConfirmationDistancePct = ({
  signalDirection,
  currentPrice,
  confirmationPrice,
  setupValue,
}: {
  signalDirection: Direction | null;
  currentPrice: number | null;
  confirmationPrice: number | null;
  setupValue: number | null;
}) => {
  if (setupValue != null) {
    return setupValue;
  }

  if (
    signalDirection == null ||
    currentPrice == null ||
    confirmationPrice == null ||
    confirmationPrice <= 0
  ) {
    return null;
  }

  return signalDirection === 'LONG'
    ? ((currentPrice - confirmationPrice) / confirmationPrice) * 100
    : ((confirmationPrice - currentPrice) / confirmationPrice) * 100;
};

const buildHardBlockReasons = ({
  confirmationReady,
  reboundFromPivotPct,
  divergenceAmplitudeAtrRatio,
  reclaimPct,
  confirmationCandleQuality,
  entryThresholds,
}: {
  confirmationReady: boolean;
  reboundFromPivotPct: number | null;
  divergenceAmplitudeAtrRatio: number | null;
  reclaimPct: number | null;
  confirmationCandleQuality: number | null;
  entryThresholds: VolumeDivergenceEntryThresholdSnapshot;
}): HardBlockReason[] => {
  const reasons: HardBlockReason[] = [];

  if (reboundFromPivotPct != null && reboundFromPivotPct <= 0) {
    reasons.push('no_rebound_from_pivot');
  }
  if (
    divergenceAmplitudeAtrRatio != null &&
    divergenceAmplitudeAtrRatio < entryThresholds.minDivergenceAmplitudeAtrRatio
  ) {
    reasons.push('weak_divergence_amplitude');
  }
  if (
    confirmationReady &&
    reclaimPct != null &&
    reclaimPct < entryThresholds.minReclaimPct
  ) {
    reasons.push('weak_reclaim');
  }
  if (
    confirmationReady &&
    confirmationCandleQuality != null &&
    confirmationCandleQuality < entryThresholds.minConfirmationCandleQuality
  ) {
    reasons.push('weak_confirmation_candle');
  }

  return reasons;
};

const getLongQ4Demotion = ({
  divergenceAmplitudeAtrRatio,
  volumeDivergenceRatio,
  coinBiasAligned,
  btcBiasAligned,
  confirmationDistancePct,
  barsSinceDetection,
  atrPct,
  reclaimPct,
}: {
  divergenceAmplitudeAtrRatio: number | null;
  volumeDivergenceRatio: number | null;
  coinBiasAligned: boolean | null;
  btcBiasAligned: boolean | null;
  confirmationDistancePct: number | null;
  barsSinceDetection: number | null;
  atrPct: number | null;
  reclaimPct: number | null;
}) => {
  const longOverextendedWithoutVolumeSupport =
    isAtLeast(divergenceAmplitudeAtrRatio, 2.2) &&
    volumeDivergenceRatio != null &&
    volumeDivergenceRatio < 2.2;
  const longBtcLedWithoutCoinSupport =
    coinBiasAligned === false &&
    btcBiasAligned === true &&
    volumeDivergenceRatio != null &&
    volumeDivergenceRatio < 2.6;
  const longDoubleConflictWithoutMaturity =
    coinBiasAligned === false &&
    btcBiasAligned === false &&
    (!isAtLeast(confirmationDistancePct, 0.35) ||
      !isAtLeast(barsSinceDetection, 2) ||
      !isAtMost(atrPct, 0.95));
  const longDoubleConflictOverextended =
    coinBiasAligned === false &&
    btcBiasAligned === false &&
    (!isAtMost(confirmationDistancePct, 1.4) ||
      !isAtMost(divergenceAmplitudeAtrRatio, 2.2) ||
      !isAtMost(atrPct, 1.0) ||
      !isAtLeast(reclaimPct, 130));
  const longDoubleConflictStaleConfirmation =
    coinBiasAligned === false &&
    btcBiasAligned === false &&
    isAtLeast(barsSinceDetection, 5);
  const longFullyAlignedLateWeakConfirmation =
    coinBiasAligned === true &&
    btcBiasAligned === true &&
    isAtLeast(barsSinceDetection, 5) &&
    (!isAtLeast(confirmationDistancePct, 1.2) || !isAtLeast(reclaimPct, 170));
  const longFullyAlignedEarlyShallowConfirmation =
    coinBiasAligned === true &&
    btcBiasAligned === true &&
    barsSinceDetection === 2 &&
    !isAtLeast(confirmationDistancePct, 0.7);
  const longLateExtendedConfirmation =
    isAtLeast(barsSinceDetection, 6) &&
    isAtLeast(confirmationDistancePct, 1.5) &&
    !isAtMost(atrPct, 1.0);

  return (
    longOverextendedWithoutVolumeSupport ||
    longBtcLedWithoutCoinSupport ||
    longDoubleConflictWithoutMaturity ||
    longDoubleConflictOverextended ||
    longDoubleConflictStaleConfirmation ||
    longFullyAlignedEarlyShallowConfirmation ||
    longFullyAlignedLateWeakConfirmation ||
    longLateExtendedConfirmation
  );
};

const getLongDeterministicQuality = ({
  confirmationReady,
  structureAdvanced,
  hardBlockReasons,
  divergenceAmplitudeAtrRatio,
  reclaimPct,
  confirmationCandleQuality,
  atrPct,
  confirmationDistancePct,
  reboundFromPivotPct,
  volumeDivergenceStrength,
  volumeDivergenceRatio,
  deltaAligned,
  barsSinceDetection,
  coinBiasAligned,
  btcBiasAligned,
  derivativesDirectionAligned,
  derivativesRiskFlags,
  entryThresholds,
  aiThresholds,
}: {
  confirmationReady: boolean;
  structureAdvanced: boolean;
  hardBlockReasons: HardBlockReason[];
  divergenceAmplitudeAtrRatio: number | null;
  reclaimPct: number | null;
  confirmationCandleQuality: number | null;
  atrPct: number | null;
  confirmationDistancePct: number | null;
  reboundFromPivotPct: number | null;
  volumeDivergenceStrength: number | null;
  volumeDivergenceRatio: number | null;
  deltaAligned: boolean | null;
  barsSinceDetection: number | null;
  coinBiasAligned: boolean | null;
  btcBiasAligned: boolean | null;
  derivativesDirectionAligned: boolean | null;
  derivativesRiskFlags: string[];
  entryThresholds: VolumeDivergenceEntryThresholdSnapshot;
  aiThresholds: VolumeDivergenceAiThresholds | null;
}) => {
  if (hardBlockReasons.length > 0) {
    return 2;
  }

  const reboundModerate = isAtLeast(reboundFromPivotPct, 0.6);
  const reboundStrong = isAtLeast(reboundFromPivotPct, 1.2);
  const reboundVeryStrong = isAtLeast(reboundFromPivotPct, 1.8);
  const confirmationDistanceModerate = isAtLeast(confirmationDistancePct, 0.35);
  const confirmationDistanceStrong = isAtLeast(confirmationDistancePct, 0.7);
  const confirmationDistanceContained = isAtMost(confirmationDistancePct, 1.4);
  const confirmationDistanceBalanced = isInRange(
    confirmationDistancePct,
    0.45,
    1.1,
  );
  const maturityReady = isAtLeast(barsSinceDetection, 2);
  const maturityFresh = isInRange(barsSinceDetection, 2, 5);
  const maturityCounterTrend = isInRange(barsSinceDetection, 2, 4);
  const calmAtr = isAtMost(atrPct, 0.95);
  const veryCalmAtr = isAtMost(atrPct, 0.85);
  const volumeModerate = isAtLeast(volumeDivergenceStrength, 5);
  const volumeStrong = isAtLeast(volumeDivergenceStrength, 15);
  const volumeVeryStrong = isAtLeast(volumeDivergenceStrength, 30);
  const volumeRatioModerate = isAtLeast(volumeDivergenceRatio, 1.3);
  const volumeRatioStrong = isAtLeast(volumeDivergenceRatio, 1.7);
  const volumeRatioVeryStrong = isAtLeast(volumeDivergenceRatio, 2.2);
  const longBiasConflictCount =
    Number(coinBiasAligned === false) + Number(btcBiasAligned === false);
  const longQ4DerivativesConflict =
    derivativesRiskFlags.includes('oi_not_confirming') &&
    derivativesDirectionAligned !== true;
  const longQ4Demotion = getLongQ4Demotion({
    divergenceAmplitudeAtrRatio,
    volumeDivergenceRatio,
    coinBiasAligned,
    btcBiasAligned,
    confirmationDistancePct,
    barsSinceDetection,
    atrPct,
    reclaimPct,
  });
  const q4SetupReady =
    aiThresholds != null &&
    isAtLeast(
      divergenceAmplitudeAtrRatio,
      aiThresholds.q4DivergenceAmplitudeAtrRatio,
    ) &&
    isAtLeast(reclaimPct, aiThresholds.q4ReclaimPct) &&
    isAtLeast(
      confirmationCandleQuality,
      aiThresholds.q4ConfirmationCandleQuality,
    );
  const q5SetupReady =
    aiThresholds != null &&
    isAtLeast(
      divergenceAmplitudeAtrRatio,
      aiThresholds.q5DivergenceAmplitudeAtrRatio,
    ) &&
    isAtLeast(reclaimPct, aiThresholds.q5ReclaimPct) &&
    isAtLeast(
      confirmationCandleQuality,
      aiThresholds.q5ConfirmationCandleQuality,
    );
  const minimumSetupReady =
    isAtLeast(
      divergenceAmplitudeAtrRatio,
      entryThresholds.minDivergenceAmplitudeAtrRatio,
    ) &&
    isAtLeast(reclaimPct, entryThresholds.minReclaimPct) &&
    isAtLeast(
      confirmationCandleQuality,
      entryThresholds.minConfirmationCandleQuality,
    );
  const longSelectivePromotion =
    confirmationReady &&
    minimumSetupReady &&
    reboundStrong &&
    confirmationDistanceBalanced &&
    maturityFresh &&
    calmAtr &&
    volumeStrong &&
    volumeRatioStrong &&
    isAtLeast(reclaimPct, Math.max(entryThresholds.minReclaimPct + 15, 130)) &&
    isAtLeast(
      confirmationCandleQuality,
      Math.max(entryThresholds.minConfirmationCandleQuality + 0.1, 0.7),
    ) &&
    deltaAligned !== false &&
    longBiasConflictCount <= 1 &&
    !longQ4Demotion;
  const longAlignedFnPromotion =
    confirmationReady &&
    minimumSetupReady &&
    coinBiasAligned === true &&
    btcBiasAligned === true &&
    reboundStrong &&
    calmAtr &&
    isAtLeast(reclaimPct, 145) &&
    isAtLeast(confirmationCandleQuality, 0.8) &&
    isAtMost(divergenceAmplitudeAtrRatio, 1.8) &&
    isAtMost(confirmationDistancePct, 0.8) &&
    !longQ4Demotion;
  const longSemiAlignedFnPromotion =
    confirmationReady &&
    minimumSetupReady &&
    (coinBiasAligned === true || btcBiasAligned === true) &&
    reboundStrong &&
    isAtLeast(reclaimPct, 140) &&
    isAtLeast(confirmationCandleQuality, 0.8) &&
    isAtMost(divergenceAmplitudeAtrRatio, 2.5) &&
    !longQ4Demotion;
  const longCounterTrendSelectivePromotion =
    confirmationReady &&
    minimumSetupReady &&
    reboundStrong &&
    confirmationDistanceBalanced &&
    maturityCounterTrend &&
    veryCalmAtr &&
    volumeVeryStrong &&
    volumeRatioVeryStrong &&
    isAtLeast(reclaimPct, 130) &&
    isAtLeast(
      confirmationCandleQuality,
      Math.max(entryThresholds.minConfirmationCandleQuality + 0.1, 0.7),
    ) &&
    longBiasConflictCount === 2 &&
    !longQ4Demotion;

  if (
    confirmationReady &&
    q5SetupReady &&
    reboundVeryStrong &&
    confirmationDistanceStrong &&
    confirmationDistanceContained &&
    maturityReady &&
    calmAtr &&
    volumeVeryStrong &&
    volumeRatioVeryStrong &&
    deltaAligned === true &&
    longBiasConflictCount === 0 &&
    !longQ4Demotion
  ) {
    return 5;
  }

  if (
    longCounterTrendSelectivePromotion ||
    longSemiAlignedFnPromotion ||
    longAlignedFnPromotion ||
    longSelectivePromotion ||
    (confirmationReady &&
      q4SetupReady &&
      reboundStrong &&
      confirmationDistanceModerate &&
      confirmationDistanceContained &&
      volumeModerate &&
      volumeRatioModerate &&
      !longQ4DerivativesConflict &&
      !longQ4Demotion &&
      deltaAligned !== false)
  ) {
    return 4;
  }

  if (confirmationReady && minimumSetupReady && reboundModerate) {
    return 3;
  }

  if (structureAdvanced && isAtLeast(reboundFromPivotPct, 0.25)) {
    return 3;
  }

  return 2;
};

const getShortDeterministicQuality = ({
  confirmationReady,
  structureAdvanced,
  hardBlockReasons,
  divergenceAmplitudeAtrRatio,
  reclaimPct,
  confirmationCandleQuality,
  reboundFromPivotPct,
  volumeDivergenceStrength,
  venueSpreadZScore,
  sessionPhase,
  deltaAligned,
  barsSinceDetection,
  coinBiasAligned,
  btcBiasAligned,
  derivativesLiqSpikeRatio,
  entryThresholds,
  aiThresholds,
}: {
  confirmationReady: boolean;
  structureAdvanced: boolean;
  hardBlockReasons: HardBlockReason[];
  divergenceAmplitudeAtrRatio: number | null;
  reclaimPct: number | null;
  confirmationCandleQuality: number | null;
  reboundFromPivotPct: number | null;
  volumeDivergenceStrength: number | null;
  venueSpreadZScore: number | null;
  sessionPhase: string | null;
  deltaAligned: boolean | null;
  barsSinceDetection: number | null;
  coinBiasAligned: boolean | null;
  btcBiasAligned: boolean | null;
  derivativesLiqSpikeRatio: number | null;
  entryThresholds: VolumeDivergenceEntryThresholdSnapshot;
  aiThresholds: VolumeDivergenceAiThresholds | null;
}) => {
  if (hardBlockReasons.length > 0) {
    return 2;
  }

  const reboundModerate = isAtLeast(reboundFromPivotPct, 0.6);
  const reboundStrong = isAtLeast(reboundFromPivotPct, 1.2);
  const reboundVeryStrong = isAtLeast(reboundFromPivotPct, 1.8);
  const volumeVeryStrong = isAtLeast(volumeDivergenceStrength, 30);
  const shortBiasConflictCount =
    Number(coinBiasAligned === false) + Number(btcBiasAligned === false);
  const weakAmplitudeBand = isInRange(divergenceAmplitudeAtrRatio, 1, 1.5);
  const shortQ4ApprovalPocket =
    sessionPhase !== 'us' &&
    !isAtLeast(venueSpreadZScore, 1) &&
    !weakAmplitudeBand;
  const q4SetupReady =
    aiThresholds != null &&
    isAtLeast(
      divergenceAmplitudeAtrRatio,
      aiThresholds.q4DivergenceAmplitudeAtrRatio,
    ) &&
    isAtLeast(reclaimPct, aiThresholds.q4ReclaimPct) &&
    isAtLeast(
      confirmationCandleQuality,
      aiThresholds.q4ConfirmationCandleQuality,
    );
  const q5SetupReady =
    aiThresholds != null &&
    isAtLeast(
      divergenceAmplitudeAtrRatio,
      aiThresholds.q5DivergenceAmplitudeAtrRatio,
    ) &&
    isAtLeast(reclaimPct, aiThresholds.q5ReclaimPct) &&
    isAtLeast(
      confirmationCandleQuality,
      aiThresholds.q5ConfirmationCandleQuality,
    );
  const minimumSetupReady =
    isAtLeast(
      divergenceAmplitudeAtrRatio,
      entryThresholds.minDivergenceAmplitudeAtrRatio,
    ) &&
    isAtLeast(reclaimPct, entryThresholds.minReclaimPct) &&
    isAtLeast(
      confirmationCandleQuality,
      entryThresholds.minConfirmationCandleQuality,
    );
  const shortAdaptivePromotion =
    confirmationReady &&
    structureAdvanced &&
    minimumSetupReady &&
    reboundStrong &&
    deltaAligned === false &&
    isAtLeast(reclaimPct, 160) &&
    isAtLeast(derivativesLiqSpikeRatio, 1);
  const shortAdaptiveConflictDemotion =
    shortBiasConflictCount === 2 &&
    isInRange(barsSinceDetection, 1, 2) &&
    isAtLeast(reclaimPct, 180) &&
    !isAtLeast(derivativesLiqSpikeRatio, 1.5);

  if (
    confirmationReady &&
    q5SetupReady &&
    reboundVeryStrong &&
    volumeVeryStrong &&
    deltaAligned === true &&
    shortBiasConflictCount === 0 &&
    shortQ4ApprovalPocket
  ) {
    return 5;
  }

  if (
    confirmationReady &&
    q4SetupReady &&
    reboundStrong &&
    volumeVeryStrong &&
    deltaAligned === true &&
    shortBiasConflictCount === 0 &&
    shortQ4ApprovalPocket
  ) {
    return 4;
  }

  if (
    shortAdaptivePromotion &&
    shortQ4ApprovalPocket &&
    !shortAdaptiveConflictDemotion
  ) {
    return 4;
  }

  if (
    confirmationReady &&
    minimumSetupReady &&
    reboundModerate &&
    deltaAligned !== false
  ) {
    return 3;
  }

  if (
    structureAdvanced &&
    isAtLeast(reboundFromPivotPct, 0.25) &&
    deltaAligned !== false
  ) {
    return 3;
  }

  return 2;
};

const getVolumeDivergenceContext = (
  signal: Signal,
): VolumeDivergenceAiContext => {
  const signalDirection = getSignalDirection(signal);
  const divergence = getDivergenceSummary(signal);
  const divergenceKind =
    divergence.kind === 'bullish' || divergence.kind === 'bearish'
      ? divergence.kind
      : null;
  const currentPrice = toFiniteNumberOrNull(signal.prices?.currentPrice);
  const currentPivotLow = toFiniteNumberOrNull(
    divergence.currentPivot?.priceLow,
  );
  const currentPivotHigh = toFiniteNumberOrNull(
    divergence.currentPivot?.priceHigh,
  );
  const previousPivotLow = toFiniteNumberOrNull(
    divergence.previousPivot?.priceLow,
  );
  const previousPivotHigh = toFiniteNumberOrNull(
    divergence.previousPivot?.priceHigh,
  );
  const currentVolumeNorm = toFiniteNumberOrNull(
    divergence.currentPivot?.volumeNorm,
  );
  const previousVolumeNorm = toFiniteNumberOrNull(
    divergence.previousPivot?.volumeNorm,
  );
  const pivotLookbackRight = toFiniteNumberOrNull(
    divergence.pivotLookbackRight,
  );
  const barsBetweenPivotConfirmations = toFiniteNumberOrNull(
    divergence.barsBetweenPivotConfirmations,
  );
  const timing = (
    signal.additionalIndicators as Record<string, unknown> | undefined
  )?.volumeDivergenceSignalTiming as
    | {
        entryTiming?: unknown;
        barsSinceDetection?: unknown;
      }
    | undefined;
  const entryTiming =
    timing?.entryTiming === 'confirmation_ready' ||
    timing?.entryTiming === 'structure_advance'
      ? timing.entryTiming
      : null;
  const barsSinceDetection = toFiniteNumberOrNull(timing?.barsSinceDetection);
  const deltaAtPivot = toFiniteNumberOrNull(
    (signal.additionalIndicators as Record<string, unknown> | undefined)
      ?.deltaAtPivot,
  );
  const setup = getVolumeDivergenceSetupSummary(signal);
  const atrPct = toFiniteNumberOrNull(setup.atrPct);
  const divergenceAmplitudeAtrRatio = toFiniteNumberOrNull(
    setup.divergenceAmplitudeAtrRatio,
  );
  const reclaimPct = toFiniteNumberOrNull(setup.reclaimPct);
  const confirmationCandleQuality = toFiniteNumberOrNull(
    setup.confirmationCandleQuality,
  );
  const setupConfirmationDistancePct = toFiniteNumberOrNull(
    setup.confirmationDistancePct,
  );
  const entryThresholds = getVolumeDivergenceThresholdSummary(signal);
  const coinMaBias = getBias(
    getSignalCoinMaFast(signal),
    getSignalCoinMaSlow(signal),
  );
  const btcMaBias = getBias(
    getSignalBtcMaFast(signal),
    getSignalBtcMaSlow(signal),
  );
  const additional = getRecord(signal.additionalIndicators);
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
  const derivativesFundingZScore =
    toFiniteNumberOrNull(derivatives15m?.fundingZScore) ??
    toFiniteNumberOrNull(derivatives1h?.fundingZScore);
  const derivativesLiqSpikeRatio =
    toFiniteNumberOrNull(derivatives15m?.liqSpikeRatio) ??
    toFiniteNumberOrNull(derivatives1h?.liqSpikeRatio);
  const btcOiChangePct1h15m = toFiniteNumberOrNull(
    derivatives15m?.oiChangePct1h,
  );
  const solOpenInterest15m = getNestedNumber(derivativesContext, [
    'referenceContexts',
    'SOLUSDT',
    'intervals',
    '15m',
    'openInterest',
  ]);
  const xrpFundingZScore15m = getNestedNumber(derivativesContext, [
    'referenceContexts',
    'XRPUSDT',
    'intervals',
    '15m',
    'fundingZScore',
  ]);
  const marketContext = getRecord(additional?.marketContext);
  const venueSpreadZScore =
    getNestedNumber(marketContext, [
      'execution',
      'binanceCoinbaseSpread',
      'zScore',
    ]) ??
    getNestedNumber(additional, [
      'baseContext',
      'relative',
      'execution',
      'venueSpreadZScore',
    ]) ??
    getNestedNumber(additional, [
      'baseContext',
      'relative',
      'execution',
      'venueSpread',
      'zScore',
    ]);
  const volumeRel20 = getNestedNumber(additional, [
    'baseContext',
    'participation',
    'volume',
    'volumeRel20',
  ]);
  const rangePosition20 = getNestedNumber(additional, [
    'baseContext',
    'structure',
    'localRange',
    'rangePosition20',
  ]);
  const session = getNestedRecord(additional, [
    'baseContext',
    'regime',
    'session',
  ]);
  const sessionPhase =
    typeof session?.sessionPhase === 'string' ? session.sessionPhase : null;

  const confirmationPrice =
    divergenceKind === 'bullish'
      ? currentPivotHigh
      : divergenceKind === 'bearish'
        ? currentPivotLow
        : null;

  const confirmationReady =
    divergenceKind === 'bullish'
      ? currentPrice != null &&
        confirmationPrice != null &&
        currentPrice >= confirmationPrice
      : divergenceKind === 'bearish'
        ? currentPrice != null &&
          confirmationPrice != null &&
          currentPrice <= confirmationPrice
        : false;
  const confirmationDistancePct = getConfirmationDistancePct({
    signalDirection,
    currentPrice,
    confirmationPrice,
    setupValue: setupConfirmationDistancePct,
  });

  const structureAdvanced =
    divergenceKind === 'bullish'
      ? currentPrice != null &&
        previousPivotLow != null &&
        currentPrice >= previousPivotLow
      : divergenceKind === 'bearish'
        ? currentPrice != null &&
          previousPivotHigh != null &&
          currentPrice <= previousPivotHigh
        : false;

  const reboundFromPivotPct =
    divergenceKind === 'bullish' &&
    currentPrice != null &&
    currentPivotLow != null &&
    currentPivotLow > 0
      ? ((currentPrice - currentPivotLow) / currentPivotLow) * 100
      : divergenceKind === 'bearish' &&
          currentPrice != null &&
          currentPivotHigh != null &&
          currentPivotHigh > 0
        ? ((currentPivotHigh - currentPrice) / currentPivotHigh) * 100
        : null;

  const priceDisplacementPct =
    divergenceKind === 'bullish' &&
    currentPivotLow != null &&
    previousPivotLow != null &&
    previousPivotLow > 0
      ? ((previousPivotLow - currentPivotLow) / previousPivotLow) * 100
      : divergenceKind === 'bearish' &&
          currentPivotHigh != null &&
          previousPivotHigh != null &&
          previousPivotHigh > 0
        ? ((currentPivotHigh - previousPivotHigh) / previousPivotHigh) * 100
        : null;

  const volumeDivergenceStrength =
    divergenceKind === 'bullish' &&
    currentVolumeNorm != null &&
    previousVolumeNorm != null
      ? currentVolumeNorm - previousVolumeNorm
      : divergenceKind === 'bearish' &&
          currentVolumeNorm != null &&
          previousVolumeNorm != null
        ? previousVolumeNorm - currentVolumeNorm
        : null;

  const volumeDivergenceRatio =
    divergenceKind === 'bullish' &&
    currentVolumeNorm != null &&
    previousVolumeNorm != null &&
    previousVolumeNorm > 0
      ? currentVolumeNorm / previousVolumeNorm
      : divergenceKind === 'bearish' &&
          currentVolumeNorm != null &&
          previousVolumeNorm != null &&
          currentVolumeNorm > 0
        ? previousVolumeNorm / currentVolumeNorm
        : null;

  const deltaAligned =
    signalDirection === 'LONG'
      ? deltaAtPivot != null
        ? deltaAtPivot > 0
        : null
      : signalDirection === 'SHORT'
        ? deltaAtPivot != null
          ? deltaAtPivot < 0
          : null
        : null;

  const coinBiasAligned =
    signalDirection === 'LONG'
      ? coinMaBias != null
        ? coinMaBias === 'bullish'
        : null
      : signalDirection === 'SHORT'
        ? coinMaBias != null
          ? coinMaBias === 'bearish'
          : null
        : null;

  const btcBiasAligned =
    signalDirection === 'LONG'
      ? btcMaBias != null
        ? btcMaBias === 'bullish'
        : null
      : signalDirection === 'SHORT'
        ? btcMaBias != null
          ? btcMaBias === 'bearish'
          : null
        : null;

  const aiThresholds =
    signalDirection != null
      ? getVolumeDivergenceAiThresholds(signalDirection)
      : null;
  const hardBlockReasons = buildHardBlockReasons({
    confirmationReady,
    reboundFromPivotPct,
    divergenceAmplitudeAtrRatio,
    reclaimPct,
    confirmationCandleQuality,
    entryThresholds,
  });

  const deterministicQuality =
    signalDirection === 'LONG'
      ? getLongDeterministicQuality({
          confirmationReady,
          structureAdvanced,
          hardBlockReasons,
          divergenceAmplitudeAtrRatio,
          reclaimPct,
          confirmationCandleQuality,
          atrPct,
          confirmationDistancePct,
          reboundFromPivotPct,
          volumeDivergenceStrength,
          volumeDivergenceRatio,
          deltaAligned,
          barsSinceDetection,
          coinBiasAligned,
          btcBiasAligned,
          derivativesDirectionAligned,
          derivativesRiskFlags,
          entryThresholds,
          aiThresholds,
        })
      : signalDirection === 'SHORT'
        ? getShortDeterministicQuality({
            confirmationReady,
            structureAdvanced,
            hardBlockReasons,
            divergenceAmplitudeAtrRatio,
            reclaimPct,
            confirmationCandleQuality,
            reboundFromPivotPct,
            volumeDivergenceStrength,
            venueSpreadZScore,
            sessionPhase,
            deltaAligned,
            barsSinceDetection,
            coinBiasAligned,
            btcBiasAligned,
            derivativesLiqSpikeRatio,
            entryThresholds,
            aiThresholds,
          })
        : hardBlockReasons.length > 0
          ? 2
          : 3;
  const derivativesRegimePocket =
    isAtMost(btcOiChangePct1h15m, BTC_OI_CHANGE_PCT_1H_15M_MAX) &&
    isAtLeast(solOpenInterest15m, SOL_OPEN_INTEREST_15M_MIN) &&
    isAtMost(xrpFundingZScore15m, XRP_FUNDING_Z_SCORE_15M_MAX);
  const maxAllowedQuality = derivativesRegimePocket
    ? Math.max(deterministicQuality, 4)
    : deterministicQuality;
  const derivativesPocketBlockAllowed =
    hardBlockReasons.length === 0 ||
    hasOnlyWeakAmplitudeBlock(hardBlockReasons);
  const approvalAllowedNow =
    confirmationReady &&
    derivativesRegimePocket &&
    derivativesPocketBlockAllowed &&
    maxAllowedQuality >= 4;

  return {
    signalDirection,
    divergenceKind,
    confirmationPrice,
    confirmationReady,
    structureAdvanced,
    reboundFromPivotPct,
    confirmationDistancePct,
    priceDisplacementPct,
    atrPct,
    divergenceAmplitudeAtrRatio,
    reclaimPct,
    confirmationCandleQuality,
    volumeDivergenceStrength,
    volumeDivergenceRatio,
    deltaAtPivot,
    deltaAligned,
    barsSincePivot: pivotLookbackRight,
    barsBetweenPivotConfirmations,
    entryTiming,
    barsSinceDetection,
    coinMaBias,
    btcMaBias,
    coinBiasAligned,
    btcBiasAligned,
    derivativesDirectionAligned,
    derivativesRiskFlags,
    derivativesFundingZScore,
    derivativesLiqSpikeRatio,
    venueSpreadZScore,
    volumeRel20,
    rangePosition20,
    btcOiChangePct1h15m,
    solOpenInterest15m,
    xrpFundingZScore15m,
    derivativesRegimePocket,
    sessionPhase,
    hardBlockReasons,
    structuralHardBlockReasons: [...hardBlockReasons],
    deterministicQuality,
    approvalAllowedNow,
    maxAllowedQuality,
  };
};

const getVolumeDivergenceContextFromPayload = (
  payload: AiPayload,
  signal: Signal,
): VolumeDivergenceAiContext => {
  const additional = payload.additionalIndicators as
    | Record<string, unknown>
    | undefined;
  const fromPayload = additional?.volumeDivergenceContext;

  if (fromPayload && typeof fromPayload === 'object') {
    return fromPayload as VolumeDivergenceAiContext;
  }

  return getVolumeDivergenceContext(signal);
};

const clampQuality = (quality: number, maxAllowedQuality: number) =>
  Math.max(1, Math.min(5, Math.min(quality, maxAllowedQuality)));

const getHardBlockReasonText = (reason: HardBlockReason) => {
  switch (reason) {
    case 'no_rebound_from_pivot':
      return 'price failed to move away from the pivot in the reversal direction';
    case 'weak_divergence_amplitude':
      return 'divergence amplitude is too small relative to ATR';
    case 'weak_reclaim':
      return 'price reclaimed too little structure after the pivot';
    case 'weak_confirmation_candle':
      return 'confirmation candle is too weak';
    default:
      return reason;
  }
};

const buildGuardrailReason = (context: VolumeDivergenceAiContext) => {
  if (context.hardBlockReasons.length > 0) {
    return `VolumeDivergence guardrail: ${context.hardBlockReasons
      .map(getHardBlockReasonText)
      .join('; ')}.`;
  }

  if (!context.confirmationReady && context.entryTiming == null) {
    return 'VolumeDivergence guardrail: reversal is visible, but the confirmation level has not been cleared yet.';
  }

  return 'VolumeDivergence guardrail: quality is limited by confirmation state and the strength of reversal away from the pivot.';
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
  const context = getVolumeDivergenceContextFromPayload(payload, signal);
  const signalDirection = getSignalDirection(signal);
  const requestedDirection =
    analysis.direction === signalDirection ? signalDirection : null;
  const finalDirection =
    requestedDirection != null && context.approvalAllowedNow
      ? requestedDirection
      : null;
  const requestedQuality =
    typeof analysis.quality === 'number'
      ? analysis.quality
      : context.maxAllowedQuality;
  const finalQuality = clampQuality(
    requestedQuality,
    context.maxAllowedQuality,
  );
  const needRetest = finalDirection == null;
  const retestPrice = needRetest ? context.confirmationPrice : null;
  const approvedQuality =
    finalDirection != null && context.maxAllowedQuality >= 4
      ? Math.max(finalQuality, 4)
      : finalQuality;

  if (finalDirection == null) {
    return {
      ...analysis,
      direction: null,
      quality: finalQuality,
      needRetest,
      retestPrice,
      takeProfitPrice: null,
      stopLossPrice: null,
      qualityReason: analysis.qualityReason || buildGuardrailReason(context),
      triggerInvalidation:
        analysis.triggerInvalidation ||
        (context.confirmationPrice != null
          ? `Wait for reversal confirmation relative to level ${context.confirmationPrice}.`
          : 'Wait for a confirmed reversal after the pivot.'),
      comment:
        analysis.comment ||
        (context.hardBlockReasons.length > 0
          ? `VolumeDivergence rejected: ${context.hardBlockReasons
              .map(getHardBlockReasonText)
              .join('; ')}.`
          : 'VolumeDivergence remains in watch mode until the reversal is confirmed.'),
    };
  }

  return {
    ...analysis,
    direction: finalDirection,
    quality: approvedQuality,
    needRetest,
    retestPrice,
    takeProfitPrice: signal.prices?.takeProfitPrice ?? null,
    stopLossPrice: signal.prices?.stopLossPrice ?? null,
  };
};

export const volumeDivergenceAiAdapter: StrategyAiAdapter = {
  buildPayload: ({ signal, basePayload }) => ({
    ...basePayload,
    additionalIndicators: {
      ...(basePayload.additionalIndicators as Record<string, unknown>),
      volumeDivergenceContext: getVolumeDivergenceContext(signal),
    } satisfies AiPayload['additionalIndicators'],
  }),
  postProcessAnalysis,
  buildSystemPromptAddon: () =>
    `${VOLUME_DIVERGENCE_CONTEXT_PROMPT}\n${VOLUME_DIVERGENCE_PAYLOAD_PROMPT}`,
  buildHumanPromptAddon: ({ signal, payload }) => {
    const context = getVolumeDivergenceContextFromPayload(payload, signal);

    return `

Additional VolumeDivergence context:
- divergenceKind=${context.divergenceKind ?? 'n/a'}
- confirmationPrice=${context.confirmationPrice ?? 'n/a'}
- confirmationReady=${context.confirmationReady}
- structureAdvanced=${context.structureAdvanced}
- reboundFromPivotPct=${context.reboundFromPivotPct?.toFixed?.(3) ?? 'n/a'}%
- atrPct=${context.atrPct?.toFixed?.(3) ?? 'n/a'}%
- divergenceAmplitudeAtrRatio=${context.divergenceAmplitudeAtrRatio?.toFixed?.(3) ?? 'n/a'}
- reclaimPct=${context.reclaimPct?.toFixed?.(3) ?? 'n/a'}
- confirmationCandleQuality=${context.confirmationCandleQuality?.toFixed?.(3) ?? 'n/a'}
- confirmationDistancePct=${context.confirmationDistancePct?.toFixed?.(3) ?? 'n/a'}%
- priceDisplacementPct=${context.priceDisplacementPct?.toFixed?.(3) ?? 'n/a'}%
- volumeDivergenceStrength=${context.volumeDivergenceStrength?.toFixed?.(3) ?? 'n/a'}
- volumeDivergenceRatio=${context.volumeDivergenceRatio?.toFixed?.(3) ?? 'n/a'}
- deltaAligned=${context.deltaAligned}
- coinBiasAligned=${context.coinBiasAligned}
- btcBiasAligned=${context.btcBiasAligned}
- derivativesDirectionAligned=${context.derivativesDirectionAligned}
- derivativesRiskFlags=${context.derivativesRiskFlags.join(', ') || 'none'}
- derivativesFundingZScore=${context.derivativesFundingZScore?.toFixed?.(3) ?? 'n/a'}
- derivativesLiqSpikeRatio=${context.derivativesLiqSpikeRatio?.toFixed?.(3) ?? 'n/a'}
- venueSpreadZScore=${context.venueSpreadZScore?.toFixed?.(3) ?? 'n/a'}
- volumeRel20=${context.volumeRel20?.toFixed?.(3) ?? 'n/a'}
- rangePosition20=${context.rangePosition20?.toFixed?.(3) ?? 'n/a'}
- btcOiChangePct1h15m=${context.btcOiChangePct1h15m?.toFixed?.(3) ?? 'n/a'}
- solOpenInterest15m=${context.solOpenInterest15m?.toFixed?.(0) ?? 'n/a'}
- xrpFundingZScore15m=${context.xrpFundingZScore15m?.toFixed?.(3) ?? 'n/a'}
- derivativesRegimePocket=${context.derivativesRegimePocket}
- barsSincePivot=${context.barsSincePivot ?? 'n/a'}
- barsBetweenPivotConfirmations=${context.barsBetweenPivotConfirmations ?? 'n/a'}
- entryTiming=${context.entryTiming ?? 'n/a'}
- barsSinceDetection=${context.barsSinceDetection ?? 'n/a'}
- deterministicQuality=${context.deterministicQuality}
- approvalAllowedNow=${context.approvalAllowedNow}
- structuralHardBlockReasons=${context.structuralHardBlockReasons.join(', ') || 'none'}
- maxAllowedQuality=${context.maxAllowedQuality}
- hardBlockReasons=${context.hardBlockReasons.join(', ') || 'none'}

Interpretation rules for VolumeDivergence:
- first evaluate whether there is a real reversal away from the pivot, not just divergence on paper;
- \`confirmationReady=false\` usually means the reversal is not fully confirmed yet;
- if price did not bounce away from the current pivot in the signal direction, do not treat the setup as confirmed;
- delta or bias conflict should reduce quality, not be ignored.
`;
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<
        VolumeDivergenceConfig,
        'AI_ENABLED' | 'AI_MODE' | 'MIN_AI_QUALITY'
      >,
    ),
};
