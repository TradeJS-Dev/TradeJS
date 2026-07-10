import { Signal } from '@tradejs/types';
import { getStrategyMlAdapter } from './strategyAdapters/ml';

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
    configId?: string;
    connectorName?: string;
  };
};

export const normalizeStrategyConfig = (
  strategyConfig?: Record<string, any>,
  strategyName?: string,
  profileId?: string,
): Record<string, any> | undefined => {
  return getStrategyMlAdapter(
    strategyName,
    profileId,
  ).normalizeStrategyConfig?.(strategyConfig);
};

export const buildMlPayload = (payload: MlSignalPayload): MlSignalPayload => {
  const strategyName =
    payload.signal?.strategy ?? payload.context?.strategyName;
  const profileId = payload.signal?.policyProfileId;
  const mlAdapter = getStrategyMlAdapter(strategyName, profileId);
  const normalizedSignal =
    mlAdapter.normalizeSignal?.(payload.signal) ?? payload.signal;
  const nextSignal = {
    ...normalizedSignal,
    indicators: {
      ...(normalizedSignal?.indicators ?? {}),
    },
  };
  const nextContext = payload.context
    ? {
        ...payload.context,
        strategyConfig: normalizeStrategyConfig(
          payload.context.strategyConfig,
          strategyName,
          profileId,
        ),
      }
    : undefined;

  return {
    signal: nextSignal,
    context: nextContext,
  };
};
