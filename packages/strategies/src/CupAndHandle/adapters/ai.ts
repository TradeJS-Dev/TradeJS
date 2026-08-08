import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import type { AiPayload, StrategyAiAdapter } from '@tradejs/types';
import type { CupAndHandleConfig } from '../config';
import type { CupAndHandleSignalContext } from '../engine';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const getContext = (payload: AiPayload) =>
  asRecord(
    asRecord(payload.additionalIndicators).cupAndHandleContext,
  ) as Partial<CupAndHandleSignalContext>;

export const cupAndHandleAiAdapter: StrategyAiAdapter = {
  buildPayload: ({ signal, basePayload }) => ({
    ...basePayload,
    additionalIndicators: {
      ...asRecord(basePayload.additionalIndicators),
      cupAndHandleContext: asRecord(signal.additionalIndicators)
        .cupAndHandleContext,
    },
  }),
  buildHumanPromptAddon: ({ payload }) => {
    const context = getContext(payload);
    return `
Additional CupAndHandle context:
- patternKind=${context.patternKind ?? 'n/a'}
- signalDirection=${context.signalDirection ?? 'n/a'}
- entryMode=${context.entryMode ?? 'n/a'}
- entryStage=${context.entryStage ?? 'n/a'}
- neckline=${String(context.neckline ?? 'n/a')}
- cupDepthPct=${String(context.cupDepthPct ?? 'n/a')}
- cupDepthAtr=${String(context.cupDepthAtr ?? 'n/a')}
- cupDurationBars=${String(context.cupDurationBars ?? 'n/a')}
- cupSymmetryRatio=${String(context.cupSymmetryRatio ?? 'n/a')}
- rimDifferencePct=${String(context.rimDifferencePct ?? 'n/a')}
- handleDepthRatio=${String(context.handleDepthRatio ?? 'n/a')}
- handleDurationBars=${String(context.handleDurationBars ?? 'n/a')}
- breakoutDistanceAtr=${String(context.breakoutDistanceAtr ?? 'n/a')}
- breakoutDistanceDepthRatio=${String(context.breakoutDistanceDepthRatio ?? 'n/a')}
- breakoutCrossedOnSignalBar=${String(context.breakoutCrossedOnSignalBar ?? 'n/a')}

Interpretation rules for CupAndHandle:
- LONG is a cup-and-handle breakout; SHORT is the mirrored inverted pattern.
- Prefer similar rim levels, a balanced cup, and a shallow handle that preserves the cup extreme.
- Treat an overextended breakout or a handle close to the full cup depth as lower quality.
`.trim();
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<
        CupAndHandleConfig,
        'AI_ENABLED' | 'AI_MODE' | 'MIN_AI_QUALITY'
      >,
    ),
};
