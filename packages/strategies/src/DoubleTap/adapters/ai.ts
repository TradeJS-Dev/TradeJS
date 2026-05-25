import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import { AiPayload, StrategyAiAdapter } from '@tradejs/types';
import { DoubleTapConfig } from '../config';
import { DoubleTapSignalContext } from '../engine';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value != null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asNumber = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const getDoubleTapContext = (payload: AiPayload) => {
  const additional = asRecord(payload.additionalIndicators);
  return ((additional?.doubleTapContext ?? {}) ||
    {}) as Partial<DoubleTapSignalContext>;
};

const resolveQuality = (context: Partial<DoubleTapSignalContext>) => {
  const breakoutDistancePct = asNumber(context.breakoutDistancePct) ?? 999;
  const height = asNumber(context.height) ?? 0;
  if (height <= 0) {
    return 1;
  }
  if (breakoutDistancePct <= 0.35) {
    return 5;
  }
  if (breakoutDistancePct <= 0.8) {
    return 4;
  }
  if (breakoutDistancePct <= 1.4) {
    return 3;
  }
  if (breakoutDistancePct <= 2.5) {
    return 2;
  }
  return 1;
};

export const doubleTapAiAdapter: StrategyAiAdapter = {
  buildPayload: ({ signal, basePayload }) => ({
    ...basePayload,
    additionalIndicators: {
      ...(basePayload.additionalIndicators as Record<string, unknown>),
      doubleTapContext: (
        signal.additionalIndicators as Record<string, unknown> | undefined
      )?.doubleTapContext,
    },
  }),
  postProcessAnalysis: ({ payload, analysis }) => {
    const context = getDoubleTapContext(payload);
    const direction =
      analysis.direction === 'LONG' || analysis.direction === 'SHORT'
        ? analysis.direction
        : context.signalDirection;
    const quality = resolveQuality(context);
    const approved = quality >= 3 && Boolean(direction);

    return {
      ...analysis,
      direction: approved ? direction ?? null : null,
      quality,
      qualityReason: approved
        ? analysis.qualityReason
        : 'DoubleTap breakout is too extended or pattern geometry is incomplete.',
    };
  },
  buildHumanPromptAddon: ({ payload }) => {
    const context = getDoubleTapContext(payload);
    return `
Additional DoubleTap context:
- patternKind=${context.patternKind ?? 'n/a'}
- signalDirection=${context.signalDirection ?? 'n/a'}
- neckline=${String(context.neckline ?? 'n/a')}
- targetPrice=${String(context.targetPrice ?? 'n/a')}
- stopLossPrice=${String(context.stopLossPrice ?? 'n/a')}
- height=${String(context.height ?? 'n/a')}
- pivotTolerancePct=${String(context.pivotTolerancePct ?? 'n/a')}
- breakoutDistancePct=${String(context.breakoutDistancePct ?? 'n/a')}
- currentPrice=${String(context.currentPrice ?? 'n/a')}
- pivots=${JSON.stringify(context.pivots ?? [])}

Interpretation rules for DoubleTap:
- This strategy enters only after a confirmed neckline break of a double bottom or double top.
- Prefer compact breaks close to the neckline; late/extended breaks should be downgraded.
- A good long has two comparable lows and a clean close above the neckline.
- A good short has two comparable highs and a clean close below the neckline.
- Reject or downgrade cases where target/stop geometry leaves poor reward-to-risk after breakout.
`.trim();
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<
        DoubleTapConfig,
        'AI_ENABLED' | 'AI_MODE' | 'MIN_AI_QUALITY'
      >,
    ),
};
