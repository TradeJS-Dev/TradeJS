import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import type { AiPayload, StrategyAiAdapter } from '@tradejs/types';
import type { HyperliquidConsensusConfig } from '../config';
import type { HyperliquidConsensusSignalContext } from '../engine';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const getConsensusContext = (payload: AiPayload) =>
  asRecord(payload.additionalIndicators)
    .hyperliquidConsensusContext as Partial<HyperliquidConsensusSignalContext>;

export const hyperliquidConsensusAiAdapter: StrategyAiAdapter = {
  buildPayload: ({ signal, basePayload }): AiPayload => ({
    ...basePayload,
    additionalIndicators: {
      ...asRecord(basePayload.additionalIndicators),
      hyperliquidConsensusContext: asRecord(signal.additionalIndicators)
        .hyperliquidConsensusContext,
    },
  }),
  buildHumanPromptAddon: ({ payload }) => {
    const context = getConsensusContext(payload);
    return `
Additional HyperliquidConsensus context:
- signalDirection=${context.signalDirection ?? 'n/a'}
- consensusScore=${String(context.consensusScore ?? 'n/a')}
- entryLongSharePct=${String(context.entryLongSharePct ?? 'n/a')}
- entryWhales=${String(context.entryWhales ?? 'n/a')}
- coveragePct=${String(context.coveragePct ?? 'n/a')}
- positionAwarePct=${String(context.positionAwarePct ?? 'n/a')}
- entryNetNotionalUsd=${String(context.entryNetNotionalUsd ?? 'n/a')}
- totalEntryNotionalUsd=${String(context.totalEntryNotionalUsd ?? 'n/a')}
- longExitNotionalUsd=${String(context.longExitNotionalUsd ?? 'n/a')}
- shortExitNotionalUsd=${String(context.shortExitNotionalUsd ?? 'n/a')}
- ageMs=${String(context.ageMs ?? 'n/a')}

Interpretation rules for HyperliquidConsensus:
- This is signal-time causal Hyperliquid flow from a versioned wallet registry.
- Positive consensus is new/increased long exposure; negative consensus is new/increased short exposure.
- Position reductions and closes are separated from entries and should be treated as exit/risk-off evidence.
- Treat wallet count, coverage, freshness, and notional as signal reliability evidence.
- Position intent is derived causally from each fill's startPosition, side, and size; flips are split into closing and opening components.
`.trim();
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<
        HyperliquidConsensusConfig,
        'AI_ENABLED' | 'AI_MODE' | 'MIN_AI_QUALITY'
      >,
    ),
};
