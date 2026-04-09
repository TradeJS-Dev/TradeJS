import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import { AiPayload, StrategyAiAdapter } from '@tradejs/types';
import { ReverseTrendLineConfig } from '../config';
import {
  buildReverseTrendlineStructuralContext,
  buildReverseTrendlineTimingContext,
  getTrendLineFromPayload,
} from '../guardrails';

const REVERSE_TRENDLINE_CONTEXT_PROMPT = `
Дополнение для ReverseTrendLine:
- Это не breakout-стратегия, а стратегия на отскок от трендовой линии.
- Для LONG по support line (trendline.mode="lows") нужен касание/ложный прокол линии и удержание закрытия выше нее.
- Для SHORT по resistance line (trendline.mode="highs") нужен касание/ложный прокол линии и удержание закрытия ниже нее.
- Если цена уже уверенно пробила линию в сторону, противоположную отскоку, это не bounce setup: direction=null и quality <= 2.
- Для bounce-сетапов приоритетнее реакция свечи на линии, rejection wick, удержание закрытия по правильную сторону и follow-through на следующем баре.
- Если payload.additionalIndicators.reverseTrendlineContext.failedBounceBreak=true, не считай сигнал структурно подтвержденным.
- Если payload.additionalIndicators.reverseTrendlineContext.entryTiming не равен ready_rejection или ready_follow_through, обычно quality <= 3.
- Конфликт BTC/coin bias снижает уверенность и обычно не дает quality 4-5.
`;

const REVERSE_TRENDLINE_PAYLOAD_PROMPT = `
- В payload.figures.trendline передается геометрия линии.
- В payload.additionalIndicators.reverseTrendlineContext передается краткая сводка bounce-логики: направление, расстояние цены до линии, был ли касание линии, была ли rejection-свеча, силу rejection, timing-stage и конфликты bias.
`;

type ReverseTimingContext = ReturnType<
  typeof buildReverseTrendlineTimingContext
>;
type ReverseStructuralContext = ReturnType<
  typeof buildReverseTrendlineStructuralContext
>;
type ReverseEntryTiming = ReverseTimingContext['entryTiming'];

type ReverseTrendlineAiContext = ReverseStructuralContext &
  ReverseTimingContext & {
    deterministicQuality: number;
    approvalAllowedNow: boolean;
    hardBlockReasons: string[];
  };

type ReverseTrendlineQualityContext = ReverseStructuralContext &
  ReverseTimingContext & {
    hardBlockReasons: string[];
  };

const getDeterministicReverseTrendlineQuality = (
  context: ReverseTrendlineQualityContext,
) => {
  if (context.hardBlockReasons.length > 0) {
    return 2;
  }

  if (
    context.entryTiming !== 'ready_rejection' &&
    context.entryTiming !== 'ready_follow_through'
  ) {
    return 3;
  }

  const rejectionStrengthPct = context.rejectionStrengthPct ?? 0;
  const rejectionWickPct = context.rejectionWickPct ?? 0;
  const touches = context.touches ?? 0;
  const distance = context.distance ?? Number.POSITIVE_INFINITY;
  const coinOk = context.coinBiasAligned !== false;
  const btcOk = context.btcBiasAligned !== false;

  const quality5 =
    context.entryTiming === 'ready_follow_through' &&
    rejectionStrengthPct >= 0.3 &&
    rejectionWickPct >= 0.2 &&
    touches >= 5 &&
    distance < 300 &&
    context.coinBiasAligned === true &&
    context.btcBiasAligned === true;

  if (quality5) {
    return 5;
  }

  const quality4 =
    rejectionStrengthPct >= 0.12 &&
    rejectionWickPct >= 0.1 &&
    touches >= 4 &&
    distance < 800 &&
    coinOk &&
    btcOk;

  return quality4 ? 4 : 3;
};

const buildReverseTrendlineAiContext = (signal: {
  direction?: unknown;
  prices?: { currentPrice?: unknown };
  indicators?: Record<string, unknown>;
  additionalIndicators?: Record<string, unknown>;
  figures?: Record<string, unknown>;
}): ReverseTrendlineAiContext => {
  const structural = buildReverseTrendlineStructuralContext(signal);
  const computedTiming = buildReverseTrendlineTimingContext({ signal });
  const timingFromSignal =
    typeof signal.additionalIndicators?.reverseTrendlineTiming === 'object' &&
    signal.additionalIndicators?.reverseTrendlineTiming &&
    typeof (
      signal.additionalIndicators.reverseTrendlineTiming as {
        entryTiming?: unknown;
      }
    ).entryTiming === 'string'
      ? (signal.additionalIndicators.reverseTrendlineTiming as {
          entryTiming: ReverseEntryTiming;
        })
      : null;
  const timing = timingFromSignal
    ? {
        ...computedTiming,
        ...timingFromSignal,
        entryReadyNow:
          timingFromSignal.entryTiming === 'ready_rejection' ||
          timingFromSignal.entryTiming === 'ready_follow_through',
      }
    : computedTiming;

  const hardBlockReasons = [...structural.structuralHardBlockReasons];

  if (structural.coinBiasAligned === false) {
    hardBlockReasons.push('coin_bias_conflict');
  }

  if (structural.btcBiasAligned === false) {
    hardBlockReasons.push('btc_bias_conflict');
  }

  const deterministicQuality = getDeterministicReverseTrendlineQuality({
    ...structural,
    ...timing,
    hardBlockReasons,
  });

  return {
    ...structural,
    ...timing,
    deterministicQuality,
    approvalAllowedNow: deterministicQuality >= 4,
    hardBlockReasons,
  };
};

const getReverseTrendlineContextFromPayload = (
  payload: AiPayload,
  signal: Parameters<typeof buildReverseTrendlineAiContext>[0],
) => {
  const additional = payload.additionalIndicators as
    | Record<string, unknown>
    | undefined;
  const fromPayload = additional?.reverseTrendlineContext as
    | ReverseTrendlineAiContext
    | undefined;

  return fromPayload ?? buildReverseTrendlineAiContext(signal);
};

const getHardBlockReasonText = (reason: string) => {
  switch (reason) {
    case 'failed_bounce_break':
      return 'цена пробила линию в сторону, противоположную отскоку';
    case 'coin_bias_conflict':
      return 'bias по монете конфликтует с направлением bounce-сделки';
    case 'btc_bias_conflict':
      return 'BTC-контекст конфликтует с направлением bounce-сделки';
    default:
      return reason;
  }
};

export const reverseTrendLineAiAdapter: StrategyAiAdapter = {
  buildPayload: ({ signal, basePayload }) => ({
    ...basePayload,
    figures: {
      ...basePayload.figures,
      trendline: getTrendLineFromPayload(signal),
    },
    additionalIndicators: {
      ...(basePayload.additionalIndicators as Record<string, unknown>),
      reverseTrendlineContext: buildReverseTrendlineAiContext(signal),
    } satisfies AiPayload['additionalIndicators'],
  }),
  postProcessAnalysis: ({ signal, payload, analysis }) => {
    const context = getReverseTrendlineContextFromPayload(payload, signal);
    const signalDirection =
      signal.direction === 'LONG' || signal.direction === 'SHORT'
        ? signal.direction
        : null;

    if (context.approvalAllowedNow === true && signalDirection != null) {
      return {
        ...analysis,
        direction: signalDirection,
        quality: context.deterministicQuality,
        needRetest: false,
        retestPrice: null,
        takeProfitPrice:
          analysis.takeProfitPrice ?? signal.prices?.takeProfitPrice ?? null,
        stopLossPrice:
          analysis.stopLossPrice ?? signal.prices?.stopLossPrice ?? null,
      };
    }

    return {
      ...analysis,
      direction: null,
      quality: context.deterministicQuality,
      needRetest: true,
      retestPrice: context.currentLinePrice ?? null,
      takeProfitPrice: null,
      stopLossPrice: null,
      qualityReason:
        context.hardBlockReasons.length > 0
          ? `ReverseTrendLine guardrail: ${context.hardBlockReasons
              .map(getHardBlockReasonText)
              .join('; ')}.`
          : 'ReverseTrendLine deterministic quality: отскок еще не подтвержден реакцией свечи или follow-through.',
      triggerInvalidation:
        context.hardBlockReasons.length > 0
          ? `Ждать новый bounce setup: ${context.hardBlockReasons
              .map(getHardBlockReasonText)
              .join('; ')}.`
          : 'Ждать касание линии, rejection-свечу и удержание закрытия по правильную сторону линии.',
      comment:
        context.hardBlockReasons.length > 0
          ? `ReverseTrendLine guardrail заблокировал вход: ${context.hardBlockReasons
              .map(getHardBlockReasonText)
              .join('; ')}.`
          : 'ReverseTrendLine пока переводит сетап в watch до подтверждения отскока.',
    };
  },
  buildSystemPromptAddon: () =>
    `${REVERSE_TRENDLINE_CONTEXT_PROMPT}\n${REVERSE_TRENDLINE_PAYLOAD_PROMPT}`,
  buildHumanPromptAddon: ({ signal, payload }) => {
    const context = getReverseTrendlineContextFromPayload(payload, signal);
    return `

Доп. контекст ReverseTrendLine:
- entryTiming=${context.entryTiming}
- lineTouchedNow=${context.lineTouchedNow}
- closeOnBounceSide=${context.closeOnBounceSide}
- failedBounceBreak=${context.failedBounceBreak}
- rejectionWickPct=${context.rejectionWickPct?.toFixed?.(3) ?? 'n/a'}%
- rejectionStrengthPct=${context.rejectionStrengthPct?.toFixed?.(3) ?? 'n/a'}%
- touches=${context.touches ?? 'n/a'}
- distance=${context.distance ?? 'n/a'}
- coinBiasAligned=${context.coinBiasAligned}
- btcBiasAligned=${context.btcBiasAligned}
- approvalAllowedNow=${context.approvalAllowedNow}
- hardBlockReasons=${context.hardBlockReasons.join(', ') || 'none'}

Правило интерпретации для ReverseTrendLine:
- искать структурное подтверждение реакции от линии, а не пробоя через линию;
- если уже есть failedBounceBreak=true, не считать сигнал подтвержденным;
- если setup еще в стадии wait_touch / wait_reaction_confirmation / stale_reaction, не завышать quality.
`;
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<ReverseTrendLineConfig, 'AI_ENABLED' | 'MIN_AI_QUALITY'>,
    ),
};
