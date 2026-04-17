import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import {
  AiPayload,
  Signal,
  SignalAnalysis,
  StrategyAiAdapter,
} from '@tradejs/types';
import { AdaptiveMomentumRibbonConfig } from '../config';

const ADAPTIVE_MOMENTUM_RIBBON_CONTEXT_PROMPT = `
Дополнение для AdaptiveMomentumRibbon:
- Это momentum-entry на zero-cross осциллятора, а не трендлайновый breakout и не reversal от линии.
- LONG появляется, когда signalOsc переходит выше 0 и ribbon переключается в activeBuy; SHORT зеркально.
- invalidationLevel — это структурный уровень отмены сигнала на баре сигнала. Если invalidated=true или invalidationLevel оказался не с той стороны от текущей цены, не считай сетап подтвержденным.
- channelState / channelBiasAligned показывают, где цена находится относительно Keltner Channel. Для LONG плохо, если цена все еще ниже kcMidline; для SHORT плохо, если цена выше kcMidline.
- invalidationDistancePct и structuralRewardRiskRatio описывают, насколько сигнал структурно компактен. Не завышай quality, если invalidation слишком широкая или reward/risk к invalidation слабый.
- Для quality=5 нужен очень чистый momentum: правильная сторона канала, сильный signalOsc, sane invalidationDistance и отсутствие конфликтов по bias монеты и BTC.
- Если approvalAllowedNow=false или deterministicQuality<4, обычно это watch-mode, а не готовый live-approval.
`;

const ADAPTIVE_MOMENTUM_RIBBON_PAYLOAD_PROMPT = `
- В payload.additionalIndicators.adaptiveMomentumRibbonContext передается краткая сводка сигнала:
  signalOsc / oscillatorStrength / channelState / channelExtensionPct / invalidationDistancePct / structuralRewardRiskRatio / coinBiasAligned / btcBiasAligned / deterministicQuality / approvalAllowedNow / structuralHardBlockReasons.
- Используй этот контекст как основную strategy-specific интерпретацию, а не пытайся заново восстановить ее только по общим рядам.
`;

type Direction = 'LONG' | 'SHORT';
type Bias = 'bullish' | 'bearish' | null;
type AmrHardBlockReason =
  | 'invalidated'
  | 'inactive_signal_state'
  | 'oscillator_conflict'
  | 'invalidation_wrong_side';
type AmrChannelState =
  | 'above_upper'
  | 'above_midline'
  | 'inside_channel'
  | 'below_midline'
  | 'below_lower'
  | 'unknown';

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
  hardBlockReasons: AmrHardBlockReason[];
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

const asBoolean = (value: unknown) => value === true || value === 1;

const getAdaptiveMomentumRibbonSnapshot = (
  signal: Signal,
): AdaptiveMomentumRibbonSnapshot => {
  const additional = signal.additionalIndicators as Record<
    string,
    unknown
  > | null;
  const amr = additional?.amr;

  return amr && typeof amr === 'object'
    ? (amr as AdaptiveMomentumRibbonSnapshot)
    : {};
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
  > & { hardBlockReasons: AmrHardBlockReason[] },
) => {
  if (context.hardBlockReasons.length > 0) {
    return 2;
  }

  const noBiasConflict =
    context.coinBiasAligned === true && context.btcBiasAligned === true;
  const biasConflictCount =
    Number(context.coinBiasAligned === false) +
    Number(context.btcBiasAligned === false);
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

  if (
    channelSupportive &&
    channelExpansion &&
    channelExtensionStrong &&
    oscillatorElite &&
    invalidationTight &&
    structuralRrStrong &&
    noBiasConflict
  ) {
    return 5;
  }

  if (
    channelSupportive &&
    channelExpansion &&
    oscillatorModerate &&
    invalidationCompact &&
    structuralRrModerate &&
    biasConflictCount < 2 &&
    (biasConflictCount === 0 || oscillatorStrong)
  ) {
    return 4;
  }

  return 3;
};

const getHardBlockReasonText = (reason: AmrHardBlockReason) => {
  switch (reason) {
    case 'invalidated':
      return 'сигнал уже инвалидирован относительно invalidationLevel';
    case 'inactive_signal_state':
      return 'active ribbon state не подтверждает текущее направление';
    case 'oscillator_conflict':
      return 'signalOsc конфликтует с направлением сигнала';
    case 'invalidation_wrong_side':
      return 'invalidationLevel находится не с той стороны от текущей цены';
    default:
      return reason;
  }
};

const buildAdaptiveMomentumRibbonContext = (
  signal: Signal,
): AdaptiveMomentumRibbonAiContext => {
  const signalDirection = getSignalDirection(signal);
  const snapshot = getAdaptiveMomentumRibbonSnapshot(signal);
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
    getLastFiniteNumber(signal.indicators?.maFast),
    getLastFiniteNumber(signal.indicators?.maSlow),
  );
  const btcBias = getBias(
    getLastFiniteNumber(signal.indicators?.btcMaFast),
    getLastFiniteNumber(signal.indicators?.btcMaSlow),
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

  const deterministicQuality = getDeterministicAdaptiveMomentumRibbonQuality({
    signalDirection,
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
    hardBlockReasons,
  });

  return {
    signalDirection,
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
    hardBlockReasons,
    structuralHardBlockReasons: hardBlockReasons,
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
          : 'AdaptiveMomentumRibbon пока оставляет сетап в watch до более чистого momentum confirmation.'),
      triggerInvalidation:
        analysis.triggerInvalidation ||
        (retestPrice != null
          ? `Ждать подтверждение относительно уровня ${retestPrice}.`
          : 'Ждать более чистое подтверждение momentum и положения цены в Keltner channel.'),
      comment:
        analysis.comment ||
        (context.hardBlockReasons.length > 0
          ? `AdaptiveMomentumRibbon отклонен: ${context.hardBlockReasons
              .map(getHardBlockReasonText)
              .join('; ')}.`
          : 'AdaptiveMomentumRibbon пока переводит сигнал в watch до более чистого continuation confirmation.'),
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
  buildPayload: ({ signal, basePayload }) => ({
    ...basePayload,
    additionalIndicators: {
      ...(basePayload.additionalIndicators as Record<string, unknown>),
      adaptiveMomentumRibbonContext: buildAdaptiveMomentumRibbonContext(signal),
    } satisfies AiPayload['additionalIndicators'],
  }),
  postProcessAnalysis,
  buildSystemPromptAddon: () =>
    `${ADAPTIVE_MOMENTUM_RIBBON_CONTEXT_PROMPT}\n${ADAPTIVE_MOMENTUM_RIBBON_PAYLOAD_PROMPT}`,
  buildHumanPromptAddon: ({ signal, payload }) => {
    const context = getAdaptiveMomentumRibbonContextFromPayload(
      payload,
      signal,
    );

    return `

Доп. контекст AdaptiveMomentumRibbon:
- signalOsc=${context.signalOsc?.toFixed?.(3) ?? 'n/a'}
- oscillatorStrength=${context.oscillatorStrength?.toFixed?.(3) ?? 'n/a'}
- channelState=${context.channelState}
- channelBiasAligned=${context.channelBiasAligned}
- channelExtensionPct=${context.channelExtensionPct?.toFixed?.(3) ?? 'n/a'}%
- invalidationDistancePct=${context.invalidationDistancePct?.toFixed?.(3) ?? 'n/a'}%
- structuralRewardRiskRatio=${context.structuralRewardRiskRatio?.toFixed?.(3) ?? 'n/a'}
- coinBiasAligned=${context.coinBiasAligned}
- btcBiasAligned=${context.btcBiasAligned}
- deterministicQuality=${context.deterministicQuality}
- approvalAllowedNow=${context.approvalAllowedNow}
- hardBlockReasons=${context.hardBlockReasons.join(', ') || 'none'}

Правило интерпретации для AdaptiveMomentumRibbon:
- zero-cross сам по себе не делает quality высоким;
- смотри на сторону Keltner channel, sane invalidation distance и bias alignment;
- если signalOsc уже против направления или сигнал invalidated, не считать вход подтвержденным.
`;
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<
        AdaptiveMomentumRibbonConfig,
        'AI_ENABLED' | 'MIN_AI_QUALITY'
      >,
    ),
};
