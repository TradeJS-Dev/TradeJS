import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import type { AiPayload, StrategyAiAdapter } from '@tradejs/types';
import type { HeadAndShouldersConfig } from '../config';
import type { HeadAndShouldersSignalContext } from '../engine';
import {
  getAiPayloadNumber,
  withStrategyLocalAiGate,
} from '@tradejs/strategy-kit/ai-gate';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const getContext = (payload: AiPayload) =>
  asRecord(
    asRecord(payload.additionalIndicators).headAndShouldersContext,
  ) as Partial<HeadAndShouldersSignalContext>;

const headAndShouldersBaseAiAdapter: StrategyAiAdapter = {
  buildPayload: ({ signal, basePayload }) => ({
    ...basePayload,
    additionalIndicators: {
      ...asRecord(basePayload.additionalIndicators),
      headAndShouldersContext: asRecord(signal.additionalIndicators)
        .headAndShouldersContext,
    },
  }),
  buildHumanPromptAddon: ({ payload }) => {
    const context = getContext(payload);
    return `
Additional HeadAndShoulders context:
- patternKind=${context.patternKind ?? 'n/a'}
- signalDirection=${context.signalDirection ?? 'n/a'}
- entryMode=${context.entryMode ?? 'n/a'}
- entryStage=${context.entryStage ?? 'n/a'}
- neckline=${String(context.neckline ?? 'n/a')}
- necklineSlopeRatio=${String(context.necklineSlopeRatio ?? 'n/a')}
- headHeightPct=${String(context.headHeightPct ?? 'n/a')}
- headHeightAtr=${String(context.headHeightAtr ?? 'n/a')}
- shoulderDifferencePct=${String(context.shoulderDifferencePct ?? 'n/a')}
- leftHeadProminenceRatio=${String(context.leftHeadProminenceRatio ?? 'n/a')}
- rightHeadProminenceRatio=${String(context.rightHeadProminenceRatio ?? 'n/a')}
- patternSymmetryRatio=${String(context.patternSymmetryRatio ?? 'n/a')}
- priorMoveAtr=${String(context.priorMoveAtr ?? 'n/a')}
- breakoutDistanceAtr=${String(context.breakoutDistanceAtr ?? 'n/a')}
- breakoutDistanceHeightRatio=${String(context.breakoutDistanceHeightRatio ?? 'n/a')}
- breakoutDelayBars=${String(context.breakoutDelayBars ?? 'n/a')}
- breakoutCrossedOnSignalBar=${String(context.breakoutCrossedOnSignalBar ?? 'n/a')}
- confirmationBodyAtr=${String(context.confirmationBodyAtr ?? 'n/a')}
- confirmationCloseLocation=${String(context.confirmationCloseLocation ?? 'n/a')}
- confirmationVolumeRel=${String(context.confirmationVolumeRel ?? 'n/a')}

Interpretation rules for HeadAndShoulders:
- SHORT is a classic head-and-shoulders neckline breakdown; LONG is the mirrored inverse pattern.
- Prefer balanced shoulders, a clearly prominent head, a moderate neckline slope, and a compact breakout.
- Treat strongly asymmetric patterns, shallow heads, or overextended breakouts as lower quality.
`.trim();
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<
        HeadAndShouldersConfig,
        'AI_ENABLED' | 'AI_MODE' | 'MIN_AI_QUALITY'
      >,
    ),
};

export const headAndShouldersAiAdapter = withStrategyLocalAiGate(
  headAndShouldersBaseAiAdapter,
  {
    id: 'head_and_shoulders_short_wick_breadth_2026_08_12',
    approves: ({ signal, payload }) => {
      const upperWickPct = getAiPayloadNumber(
        payload,
        'additionalIndicators.baseContext.structure.candleQuality.upperWickPct',
      );
      const altBasketReturn24h = getAiPayloadNumber(
        payload,
        'additionalIndicators.baseContext.relative.btcAltRegime.altBasketReturn24h',
      );

      return (
        signal.direction === 'SHORT' &&
        upperWickPct != null &&
        upperWickPct <= 0.3 &&
        altBasketReturn24h != null &&
        altBasketReturn24h >= -0.005
      );
    },
  },
);
