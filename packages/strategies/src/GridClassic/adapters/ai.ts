import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import type {
  AiPayload,
  BaseStrategyContextSnapshot,
  Direction,
  StrategyAiAdapter,
} from '@tradejs/types';
import type { GridClassicConfig } from '../config';
import type { GridClassicSignalContext } from '../engine';
import {
  buildGridClassicGuardrailContext,
  type GridClassicGateFeatures,
} from '../guardrails';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const toDirection = (value: unknown): Direction | undefined =>
  value === 'LONG' || value === 'SHORT' ? value : undefined;

const getContext = (payload: AiPayload) => {
  const context = asRecord(
    asRecord(payload.additionalIndicators).gridClassicContext,
  ) as Partial<GridClassicSignalContext>;
  const signalDirection = toDirection(payload.signal?.direction);
  return signalDirection == null
    ? context
    : { ...context, direction: signalDirection };
};

const getGuardrailContext = (payload: AiPayload) => {
  const additional = asRecord(payload.additionalIndicators);
  return buildGridClassicGuardrailContext({
    signalContext: getContext(payload),
    baseContext: (additional.baseContext ??
      null) as BaseStrategyContextSnapshot | null,
  });
};

const withGridClassicGateFeatures = ({
  baseContext,
  context,
}: {
  baseContext: BaseStrategyContextSnapshot | null;
  context: ReturnType<typeof buildGridClassicGuardrailContext>;
}) =>
  baseContext == null
    ? baseContext
    : ({
        ...(baseContext as unknown as Record<string, unknown>),
        gridClassicGateFeatures: context.gridClassicGateFeatures,
      } as BaseStrategyContextSnapshot & {
        gridClassicGateFeatures: GridClassicGateFeatures;
      });

export const gridClassicAiAdapter: StrategyAiAdapter = {
  buildPayload: ({ signal, basePayload }) => {
    const baseAdditional = asRecord(basePayload.additionalIndicators);
    const baseContext = (baseAdditional.baseContext ??
      null) as BaseStrategyContextSnapshot | null;
    const sourceContext = asRecord(
      asRecord(signal.additionalIndicators).gridClassicContext,
    );
    const signalDirection = toDirection(signal.direction);
    const gridClassicContext =
      signalDirection == null
        ? sourceContext
        : { ...sourceContext, direction: signalDirection };
    const payload = {
      ...basePayload,
      additionalIndicators: {
        ...baseAdditional,
        gridClassicContext,
      },
    };
    const context = getGuardrailContext(payload);
    const additionalIndicators: Record<string, unknown> = {
      ...asRecord(payload.additionalIndicators),
      gridClassicContext: context,
    };
    const enrichedBaseContext = withGridClassicGateFeatures({
      baseContext,
      context,
    });
    if (enrichedBaseContext != null) {
      additionalIndicators.baseContext = enrichedBaseContext;
    }

    return {
      ...payload,
      additionalIndicators,
    };
  },
  postProcessAnalysis: ({ payload, analysis }) => {
    const context = getGuardrailContext(payload);
    const approved =
      context.approvalAllowedNow === true && context.signalDirection != null;

    return {
      ...analysis,
      direction: approved ? context.signalDirection : null,
      quality: context.deterministicQuality,
      approved,
      rejectReason: approved
        ? undefined
        : context.approvalBlockReasons.join('; ') ||
          'GridClassic signal failed deterministic structural validation.',
    };
  },
  buildHumanPromptAddon: ({ payload }) => {
    const context = getGuardrailContext(payload);
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
- latestHighPivotAgeBars=${String(context.latestHighPivotAgeBars ?? 'n/a')}
- latestLowPivotAgeBars=${String(context.latestLowPivotAgeBars ?? 'n/a')}
- alternatingPivotCount=${String(context.alternatingPivotCount ?? 'n/a')}
- recentContainmentRatio=${String(context.recentContainmentRatio ?? 'n/a')}
- recentOutsideCloseCount=${String(context.recentOutsideCloseCount ?? 'n/a')}
- rangeQualityAccepted=${String(context.rangeQualityAccepted ?? 'n/a')}
- entrySignalStage=${String(context.entrySignalStage ?? 'n/a')}
- entryConfirmationAgeBars=${String(context.entryConfirmationAgeBars ?? 'n/a')}
- targetDistanceBps=${String(context.targetDistanceBps ?? 'n/a')}
- grossReward=${String(context.grossReward ?? 'n/a')}
- executionCosts=${String(context.executionCosts ?? 'n/a')}
- netReward=${String(context.netReward ?? 'n/a')}
- netRisk=${String(context.netRisk ?? 'n/a')}
- netRiskRatio=${String(context.netRiskRatio ?? 'n/a')}
- distanceToLower=${String(context.distanceToLower ?? 'n/a')}
- distanceToUpper=${String(context.distanceToUpper ?? 'n/a')}
- distanceToCenter=${String(context.distanceToCenter ?? 'n/a')}
- distanceToStop=${String(context.distanceToStop ?? 'n/a')}
- deterministicQuality=${String(context.deterministicQuality)}
- approvalAllowedNow=${String(context.approvalAllowedNow)}
- approvalBlockReasons=${context.approvalBlockReasons.join(',') || 'none'}

Interpretation rules:
- GridClassic is a causal range mean-reversion strategy, not the directional Grid strategy.
- Treat deterministicQuality and approvalAllowedNow as the normalized local gate result.
- Approve only a structurally valid, causally confirmed grid entry with intact range geometry, valid economics, and no breakout or volatility shock.
- Structurally valid entries remain q3 observation-only until a market-state pocket passes independent train, tuning, and untouched-test support requirements.
- A v2 entry is confirmed on a later closed candle after the initial edge rejection; configured pivot freshness, alternating-touch, recent-containment, and entry-economics thresholds remain deterministic preconditions when enabled.
- Its virtual grid submits at most one equal-or-smaller addition per closed bar.
- Additional levels may require a fresh rejection from the frozen boundary.
- The frozen range, cost-adjusted break-even stop, non-martingale sizing, and aggregate MAX_LOSS_VALUE budget are immutable constraints.
- A failed rejection, breakout, range invalidation, or volatility shock blocks additions before the cycle exits.
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
