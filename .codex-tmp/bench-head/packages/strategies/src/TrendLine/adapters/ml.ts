import { mapMlRuntimeFromConfig } from '@tradejs/core/strategies';
import type { TrendLineConfig } from '../config';
import { Signal, StrategyMlAdapter } from '@tradejs/types';

type TrendLineMlRuntimeConfig = Pick<
  TrendLineConfig,
  'ML_ENABLED' | 'ML_THRESHOLD' | 'TRENDLINE' | 'HIGHS' | 'LOWS'
>;

type TrendLineMlStrategyConfigInput = Partial<
  Pick<TrendLineConfig, 'TRENDLINE' | 'HIGHS' | 'LOWS'>
> & {
  TRENDLINE_CONFIG?: unknown;
  [key: string]: unknown;
};

const toTrendLineMlStrategyConfig = <T extends TrendLineMlStrategyConfigInput>(
  input?: T,
): (T & { TRENDLINE_CONFIG: unknown }) | undefined => {
  if (!input) return undefined;

  return {
    ...input,
    TRENDLINE_CONFIG: input.TRENDLINE_CONFIG ?? input.TRENDLINE ?? {},
  };
};

export const trendLineMlAdapter: StrategyMlAdapter = {
  normalizeSignal: (signal: Signal) => {
    const nextSignal: Signal = {
      ...signal,
      indicators: {
        ...(signal.indicators ?? {}),
      },
    };

    const additional = signal.additionalIndicators ?? {};
    if (nextSignal.indicators.touches == null && additional.touches != null) {
      nextSignal.indicators.touches = additional.touches as any;
    }
    if (nextSignal.indicators.distance == null && additional.distance != null) {
      nextSignal.indicators.distance = additional.distance as any;
    }

    return nextSignal;
  },
  normalizeStrategyConfig: (
    strategyConfig?: Record<string, any>,
  ): Record<string, any> | undefined => {
    return toTrendLineMlStrategyConfig(strategyConfig);
  },
  mapEntryRuntimeFromConfig: (config) =>
    mapMlRuntimeFromConfig(config as TrendLineMlRuntimeConfig, {
      strategyConfig: toTrendLineMlStrategyConfig(
        config as TrendLineMlRuntimeConfig,
      ),
    }),
};
