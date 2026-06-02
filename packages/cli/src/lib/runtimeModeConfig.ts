import type { Interval, StrategyConfig } from '@tradejs/types';

export type RuntimeStrategyEnv = 'BACKTEST' | 'PARITY' | 'CRON';

export const hasRuntimeEntryGateEnabled = (strategyConfig: StrategyConfig) =>
  strategyConfig.AI_ENABLED === true || strategyConfig.ML_ENABLED === true;

export const resolveReplayStrategyEnv = ({
  strategyConfig,
  forceRuntimeGates = false,
}: {
  strategyConfig: StrategyConfig;
  forceRuntimeGates?: boolean;
}): RuntimeStrategyEnv =>
  forceRuntimeGates || hasRuntimeEntryGateEnabled(strategyConfig)
    ? 'PARITY'
    : 'BACKTEST';

export const buildRuntimeModeStrategyConfig = ({
  strategyConfig,
  env,
  interval,
  makeOrders,
  recordRuntimeTrades,
  aiReplayAnalyses,
}: {
  strategyConfig: StrategyConfig;
  env: RuntimeStrategyEnv;
  interval: Interval;
  makeOrders: boolean | undefined;
  recordRuntimeTrades?: boolean;
  aiReplayAnalyses?: unknown[];
}): StrategyConfig => ({
  ...strategyConfig,
  ENV: env,
  MAKE_ORDERS: makeOrders,
  INTERVAL: interval,
  ...(typeof recordRuntimeTrades === 'boolean'
    ? { RECORD_RUNTIME_TRADES: recordRuntimeTrades }
    : {}),
  ...(aiReplayAnalyses?.length ? { AI_REPLAY_ANALYSES: aiReplayAnalyses } : {}),
});
