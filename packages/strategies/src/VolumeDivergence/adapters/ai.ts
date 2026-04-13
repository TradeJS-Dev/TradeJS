import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import { AiPayload, StrategyAiAdapter } from '@tradejs/types';
import type { Signal, SignalAnalysis } from '@tradejs/types';
import type { VolumeDivergenceConfig } from '../config';
import {
  DEFAULT_VOLUME_DIVERGENCE_ENTRY_THRESHOLDS,
  getVolumeDivergenceAiThresholds,
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
- additionalIndicators.deltaAtPivot — это proxy net-volume по свече pivot, а не настоящий lower-timeframe volume delta TradingView.
`;

const VOLUME_DIVERGENCE_PAYLOAD_PROMPT = `
- В payload.additionalIndicators.volumeDivergenceContext передается краткая сводка по силе дивергенции:
  divergenceKind / confirmationPrice / confirmationReady / structureAdvanced / reboundFromPivotPct / priceDisplacementPct / divergenceAmplitudeAtrRatio / reclaimPct / confirmationCandleQuality / volumeDivergenceStrength / deltaAligned / coinBiasAligned / btcBiasAligned / deterministicQuality / approvalAllowedNow / structuralHardBlockReasons / maxAllowedQuality.
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
  const hardBlockReasons: HardBlockReason[] = [];
  if (reboundFromPivotPct != null && reboundFromPivotPct <= 0) {
    hardBlockReasons.push('no_rebound_from_pivot');
  }
  if (
    divergenceAmplitudeAtrRatio != null &&
    divergenceAmplitudeAtrRatio < entryThresholds.minDivergenceAmplitudeAtrRatio
  ) {
    hardBlockReasons.push('weak_divergence_amplitude');
  }
  if (
    confirmationReady &&
    reclaimPct != null &&
    reclaimPct < entryThresholds.minReclaimPct
  ) {
    hardBlockReasons.push('weak_reclaim');
  }
  if (
    confirmationReady &&
    confirmationCandleQuality != null &&
    confirmationCandleQuality < entryThresholds.minConfirmationCandleQuality
  ) {
    hardBlockReasons.push('weak_confirmation_candle');
  }
  const reboundModerate =
    reboundFromPivotPct != null && reboundFromPivotPct >= 0.6;
  const reboundStrong =
    reboundFromPivotPct != null && reboundFromPivotPct >= 1.2;
  const reboundVeryStrong =
    reboundFromPivotPct != null && reboundFromPivotPct >= 1.8;
  const volumeModerate =
    volumeDivergenceStrength != null && volumeDivergenceStrength >= 5;
  const volumeStrong =
    volumeDivergenceStrength != null && volumeDivergenceStrength >= 15;
  const volumeVeryStrong =
    volumeDivergenceStrength != null && volumeDivergenceStrength >= 30;
  const longBiasConflictCount =
    Number(coinBiasAligned === false) + Number(btcBiasAligned === false);
  const shortBiasConflictCount = longBiasConflictCount;
  const isCounterTrendLong = longBiasConflictCount === 2;
  const q4SetupReady =
    aiThresholds != null &&
    divergenceAmplitudeAtrRatio != null &&
    reclaimPct != null &&
    confirmationCandleQuality != null &&
    divergenceAmplitudeAtrRatio >= aiThresholds.q4DivergenceAmplitudeAtrRatio &&
    reclaimPct >= aiThresholds.q4ReclaimPct &&
    confirmationCandleQuality >= aiThresholds.q4ConfirmationCandleQuality;
  const q5SetupReady =
    aiThresholds != null &&
    divergenceAmplitudeAtrRatio != null &&
    reclaimPct != null &&
    confirmationCandleQuality != null &&
    divergenceAmplitudeAtrRatio >= aiThresholds.q5DivergenceAmplitudeAtrRatio &&
    reclaimPct >= aiThresholds.q5ReclaimPct &&
    confirmationCandleQuality >= aiThresholds.q5ConfirmationCandleQuality;
  const minimumSetupReady =
    divergenceAmplitudeAtrRatio != null &&
    reclaimPct != null &&
    confirmationCandleQuality != null &&
    divergenceAmplitudeAtrRatio >=
      entryThresholds.minDivergenceAmplitudeAtrRatio &&
    reclaimPct >= entryThresholds.minReclaimPct &&
    confirmationCandleQuality >= entryThresholds.minConfirmationCandleQuality;

  let deterministicQuality = 3;

  if (hardBlockReasons.length > 0) {
    deterministicQuality = 2;
  } else if (signalDirection === 'LONG') {
    if (
      confirmationReady &&
      q5SetupReady &&
      reboundVeryStrong &&
      volumeVeryStrong &&
      deltaAligned === true &&
      longBiasConflictCount === 0
    ) {
      deterministicQuality = 5;
    } else if (
      confirmationReady &&
      q4SetupReady &&
      reboundModerate &&
      volumeModerate &&
      (deltaAligned !== false ||
        (isCounterTrendLong && reboundStrong && volumeStrong))
    ) {
      deterministicQuality = 4;
    } else if (confirmationReady && minimumSetupReady && reboundModerate) {
      deterministicQuality = 3;
    } else if (
      structureAdvanced &&
      reboundFromPivotPct != null &&
      reboundFromPivotPct >= 0.25
    ) {
      deterministicQuality = 3;
    } else {
      deterministicQuality = 2;
    }
  } else if (signalDirection === 'SHORT') {
    if (
      confirmationReady &&
      q5SetupReady &&
      reboundVeryStrong &&
      volumeVeryStrong &&
      deltaAligned === true &&
      shortBiasConflictCount === 0
    ) {
      deterministicQuality = 5;
    } else if (
      confirmationReady &&
      q4SetupReady &&
      reboundStrong &&
      volumeVeryStrong &&
      deltaAligned === true &&
      shortBiasConflictCount === 0
    ) {
      deterministicQuality = 4;
    } else if (
      confirmationReady &&
      minimumSetupReady &&
      reboundModerate &&
      deltaAligned !== false
    ) {
      deterministicQuality = 3;
    } else if (
      structureAdvanced &&
      reboundFromPivotPct != null &&
      reboundFromPivotPct >= 0.25 &&
      deltaAligned !== false
    ) {
      deterministicQuality = 3;
    } else {
      deterministicQuality = 2;
    }
  }
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
