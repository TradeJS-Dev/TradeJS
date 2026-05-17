import { RuntimeTradeRecord } from '@tradejs/types';
import { MatchedTradeParityEntry, TradeParityEntry } from './runtimeParity';

export type RuntimeTradeStrategySummary = {
  strategyName: string;
  trades: number;
  activeTrades: number;
  closedTrades: number;
  totalPnl: number;
};

export type StrategyParitySummaryRow = {
  runtime: number;
  runtimeDuplicates: number;
  backtest: number;
  matched: number;
  runtimeOnly: number;
  backtestOnly: number;
};

export const summarizeRuntimeTradesByStrategy = (
  trades: RuntimeTradeRecord[],
): RuntimeTradeStrategySummary[] => {
  const summaryByStrategy = new Map<string, RuntimeTradeStrategySummary>();

  for (const trade of trades) {
    const summary = summaryByStrategy.get(trade.strategy) ?? {
      strategyName: trade.strategy,
      trades: 0,
      activeTrades: 0,
      closedTrades: 0,
      totalPnl: 0,
    };

    summary.trades += 1;
    if (trade.status === 'active') {
      summary.activeTrades += 1;
    } else {
      summary.closedTrades += 1;
    }

    const pnl =
      trade.status === 'active'
        ? trade.currentPnl
        : trade.closedPnl ?? trade.currentPnl;
    if (typeof pnl === 'number' && Number.isFinite(pnl)) {
      summary.totalPnl += pnl;
    }

    summaryByStrategy.set(trade.strategy, summary);
  }

  return [...summaryByStrategy.values()]
    .map((summary) => ({
      ...summary,
      totalPnl: Number(summary.totalPnl.toFixed(2)),
    }))
    .sort((left, right) => left.strategyName.localeCompare(right.strategyName));
};

export const summarizeTradeParityByStrategy = ({
  runtimeEntries,
  runtimeDuplicateEntries,
  backtestEntries,
  matchedEntries,
  runtimeOnlyEntries,
  backtestOnlyEntries,
}: {
  runtimeEntries: TradeParityEntry[];
  runtimeDuplicateEntries: TradeParityEntry[];
  backtestEntries: TradeParityEntry[];
  matchedEntries: MatchedTradeParityEntry[];
  runtimeOnlyEntries: TradeParityEntry[];
  backtestOnlyEntries: TradeParityEntry[];
}) => {
  const rows = new Map<string, StrategyParitySummaryRow>();

  const ensureRow = (strategyName: string) => {
    const row = rows.get(strategyName) ?? {
      runtime: 0,
      runtimeDuplicates: 0,
      backtest: 0,
      matched: 0,
      runtimeOnly: 0,
      backtestOnly: 0,
    };
    rows.set(strategyName, row);
    return row;
  };

  for (const entry of runtimeEntries) {
    ensureRow(entry.strategy).runtime += 1;
  }
  for (const entry of runtimeDuplicateEntries) {
    ensureRow(entry.strategy).runtimeDuplicates += 1;
  }
  for (const entry of backtestEntries) {
    ensureRow(entry.strategy).backtest += 1;
  }
  for (const entry of matchedEntries) {
    ensureRow(entry.runtime.strategy).matched += 1;
  }
  for (const entry of runtimeOnlyEntries) {
    ensureRow(entry.strategy).runtimeOnly += 1;
  }
  for (const entry of backtestOnlyEntries) {
    ensureRow(entry.strategy).backtestOnly += 1;
  }

  return [...rows.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
};
