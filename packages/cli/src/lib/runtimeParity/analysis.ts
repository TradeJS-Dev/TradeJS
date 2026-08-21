import type {
  RuntimeSignalEvaluationRecord,
  RuntimeTradeRecord,
  Signal,
} from '@tradejs/types';
import {
  compareTradeParityEntries,
  dedupeRuntimeParityEntries,
  extractRuntimeParityEntries,
  summarizeMatchedParity,
  type TradeParityEntry,
} from '../runtimeParity';
import { summarizeTradeParityByStrategy } from '../paritySummary';
import {
  classifyBacktestOnlyEntries,
  classifyRuntimeOnlyEntries,
} from './classification';
import { toTargetKey, type ReplayError, type ReplayTarget } from './targets';

export type StrategyParitySummaryRow = {
  runtime: number;
  runtimeDuplicates: number;
  backtest: number;
  matched: number;
  runtimeOnly: number;
  backtestOnly: number;
  targets: number;
  compared: number;
  errors: number;
};

export type RuntimeParityAnalysisContext = {
  runtimeTrades: RuntimeTradeRecord[];
  runtimeSignals: Signal[];
  runtimeSignalEvaluations: RuntimeSignalEvaluationRecord[];
  backtestEntries: TradeParityEntry[];
  replaySignalEvaluations: RuntimeSignalEvaluationRecord[];
  replayTargets: ReplayTarget[];
  successfulTargetKeys: Set<string>;
  replayErrors: ReplayError[];
  toleranceMs: number;
};

const summarizeByStrategy = ({
  targets,
  successfulTargetKeys,
  replayErrors,
  runtimeEntries,
  runtimeDuplicateEntries,
  backtestEntries,
  matchedEntries,
  runtimeOnlyEntries,
  backtestOnlyEntries,
}: {
  targets: ReplayTarget[];
  successfulTargetKeys: Set<string>;
  replayErrors: ReplayError[];
  runtimeEntries: TradeParityEntry[];
  runtimeDuplicateEntries: TradeParityEntry[];
  backtestEntries: TradeParityEntry[];
  matchedEntries: ReturnType<typeof compareTradeParityEntries>['matched'];
  runtimeOnlyEntries: TradeParityEntry[];
  backtestOnlyEntries: TradeParityEntry[];
}) => {
  const rows = new Map<string, StrategyParitySummaryRow>();
  const baseRows = summarizeTradeParityByStrategy({
    runtimeEntries,
    runtimeDuplicateEntries,
    backtestEntries,
    matchedEntries,
    runtimeOnlyEntries,
    backtestOnlyEntries,
  });
  for (const [strategy, baseRow] of baseRows) {
    rows.set(strategy, {
      ...baseRow,
      targets: 0,
      compared: 0,
      errors: 0,
    });
  }

  const ensureRow = (strategy: string) => {
    const row = rows.get(strategy) ?? {
      runtime: 0,
      runtimeDuplicates: 0,
      backtest: 0,
      matched: 0,
      runtimeOnly: 0,
      backtestOnly: 0,
      targets: 0,
      compared: 0,
      errors: 0,
    };
    rows.set(strategy, row);
    return row;
  };

  for (const target of targets) {
    const row = ensureRow(target.strategy);
    row.targets += 1;
    if (successfulTargetKeys.has(toTargetKey(target))) {
      row.compared += 1;
    }
  }
  for (const error of replayErrors) {
    ensureRow(error.strategy).errors += 1;
  }

  return [...rows.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
};

export const analyzeRuntimeParity = (context: RuntimeParityAnalysisContext) => {
  const comparableRuntimeTrades = context.runtimeTrades.filter((trade) =>
    context.successfulTargetKeys.has(toTargetKey(trade)),
  );
  const rawRuntimeEntries = extractRuntimeParityEntries(
    comparableRuntimeTrades,
  );
  const runtimeDedupe = dedupeRuntimeParityEntries(rawRuntimeEntries);
  const runtimeEntries = runtimeDedupe.entries;
  const comparison = compareTradeParityEntries({
    runtimeEntries,
    backtestEntries: context.backtestEntries,
    toleranceMs: context.toleranceMs,
  });
  const classifiedBacktestOnly = classifyBacktestOnlyEntries({
    entries: comparison.backtestOnly,
    runtimeSignals: context.runtimeSignals,
    runtimeSignalEvaluations: context.runtimeSignalEvaluations,
    toleranceMs: context.toleranceMs,
  });
  const classifiedRuntimeOnly = classifyRuntimeOnlyEntries({
    entries: comparison.runtimeOnly,
    replaySignalEvaluations: context.replaySignalEvaluations,
    backtestEntries: context.backtestEntries,
    toleranceMs: context.toleranceMs,
  });
  const matchedSummary = summarizeMatchedParity(comparison.matched);
  const strategyRows = summarizeByStrategy({
    targets: context.replayTargets,
    successfulTargetKeys: context.successfulTargetKeys,
    replayErrors: context.replayErrors,
    runtimeEntries,
    runtimeDuplicateEntries: runtimeDedupe.duplicateEntries,
    backtestEntries: context.backtestEntries,
    matchedEntries: comparison.matched,
    runtimeOnlyEntries: comparison.runtimeOnly,
    backtestOnlyEntries: comparison.backtestOnly,
  });

  return {
    comparableRuntimeTrades,
    rawRuntimeEntries,
    runtimeDedupe,
    runtimeEntries,
    comparison,
    classifiedBacktestOnly,
    classifiedRuntimeOnly,
    matchedSummary,
    strategyRows,
  };
};
