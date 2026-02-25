import { Signal, StrategyMlAdapter } from '@types';

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
    if (!strategyConfig) return strategyConfig;
    return {
      ...strategyConfig,
      TRENDLINE_CONFIG:
        strategyConfig.TRENDLINE_CONFIG ?? strategyConfig.TRENDLINE,
    };
  },
};
