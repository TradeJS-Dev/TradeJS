import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import { AiPayload, StrategyAiAdapter } from '@tradejs/types';
import { TrendShiftConfig } from '../config';

type TrendShiftContext = {
  signalDirection?: 'LONG' | 'SHORT';
  confirmedFlip?: boolean;
  bullFlip?: boolean;
  bearFlip?: boolean;
  flipDistanceOk?: boolean;
  closeVsAvgPct?: number;
  bandWidthPct?: number;
  avgSlopePct?: number;
  distanceAtrRatio?: number;
  coinBias?: 'bullish' | 'bearish' | 'neutral' | 'unknown';
  coinBiasAligned?: boolean | null;
  currentPrice?: number;
  avg?: number;
};

type TrendShiftAiContext = TrendShiftContext & {
  deterministicQuality: number;
  approvalAllowedNow: boolean;
  hardBlockReasons: string[];
};

const getTrendShiftContext = (payload: AiPayload): TrendShiftAiContext => {
  const additional = payload.additionalIndicators as
    | Record<string, unknown>
    | undefined;
  const raw = (additional?.trendShiftContext ?? {}) as TrendShiftContext;
  const hardBlockReasons: string[] = [];

  if (!raw.confirmedFlip) {
    hardBlockReasons.push('unconfirmed_flip');
  }
  if (!raw.flipDistanceOk) {
    hardBlockReasons.push('weak_flip_distance');
  }
  if (raw.coinBiasAligned === false) {
    hardBlockReasons.push('coin_bias_conflict');
  }

  const slopeAbs = Math.abs(raw.avgSlopePct ?? 0);
  const distanceAtrRatio = raw.distanceAtrRatio ?? 0;
  const closeVsAvgPctAbs = Math.abs(raw.closeVsAvgPct ?? 0);

  let deterministicQuality = 3;
  if (hardBlockReasons.length > 0) {
    deterministicQuality = raw.confirmedFlip ? 2 : 1;
  } else if (
    distanceAtrRatio >= 0.8 &&
    slopeAbs >= 0.09 &&
    closeVsAvgPctAbs >= 0.12
  ) {
    deterministicQuality = 5;
  } else if (
    distanceAtrRatio >= 0.45 &&
    slopeAbs >= 0.04 &&
    closeVsAvgPctAbs >= 0.05
  ) {
    deterministicQuality = 4;
  }

  return {
    ...raw,
    deterministicQuality,
    approvalAllowedNow: deterministicQuality >= 4,
    hardBlockReasons,
  };
};

const reasonText = (reason: string) => {
  switch (reason) {
    case 'unconfirmed_flip':
      return 'внутренний разворот еще не подтвержден';
    case 'weak_flip_distance':
      return 'цена отошла от adaptive average слишком слабо';
    case 'coin_bias_conflict':
      return 'MA-bias по монете конфликтует с направлением flip';
    default:
      return reason;
  }
};

export const trendShiftAiAdapter: StrategyAiAdapter = {
  buildPayload: ({ signal, basePayload }) => ({
    ...basePayload,
    additionalIndicators: {
      ...(basePayload.additionalIndicators as Record<string, unknown>),
      trendShiftContext: (
        signal.additionalIndicators as Record<string, unknown> | undefined
      )?.trendShiftContext,
    },
  }),
  postProcessAnalysis: ({ payload, analysis }) => {
    const context = getTrendShiftContext(payload);
    const requestedDirection =
      analysis.direction === 'LONG' || analysis.direction === 'SHORT'
        ? analysis.direction
        : context.signalDirection;

    if (context.approvalAllowedNow === true && requestedDirection != null) {
      return {
        ...analysis,
        direction: requestedDirection,
        quality: context.deterministicQuality,
        approved: true,
      };
    }

    return {
      ...analysis,
      direction: null,
      quality: context.deterministicQuality,
      approved: false,
      rejectReason:
        context.hardBlockReasons.length > 0
          ? context.hardBlockReasons.map(reasonText).join('; ')
          : 'flip еще не выглядит достаточно сильным для live approval',
    };
  },
  buildHumanPromptAddon: ({ payload }) => {
    const context = getTrendShiftContext(payload);
    return `
Доп. контекст TrendShift:
- signalDirection=${context.signalDirection ?? 'n/a'}
- confirmedFlip=${String(context.confirmedFlip)}
- bullFlip=${String(context.bullFlip)}
- bearFlip=${String(context.bearFlip)}
- flipDistanceOk=${String(context.flipDistanceOk)}
- closeVsAvgPct=${String(context.closeVsAvgPct ?? 'n/a')}
- bandWidthPct=${String(context.bandWidthPct ?? 'n/a')}
- avgSlopePct=${String(context.avgSlopePct ?? 'n/a')}
- distanceAtrRatio=${String(context.distanceAtrRatio ?? 'n/a')}
- coinBias=${context.coinBias ?? 'n/a'}
- coinBiasAligned=${String(context.coinBiasAligned)}
- deterministicQuality=${context.deterministicQuality}
- approvalAllowedNow=${context.approvalAllowedNow}
- hardBlockReasons=${JSON.stringify(context.hardBlockReasons)}

Правило интерпретации для TrendShift:
- Это trend-state flip стратегия, а не прогноз будущего импульса.
- Если approvalAllowedNow=false, не описывай сигнал как fully confirmed live-entry.
- Если hardBlockReasons не пустой, объясняй чего именно не хватает до подтверждения.
`.trim();
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<
        TrendShiftConfig,
        'AI_ENABLED' | 'AI_MODE' | 'MIN_AI_QUALITY'
      >,
    ),
};
