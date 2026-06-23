import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import type { AiPayload, StrategyAiAdapter } from '@tradejs/types';
import type { VolatilityCompressionBreakoutConfig } from '../config';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const volatilityCompressionBreakoutAiAdapter: StrategyAiAdapter = {
  buildPayload: ({ signal, basePayload }): AiPayload => ({
    ...basePayload,
    additionalIndicators: {
      ...asRecord(basePayload.additionalIndicators),
      volatilityCompressionBreakoutContext: asRecord(
        signal.additionalIndicators,
      ).volatilityCompressionBreakoutContext,
    },
  }),
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<
        VolatilityCompressionBreakoutConfig,
        'AI_ENABLED' | 'AI_MODE' | 'MIN_AI_QUALITY'
      >,
    ),
};
