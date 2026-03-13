import { mapMlRuntimeFromConfig } from '@tradejs/core/strategies';
import type { VolumeDivergenceConfig } from '../config';
import { StrategyMlAdapter } from '@tradejs/types';

type VolumeDivergenceMlRuntimeConfig = Pick<
  VolumeDivergenceConfig,
  | 'ML_ENABLED'
  | 'ML_THRESHOLD'
  | 'NORMALIZATION_LENGTH'
  | 'PIVOT_LOOKBACK_LEFT'
  | 'PIVOT_LOOKBACK_RIGHT'
  | 'MAX_BARS_BETWEEN_PIVOTS'
  | 'MIN_BARS_BETWEEN_PIVOTS'
  | 'BULLISH'
  | 'BEARISH'
>;

type VolumeDivergenceMlStrategyConfigInput =
  Partial<VolumeDivergenceMlRuntimeConfig> & {
    VOLUME_DIVERGENCE_CONFIG?: unknown;
    [key: string]: unknown;
  };

const toVolumeDivergenceMlStrategyConfig = <
  T extends VolumeDivergenceMlStrategyConfigInput,
>(
  input?: T,
): (T & { VOLUME_DIVERGENCE_CONFIG: unknown }) | undefined => {
  if (!input) return undefined;

  return {
    ...input,
    VOLUME_DIVERGENCE_CONFIG: input.VOLUME_DIVERGENCE_CONFIG ?? {
      normalizationLength: input.NORMALIZATION_LENGTH,
      pivotLookbackLeft: input.PIVOT_LOOKBACK_LEFT,
      pivotLookbackRight: input.PIVOT_LOOKBACK_RIGHT,
      maxBarsBetweenPivots: input.MAX_BARS_BETWEEN_PIVOTS,
      minBarsBetweenPivots: input.MIN_BARS_BETWEEN_PIVOTS,
      bullish: input.BULLISH,
      bearish: input.BEARISH,
    },
  };
};

export const volumeDivergenceMlAdapter: StrategyMlAdapter = {
  normalizeStrategyConfig: (
    strategyConfig?: Record<string, any>,
  ): Record<string, any> | undefined => {
    return toVolumeDivergenceMlStrategyConfig(strategyConfig);
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapMlRuntimeFromConfig(config as VolumeDivergenceMlRuntimeConfig, {
      strategyConfig: toVolumeDivergenceMlStrategyConfig(
        config as VolumeDivergenceMlRuntimeConfig,
      ),
    }),
};
