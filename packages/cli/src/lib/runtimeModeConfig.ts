import type { Interval, StrategyConfig } from '@tradejs/types';

export type RuntimeStrategyEnv = 'BACKTEST' | 'PARITY' | 'CRON';

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
