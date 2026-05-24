import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import { AiPayload, StrategyAiAdapter } from '@tradejs/types';
import { ReverseTrendLineConfig } from '../config';
import {
  buildReverseTrendlineStructuralContext,
  buildReverseTrendlineTimingContext,
  getTrendLineFromPayload,
} from '../guardrails';

const REVERSE_TRENDLINE_CONTEXT_PROMPT = `
ReverseTrendLine addon:
- This is a trendline bounce strategy, not a breakout strategy.
- For LONG on a support line (\`trendline.mode="lows"\`), you need a touch or false break of the line followed by a close back above it.
- For SHORT on a resistance line (\`trendline.mode="highs"\`), you need a touch or false break of the line followed by a close back below it.
- If price has already broken through the line with conviction in the opposite direction, this is not a bounce setup: use \`direction=null\` and \`quality <= 2\`.
- For bounce setups, prioritize candle reaction at the line, rejection wick quality, a close on the correct side, and next-bar follow-through.
- If \`payload.additionalIndicators.reverseTrendlineContext.failedBounceBreak=true\`, do not treat the signal as structurally confirmed.
- If \`payload.additionalIndicators.reverseTrendlineContext.entryTiming\` is not \`ready_rejection\` or \`ready_follow_through\`, quality is usually \`<= 3\`.
- Baseline deterministic approval for same-bar rejection is intentionally strict:
  - a strong conflict-only rejection may qualify for \`quality=4\`;
  - some same-bar rejections with \`conflictState=none\` or \`both\` may reach \`quality=4\` only with a very strong deterministic rejection score.
- For SHORT bounce setups with \`btc_bias_conflict\`, do not overstate quality; those cases usually stay in watch mode unless the structural confirmation is much stronger.
- If \`deterministicRejectionScore\` is low or medium, do not assign \`quality=4\` just because the candle visually resembles a rejection.
`;

const REVERSE_TRENDLINE_PAYLOAD_PROMPT = `
- \`payload.figures.trendline\` contains the line geometry.
- \`payload.additionalIndicators.reverseTrendlineContext\` contains a compact bounce summary: direction, price distance to the line, whether the line was touched, whether there was a rejection candle, rejection strength, timing stage, bias conflicts, and \`deterministicRejectionScore\`.
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
    deterministicRejectionScore: number | null;
    approvalAllowedNow: boolean;
    hardBlockReasons: string[];
    approvalBlockReasons: string[];
  };

type ReverseTrendlineQualityContext = ReverseStructuralContext &
  ReverseTimingContext & {
    hardBlockReasons: string[];
  };

const getReverseTrendlineBiasConflictState = (
  context: Pick<
    ReverseTrendlineQualityContext,
    'coinBiasAligned' | 'btcBiasAligned'
  >,
) => {
  const coinConflict = context.coinBiasAligned === false;
  const btcConflict = context.btcBiasAligned === false;

  if (coinConflict && btcConflict) {
    return 'both';
  }
  if (coinConflict) {
    return 'coin_only';
  }
  if (btcConflict) {
    return 'btc_only';
  }
  if (context.coinBiasAligned === true && context.btcBiasAligned === true) {
    return 'none';
  }

  return 'unknown';
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getNestedRecord = (
  value: unknown,
  path: string[],
): Record<string, unknown> | null => {
  let current = value;

  for (const segment of path) {
    if (!isRecord(current)) {
      return null;
    }
    current = current[segment];
  }

  return isRecord(current) ? current : null;
};

const getNestedNumber = (value: unknown, path: string[]) => {
  let current = value;

  for (const segment of path) {
    if (!isRecord(current)) {
      return null;
    }
    current = current[segment];
  }

  return typeof current === 'number' && Number.isFinite(current)
    ? current
    : null;
};

const getBaseContextApprovalBlockReasons = (
  context: ReverseTrendlineQualityContext & { deterministicQuality: number },
  signal: Parameters<typeof buildReverseTrendlineAiContext>[0],
) => {
  const baseContext = isRecord(signal.additionalIndicators?.baseContext)
    ? signal.additionalIndicators.baseContext
    : null;
  if (!baseContext) {
    return [];
  }

  const riskFlags = getNestedRecord(baseContext, [
    'derivatives',
    'summary',
  ])?.riskFlags;
  const hasMissingDerivatives =
    Array.isArray(riskFlags) && riskFlags.includes('missing_derivatives');
  const volumeRel20 = getNestedNumber(baseContext, [
    'participation',
    'volume',
    'volumeRel20',
  ]);
  const rangePosition20 = getNestedNumber(baseContext, [
    'structure',
    'localRange',
    'rangePosition20',
  ]);
  const atrPctZScore = getNestedNumber(baseContext, [
    'regime',
    'volatility',
    'atrPctZScore',
  ]);
  const biasConflictState = getReverseTrendlineBiasConflictState(context);
  const reasons: string[] = [];

  if (hasMissingDerivatives) {
    reasons.push('missing_derivatives');
  }
  if (volumeRel20 != null && volumeRel20 < 0.8) {
    reasons.push('weak_volume_participation');
  }
  if (
    context.signalDirection === 'SHORT' &&
    atrPctZScore != null &&
    atrPctZScore >= 2
  ) {
    reasons.push('short_extreme_volatility');
  }
  if (
    context.signalDirection === 'SHORT' &&
    rangePosition20 != null &&
    rangePosition20 < 0.2
  ) {
    reasons.push('short_low_range_position');
  }
  if (
    context.signalDirection === 'LONG' &&
    context.distance != null &&
    context.distance > 150 &&
    context.distance <= 250
  ) {
    reasons.push('long_weak_mid_distance');
  }
  if (
    context.signalDirection === 'SHORT' &&
    context.entryTiming === 'ready_follow_through' &&
    biasConflictState === 'none' &&
    context.deterministicQuality >= 5
  ) {
    reasons.push('short_follow_through_overrated');
  }

  return reasons;
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
  const biasConflictState = getReverseTrendlineBiasConflictState(context);
  const noConflict = biasConflictState === 'none';
  const conflictOnly =
    biasConflictState === 'coin_only' || biasConflictState === 'btc_only';

  const quality5 =
    context.entryTiming === 'ready_follow_through' &&
    noConflict &&
    rejectionStrengthPct >= 0.25 &&
    rejectionWickPct >= 0.18 &&
    touches >= 4 &&
    distance < 500;

  if (quality5) {
    return 5;
  }

  const quality4FollowThrough =
    context.entryTiming === 'ready_follow_through' &&
    noConflict &&
    rejectionStrengthPct >= 0.22 &&
    rejectionWickPct >= 0.18 &&
    touches >= 4;

  if (quality4FollowThrough) {
    return 4;
  }

  const quality4ConflictRejection =
    context.entryTiming === 'ready_rejection' &&
    conflictOnly &&
    rejectionStrengthPct >= 0.45 &&
    touches >= 5 &&
    !(
      context.signalDirection === 'SHORT' &&
      biasConflictState === 'coin_only' &&
      distance <= 180 &&
      rejectionWickPct <= 0.45
    ) &&
    !(context.signalDirection === 'SHORT' && biasConflictState === 'btc_only');

  if (quality4ConflictRejection) {
    return 4;
  }

  const rejectionScore =
    getDeterministicReverseTrendlineRejectionScore(context);
  const quality4EliteShortBtcOnlyRejection =
    context.entryTiming === 'ready_rejection' &&
    context.signalDirection === 'SHORT' &&
    biasConflictState === 'btc_only' &&
    rejectionScore != null &&
    rejectionScore >= 5 &&
    rejectionWickPct >= 0.6 &&
    touches >= 5 &&
    distance <= 200;

  if (quality4EliteShortBtcOnlyRejection) {
    return 4;
  }

  const quality4ScoredRejection =
    context.entryTiming === 'ready_rejection' &&
    (biasConflictState === 'none' || biasConflictState === 'both') &&
    rejectionScore != null &&
    rejectionScore >= 7 &&
    !(
      context.signalDirection === 'SHORT' &&
      biasConflictState === 'none' &&
      distance <= 150 &&
      (rejectionWickPct >= 0.7 || rejectionStrengthPct >= 1.3)
    );

  if (quality4ScoredRejection) {
    return 4;
  }

  const quality4EliteAlignedRejection =
    context.entryTiming === 'ready_rejection' &&
    noConflict &&
    rejectionStrengthPct >= 0.9 &&
    rejectionWickPct >= 0.15 &&
    touches >= 5 &&
    distance <= 250;

  return quality4EliteAlignedRejection ? 4 : 3;
};

const getDeterministicReverseTrendlineRejectionScore = (
  context: ReverseTrendlineQualityContext,
) => {
  if (context.entryTiming !== 'ready_rejection') {
    return null;
  }

  const biasConflictState = getReverseTrendlineBiasConflictState(context);
  const rejectionStrengthPct = context.rejectionStrengthPct ?? 0;
  const rejectionWickPct = context.rejectionWickPct ?? 0;
  const touches = context.touches ?? 0;
  const distance = context.distance ?? Number.POSITIVE_INFINITY;

  let score = 0;

  if (rejectionStrengthPct >= 0.25) {
    score += 1;
  }
  if (rejectionStrengthPct >= 0.6) {
    score += 1;
  }
  if (rejectionWickPct >= 0.18) {
    score += 1;
  }
  if (touches >= 4) {
    score += 1;
  }
  if (distance <= 250) {
    score += 1;
  }

  if (context.signalDirection === 'LONG') {
    if (biasConflictState === 'both') {
      score += 1;
    }
    if (rejectionWickPct >= 0.75) {
      score += 1;
    }
  }

  if (context.signalDirection === 'SHORT') {
    if (biasConflictState === 'none') {
      score += 1;
    }
    if (distance <= 150) {
      score += 1;
    }
  }

  return score;
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
  const deterministicRejectionScore =
    getDeterministicReverseTrendlineRejectionScore({
      ...structural,
      ...timing,
      hardBlockReasons,
    });

  const deterministicQuality = getDeterministicReverseTrendlineQuality({
    ...structural,
    ...timing,
    hardBlockReasons,
  });
  const approvalBlockReasons = getBaseContextApprovalBlockReasons(
    {
      ...structural,
      ...timing,
      hardBlockReasons,
      deterministicQuality,
    },
    signal,
  );

  return {
    ...structural,
    ...timing,
    deterministicQuality,
    deterministicRejectionScore,
    approvalAllowedNow:
      deterministicQuality >= 4 && approvalBlockReasons.length === 0,
    hardBlockReasons,
    approvalBlockReasons,
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
      return 'price broke through the line against the intended bounce';
    case 'coin_bias_conflict':
      return 'coin bias conflicts with the bounce direction';
    case 'btc_bias_conflict':
      return 'BTC context conflicts with the bounce direction';
    case 'missing_derivatives':
      return 'derivatives context is missing';
    case 'weak_volume_participation':
      return 'volume participation is too weak for this bounce';
    case 'short_extreme_volatility':
      return 'SHORT bounce appears in an extreme volatility regime';
    case 'short_low_range_position':
      return 'SHORT bounce starts too low in the local range';
    case 'long_weak_mid_distance':
      return 'LONG bounce distance sits in a weak mid-distance pocket';
    case 'short_follow_through_overrated':
      return 'SHORT follow-through bounce is not reliable enough for quality 5';
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
          : context.approvalBlockReasons.length > 0
            ? `ReverseTrendLine base-context filter: ${context.approvalBlockReasons
                .map(getHardBlockReasonText)
                .join('; ')}.`
            : 'ReverseTrendLine deterministic quality requires either a strong conflict-only rejection or a confirmed aligned follow-through for a bounce.',
      triggerInvalidation:
        context.hardBlockReasons.length > 0
          ? `Wait for a new bounce setup: ${context.hardBlockReasons
              .map(getHardBlockReasonText)
              .join('; ')}.`
          : context.approvalBlockReasons.length > 0
            ? `Wait for a cleaner bounce context: ${context.approvalBlockReasons
                .map(getHardBlockReasonText)
                .join('; ')}.`
            : 'Wait for a line touch, a rejection candle, and a close held on the correct side of the line.',
      comment:
        context.hardBlockReasons.length > 0
          ? `ReverseTrendLine guardrail blocked the entry: ${context.hardBlockReasons
              .map(getHardBlockReasonText)
              .join('; ')}.`
          : context.approvalBlockReasons.length > 0
            ? `ReverseTrendLine base-context filter blocked the entry: ${context.approvalBlockReasons
                .map(getHardBlockReasonText)
                .join('; ')}.`
            : 'ReverseTrendLine keeps the setup in watch mode until the bounce is confirmed.',
    };
  },
  buildSystemPromptAddon: () =>
    `${REVERSE_TRENDLINE_CONTEXT_PROMPT}\n${REVERSE_TRENDLINE_PAYLOAD_PROMPT}`,
  buildHumanPromptAddon: ({ signal, payload }) => {
    const context = getReverseTrendlineContextFromPayload(payload, signal);
    return `

Additional ReverseTrendLine context:
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
- deterministicRejectionScore=${context.deterministicRejectionScore ?? 'n/a'}
- approvalAllowedNow=${context.approvalAllowedNow}
- hardBlockReasons=${context.hardBlockReasons.join(', ') || 'none'}
- approvalBlockReasons=${context.approvalBlockReasons.join(', ') || 'none'}

Interpretation rules for ReverseTrendLine:
- look for structural confirmation of a reaction from the line, not a breakout through the line;
- if \`failedBounceBreak=true\` is already present, do not treat the signal as confirmed;
- if the setup is still in \`wait_touch\`, \`wait_reaction_confirmation\`, or \`stale_reaction\`, do not overstate quality;
- if \`deterministicRejectionScore\` is high, use it only as an extra signal together with the proper bounce context, not as a replacement for structure.
`;
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<
        ReverseTrendLineConfig,
        'AI_ENABLED' | 'AI_MODE' | 'MIN_AI_QUALITY'
      >,
    ),
};
