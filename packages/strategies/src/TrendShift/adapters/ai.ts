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
  coinBiasConflict: boolean;
};

const getTrendShiftContext = (payload: AiPayload): TrendShiftAiContext => {
  const additional = payload.additionalIndicators as
    | Record<string, unknown>
    | undefined;
  const raw = (additional?.trendShiftContext ?? {}) as TrendShiftContext;
  const hardBlockReasons: string[] = [];
  const coinBiasConflict = raw.coinBiasAligned === false;

  if (!raw.confirmedFlip) {
    hardBlockReasons.push('unconfirmed_flip');
  }
  if (!raw.flipDistanceOk) {
    hardBlockReasons.push('weak_flip_distance');
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
    approvalAllowedNow: deterministicQuality >= 5,
    hardBlockReasons,
    coinBiasConflict,
  };
};

const reasonText = (reason: string) => {
  switch (reason) {
    case 'unconfirmed_flip':
      return 'the internal flip is not confirmed yet';
    case 'weak_flip_distance':
      return 'price moved away from the adaptive average too weakly';
    case 'coin_bias_conflict':
      return 'coin MA bias conflicts with the flip direction';
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
          : context.coinBiasConflict
            ? 'coin MA bias still conflicts with the flip; require q5-strength continuation to override it'
            : 'the flip still does not look strong enough for live approval',
    };
  },
  buildHumanPromptAddon: ({ payload }) => {
    const context = getTrendShiftContext(payload);
    return `
Additional TrendShift context:
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
- coinBiasConflict=${context.coinBiasConflict}
- hardBlockReasons=${JSON.stringify(context.hardBlockReasons)}

Interpretation rules for TrendShift:
- This is a trend-state flip strategy, not a forecast of future impulse.
- If approvalAllowedNow=false, do not describe the signal as a fully confirmed live entry.
- Ordinary q4 strength is watch-only; only q5-strength flips qualify for live approval.
- If hardBlockReasons is not empty, explain exactly what is still missing for confirmation.
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
