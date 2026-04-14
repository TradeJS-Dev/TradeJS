import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import { AiPayload, StrategyAiAdapter } from '@tradejs/types';
import type { Signal, SignalAnalysis } from '@tradejs/types';
import type { VolumeDivergenceConfig } from '../config';
import {
  DEFAULT_VOLUME_DIVERGENCE_ENTRY_THRESHOLDS,
  getVolumeDivergenceAiThresholds,
  VolumeDivergenceAiThresholds,
  VolumeDivergenceEntryThresholdSnapshot,
  VolumeDivergenceSetupFeatures,
} from '../setup';

const VOLUME_DIVERGENCE_CONTEXT_PROMPT = `
Дополнение для VolumeDivergence:
- Это reversal-сетап на дивергенции цены и нормализованного объема, а не breakout-стратегия.
- Bullish divergence: price делает lower low, а volume делает higher low.
- Bearish divergence: price делает higher high, а volume делает lower high.
- Для bullish-сигнала не завышай quality, если цена после pivot low так и не смогла заметно отскочить от текущего pivot low или не смогла вернуть хотя бы часть структуры.
- Для bearish-сигнала зеркально: не завышай quality, если цена после pivot high не смогла заметно уйти вниз от текущего pivot high.
- Если payload.additionalIndicators.volumeDivergenceContext.confirmationReady=false, обычно это еще не fully confirmed reversal; чаще quality <= 4 и часто нужен retest/confirmation.
- Для live approve считай confirmationReady намного важнее, чем structureAdvanced: structure advance сам по себе еще не означает готовый reversal entry.
- Для reversal-сетапа не награждай quality автоматически только за то, что MA bias по монете/BTC уже совпадает с направлением сигнала.
- Для LONG с entryTiming=structure_advance обычно не ставь quality=5: это промежуточный этап, а не fully confirmed reversal.
- Для SHORT будь строже, чем для LONG: bearish reversal должен требовать более чистого follow-through, а конфликт по bias/delta должен сильнее снижать quality.
- Если deltaAtPivot конфликтует с направлением reversal или bias по монете/BTC конфликтует с сигналом, не завышай quality только из-за самой дивергенции.
- Смотри на divergenceAmplitudeAtrRatio / reclaimPct / confirmationCandleQuality: это explicit setup-features, описывающие насколько дивергенция действительно значима относительно ATR, насколько цена вернула структуру и насколько качественной была confirmation candle.
- confirmationDistancePct показывает, насколько далеко цена ушла за confirmation level; не завышай quality, если confirmation вроде бы есть, но закрепление за уровнем минимальное.
- additionalIndicators.deltaAtPivot — это proxy net-volume по свече pivot, а не настоящий lower-timeframe volume delta TradingView.
`;

const VOLUME_DIVERGENCE_PAYLOAD_PROMPT = `
- В payload.additionalIndicators.volumeDivergenceContext передается краткая сводка по силе дивергенции:
  divergenceKind / confirmationPrice / confirmationReady / structureAdvanced / reboundFromPivotPct / confirmationDistancePct / priceDisplacementPct / divergenceAmplitudeAtrRatio / reclaimPct / confirmationCandleQuality / volumeDivergenceStrength / deltaAligned / coinBiasAligned / btcBiasAligned / deterministicQuality / approvalAllowedNow / structuralHardBlockReasons / maxAllowedQuality.
- Используй этот context как explicit strategy-specific summary, а не пытайся заново вывести то же самое только по общим свечам.
`;

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
      !isAtMost(atrPct, 1.0) ||
      !isAtLeast(reclaimPct, 130));
  const longLateExtendedConfirmation =
    isAtLeast(barsSinceDetection, 6) &&
    isAtLeast(confirmationDistancePct, 1.5) &&
    !isAtMost(atrPct, 1.0);

  return (
    longOverextendedWithoutVolumeSupport ||
    longBtcLedWithoutCoinSupport ||
    longDoubleConflictWithoutMaturity ||
    longDoubleConflictOverextended ||
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
  const isCounterTrendLong = longBiasConflictCount === 2;
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
    longSelectivePromotion ||
    (confirmationReady &&
      q4SetupReady &&
      reboundModerate &&
      confirmationDistanceModerate &&
      confirmationDistanceContained &&
      volumeModerate &&
      volumeRatioModerate &&
      !longQ4Demotion &&
      (deltaAligned !== false ||
        (isCounterTrendLong &&
          reboundStrong &&
          maturityCounterTrend &&
          calmAtr &&
          isAtLeast(reclaimPct, 130) &&
          volumeStrong &&
          volumeRatioStrong)))
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
  deltaAligned,
  coinBiasAligned,
  btcBiasAligned,
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
  deltaAligned: boolean | null;
  coinBiasAligned: boolean | null;
  btcBiasAligned: boolean | null;
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

  if (
    confirmationReady &&
    q5SetupReady &&
    reboundVeryStrong &&
    volumeVeryStrong &&
    deltaAligned === true &&
    shortBiasConflictCount === 0
  ) {
    return 5;
  }

  if (
    confirmationReady &&
    q4SetupReady &&
    reboundStrong &&
    volumeVeryStrong &&
    deltaAligned === true &&
    shortBiasConflictCount === 0
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
    getLastFiniteNumber(signal.indicators?.maFast),
    getLastFiniteNumber(signal.indicators?.maSlow),
  );
  const btcMaBias = getBias(
    getLastFiniteNumber(signal.indicators?.btcMaFast),
    getLastFiniteNumber(signal.indicators?.btcMaSlow),
  );

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
            deltaAligned,
            coinBiasAligned,
            btcBiasAligned,
            entryThresholds,
            aiThresholds,
          })
        : hardBlockReasons.length > 0
          ? 2
          : 3;
  const approvalAllowedNow =
    hardBlockReasons.length === 0 &&
    deterministicQuality >= 4 &&
    confirmationReady;

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
    hardBlockReasons,
    structuralHardBlockReasons: [...hardBlockReasons],
    deterministicQuality,
    approvalAllowedNow,
    maxAllowedQuality: deterministicQuality,
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
      return 'цена не смогла уйти от pivot в сторону reversal';
    case 'weak_divergence_amplitude':
      return 'дивергенция слишком маленькая относительно ATR';
    case 'weak_reclaim':
      return 'цена вернула слишком мало структуры после pivot';
    case 'weak_confirmation_candle':
      return 'confirmation candle слишком слабая';
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
    return 'VolumeDivergence guardrail: reversal уже виден, но confirmation level еще не пройден.';
  }

  return 'VolumeDivergence guardrail: quality ограничен подтвержденностью и силой reversal away from pivot.';
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
          ? `Ждать подтверждение reversal относительно уровня ${context.confirmationPrice}.`
          : 'Ждать подтвержденный reversal после pivot.'),
      comment:
        analysis.comment ||
        (context.hardBlockReasons.length > 0
          ? `VolumeDivergence отклонен: ${context.hardBlockReasons
              .map(getHardBlockReasonText)
              .join('; ')}.`
          : 'VolumeDivergence пока остается в стадии watch до подтверждения reversal.'),
    };
  }

  return {
    ...analysis,
    direction: finalDirection,
    quality: finalQuality,
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

Доп. контекст VolumeDivergence:
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
- barsSincePivot=${context.barsSincePivot ?? 'n/a'}
- barsBetweenPivotConfirmations=${context.barsBetweenPivotConfirmations ?? 'n/a'}
- entryTiming=${context.entryTiming ?? 'n/a'}
- barsSinceDetection=${context.barsSinceDetection ?? 'n/a'}
- deterministicQuality=${context.deterministicQuality}
- approvalAllowedNow=${context.approvalAllowedNow}
- structuralHardBlockReasons=${context.structuralHardBlockReasons.join(', ') || 'none'}
- maxAllowedQuality=${context.maxAllowedQuality}
- hardBlockReasons=${context.hardBlockReasons.join(', ') || 'none'}

Правило интерпретации для VolumeDivergence:
- сначала оцени, есть ли реальный reversal away from pivot, а не просто факт дивергенции;
- confirmationReady=false обычно означает, что reversal еще не fully confirmed;
- если цена не отскочила от текущего pivot в сторону сигнала, не считай сетап подтвержденным;
- conflict по delta/bias должен снижать quality, а не игнорироваться.
`;
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<VolumeDivergenceConfig, 'AI_ENABLED' | 'MIN_AI_QUALITY'>,
    ),
};
