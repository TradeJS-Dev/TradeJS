import { Signal } from '@types';

export type MlTestConfig = {
  strategyName?: string;
  strategyConfig?: Record<string, any>;
  symbol?: string;
  candles?: any[];
  btcCandles?: any[];
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
  candles?: any[];
  btcCandles?: any[];
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
  if (!payload.context?.strategyConfig) {
    return payload;
  }

  return {
    ...payload,
    context: {
      ...payload.context,
      strategyConfig: normalizeStrategyConfig(payload.context.strategyConfig),
    },
  };
};
