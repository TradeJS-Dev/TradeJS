import type { RuntimeSignalEvaluationRecord, Signal } from '@tradejs/types';
import type { TradeParityEntry } from '../runtimeParity';
import type {
  BacktestOnlyClassification,
  RuntimeOnlyClassification,
} from './classification';
import {
  buildStrategyIssueRows,
  type RuntimeParityReportContext,
} from './reportingShared';

const toSerializableTradeParityEntry = (entry: TradeParityEntry | undefined) =>
  entry
    ? {
        id: entry.id,
        source: entry.source,
        strategy: entry.strategy,
        symbol: entry.symbol,
        direction: entry.direction,
        timestamp: entry.timestamp,
        price: entry.price,
        orderId: entry.orderId,
        signalId: entry.signalId,
      }
    : undefined;

const toSerializableSignal = (signal: Signal | undefined) =>
  signal
    ? {
        signalId: signal.signalId,
        orderId: signal.orderId,
        strategy: signal.strategy,
        symbol: signal.symbol,
        direction: signal.direction,
        timestamp: signal.timestamp,
        orderStatus: signal.orderStatus,
        orderSkipReason: signal.orderSkipReason,
        ml: signal.ml,
        aiAnalysis: signal.aiAnalysis,
      }
    : undefined;

const toSerializableRuntimeSignalEvaluation = (
  evaluation: RuntimeSignalEvaluationRecord | undefined,
) =>
  evaluation
    ? {
        evaluationId: evaluation.evaluationId,
        strategy: evaluation.strategy,
        symbol: evaluation.symbol,
        direction: evaluation.direction,
        timestamp: evaluation.timestamp,
        evaluatedAt: evaluation.evaluatedAt,
        status: evaluation.status,
        reason: evaluation.reason,
        signalId: evaluation.signalId,
        orderStatus: evaluation.orderStatus,
        orderSkipReason: evaluation.orderSkipReason,
        ml: evaluation.ml,
        aiAnalysis: evaluation.aiAnalysis,
      }
    : undefined;

const getRuntimeOnlyLikelyCause = (
  classification: RuntimeOnlyClassification,
) => {
  switch (classification) {
    case 'gated_out':
      return 'Replay saw the setup but blocked the trade with gate/order-skip logic.';
    case 'order_failed':
      return 'Replay saw the setup but order placement failed.';
    case 'core_skipped':
      return 'Replay strategy core did not emit a signal for this runtime trade.';
    case 'backtest_drift':
      return 'Replay has a nearby backtest entry, but it is outside the allowed timestamp tolerance.';
    case 'not_evaluated':
      return 'Replay produced no evaluation close to the runtime trade timestamp.';
    case 'true_mismatch':
      return 'Runtime and replay disagree after evaluation; inspect direction, statuses, and reason fields.';
  }
};

const getBacktestOnlyLikelyCause = (
  classification: BacktestOnlyClassification,
) => {
  switch (classification) {
    case 'gated_out':
      return 'Runtime/live path saw the setup but blocked the trade with gate/order-skip logic.';
    case 'order_failed':
      return 'Runtime/live path saw the setup but order placement failed.';
    case 'core_skipped':
      return 'Runtime evaluation skipped the setup while replay/backtest opened a trade.';
    case 'not_evaluated':
      return 'Runtime produced no signal or evaluation close to the backtest trade timestamp.';
    case 'true_mismatch':
      return 'Backtest opened a trade that runtime did not replicate; inspect signal/evaluation context.';
  }
};

const getRuntimeOnlyRecommendedChecks = (
  classification: RuntimeOnlyClassification,
) => {
  switch (classification) {
    case 'gated_out':
      return [
        'Check replay evaluation.orderStatus',
        'Check replay evaluation.orderSkipReason',
        'Compare AI/ML gate inputs',
      ];
    case 'order_failed':
      return [
        'Check replay evaluation.orderStatus',
        'Check replay evaluation.reason',
        'Check connector/order simulation path',
      ];
    case 'core_skipped':
      return [
        'Check replay evaluation.status',
        'Compare candle window and preload history',
        'Inspect strategy core conditions at entry timestamp',
      ];
    case 'backtest_drift':
      return [
        'Check nearest backtest timestamp',
        'Inspect toleranceBars/toleranceMs',
        'Compare candle alignment and exchange history',
      ];
    case 'not_evaluated':
      return [
        'Check replay target coverage',
        'Check replay evaluation generation',
        'Inspect symbol/strategy filtering',
      ];
    case 'true_mismatch':
      return [
        'Compare runtime trade vs replay evaluation',
        'Check direction and orderStatus',
        'Inspect strategy inputs around entry timestamp',
      ];
  }
};

const getBacktestOnlyRecommendedChecks = (
  classification: BacktestOnlyClassification,
) => {
  switch (classification) {
    case 'gated_out':
      return [
        'Check runtime signal.orderStatus',
        'Check runtime signal.orderSkipReason',
        'Compare AI/ML gate inputs',
      ];
    case 'order_failed':
      return [
        'Check runtime signal.orderStatus',
        'Check runtime evaluation.reason',
        'Inspect live order placement path',
      ];
    case 'core_skipped':
      return [
        'Check runtime evaluation.status',
        'Compare runtime signal direction',
        'Inspect strategy core conditions at entry timestamp',
      ];
    case 'not_evaluated':
      return [
        'Check runtime signal persistence',
        'Check evaluation generation',
        'Inspect symbol/strategy filtering',
      ];
    case 'true_mismatch':
      return [
        'Compare backtest entry vs runtime signal/evaluation',
        'Check direction and orderStatus',
        'Inspect runtime-specific filters',
      ];
  }
};

export const buildRuntimeParityMismatchAttachment = (
  context: RuntimeParityReportContext,
) => {
  if (
    !context.classifiedRuntimeOnly.length &&
    !context.classifiedBacktestOnly.length
  ) {
    return null;
  }

  const cases = [
    ...context.classifiedRuntimeOnly.map((item) => ({
      kind: 'runtimeOnly' as const,
      strategy: item.entry.strategy,
      symbol: item.entry.symbol,
      direction: item.entry.direction,
      signalRefs: {
        signalId: item.entry.signalId ?? item.evaluation?.signalId,
        orderId: item.entry.orderId ?? item.entry.id,
        evaluationId: item.evaluation?.evaluationId,
      },
      why: {
        classification: item.classification,
        reason: item.reason,
        likelyCause: getRuntimeOnlyLikelyCause(item.classification),
      },
      timing: {
        entryTimestamp: item.entry.timestamp,
        replayEvaluationTimestamp: item.evaluation?.timestamp,
        replayEvaluatedAt: item.evaluation?.evaluatedAt,
        nearestBacktestTimestamp: item.nearestBacktestEntry?.timestamp,
        replayEvaluationDriftMs: item.evaluationTimestampDiffMs,
        nearestBacktestDriftMs: item.nearestBacktestEntryTimestampDiffMs,
      },
      decisionTrace: {
        replayEvaluationStatus: item.evaluation?.status,
        replayOrderStatus: item.evaluation?.orderStatus,
        replayOrderSkipReason: item.evaluation?.orderSkipReason,
      },
      recommendedChecks: getRuntimeOnlyRecommendedChecks(item.classification),
      artifacts: {
        runtimeEntry: toSerializableTradeParityEntry(item.entry),
        replayEvaluation: toSerializableRuntimeSignalEvaluation(
          item.evaluation,
        ),
        nearestBacktestEntry: toSerializableTradeParityEntry(
          item.nearestBacktestEntry,
        ),
      },
    })),
    ...context.classifiedBacktestOnly.map((item) => ({
      kind: 'backtestOnly' as const,
      strategy: item.entry.strategy,
      symbol: item.entry.symbol,
      direction: item.entry.direction,
      signalRefs: {
        signalId:
          item.entry.signalId ||
          item.signal?.signalId ||
          item.evaluation?.signalId ||
          item.entry.id,
        orderId: item.signal?.orderId,
        evaluationId: item.evaluation?.evaluationId,
      },
      why: {
        classification: item.classification,
        reason: item.reason,
        likelyCause: getBacktestOnlyLikelyCause(item.classification),
      },
      timing: {
        entryTimestamp: item.entry.timestamp,
        runtimeSignalTimestamp: item.signal?.timestamp,
        runtimeEvaluationTimestamp: item.evaluation?.timestamp,
        runtimeEvaluatedAt: item.evaluation?.evaluatedAt,
        runtimeSignalDriftMs: item.signalTimestampDiffMs,
        runtimeEvaluationDriftMs: item.evaluationTimestampDiffMs,
      },
      decisionTrace: {
        runtimeSignalOrderStatus: item.signal?.orderStatus,
        runtimeSignalOrderSkipReason: item.signal?.orderSkipReason,
        runtimeEvaluationStatus: item.evaluation?.status,
        runtimeEvaluationOrderStatus: item.evaluation?.orderStatus,
        runtimeEvaluationOrderSkipReason: item.evaluation?.orderSkipReason,
      },
      recommendedChecks: getBacktestOnlyRecommendedChecks(item.classification),
      artifacts: {
        backtestEntry: toSerializableTradeParityEntry(item.entry),
        runtimeSignal: toSerializableSignal(item.signal),
        runtimeEvaluation: toSerializableRuntimeSignalEvaluation(
          item.evaluation,
        ),
      },
    })),
  ];

  const payload = {
    kind: 'tradejs-runtime-parity-mismatches',
    version: 1,
    generatedAt: Date.now(),
    codexQuestion:
      'For each mismatch case, explain why runtime and replay/backtest diverged. Use why.classification first, then confirm with decisionTrace, timing, and artifacts.',
    window: {
      start: context.window.start,
      end: context.window.end,
      source: context.window.source,
    },
    connectorName: context.connectorName,
    replayEnv: context.replayEnv,
    tolerance: { bars: context.toleranceBars, ms: context.toleranceMs },
    summary: {
      replayTargets: context.replayTargetsCount,
      comparedTargets: context.comparedTargetsCount,
      replayErrors: context.replayErrors.length,
      sourceCounts: context.sourceCounts,
      runtimeEntriesRaw: context.rawRuntimeEntriesCount,
      runtimeEntries: context.runtimeEntriesCount,
      runtimeDuplicateEntries: context.runtimeDuplicateEntriesCount,
      backtestEntries: context.backtestEntriesCount,
      matchedEntries: context.matchedCount,
      runtimeOnlyEntries: context.runtimeOnlyCount,
      backtestOnlyEntries: context.backtestOnlyCount,
      runtimeSignalEvaluations: context.runtimeSignalEvaluationsCount,
      matchedDeltas: {
        priceAvgPct: context.matchedSummary.avgPriceDeltaPct,
        priceMaxPct: context.matchedSummary.maxPriceDeltaPct,
        timeAvgMs: context.matchedSummary.avgTimestampDiffMs,
        timeMaxMs: context.matchedSummary.maxTimestampDiffMs,
      },
      strategyIssues: buildStrategyIssueRows(context.strategyRows).map((line) =>
        line.slice(2),
      ),
    },
    replayErrors: context.replayErrors.map((error) => ({
      strategy: error.strategy,
      symbol: error.symbol,
      sources: error.sources,
      message: error.message,
    })),
    cases,
    mismatches: {
      runtimeOnly: context.classifiedRuntimeOnly.map((item) => ({
        classification: item.classification,
        reason: item.reason,
        runtimeEntry: toSerializableTradeParityEntry(item.entry),
        replayEvaluation: toSerializableRuntimeSignalEvaluation(
          item.evaluation,
        ),
        replayEvaluationDriftMs: item.evaluationTimestampDiffMs,
        nearestBacktestEntry: toSerializableTradeParityEntry(
          item.nearestBacktestEntry,
        ),
        nearestBacktestDriftMs: item.nearestBacktestEntryTimestampDiffMs,
      })),
      backtestOnly: context.classifiedBacktestOnly.map((item) => ({
        classification: item.classification,
        reason: item.reason,
        backtestEntry: toSerializableTradeParityEntry(item.entry),
        runtimeSignal: toSerializableSignal(item.signal),
        runtimeSignalDriftMs: item.signalTimestampDiffMs,
        runtimeEvaluation: toSerializableRuntimeSignalEvaluation(
          item.evaluation,
        ),
        runtimeEvaluationDriftMs: item.evaluationTimestampDiffMs,
      })),
    },
  };

  return {
    filename: `runtime-parity-mismatches-${context.connectorName}-${context.window.start}-${context.window.end}.json`,
    content: JSON.stringify(payload, null, 2),
    caption: 'Runtime parity mismatch JSON',
  };
};
