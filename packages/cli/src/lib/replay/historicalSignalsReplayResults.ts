import { calculateStatsFull } from '@tradejs/core/backtest';
import { INITIAL_BACKTEST_AMOUNT } from '@tradejs/core/constants';
import type {
  OrderLogData,
  PositionLogData,
  Signal,
  StrategyConfig,
  TestStat,
} from '@tradejs/types';
import type { PortfolioReplayConnector } from './portfolioReplayConnector';
import type { RuntimeLineageScopeRecord } from '../runtimeSignalsStorage';
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
  replayLineageScopes: RuntimeLineageScopeRecord[];
};

export type HistoricalReplayResultContext = {
  strategies: ReplayRuntimeStrategy[];
  artifacts: ReturnType<PortfolioReplayConnector['getReplayArtifacts']>;
  signals: Signal[];
  cycleCount: number;
  abortedCycles: number;
  runtimeLineages: ReplayRuntimeLineageRecord[];
  replayLineageScopes: RuntimeLineageScopeRecord[];
};

const emptyStat = (): TestStat =>
  ({
    orders: 0,
    wins: 0,
    losses: 0,
    netProfit: 0,
    amount: 0,
  }) as unknown as TestStat;

const positionLogForStats = (positionLog: PositionLogData): PositionLogData => {
  let amount = INITIAL_BACKTEST_AMOUNT;
  return [...positionLog]
    .sort(
      (left, right) =>
        left.close.timestamp - right.close.timestamp ||
        left.open.timestamp - right.open.timestamp,
    )
    .map((position) => {
      const pnl = Number.isFinite(position.netProfit)
        ? Number(position.netProfit)
        : position.close.amount - position.open.amount;
      const next = {
        ...position,
        open: { ...position.open, amount },
        close: { ...position.close, amount: amount + pnl },
        netProfit: pnl,
      };
      amount += pnl;
      return next;
    });
};

const calculateReplayStat = (positionLog: PositionLogData) =>
  positionLog.length
    ? (calculateStatsFull(positionLogForStats(positionLog)) as TestStat | null)
    : emptyStat();

const byTimestamp = <T extends { timestamp: number }>(left: T, right: T) =>
  left.timestamp - right.timestamp;

const byPositionClose = (
  left: PositionLogData[number],
  right: PositionLogData[number],
) => left.close.timestamp - right.close.timestamp;

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
      stat: calculateReplayStat(positionLog),
    };
  }),
  signals: context.signals,
  orderLog: context.artifacts.orderLog,
  positionLog: context.artifacts.positionLog,
  cycleCount: context.cycleCount,
  abortedCycles: context.abortedCycles,
  runtimeLineages: context.runtimeLineages,
  replayLineageScopes: context.replayLineageScopes,
});

export const compactHistoricalReplayResultForPortfolio = (
  result: HistoricalSignalsReplayResult,
): HistoricalSignalsReplayResult => ({
  ...result,
  strategies: result.strategies.map((strategy) => ({
    ...strategy,
    orderLog: [],
  })),
  signals: [],
  orderLog: [],
  replayLineageScopes: [],
});

export const mergeHistoricalReplayResults = (
  parts: HistoricalSignalsReplayResult[],
): HistoricalSignalsReplayResult => {
  if (!parts.length) {
    throw new Error('Cannot merge an empty historical replay result list');
  }
  const strategyNames = parts[0].strategies.map(
    (strategy) => strategy.strategyName,
  );
  const strategies = strategyNames.map((strategyName) => {
    const entries = parts.map((part) => {
      const entry = part.strategies.find(
        (strategy) => strategy.strategyName === strategyName,
      );
      if (!entry) {
        throw new Error(`Replay batch is missing strategy ${strategyName}`);
      }
      return entry;
    });
    const positionLog = entries
      .flatMap((entry) => entry.positionLog)
      .sort(byPositionClose);
    return {
      strategyName,
      strategyConfig: entries[0].strategyConfig,
      orderLog: entries.flatMap((entry) => entry.orderLog).sort(byTimestamp),
      positionLog,
      stat: calculateReplayStat(positionLog),
    };
  });

  return {
    strategies,
    signals: parts.flatMap((part) => part.signals).sort(byTimestamp),
    orderLog: parts.flatMap((part) => part.orderLog).sort(byTimestamp),
    positionLog: parts
      .flatMap((part) => part.positionLog)
      .sort(byPositionClose),
    cycleCount: parts.reduce((sum, part) => sum + part.cycleCount, 0),
    abortedCycles: parts.reduce((sum, part) => sum + part.abortedCycles, 0),
    runtimeLineages: parts.flatMap((part) => part.runtimeLineages),
    replayLineageScopes: parts.flatMap((part) => part.replayLineageScopes),
  };
};
