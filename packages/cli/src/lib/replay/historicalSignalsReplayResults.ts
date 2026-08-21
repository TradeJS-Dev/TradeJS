import { calculateStatsFull } from '@tradejs/core/backtest';
import type {
  OrderLogData,
  PositionLogData,
  Signal,
  StrategyConfig,
  TestStat,
} from '@tradejs/types';
import type { PortfolioReplayConnector } from './portfolioReplayConnector';
import type {
  ReplayRuntimeLineageRecord,
  ReplayRuntimeStrategy,
} from './historicalSignalsReplayPreparation';

export type ReplayStrategyRunArtifacts = {
  strategyName: string;
  strategyConfig: StrategyConfig;
  orderLog: OrderLogData;
  positionLog: PositionLogData;
  stat: TestStat | null;
};

export type HistoricalSignalsReplayResult = {
  strategies: ReplayStrategyRunArtifacts[];
  signals: Signal[];
  orderLog: OrderLogData;
  positionLog: PositionLogData;
  cycleCount: number;
  abortedCycles: number;
  runtimeLineages: ReplayRuntimeLineageRecord[];
};

export type HistoricalReplayResultContext = {
  strategies: ReplayRuntimeStrategy[];
  artifacts: ReturnType<PortfolioReplayConnector['getReplayArtifacts']>;
  signals: Signal[];
  cycleCount: number;
  abortedCycles: number;
  runtimeLineages: ReplayRuntimeLineageRecord[];
};

const emptyStat = (): TestStat =>
  ({
    orders: 0,
    wins: 0,
    losses: 0,
    netProfit: 0,
    amount: 0,
  }) as unknown as TestStat;

export const collectHistoricalReplayResult = (
  context: HistoricalReplayResultContext,
): HistoricalSignalsReplayResult => ({
  strategies: context.strategies.map(({ strategyName, strategyConfig }) => {
    const orderLog =
      context.artifacts.orderLogByStrategy.get(strategyName) ?? [];
    const positionLog =
      context.artifacts.positionLogByStrategy.get(strategyName) ?? [];
    return {
      strategyName,
      strategyConfig,
      orderLog,
      positionLog,
      stat: positionLog.length
        ? (calculateStatsFull(positionLog) as TestStat | null)
        : emptyStat(),
    };
  }),
  signals: context.signals,
  orderLog: context.artifacts.orderLog,
  positionLog: context.artifacts.positionLog,
  cycleCount: context.cycleCount,
  abortedCycles: context.abortedCycles,
  runtimeLineages: context.runtimeLineages,
});
