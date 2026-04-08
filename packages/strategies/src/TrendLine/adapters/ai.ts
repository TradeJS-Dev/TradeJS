import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import { AiPayload, StrategyAiAdapter } from '@tradejs/types';
import type { TrendLineConfig } from '../config';
import {
  buildTrendlineStructuralContext,
  getBias,
  getLastFiniteNumber,
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
Дополнение для trendline-сетапов:
- Это сетап на основе пробоя/реакции от трендовой линии; поле payload.figures.trendline содержит геометрию этой линии, а payload.additionalIndicators.trendlineContext — краткую сводку положения цены относительно линии.
- Для TrendLine роль геометрии/структуры цены приоритетнее индикаторных подтверждений.
- Касания усиливают линию, но сами по себе не подтверждают вход. Без подтвержденного пробоя/ретеста не повышай quality только из-за количества касаний.
- Для SHORT по rising support (trendline.mode="lows") обычно нужен либо явный уход цены ниже линии, либо ретест линии снизу с отбоем. Если цена остается над линией или прямо на ней, обычно direction=null и quality <= 2.
- Для LONG по descending resistance (trendline.mode="highs") зеркально: нужен выход выше линии или ретест сверху. Если цена под линией или прямо на ней, обычно direction=null и quality <= 2.
- Если payload.additionalIndicators.trendlineContext.nearLineNoise=true, не считай это подтвержденным пробоем: чаще quality <= 2-3 и ожидание ретеста/подтверждения.
- Если payload.additionalIndicators.trendlineContext.coinBiasAligned=false или btcBiasAligned=false, трактуй это как прямой конфликт с направлением сделки. В таком случае обычно не одобряй вход, если нет исключительного структурного преимущества.
- Если payload.additionalIndicators.trendlineContext.clearBreak=false и цена все еще около линии, не описывай это как "чистый пробой".
- Если clearBreak=true, но trendlineContext.weakCleanBreak=true, трактуй это как слишком слабый формальный пробой: структуру уже задело, но запаса по displacement пока мало. Обычно здесь нужен follow-through или ретест, а не немедленный вход.
- Если clearBreak=true, но trendlineContext.compressedCleanBreak=true, это сжатый пробой после серии близких касаний на короткой линии. Даже при формальном выходе за линию здесь чаще нужен follow-through или ретест, а не немедленный вход.
- Если clearBreak=true, но trendlineContext.breakVsAtrRatio < 0.5 и при этом trendlineContext.weakBtcLedBreak=true, считай это слабым BTC-led пробоем без собственного follow-through по монете. Обычно здесь нужен ретест/подтверждение, а не немедленный вход.
- Для LONG по descending resistance, если линия очень длинная, а выход над ней пока умеренный и BTC поддерживает пробой слабо, трактуй это как ранний breakout без follow-through. В таком случае чаще нужен ретест/подтверждение, а не немедленный вход.
- Для TrendLine quality 4-5 допустим только когда одновременно: clearBreak=true, nearLineNoise=false, coinBiasAligned=true и btcBiasAligned=true. Если хотя бы одно из этих условий не выполнено, не ставь quality выше 3.
- Редкое исключение: если trendlineContext.aggressivePreBreakPressure=true, это агрессивный pre-break pressure сетап. В таком случае допустим quality=4 даже без clearBreak, но только как ранний вход с tight risk и только если не конфликтуют coin/BTC bias.
- Еще одно редкое исключение: если trendlineContext.strongNearBreakPressure=true, это зрелая линия с уже начавшимся продавливанием в сторону сделки и очень сильным aligned pressure по монете и BTC. В таком случае допустим quality=4 даже при nearLineNoise=true, но только как ранний вход по сильной структуре.
`;

const TRENDLINE_PAYLOAD_PROMPT = `
- В payload.figures.trendline передается полная геометрия трендовой линии (без trim), чтобы можно было оценивать касания/структуру.
- В payload.additionalIndicators.trendlineContext передается mode / touches / distance / currentLinePrice / priceVsLinePct / priceVsLineSide / clearBreak / nearLineNoise / coinMaBias / btcMaBias / maxAllowedQuality / approvalAllowedNow / hardBlockReasons.
- Дополнительно в trendlineContext передаются atrPct / breakVsAtrRatio / coinMaSpreadPct / btcMaSpreadPct / aggressivePreBreakPressure / strongNearBreakPressure / weakCleanBreak / compressedCleanBreak / weakBtcLedBreak / weakLongFarBreak.
`;

const buildTrendlineContext = (signal: {
  direction?: unknown;
  prices?: { currentPrice?: unknown };
  indicators?: Record<string, unknown>;
  additionalIndicators?: Record<string, unknown>;
  figures?: Record<string, unknown>;
}) => {
  const structural = buildTrendlineStructuralContext(signal);
  const trendLine = getTrendLineFromPayload(signal);
  const coinMaFast = getLastFiniteNumber(signal.indicators?.maFast);
  const coinMaSlow = getLastFiniteNumber(signal.indicators?.maSlow);
  const coinMaBias = getBias(coinMaFast, coinMaSlow);
  const coinMaSpreadPct = getSpreadPct(coinMaFast, coinMaSlow);
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
  });
  const maxAllowedQuality = deterministicQuality;
  const approvalAllowedNow = deterministicQuality >= 4;

  return {
    ...structural,
    coinMaFast,
    coinMaSlow,
    coinMaBias,
    coinMaSpreadPct,
    coinBiasAligned,
    aggressivePreBreakPressure,
    strongNearBreakPressure,
    weakBtcLedBreak,
    deterministicQuality,
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
    case 'weak_clean_break':
      return 'формальный пробой есть, но displacement еще слишком слабый относительно ATR';
    case 'compressed_clean_break':
      return 'пробой выглядит слишком сжатым: серия близких касаний на короткой линии без достаточного follow-through';
    case 'weak_btc_led_break':
      return 'пробой слишком мелкий относительно ATR и больше похож на BTC-led движение без follow-through по монете';
    case 'weak_long_far_break':
      return 'для LONG пробой очень длинной линии пока слишком умеренный, а BTC поддерживает его слишком слабо';
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

  if (trendlineContext.signalDirection === 'LONG') {
    const quality5 =
      breakVsAtrRatio >= 0.8 &&
      priceVsLinePctAbs >= 0.7 &&
      distance < 300 &&
      btcMaSpreadPct >= 0.5;
    if (quality5) {
      return 5;
    }

    const quality4 =
      breakVsAtrRatio >= 0.55 &&
      priceVsLinePctAbs >= 0.5 &&
      distance < 700 &&
      btcMaSpreadPct >= 0.15;
    return quality4 ? 4 : 3;
  }

  const quality5 =
    breakVsAtrRatio >= 1.2 &&
    priceVsLinePctAbs >= 1.0 &&
    touches >= 5 &&
    btcMaSpreadPct <= -0.3;
  if (quality5) {
    return 5;
  }

  const quality4 =
    breakVsAtrRatio >= 0.8 &&
    priceVsLinePctAbs >= 0.7 &&
    touches >= 5 &&
    btcMaSpreadPct <= -0.15;
  return quality4 ? 4 : 3;
};

const getDeterministicTrendlineQualityReason = (
  trendlineContext: Pick<TrendlineQualityContext, 'signalDirection' | 'hardBlockReasons'>,
) => {
  if (trendlineContext.hardBlockReasons.length > 0) {
    return `TrendLine guardrail: вход заблокирован, потому что ${trendlineContext.hardBlockReasons
      .map(getHardBlockReasonText)
      .join('; ')}.`;
  }

  if (trendlineContext.signalDirection === 'LONG') {
    return 'TrendLine deterministic quality: пробой есть, но для LONG не хватает displacement, поддержки BTC или линия слишком длинная для немедленного входа.';
  }

  if (trendlineContext.signalDirection === 'SHORT') {
    return 'TrendLine deterministic quality: пробой есть, но для SHORT не хватает bearish displacement или follow-through, поэтому вход пока рано одобрять.';
  }

  return 'TrendLine deterministic quality: структура еще не дотягивает до входа прямо сейчас.';
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
          ? 'TrendLine strong near-break pressure: зрелая линия уже продавливается в сторону сделки, ранний вход разрешен кодом стратегии.'
          : 'TrendLine aggressive pre-break pressure: разрешен ранний вход при сильном bearish pressure и tight risk.';
      const fallbackComment =
        trendlineContext.strongNearBreakPressure === true
          ? 'TrendLine strong near-break pressure: ранний вход разрешен кодом стратегии.'
          : 'TrendLine aggressive pre-break pressure: ранний вход разрешен кодом стратегии.';

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

    if (trendlineContext.approvalAllowedNow === true && signalDirection != null) {
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
      'TrendLine guardrail: вход заблокирован до подтверждения структуры.',
      400,
    );
    const triggerInvalidation = mergeShortText(
      trendlineContext.hardBlockReasons.length > 0
        ? `Ждать чистый пробой/ретест линии и убрать конфликты: ${trendlineContext.hardBlockReasons
            .map(getHardBlockReasonText)
            .join('; ')}.`
        : 'Ждать более сильный breakout/follow-through или ретест линии с подтверждением по монете и BTC.',
      'Ждать чистый пробой/ретест линии и подтверждение по монете и BTC.',
      400,
    );
    const comment = mergeShortText(
      trendlineContext.hardBlockReasons.length > 0
        ? `TrendLine guardrail заблокировал вход: ${trendlineContext.hardBlockReasons
            .map(getHardBlockReasonText)
            .join('; ')}.`
        : 'TrendLine deterministic quality опустил вход в watch/reject до появления более сильной структуры.',
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
- trendline.atrPct=${formatPromptNumber(trendlineContext.atrPct, 3)}%
- trendline.breakVsAtrRatio=${formatPromptNumber(trendlineContext.breakVsAtrRatio, 3)}
- trendline.aggressivePreBreakPressure=${String(trendlineContext.aggressivePreBreakPressure)}
- trendline.strongNearBreakPressure=${String(trendlineContext.strongNearBreakPressure)}
- trendline.weakCleanBreak=${String(trendlineContext.weakCleanBreak)}
- trendline.compressedCleanBreak=${String(trendlineContext.compressedCleanBreak)}
- trendline.weakBtcLedBreak=${String(trendlineContext.weakBtcLedBreak)}
- trendline.weakLongFarBreak=${String(trendlineContext.weakLongFarBreak)}
- trendline.deterministicQuality=${String(trendlineContext.deterministicQuality)}
- trendline.maxAllowedQuality=${String(trendlineContext.maxAllowedQuality)}
- trendline.approvalAllowedNow=${String(trendlineContext.approvalAllowedNow)}
- trendline.hardBlockReasons=${JSON.stringify(trendlineContext.hardBlockReasons)}
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

Правило интерпретации для TrendLine:
- SHORT от линии lows подтверждается только явным уходом ниже линии или ретестом снизу с отбоем.
- LONG от линии highs подтверждается только явным уходом выше линии или ретестом сверху с отбоем.
- Если trendline.nearLineNoise=true или biasAligned=false, лучше вернуть direction=null и quality 1-3, чем одобрить вход без запаса.
- Если trendline.weakCleanBreak=true, формальный пробой уже есть, но он слишком слабый по displacement: нужен follow-through или ретест, а не quality 4-5.
- Если trendline.compressedCleanBreak=true, пробой формально есть, но линия слишком короткая и сжатая после серии близких касаний: обычно здесь нужен follow-through или ретест, а не немедленный вход.
- Если trendline.weakBtcLedBreak=true, трактуй это как мелкий пробой, который сильнее тянет BTC, чем сама монета: здесь обычно нужен ретест и quality 1-3.
- Если clearBreak=false или любой alignment=false, не поднимай quality выше 3.
- Если trendline.aggressivePreBreakPressure=true, можно рассматривать ранний SHORT до явного пробоя, но только как исключение: quality максимум 4, нужен tight stop и явное описание, что вход агрессивный.
- Если trendline.strongNearBreakPressure=true, можно рассматривать ранний SHORT при сильном давлении уже по нужную сторону линии, даже если пробой еще не дотягивает до clearBreak-порога: quality максимум 4.
- Стратегия детерминированно нормализует итоговый quality до trendline.deterministicQuality; твоя задача — объяснить решение в этих рамках, а не спорить с tier.
- Если trendline.approvalAllowedNow=false, не описывай это как сделку для входа прямо сейчас: объясняй, чего не хватает до одобрения.
`;
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<TrendLineConfig, 'AI_ENABLED' | 'MIN_AI_QUALITY'>,
    ),
};
