import type {
  RuntimeSignalEvaluationRecord,
  Signal,
  SignalOrderStatus,
} from '@tradejs/types';
import type { TradeParityEntry } from '../runtimeParity';

export type BacktestOnlyClassification =
  | 'gated_out'
  | 'order_failed'
  | 'core_skipped'
  | 'not_evaluated'
  | 'true_mismatch';

export type ClassifiedBacktestOnlyEntry = {
  entry: TradeParityEntry;
  classification: BacktestOnlyClassification;
  reason: string;
  signal?: Signal;
  signalTimestampDiffMs?: number;
  evaluation?: RuntimeSignalEvaluationRecord;
  evaluationTimestampDiffMs?: number;
};

export type RuntimeOnlyClassification =
  | 'gated_out'
  | 'order_failed'
  | 'core_skipped'
  | 'backtest_drift'
  | 'not_evaluated'
  | 'true_mismatch';

export type ClassifiedRuntimeOnlyEntry = {
  entry: TradeParityEntry;
  classification: RuntimeOnlyClassification;
  reason: string;
  evaluation?: RuntimeSignalEvaluationRecord;
  evaluationTimestampDiffMs?: number;
  nearestBacktestEntry?: TradeParityEntry;
  nearestBacktestEntryTimestampDiffMs?: number;
};

export const BACKTEST_ONLY_CLASSIFICATIONS: BacktestOnlyClassification[] = [
  'gated_out',
  'order_failed',
  'core_skipped',
  'not_evaluated',
  'true_mismatch',
];

export const RUNTIME_ONLY_CLASSIFICATIONS: RuntimeOnlyClassification[] = [
  'gated_out',
  'order_failed',
  'core_skipped',
  'backtest_drift',
  'not_evaluated',
  'true_mismatch',
];

const formatMinutes = (value: number | null) =>
  value == null || !Number.isFinite(value)
    ? 'n/a'
    : `${(value / 60_000).toFixed(2)}m`;

const normalizeSignalOrderStatus = (
  value: Signal['orderStatus'],
): SignalOrderStatus | 'unknown' => {
  if (
    value === 'completed' ||
    value === 'failed' ||
    value === 'skipped' ||
    value === 'canceled'
  ) {
    return value;
  }

  return 'unknown';
};

const findNearestRuntimeSignal = ({
  entry,
  runtimeSignals,
  toleranceMs,
}: {
  entry: TradeParityEntry;
  runtimeSignals: Signal[];
  toleranceMs: number;
}) => {
  let bestSignal: Signal | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (const signal of runtimeSignals) {
    if (
      signal.strategy !== entry.strategy ||
      signal.symbol !== entry.symbol ||
      signal.direction !== entry.direction
    ) {
      continue;
    }

    const diff = Math.abs(signal.timestamp - entry.timestamp);
    if (diff > toleranceMs || diff >= bestDiff) {
      continue;
    }

    bestSignal = signal;
    bestDiff = diff;
  }

  return bestSignal
    ? {
        signal: bestSignal,
        timestampDiffMs: bestDiff,
      }
    : null;
};

const findNearestRuntimeSignalEvaluation = ({
  entry,
  runtimeSignalEvaluations,
  toleranceMs,
}: {
  entry: TradeParityEntry;
  runtimeSignalEvaluations: RuntimeSignalEvaluationRecord[];
  toleranceMs: number;
}) => {
  let bestEvaluation: RuntimeSignalEvaluationRecord | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (const evaluation of runtimeSignalEvaluations) {
    if (
      evaluation.strategy !== entry.strategy ||
      evaluation.symbol !== entry.symbol
    ) {
      continue;
    }

    const diff = Math.abs(evaluation.timestamp - entry.timestamp);
    if (diff > toleranceMs || diff >= bestDiff) {
      continue;
    }

    bestEvaluation = evaluation;
    bestDiff = diff;
  }

  return bestEvaluation
    ? {
        evaluation: bestEvaluation,
        timestampDiffMs: bestDiff,
      }
    : null;
};

const findNearestBacktestEntryForRuntimeOnly = ({
  entry,
  backtestEntries,
}: {
  entry: TradeParityEntry;
  backtestEntries: TradeParityEntry[];
}) => {
  let bestEntry: TradeParityEntry | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (const backtestEntry of backtestEntries) {
    if (
      backtestEntry.strategy !== entry.strategy ||
      backtestEntry.symbol !== entry.symbol ||
      backtestEntry.direction !== entry.direction
    ) {
      continue;
    }

    const diff = Math.abs(backtestEntry.timestamp - entry.timestamp);
    if (diff >= bestDiff) {
      continue;
    }

    bestEntry = backtestEntry;
    bestDiff = diff;
  }

  return bestEntry
    ? {
        entry: bestEntry,
        timestampDiffMs: bestDiff,
      }
    : null;
};

const buildSignalClassificationReason = ({
  signal,
  orderStatus,
  classification,
}: {
  signal: Signal;
  orderStatus: SignalOrderStatus | 'unknown';
  classification: BacktestOnlyClassification;
}) => {
  const skipReason =
    typeof signal.orderSkipReason === 'string'
      ? signal.orderSkipReason.trim()
      : '';
  if (skipReason) {
    return skipReason;
  }

  if (classification === 'gated_out' && signal.ml?.passed === false) {
    return `ml_probability=${signal.ml.probability.toFixed(4)} threshold=${signal.ml.threshold.toFixed(4)}`;
  }

  if (orderStatus === 'completed') {
    return 'completed_signal_without_runtime_trade';
  }

  if (orderStatus !== 'unknown') {
    return `orderStatus=${orderStatus}`;
  }

  return 'runtime_signal_without_completed_trade';
};

const buildEvaluationClassification = ({
  entry,
  evaluation,
}: {
  entry: TradeParityEntry;
  evaluation: RuntimeSignalEvaluationRecord;
}): Pick<ClassifiedBacktestOnlyEntry, 'classification' | 'reason'> => {
  if (evaluation.status === 'skip') {
    return {
      classification: 'core_skipped',
      reason: evaluation.reason || 'NO_SIGNAL',
    };
  }

  if (evaluation.status === 'error') {
    return {
      classification: 'true_mismatch',
      reason: evaluation.reason || 'runtime_evaluation_error',
    };
  }

  if (evaluation.direction && evaluation.direction !== entry.direction) {
    return {
      classification: 'core_skipped',
      reason: `runtime_signal_direction=${evaluation.direction}`,
    };
  }

  const orderStatus = normalizeSignalOrderStatus(evaluation.orderStatus);
  if (orderStatus === 'failed') {
    return {
      classification: 'order_failed',
      reason: evaluation.reason || 'orderStatus=failed',
    };
  }

  if (
    orderStatus === 'skipped' ||
    orderStatus === 'canceled' ||
    (typeof evaluation.orderSkipReason === 'string' &&
      evaluation.orderSkipReason.trim())
  ) {
    return {
      classification: 'gated_out',
      reason:
        evaluation.orderSkipReason ||
        evaluation.reason ||
        `orderStatus=${orderStatus}`,
    };
  }

  if (orderStatus === 'completed') {
    return {
      classification: 'true_mismatch',
      reason: 'completed_signal_without_runtime_trade',
    };
  }

  return {
    classification: 'true_mismatch',
    reason: evaluation.reason || 'runtime_signal_without_completed_trade',
  };
};

const buildRuntimeOnlyEvaluationClassification = ({
  entry,
  evaluation,
}: {
  entry: TradeParityEntry;
  evaluation: RuntimeSignalEvaluationRecord;
}): Pick<ClassifiedRuntimeOnlyEntry, 'classification' | 'reason'> => {
  if (evaluation.status === 'skip') {
    return {
      classification: 'core_skipped',
      reason: evaluation.reason || 'NO_SIGNAL',
    };
  }

  if (evaluation.status === 'error') {
    return {
      classification: 'true_mismatch',
      reason: evaluation.reason || 'replay_evaluation_error',
    };
  }

  if (evaluation.direction && evaluation.direction !== entry.direction) {
    return {
      classification: 'true_mismatch',
      reason: `replay_signal_direction=${evaluation.direction}`,
    };
  }

  const orderStatus = normalizeSignalOrderStatus(evaluation.orderStatus);
  if (orderStatus === 'failed') {
    return {
      classification: 'order_failed',
      reason: evaluation.reason || 'orderStatus=failed',
    };
  }

  if (
    orderStatus === 'skipped' ||
    orderStatus === 'canceled' ||
    (typeof evaluation.orderSkipReason === 'string' &&
      evaluation.orderSkipReason.trim())
  ) {
    return {
      classification: 'gated_out',
      reason:
        evaluation.orderSkipReason ||
        evaluation.reason ||
        `orderStatus=${orderStatus}`,
    };
  }

  if (orderStatus === 'completed') {
    return {
      classification: 'true_mismatch',
      reason: 'completed_replay_signal_without_backtest_trade',
    };
  }

  return {
    classification: 'true_mismatch',
    reason: evaluation.reason || 'runtime_trade_without_replay_trade',
  };
};

export const classifyBacktestOnlyEntries = ({
  entries,
  runtimeSignals,
  runtimeSignalEvaluations,
  toleranceMs,
}: {
  entries: TradeParityEntry[];
  runtimeSignals: Signal[];
  runtimeSignalEvaluations: RuntimeSignalEvaluationRecord[];
  toleranceMs: number;
}): ClassifiedBacktestOnlyEntry[] =>
  entries.map((entry) => {
    const nearestSignal = findNearestRuntimeSignal({
      entry,
      runtimeSignals,
      toleranceMs,
    });

    if (!nearestSignal) {
      const nearestEvaluation = findNearestRuntimeSignalEvaluation({
        entry,
        runtimeSignalEvaluations,
        toleranceMs,
      });

      if (nearestEvaluation) {
        const evaluationClassification = buildEvaluationClassification({
          entry,
          evaluation: nearestEvaluation.evaluation,
        });

        return {
          entry,
          ...evaluationClassification,
          evaluation: nearestEvaluation.evaluation,
          evaluationTimestampDiffMs: nearestEvaluation.timestampDiffMs,
        };
      }

      return {
        entry,
        classification: 'not_evaluated',
        reason: 'no_runtime_evaluation',
      };
    }

    const orderStatus = normalizeSignalOrderStatus(
      nearestSignal.signal.orderStatus,
    );
    let classification: BacktestOnlyClassification;

    if (orderStatus === 'failed') {
      classification = 'order_failed';
    } else if (
      orderStatus === 'skipped' ||
      orderStatus === 'canceled' ||
      nearestSignal.signal.ml?.passed === false ||
      (typeof nearestSignal.signal.orderSkipReason === 'string' &&
        nearestSignal.signal.orderSkipReason.trim())
    ) {
      classification = 'gated_out';
    } else {
      classification = 'true_mismatch';
    }

    return {
      entry,
      classification,
      reason: buildSignalClassificationReason({
        signal: nearestSignal.signal,
        orderStatus,
        classification,
      }),
      signal: nearestSignal.signal,
      signalTimestampDiffMs: nearestSignal.timestampDiffMs,
    };
  });

export const classifyRuntimeOnlyEntries = ({
  entries,
  replaySignalEvaluations,
  backtestEntries,
  toleranceMs,
}: {
  entries: TradeParityEntry[];
  replaySignalEvaluations: RuntimeSignalEvaluationRecord[];
  backtestEntries: TradeParityEntry[];
  toleranceMs: number;
}): ClassifiedRuntimeOnlyEntry[] =>
  entries.map((entry) => {
    const nearestBacktestEntry = findNearestBacktestEntryForRuntimeOnly({
      entry,
      backtestEntries,
    });
    if (
      nearestBacktestEntry &&
      nearestBacktestEntry.timestampDiffMs > toleranceMs
    ) {
      return {
        entry,
        classification: 'backtest_drift',
        reason: `nearest_backtest_entry_drift=${formatMinutes(nearestBacktestEntry.timestampDiffMs)}`,
        nearestBacktestEntry: nearestBacktestEntry.entry,
        nearestBacktestEntryTimestampDiffMs:
          nearestBacktestEntry.timestampDiffMs,
      };
    }

    const nearestEvaluation = findNearestRuntimeSignalEvaluation({
      entry,
      runtimeSignalEvaluations: replaySignalEvaluations,
      toleranceMs,
    });
    if (!nearestEvaluation) {
      return {
        entry,
        classification: 'not_evaluated',
        reason: 'no_replay_evaluation',
      };
    }

    return {
      entry,
      ...buildRuntimeOnlyEvaluationClassification({
        entry,
        evaluation: nearestEvaluation.evaluation,
      }),
      evaluation: nearestEvaluation.evaluation,
      evaluationTimestampDiffMs: nearestEvaluation.timestampDiffMs,
    };
  });

export const summarizeBacktestOnlyClassifications = (
  classifiedEntries: ClassifiedBacktestOnlyEntry[],
) => {
  const counts = new Map<BacktestOnlyClassification, number>(
    BACKTEST_ONLY_CLASSIFICATIONS.map((classification) => [classification, 0]),
  );

  for (const item of classifiedEntries) {
    counts.set(item.classification, (counts.get(item.classification) ?? 0) + 1);
  }

  const nonZero = BACKTEST_ONLY_CLASSIFICATIONS.flatMap((classification) => {
    const count = counts.get(classification) ?? 0;
    return count > 0 ? [`${classification}=${count}`] : [];
  });

  return nonZero.join(', ');
};

export const summarizeRuntimeOnlyClassifications = (
  classifiedEntries: ClassifiedRuntimeOnlyEntry[],
) => {
  const counts = new Map<RuntimeOnlyClassification, number>(
    RUNTIME_ONLY_CLASSIFICATIONS.map((classification) => [classification, 0]),
  );

  for (const item of classifiedEntries) {
    counts.set(item.classification, (counts.get(item.classification) ?? 0) + 1);
  }

  const nonZero = RUNTIME_ONLY_CLASSIFICATIONS.flatMap((classification) => {
    const count = counts.get(classification) ?? 0;
    return count > 0 ? [`${classification}=${count}`] : [];
  });

  return nonZero.join(', ');
};
