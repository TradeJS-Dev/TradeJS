import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import type { TrendLineConfig } from '../config';
import { AiPayload, StrategyAiAdapter } from '@tradejs/types';

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
Дополнение для trendline-сетапов:
- Это сетап на основе пробоя/реакции от трендовой линии; поле payload.figures.trendline содержит геометрию этой линии, а payload.additionalIndicators.trendlineContext — краткую сводку положения цены относительно линии.
- Для TrendLine роль геометрии/структуры цены приоритетнее индикаторных подтверждений.
- Касания усиливают линию, но сами по себе не подтверждают вход. Без подтвержденного пробоя/ретеста не повышай quality только из-за количества касаний.
- Для SHORT по rising support (trendline.mode="lows") обычно нужен либо явный уход цены ниже линии, либо ретест линии снизу с отбоем. Если цена остается над линией или прямо на ней, обычно direction=null и quality <= 2.
- Для LONG по descending resistance (trendline.mode="highs") зеркально: нужен выход выше линии или ретест сверху. Если цена под линией или прямо на ней, обычно direction=null и quality <= 2.
- Если payload.additionalIndicators.trendlineContext.nearLineNoise=true, не считай это подтвержденным пробоем: чаще quality <= 2-3 и ожидание ретеста/подтверждения.
- Если payload.additionalIndicators.trendlineContext.coinBiasAligned=false или btcBiasAligned=false, трактуй это как прямой конфликт с направлением сделки. В таком случае обычно не одобряй вход, если нет исключительного структурного преимущества.
- Если payload.additionalIndicators.trendlineContext.clearBreak=false и цена все еще около линии, не описывай это как "чистый пробой".
- Для TrendLine quality 4-5 допустим только когда одновременно: clearBreak=true, nearLineNoise=false, coinBiasAligned=true и btcBiasAligned=true. Если хотя бы одно из этих условий не выполнено, не ставь quality выше 3.
`;

const TRENDLINE_PAYLOAD_PROMPT = `
- В payload.figures.trendline передается полная геометрия трендовой линии (без trim), чтобы можно было оценивать касания/структуру.
- В payload.additionalIndicators.trendlineContext передается mode / touches / distance / currentLinePrice / priceVsLinePct / priceVsLineSide / clearBreak / nearLineNoise / coinMaBias / btcMaBias / maxAllowedQuality / approvalAllowedNow / hardBlockReasons.
`;

const toFiniteNumberOrNull = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const getLastFiniteNumber = (value: unknown) => {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  return toFiniteNumberOrNull(value[value.length - 1]);
};

const getBias = (fast: number | null, slow: number | null) => {
  if (fast == null || slow == null) {
    return null;
  }
  if (fast > slow) {
    return 'bullish';
  }
  if (fast < slow) {
    return 'bearish';
  }
  return 'flat';
};

const getTrendLineFromPayload = (
  signal: { figures?: Record<string, unknown>; additionalIndicators?: Record<string, unknown> },
) =>
  (signal.figures?.trendLine as Record<string, unknown> | undefined) ??
  (signal.additionalIndicators?.trendLine as Record<string, unknown> | undefined) ??
  null;

const buildTrendlineContext = (
  signal: {
    direction?: unknown;
    prices?: { currentPrice?: unknown };
    indicators?: Record<string, unknown>;
    additionalIndicators?: Record<string, unknown>;
    figures?: Record<string, unknown>;
  },
) => {
  const trendLine = getTrendLineFromPayload(signal);
  const currentPrice = toFiniteNumberOrNull(signal.prices?.currentPrice);
  const signalDirection =
    signal.direction === 'LONG' || signal.direction === 'SHORT'
      ? signal.direction
      : null;
  const points = Array.isArray(trendLine?.points) ? trendLine.points : [];
  const latestPoint = points.length ? points[points.length - 1] : null;
  const currentLinePrice = toFiniteNumberOrNull(
    latestPoint && typeof latestPoint === 'object'
      ? (latestPoint as { value?: unknown }).value
      : null,
  );
  const priceVsLinePct =
    currentPrice != null &&
    currentLinePrice != null &&
    currentLinePrice !== 0
      ? ((currentPrice - currentLinePrice) / currentLinePrice) * 100
      : null;
  const priceVsLineSide =
    priceVsLinePct == null
      ? null
      : priceVsLinePct > 0
        ? 'above'
        : priceVsLinePct < 0
          ? 'below'
          : 'at';
  const priceVsLinePctAbs =
    priceVsLinePct == null ? null : Math.abs(priceVsLinePct);
  const touchesTotal = toFiniteNumberOrNull(signal.additionalIndicators?.touches);
  const distance = toFiniteNumberOrNull(signal.additionalIndicators?.distance);
  const coinMaFast = getLastFiniteNumber(signal.indicators?.maFast);
  const coinMaSlow = getLastFiniteNumber(signal.indicators?.maSlow);
  const btcMaFast = getLastFiniteNumber(signal.indicators?.btcMaFast);
  const btcMaSlow = getLastFiniteNumber(signal.indicators?.btcMaSlow);
  const coinMaBias = getBias(coinMaFast, coinMaSlow);
  const btcMaBias = getBias(btcMaFast, btcMaSlow);
  const coinBiasAligned =
    signalDirection == null || coinMaBias == null
      ? null
      : signalDirection === 'SHORT'
        ? coinMaBias === 'bearish'
        : coinMaBias === 'bullish';
  const btcBiasAligned =
    signalDirection == null || btcMaBias == null
      ? null
      : signalDirection === 'SHORT'
        ? btcMaBias === 'bearish'
        : btcMaBias === 'bullish';
  const clearBreak =
    signalDirection === 'SHORT'
      ? priceVsLineSide === 'below' &&
        priceVsLinePctAbs != null &&
        priceVsLinePctAbs >= 0.35
      : signalDirection === 'LONG'
        ? priceVsLineSide === 'above' &&
          priceVsLinePctAbs != null &&
          priceVsLinePctAbs >= 0.35
        : null;
  const nearLineNoise =
    priceVsLinePctAbs == null ? null : priceVsLinePctAbs < 0.35;
  const hardBlockReasons: string[] = [];

  if (clearBreak === false) {
    hardBlockReasons.push('no_clear_break');
  }
  if (nearLineNoise === true) {
    hardBlockReasons.push('near_line_noise');
  }
  if (coinBiasAligned === false) {
    hardBlockReasons.push('coin_bias_conflict');
  }
  if (btcBiasAligned === false) {
    hardBlockReasons.push('btc_bias_conflict');
  }

  const maxAllowedQuality = hardBlockReasons.length > 0 ? 3 : 5;
  const approvalAllowedNow = hardBlockReasons.length === 0;

  return {
    signalDirection,
    mode:
      typeof trendLine?.mode === 'string'
        ? trendLine.mode
        : null,
    touches:
      touchesTotal != null
        ? touchesTotal
        : Array.isArray(trendLine?.touches)
          ? trendLine.touches.length
          : null,
    distance,
    currentLinePrice,
    currentPrice,
    priceVsLinePct,
    priceVsLineSide,
    priceVsLinePctAbs,
    clearBreak,
    nearLineNoise,
    coinMaFast,
    coinMaSlow,
    coinMaBias,
    coinBiasAligned,
    btcMaFast,
    btcMaSlow,
    btcMaBias,
    btcBiasAligned,
    maxAllowedQuality,
    approvalAllowedNow,
    hardBlockReasons,
  };
};

const formatPromptNumber = (
  value: number | null,
  fractionDigits = 4,
): string => {
  if (value == null) {
    return 'n/a';
  }
  return value.toFixed(fractionDigits);
};

const clampQuality = (value: unknown, maxAllowedQuality: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return Math.min(3, maxAllowedQuality);
  }

  return Math.max(1, Math.min(maxAllowedQuality, Math.round(parsed)));
};

const getHardBlockReasonText = (reason: string) => {
  switch (reason) {
    case 'no_clear_break':
      return 'нет чистого пробоя линии';
    case 'near_line_noise':
      return 'цена слишком близко к линии и это похоже на шум';
    case 'coin_bias_conflict':
      return 'bias по монете конфликтует с направлением';
    case 'btc_bias_conflict':
      return 'BTC-контекст конфликтует с направлением';
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

const getTrendlineContextFromPayload = (
  payload: AiPayload,
  signal: Parameters<typeof buildTrendlineContext>[0],
) => {
  const additional =
    payload.additionalIndicators as Record<string, unknown> | undefined;
  const fromPayload =
    additional?.trendlineContext as
      | ReturnType<typeof buildTrendlineContext>
      | undefined;

  return fromPayload ?? buildTrendlineContext(signal);
};

export const trendLineAiAdapter: StrategyAiAdapter = {
  // Shared builder trims nested series/figures; TrendLine keeps trendline geometry untrimmed on purpose.
  buildPayload: ({ signal, basePayload }) => ({
    ...basePayload,
    figures: {
      ...basePayload.figures,
      // Keep raw line geometry available exactly where the shared prompt expects it.
      trendline: getTrendLineFromPayload(signal),
    },
    additionalIndicators: {
      ...(basePayload.additionalIndicators as Record<string, unknown>),
      trendlineContext: buildTrendlineContext(signal),
    } satisfies AiPayload['additionalIndicators'],
  }),
  postProcessAnalysis: ({ signal, payload, analysis }) => {
    const trendlineContext = getTrendlineContextFromPayload(payload, signal);
    const hasNumericQuality = Number.isFinite(Number(analysis.quality));
    const quality = clampQuality(
      analysis.quality,
      trendlineContext.maxAllowedQuality,
    );

    if (trendlineContext.approvalAllowedNow !== false) {
      if (!hasNumericQuality || quality === analysis.quality) {
        return analysis;
      }

      return {
        ...analysis,
        quality,
      };
    }

    const reasons = trendlineContext.hardBlockReasons
      .map(getHardBlockReasonText)
      .join('; ');
    const retestPrice =
      trendlineContext.currentLinePrice ?? analysis.retestPrice ?? null;
    const qualityReason = mergeShortText(
      `TrendLine guardrail: вход заблокирован, потому что ${reasons}.`,
      'TrendLine guardrail: вход заблокирован до подтверждения структуры.',
      400,
    );
    const triggerInvalidation = mergeShortText(
      `Ждать чистый пробой/ретест линии и убрать конфликты: ${reasons}.`,
      'Ждать чистый пробой/ретест линии и подтверждение по монете и BTC.',
      400,
    );
    const comment = mergeShortText(
      `TrendLine guardrail заблокировал вход: ${reasons}.`,
      'TrendLine guardrail заблокировал вход до подтверждения структуры.',
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
        'Сейчас нет подтвержденного пробоя/ретеста трендовой для входа.',
        400,
      ),
      retestPlan: mergeShortText(
        analysis.retestPlan ?? '',
        'Ждать возврат к линии и реакцию в сторону сделки перед новым входом.',
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
    const additional =
      payload.additionalIndicators as Record<string, unknown> | undefined;
    const trendlineContext =
      additional?.trendlineContext as
        | ReturnType<typeof buildTrendlineContext>
        | undefined;

    if (!trendlineContext) {
      return '';
    }

    return `

Доп. контекст TrendLine:
- trendline.mode=${trendlineContext.mode ?? 'n/a'}
- trendline.touches=${formatPromptNumber(trendlineContext.touches, 0)}
- trendline.distance=${formatPromptNumber(trendlineContext.distance, 0)}
- trendline.currentLinePrice=${formatPromptNumber(trendlineContext.currentLinePrice, 6)}
- trendline.currentPrice=${formatPromptNumber(trendlineContext.currentPrice, 6)}
- trendline.priceVsLinePct=${formatPromptNumber(trendlineContext.priceVsLinePct, 3)}%
- trendline.priceVsLineSide=${trendlineContext.priceVsLineSide ?? 'n/a'}
- trendline.clearBreak=${String(trendlineContext.clearBreak)}
- trendline.nearLineNoise=${String(trendlineContext.nearLineNoise)}
- trendline.maxAllowedQuality=${String(trendlineContext.maxAllowedQuality)}
- trendline.approvalAllowedNow=${String(trendlineContext.approvalAllowedNow)}
- trendline.hardBlockReasons=${JSON.stringify(trendlineContext.hardBlockReasons)}
- coin.maFastLast=${formatPromptNumber(trendlineContext.coinMaFast, 6)}
- coin.maSlowLast=${formatPromptNumber(trendlineContext.coinMaSlow, 6)}
- coin.maBias=${trendlineContext.coinMaBias ?? 'n/a'}
- coin.biasAligned=${String(trendlineContext.coinBiasAligned)}
- btc.maFastLast=${formatPromptNumber(trendlineContext.btcMaFast, 2)}
- btc.maSlowLast=${formatPromptNumber(trendlineContext.btcMaSlow, 2)}
- btc.maBias=${trendlineContext.btcMaBias ?? 'n/a'}
- btc.biasAligned=${String(trendlineContext.btcBiasAligned)}

Правило интерпретации для TrendLine:
- SHORT от линии lows подтверждается только явным уходом ниже линии или ретестом снизу с отбоем.
- LONG от линии highs подтверждается только явным уходом выше линии или ретестом сверху с отбоем.
- Если trendline.nearLineNoise=true или biasAligned=false, лучше вернуть direction=null и quality 1-3, чем одобрить вход без запаса.
- Если clearBreak=false или любой alignment=false, не поднимай quality выше 3.
- Жесткое ограничение: никогда не возвращай quality выше trendline.maxAllowedQuality.
- Если trendline.approvalAllowedNow=false, не одобряй немедленный вход: обычно direction=null либо quality 1-3 с ожиданием подтверждения/ретеста.
`;
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<TrendLineConfig, 'AI_ENABLED' | 'MIN_AI_QUALITY'>,
    ),
};
