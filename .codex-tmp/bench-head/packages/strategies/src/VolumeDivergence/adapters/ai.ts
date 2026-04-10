import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import { AiPayload, StrategyAiAdapter } from '@tradejs/types';
import type { Signal, SignalAnalysis } from '@tradejs/types';
import type { VolumeDivergenceConfig } from '../config';

const VOLUME_DIVERGENCE_CONTEXT_PROMPT = `
Дополнение для VolumeDivergence:
- Это reversal-сетап на дивергенции цены и нормализованного объема, а не breakout-стратегия.
- Bullish divergence: price делает lower low, а volume делает higher low.
- Bearish divergence: price делает higher high, а volume делает lower high.
- Для bullish-сигнала не завышай quality, если цена после pivot low так и не смогла заметно отскочить от текущего pivot low или не смогла вернуть хотя бы часть структуры.
- Для bearish-сигнала зеркально: не завышай quality, если цена после pivot high не смогла заметно уйти вниз от текущего pivot high.
- Если payload.additionalIndicators.volumeDivergenceContext.confirmationReady=false, обычно это еще не fully confirmed reversal; чаще quality <= 4 и часто нужен retest/confirmation.
- Если deltaAtPivot конфликтует с направлением reversal или bias по монете/BTC конфликтует с сигналом, не завышай quality только из-за самой дивергенции.
- additionalIndicators.deltaAtPivot — это proxy net-volume по свече pivot, а не настоящий lower-timeframe volume delta TradingView.
`;

const VOLUME_DIVERGENCE_PAYLOAD_PROMPT = `
- В payload.additionalIndicators.volumeDivergenceContext передается краткая сводка по силе дивергенции:
  divergenceKind / confirmationPrice / confirmationReady / structureAdvanced / reboundFromPivotPct / priceDisplacementPct / volumeDivergenceStrength / deltaAligned / coinBiasAligned / btcBiasAligned / maxAllowedQuality.
- Используй этот context как explicit strategy-specific summary, а не пытайся заново вывести то же самое только по общим свечам.
`;

type Direction = 'LONG' | 'SHORT';
type Bias = 'bullish' | 'bearish' | null;
type DivergenceKind = 'bullish' | 'bearish';
type HardBlockReason = 'no_rebound_from_pivot';

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
  volumeDivergenceStrength: number | null;
  volumeDivergenceRatio: number | null;
  deltaAtPivot: number | null;
  deltaAligned: boolean | null;
  barsSincePivot: number | null;
  barsBetweenPivotConfirmations: number | null;
  coinMaBias: Bias;
  btcMaBias: Bias;
  coinBiasAligned: boolean | null;
  btcBiasAligned: boolean | null;
  hardBlockReasons: HardBlockReason[];
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
  const deltaAtPivot = toFiniteNumberOrNull(
    (signal.additionalIndicators as Record<string, unknown> | undefined)
      ?.currentPivotDelta,
  );
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

  const hardBlockReasons: HardBlockReason[] =
    reboundFromPivotPct != null && reboundFromPivotPct <= 0
      ? ['no_rebound_from_pivot']
      : [];

  let score = 0;

  if (volumeDivergenceStrength != null && volumeDivergenceStrength >= 5) {
    score += 1;
  }
  if (volumeDivergenceStrength != null && volumeDivergenceStrength >= 15) {
    score += 1;
  }
  if (reboundFromPivotPct != null && reboundFromPivotPct >= 0.25) {
    score += 1;
  }
  if (reboundFromPivotPct != null && reboundFromPivotPct >= 0.6) {
    score += 1;
  }
  if (structureAdvanced) {
    score += 1;
  }
  if (confirmationReady) {
    score += 1;
  }
  if (deltaAligned === true) {
    score += 1;
  }
  if (coinBiasAligned === true) {
    score += 1;
  }
  if (btcBiasAligned === true) {
    score += 1;
  }
  if (deltaAligned === false) {
    score -= 1;
  }
  if (coinBiasAligned === false) {
    score -= 1;
  }
  if (btcBiasAligned === false) {
    score -= 1;
  }

  const maxAllowedQuality =
    hardBlockReasons.length > 0
      ? 2
      : confirmationReady && score >= 6
        ? 5
        : (confirmationReady || structureAdvanced) && score >= 4
          ? 4
          : 3;

  return {
    signalDirection,
    divergenceKind,
    confirmationPrice,
    confirmationReady,
    structureAdvanced,
    reboundFromPivotPct,
    priceDisplacementPct,
    volumeDivergenceStrength,
    volumeDivergenceRatio,
    deltaAtPivot,
    deltaAligned,
    barsSincePivot: pivotLookbackRight,
    barsBetweenPivotConfirmations,
    coinMaBias,
    btcMaBias,
    coinBiasAligned,
    btcBiasAligned,
    hardBlockReasons,
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
      return 'цена не смогла уйти от pivot в сторону reversal';
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

  if (!context.confirmationReady) {
    return 'VolumeDivergence guardrail: reversal уже виден, но confirmation level еще не пройден.';
  }

  return 'VolumeDivergence guardrail: quality ограничен подтвержденностью reversal от pivot.';
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
    requestedDirection != null && context.hardBlockReasons.length === 0
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
  const needRetest =
    finalDirection == null
      ? true
      : !context.confirmationReady || Boolean(analysis.needRetest);
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
