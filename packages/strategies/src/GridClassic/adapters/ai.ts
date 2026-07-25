import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import type { AiPayload, StrategyAiAdapter } from '@tradejs/types';
import type { GridClassicConfig } from '../config';
import type { GridClassicSignalContext } from '../engine';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const getContext = (payload: AiPayload) =>
  asRecord(
    asRecord(payload.additionalIndicators).gridClassicContext,
  ) as Partial<GridClassicSignalContext>;

export const gridClassicAiAdapter: StrategyAiAdapter = {
  buildPayload: ({ signal, basePayload }) => ({
    ...basePayload,
    additionalIndicators: {
      ...asRecord(basePayload.additionalIndicators),
      gridClassicContext: asRecord(signal.additionalIndicators)
        .gridClassicContext,
    },
  }),
  buildHumanPromptAddon: ({ payload }) => {
    const context = getContext(payload);
    return `
Additional GridClassic context:
- direction=${String(context.direction ?? 'n/a')}
- gridLevel=${String(context.gridLevel ?? 'n/a')}
- filledLevels=${String(context.filledLevels ?? 'n/a')}
- remainingLevels=${String(context.remainingLevels ?? 'n/a')}
- rangeReady=${String(context.rangeReady ?? 'n/a')}
- rangeDetected=${String(context.rangeDetected ?? 'n/a')}
- upperPrice=${String(context.upperPrice ?? 'n/a')}
- lowerPrice=${String(context.lowerPrice ?? 'n/a')}
- centerPrice=${String(context.centerPrice ?? 'n/a')}
- position=${String(context.position ?? 'n/a')}
- widthAtr=${String(context.widthAtr ?? 'n/a')}
- centerSlopeAtrPerBar=${String(context.centerSlopeAtrPerBar ?? 'n/a')}
- boundaryDivergenceAtr=${String(context.boundaryDivergenceAtr ?? 'n/a')}
- containmentRatio=${String(context.containmentRatio ?? 'n/a')}
- highPivotCount=${String(context.highPivotCount ?? 'n/a')}
- lowPivotCount=${String(context.lowPivotCount ?? 'n/a')}
- rangeAgeBars=${String(context.rangeAgeBars ?? 'n/a')}
- breakoutDirection=${String(context.breakoutDirection ?? 'n/a')}
- volatilityExpansionRatio=${String(context.volatilityExpansionRatio ?? 'n/a')}
- volatilityShock=${String(context.volatilityShock ?? 'n/a')}
- longRejection=${String(context.longRejection ?? 'n/a')}
- shortRejection=${String(context.shortRejection ?? 'n/a')}
- longCloseInside=${String(context.longCloseInside ?? 'n/a')}
- shortCloseInside=${String(context.shortCloseInside ?? 'n/a')}
- distanceToLower=${String(context.distanceToLower ?? 'n/a')}
- distanceToUpper=${String(context.distanceToUpper ?? 'n/a')}
- distanceToCenter=${String(context.distanceToCenter ?? 'n/a')}
- distanceToStop=${String(context.distanceToStop ?? 'n/a')}

Interpretation rules:
- GridClassic is a causal range mean-reversion strategy, not the directional Grid strategy.
- Its virtual grid submits at most one equal-or-smaller addition per closed bar.
- The frozen range, hard stop, non-martingale sizing, and aggregate MAX_LOSS_VALUE budget are immutable constraints.
- A breakout, range invalidation, or volatility shock blocks additions before the cycle exits.
`.trim();
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<
        GridClassicConfig,
        'AI_ENABLED' | 'AI_MODE' | 'MIN_AI_QUALITY'
      >,
    ),
};
