import { Signal } from '@types';

export type MlTestConfig = {
  strategyName?: string;
  strategyConfig?: Record<string, any>;
  symbol?: string;
  threshold?: number;
  ML_THRESHOLD?: number;
  grpcAddress?: string;
};

export type MlSignalPayload = {
  signal: Signal;
  context?: {
    strategyConfig?: Record<string, any>;
    strategyName?: string;
    symbol?: string;
    userName?: string;
    testId?: string;
    testSuiteId?: string;
    testName?: string;
    connectorName?: string;
  };
};

export const normalizeStrategyConfig = (
  strategyConfig?: Record<string, any>,
): Record<string, any> | undefined => {
  if (!strategyConfig) return strategyConfig;
  return {
    ...strategyConfig,
    TRENDLINE_CONFIG:
      strategyConfig.TRENDLINE_CONFIG ?? strategyConfig.TRENDLINE,
  };
};

export const buildMlPayload = (payload: MlSignalPayload): MlSignalPayload => {
  const nextSignal = {
    ...payload.signal,
    indicators: {
      ...(payload.signal?.indicators ?? {}),
    },
  };
  const nextContext = payload.context
    ? {
        ...payload.context,
        strategyConfig: normalizeStrategyConfig(payload.context.strategyConfig),
      }
    : undefined;

  return {
    signal: nextSignal,
    context: nextContext,
  };
};
