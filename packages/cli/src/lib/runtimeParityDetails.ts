import {
  normalizeStrategyOrderLinkKey,
  parseStrategyOrderLinkKey,
} from '@tradejs/core/trade';
import type {
  ExchangeEntryRecord,
  RuntimeSignalEvaluationRecord,
  Signal,
} from '@tradejs/types';
import {
  getBacktestParityComparisonTimestamp,
  type TradeParityEntry,
} from './runtimeParity';
import type {
  ReplayMismatchAiDiagnostic,
  ReplayMismatchDrilldown,
  ReplayMismatchEvaluationDiagnostic,
  ReplayMismatchSignalDiagnostic,
  ReplayParityEntryDetail,
  ReplayParityNearestCandidate,
  ReplayRuntimeComparisonDetails,
} from './replay/support';
import type { RuntimeLineageScopeRecord } from './runtimeSignalsStorage';

export type ExchangeMatchedBacktestEntry = {
  exchange: ExchangeEntryRecord;
  backtest: TradeParityEntry;
  timestampDiffMs: number;
  priceDeltaPct: number | null;
};

export type ExchangeOrderFailedBacktestEntry = ExchangeMatchedBacktestEntry & {
  reason: string;
};

const DEFAULT_REPLAY_PARITY_DETAILS_LIMIT = 500;
const DEFAULT_REPLAY_PARITY_ARTIFACT_LIMIT = 100;

export const buildStrategyNameByOrderLinkKey = (strategyNames: string[]) =>
  new Map(
    strategyNames.flatMap((strategyName) => {
      const strategyKey = normalizeStrategyOrderLinkKey(strategyName);
      return strategyKey ? [[strategyKey, strategyName] as const] : [];
    }),
  );

export const resolveReplayStrategyNameFromExchangeEntry = ({
  exchangeEntry,
  strategyNameByOrderLinkKey,
}: {
  exchangeEntry: Pick<ExchangeEntryRecord, 'orderLinkId'>;
  strategyNameByOrderLinkKey: Map<string, string>;
}) => {
  const strategyKey = parseStrategyOrderLinkKey(exchangeEntry.orderLinkId);
  if (!strategyKey) {
    return null;
  }

  return strategyNameByOrderLinkKey.get(strategyKey) ?? null;
};

const resolveReplayParityDetailsLimit = () => {
  const parsed = Number.parseInt(
    String(process.env.REPLAY_PARITY_DETAILS_LIMIT ?? ''),
    10,
  );
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_REPLAY_PARITY_DETAILS_LIMIT;
};

const resolveReplayParityArtifactLimit = () => {
  const parsed = Number.parseInt(
    String(process.env.REPLAY_PARITY_ARTIFACT_LIMIT ?? ''),
    10,
  );
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_REPLAY_PARITY_ARTIFACT_LIMIT;
};

const capReplayDetails = <TItem>(items: TItem[], limit: number) =>
  items.slice(0, Math.max(0, limit));

const buildCostDetail = (entry: {
  entryFee?: number | null;
  exitFee?: number | null;
  fundingFee?: number | null;
  totalFee?: number | null;
}) => ({
  entryFee: entry.entryFee ?? null,
  exitFee: entry.exitFee ?? null,
  fundingFee: entry.fundingFee ?? null,
  totalFee: entry.totalFee ?? null,
});

const toBacktestParityDetail = (
  entry: TradeParityEntry,
  timestampOffsetMs = 0,
): ReplayParityEntryDetail => {
  const comparisonTimestamp = getBacktestParityComparisonTimestamp(
    entry,
    timestampOffsetMs,
  );
  return {
    source: 'backtest',
    strategy: entry.strategy,
    symbol: entry.symbol,
    direction: entry.direction,
    qty: entry.qty ?? null,
    timestamp: entry.timestamp,
    signalTimestamp: entry.signalTimestamp ?? null,
    comparisonTimestamp: timestampOffsetMs === 0 ? null : comparisonTimestamp,
    price: entry.price,
    exitType: entry.exitType ?? null,
    exitTimestamp: entry.exitTimestamp ?? null,
    exitPrice: entry.exitPrice ?? null,
    pnl: entry.expectedPnl ?? null,
    costs: buildCostDetail(entry),
    orderId: entry.orderId,
    signalId: entry.signalId,
  };
};

const toRuntimeParityDetail = (
  entry: TradeParityEntry,
): ReplayParityEntryDetail => ({
  source: 'runtime',
  strategy: entry.strategy,
  symbol: entry.symbol,
  direction: entry.direction,
  qty: entry.qty ?? null,
  timestamp: entry.timestamp,
  price: entry.price,
  exitType: entry.exitType ?? null,
  exitTimestamp: entry.exitTimestamp ?? null,
  exitPrice: entry.exitPrice ?? null,
  pnl: entry.realizedPnl ?? null,
  costs: buildCostDetail(entry),
  orderId: entry.orderId,
  signalId: entry.signalId,
});

const toExchangeParityDetail = ({
  entry,
  inferredStrategy = null,
}: {
  entry: ExchangeEntryRecord;
  inferredStrategy?: string | null;
}): ReplayParityEntryDetail => ({
  source: 'exchange',
  inferredStrategy,
  symbol: entry.symbol,
  direction: entry.direction,
  qty: entry.qty,
  timestamp: entry.entryTimestamp,
  price: entry.entryPrice,
  exitType: null,
  exitTimestamp: entry.exitTimestamp ?? null,
  exitPrice: entry.exitPrice ?? null,
  pnl: entry.closedPnl ?? null,
  costs: buildCostDetail({
    entryFee: entry.openFee,
    exitFee: entry.closeFee,
    fundingFee: entry.fundingFee,
    totalFee: entry.totalFee,
  }),
  orderId: entry.orderId,
  orderLinkId: entry.orderLinkId,
});

const buildTimestampDelta = (
  left: number | null | undefined,
  right: number | null | undefined,
) =>
  typeof left === 'number' &&
  Number.isFinite(left) &&
  typeof right === 'number' &&
  Number.isFinite(right)
    ? Math.abs(left - right)
    : null;

const getComparisonTimestamp = (entry: ReplayParityEntryDetail) =>
  typeof entry.comparisonTimestamp === 'number' &&
  Number.isFinite(entry.comparisonTimestamp)
    ? entry.comparisonTimestamp
    : entry.timestamp;

const getEntryStrategy = (entry: ReplayParityEntryDetail) =>
  entry.strategy ?? entry.inferredStrategy ?? null;

const findNearestSignal = ({
  entry,
  signals,
  toleranceMs,
  timestampOffsetMs,
  entryTimestampOffsetMs = 0,
}: {
  entry: ReplayParityEntryDetail;
  signals: Signal[];
  toleranceMs: number;
  timestampOffsetMs: number;
  entryTimestampOffsetMs?: number;
}) => {
  const entryStrategy = getEntryStrategy(entry);
  if (!entryStrategy) {
    return null;
  }

  let bestSignal: Signal | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  const entryTimestamp = entry.timestamp + entryTimestampOffsetMs;

  for (const signal of signals) {
    if (
      signal.strategy !== entryStrategy ||
      signal.symbol !== entry.symbol ||
      signal.direction !== entry.direction
    ) {
      continue;
    }

    const diff = Math.abs(
      signal.timestamp + timestampOffsetMs - entryTimestamp,
    );
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

const findNearestEvaluation = ({
  entry,
  evaluations,
  toleranceMs,
  timestampOffsetMs,
  entryTimestampOffsetMs = 0,
}: {
  entry: ReplayParityEntryDetail;
  evaluations: RuntimeSignalEvaluationRecord[];
  toleranceMs: number;
  timestampOffsetMs: number;
  entryTimestampOffsetMs?: number;
}) => {
  const entryStrategy = getEntryStrategy(entry);
  if (!entryStrategy) {
    return null;
  }

  let bestEvaluation: RuntimeSignalEvaluationRecord | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  const entryTimestamp = entry.timestamp + entryTimestampOffsetMs;

  for (const evaluation of evaluations) {
    if (
      evaluation.strategy !== entryStrategy ||
      evaluation.symbol !== entry.symbol
    ) {
      continue;
    }

    const diff = Math.abs(
      evaluation.timestamp + timestampOffsetMs - entryTimestamp,
    );
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

const findNearestRuntimeEvaluationOutcome = ({
  entry,
  lineageScopes,
  toleranceMs,
}: {
  entry: ReplayParityEntryDetail;
  lineageScopes: RuntimeLineageScopeRecord[];
  toleranceMs: number;
}) => {
  const strategy = getEntryStrategy(entry);
  const timestamp = entry.signalTimestamp ?? entry.timestamp;
  if (!strategy) return null;

  let nearest: {
    status: 'skip';
    reason: string;
    timestamp: number;
    timestampDiffMs: number;
    source: 'lineage_scope_compact';
  } | null = null;

  for (const scope of lineageScopes) {
    if (scope.strategy !== strategy || scope.symbol !== entry.symbol) {
      continue;
    }
    for (const run of scope.evaluationRuns ?? []) {
      if (
        run.stepMs <= 0 ||
        timestamp < run.firstTimestamp - toleranceMs ||
        timestamp > run.lastTimestamp + toleranceMs
      ) {
        continue;
      }
      const step = Math.round((timestamp - run.firstTimestamp) / run.stepMs);
      const candidateTimestamp = run.firstTimestamp + step * run.stepMs;
      const timestampDiffMs = Math.abs(candidateTimestamp - timestamp);
      if (
        candidateTimestamp < run.firstTimestamp ||
        candidateTimestamp > run.lastTimestamp ||
        timestampDiffMs > toleranceMs ||
        (nearest && timestampDiffMs >= nearest.timestampDiffMs)
      ) {
        continue;
      }
      nearest = {
        status: run.status,
        reason: run.reason,
        timestamp: candidateTimestamp,
        timestampDiffMs,
        source: 'lineage_scope_compact',
      };
    }
  }

  return nearest;
};

const hasRuntimeLineageCoverage = ({
  entry,
  lineageScopes,
}: {
  entry: ReplayParityEntryDetail;
  lineageScopes: RuntimeLineageScopeRecord[];
}) => {
  const strategy = getEntryStrategy(entry);
  const timestamp = entry.signalTimestamp ?? entry.timestamp;
  return lineageScopes.some(
    (scope) =>
      scope.strategy === strategy &&
      scope.symbol === entry.symbol &&
      timestamp >= scope.firstTimestamp &&
      timestamp <= scope.lastTimestamp,
  );
};

const classifySignalDiagnostic = (
  signal: Signal,
): { classification: string; reason: string } => {
  if (signal.orderStatus === 'failed') {
    return {
      classification: 'order_failed',
      reason: signal.orderFailureReason || signal.orderSkipReason || 'failed',
    };
  }

  if (
    signal.orderStatus === 'skipped' ||
    signal.orderStatus === 'canceled' ||
    (typeof signal.orderSkipReason === 'string' &&
      signal.orderSkipReason.trim()) ||
    signal.ml?.passed === false
  ) {
    return {
      classification: 'gated_or_policy_blocked',
      reason:
        signal.orderSkipReason ||
        (signal.ml?.passed === false
          ? `ml_probability=${signal.ml.probability} threshold=${signal.ml.threshold}`
          : `orderStatus=${signal.orderStatus ?? 'skipped'}`),
    };
  }

  if (signal.orderStatus === 'completed') {
    return {
      classification: 'completed_signal_without_match',
      reason: 'completed_signal_without_matching_trade',
    };
  }

  return {
    classification: 'signal_without_order_status',
    reason: 'signal_found_without_order_status',
  };
};

const classifyEvaluationDiagnostic = (
  evaluation: RuntimeSignalEvaluationRecord,
): { classification: string; reason: string } => {
  if (evaluation.status === 'skip') {
    return {
      classification: 'core_skipped',
      reason: evaluation.reason || 'NO_SIGNAL',
    };
  }

  if (evaluation.status === 'error') {
    return {
      classification: 'evaluation_error',
      reason: evaluation.reason || 'runtime_evaluation_error',
    };
  }

  if (evaluation.orderStatus === 'failed') {
    return {
      classification: 'order_failed',
      reason: evaluation.reason || 'orderStatus=failed',
    };
  }

  if (
    evaluation.orderStatus === 'skipped' ||
    evaluation.orderStatus === 'canceled' ||
    (typeof evaluation.orderSkipReason === 'string' &&
      evaluation.orderSkipReason.trim())
  ) {
    return {
      classification: 'gated_or_policy_blocked',
      reason:
        evaluation.orderSkipReason ||
        evaluation.reason ||
        `orderStatus=${evaluation.orderStatus}`,
    };
  }

  if (evaluation.orderStatus === 'completed') {
    return {
      classification: 'completed_signal_without_match',
      reason: 'completed_signal_without_matching_trade',
    };
  }

  return {
    classification: 'signal_evaluation_without_order_status',
    reason: evaluation.reason || 'signal_evaluation_without_order_status',
  };
};

const summarizeMismatchDiagnostics = (
  items: Array<{ classification: string }>,
) =>
  Object.fromEntries(
    [
      ...items
        .reduce((counts, item) => {
          counts.set(
            item.classification,
            (counts.get(item.classification) ?? 0) + 1,
          );
          return counts;
        }, new Map<string, number>())
        .entries(),
    ].sort(([left], [right]) => left.localeCompare(right)),
  );

const buildPnlDelta = (
  expectedPnl: number | null | undefined,
  realizedPnl: number | null | undefined,
) =>
  typeof expectedPnl === 'number' &&
  Number.isFinite(expectedPnl) &&
  typeof realizedPnl === 'number' &&
  Number.isFinite(realizedPnl)
    ? realizedPnl - expectedPnl
    : null;

const buildPriceDeltaPct = (
  leftPrice: number | null | undefined,
  rightPrice: number | null | undefined,
): number | null => {
  if (
    leftPrice == null ||
    rightPrice == null ||
    !Number.isFinite(leftPrice) ||
    !Number.isFinite(rightPrice) ||
    leftPrice === 0
  ) {
    return null;
  }

  return Math.abs(((rightPrice - leftPrice) / leftPrice) * 100);
};

const toFiniteNumberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const toAiDiagnostic = (
  analysis: Signal['aiAnalysis'] | RuntimeSignalEvaluationRecord['aiAnalysis'],
): ReplayMismatchAiDiagnostic | null => {
  if (!analysis || typeof analysis !== 'object') {
    return null;
  }

  return {
    direction:
      typeof analysis.direction === 'string' ? analysis.direction : null,
    quality: toFiniteNumberOrNull(analysis.quality),
    needRetest:
      typeof analysis.needRetest === 'boolean' ? analysis.needRetest : null,
    gateDecision:
      typeof analysis.gateDecision === 'string' ? analysis.gateDecision : null,
    llmDecision:
      typeof analysis.llmDecision === 'string' ? analysis.llmDecision : null,
    qualityReason:
      typeof analysis.qualityReason === 'string'
        ? analysis.qualityReason
        : null,
  };
};

const toSignalDiagnostic = ({
  signal,
  timestampDiffMs,
}: {
  signal: Signal;
  timestampDiffMs: number;
}): ReplayMismatchSignalDiagnostic => ({
  signalId: signal.signalId,
  timestamp: signal.timestamp,
  timestampDiffMs,
  direction: signal.direction,
  orderStatus: signal.orderStatus,
  orderSkipReason: signal.orderSkipReason,
  ai: toAiDiagnostic(signal.aiAnalysis),
  ml: signal.ml ?? null,
});

const toEvaluationDiagnostic = ({
  evaluation,
  timestampDiffMs,
}: {
  evaluation: RuntimeSignalEvaluationRecord;
  timestampDiffMs: number;
}): ReplayMismatchEvaluationDiagnostic => ({
  evaluationId: evaluation.evaluationId,
  timestamp: evaluation.timestamp,
  timestampDiffMs,
  status: evaluation.status,
  reason: evaluation.reason,
  signalId: evaluation.signalId,
  direction: evaluation.direction,
  orderStatus: evaluation.orderStatus,
  orderSkipReason: evaluation.orderSkipReason,
  ai: toAiDiagnostic(evaluation.aiAnalysis),
  ml: evaluation.ml ?? null,
});

const buildSlippageCost = ({
  direction,
  expectedPrice,
  actualPrice,
  qty,
  stage,
}: {
  direction: string;
  expectedPrice: number | null | undefined;
  actualPrice: number | null | undefined;
  qty: number | null | undefined;
  stage: 'entry' | 'exit';
}) => {
  if (
    typeof expectedPrice !== 'number' ||
    !Number.isFinite(expectedPrice) ||
    typeof actualPrice !== 'number' ||
    !Number.isFinite(actualPrice) ||
    typeof qty !== 'number' ||
    !Number.isFinite(qty)
  ) {
    return null;
  }

  const sideMultiplier = direction === 'SHORT' ? -1 : 1;
  const priceDelta =
    stage === 'entry'
      ? (actualPrice - expectedPrice) * sideMultiplier
      : (expectedPrice - actualPrice) * sideMultiplier;
  return Number((priceDelta * qty).toFixed(12));
};

const buildMatchedReplayDetail = ({
  runtime,
  backtest,
  timestampDiffMs,
  priceDeltaPct,
}: {
  runtime: ReplayParityEntryDetail;
  backtest: ReplayParityEntryDetail;
  timestampDiffMs: number;
  priceDeltaPct: number | null;
}) => {
  const exitPriceDeltaPct = buildPriceDeltaPct(
    runtime.exitPrice ?? null,
    backtest.exitPrice ?? null,
  );
  const qty = runtime.qty ?? backtest.qty ?? null;
  const entrySlippageCost = buildSlippageCost({
    direction: runtime.direction,
    expectedPrice: backtest.price,
    actualPrice: runtime.price,
    qty,
    stage: 'entry',
  });
  const exitSlippageCost = buildSlippageCost({
    direction: runtime.direction,
    expectedPrice: backtest.exitPrice,
    actualPrice: runtime.exitPrice,
    qty,
    stage: 'exit',
  });
  const totalSlippageCost =
    entrySlippageCost == null && exitSlippageCost == null
      ? null
      : Number(
          ((entrySlippageCost ?? 0) + (exitSlippageCost ?? 0)).toFixed(12),
        );
  return {
    runtime,
    backtest,
    timestampDiffMs,
    priceDeltaPct,
    exitTimestampDiffMs: buildTimestampDelta(
      runtime.exitTimestamp,
      backtest.exitTimestamp,
    ),
    exitPriceDeltaPct,
    exitType: {
      expected: backtest.exitType ?? null,
      actual: runtime.exitType ?? null,
      matches:
        backtest.exitType && runtime.exitType
          ? backtest.exitType === runtime.exitType
          : null,
    },
    pnl: {
      expectedPnl: backtest.pnl ?? null,
      realizedPnl: runtime.pnl ?? null,
      delta: buildPnlDelta(backtest.pnl, runtime.pnl),
    },
    slippage: {
      entryPriceDeltaPct: priceDeltaPct,
      exitPriceDeltaPct,
      entryCost: entrySlippageCost,
      exitCost: exitSlippageCost,
      totalCost: totalSlippageCost,
    },
  };
};

const buildNearestCandidates = ({
  entries,
  candidates,
  toleranceMs,
  requireSameStrategy,
}: {
  entries: ReplayParityEntryDetail[];
  candidates: ReplayParityEntryDetail[];
  toleranceMs: number;
  requireSameStrategy?: boolean;
}): ReplayParityNearestCandidate[] =>
  entries.map((entry) => {
    const comparable = candidates.filter((candidate) => {
      if (
        candidate.symbol !== entry.symbol ||
        candidate.direction !== entry.direction
      ) {
        return false;
      }
      if (!requireSameStrategy) {
        return true;
      }
      const entryStrategy = entry.strategy ?? entry.inferredStrategy ?? null;
      const candidateStrategy =
        candidate.strategy ?? candidate.inferredStrategy ?? null;
      return entryStrategy != null && entryStrategy === candidateStrategy;
    });

    const nearest = comparable
      .map((candidate) => ({
        candidate,
        timestampDiffMs: Math.abs(
          getComparisonTimestamp(candidate) - getComparisonTimestamp(entry),
        ),
      }))
      .sort((left, right) => left.timestampDiffMs - right.timestampDiffMs)[0];

    if (!nearest) {
      return {
        entry,
        nearest: null,
        timestampDiffMs: null,
        priceDeltaPct: null,
        reason: 'no_candidate_same_symbol_direction',
      };
    }

    const priceDeltaPct = buildPriceDeltaPct(
      entry.price,
      nearest.candidate.price,
    );
    return {
      entry,
      nearest: nearest.candidate,
      timestampDiffMs: nearest.timestampDiffMs,
      priceDeltaPct,
      reason:
        nearest.timestampDiffMs > toleranceMs
          ? 'outside_tolerance'
          : 'candidate_already_matched',
    };
  });

export const buildReplayMismatchDrilldown = ({
  runtimeOnly,
  backtestOnly,
  nearestCandidates,
  runtimeSignals = [],
  runtimeSignalEvaluations = [],
  replaySignals = [],
  replaySignalEvaluations = [],
  runtimeLineageScopes = [],
  toleranceMs,
  backtestTimestampOffsetMs,
  limit,
}: {
  runtimeOnly: ReplayParityEntryDetail[];
  backtestOnly: ReplayParityEntryDetail[];
  nearestCandidates: ReplayParityNearestCandidate[];
  runtimeSignals?: Signal[];
  runtimeSignalEvaluations?: RuntimeSignalEvaluationRecord[];
  replaySignals?: Signal[];
  replaySignalEvaluations?: RuntimeSignalEvaluationRecord[];
  runtimeLineageScopes?: RuntimeLineageScopeRecord[];
  toleranceMs: number;
  backtestTimestampOffsetMs: number;
  limit: number;
}): ReplayMismatchDrilldown => {
  const nearestByEntry = new Map(
    nearestCandidates.map((candidate) => [candidate.entry, candidate]),
  );

  const artifactLimit = Math.min(limit, resolveReplayParityArtifactLimit());
  let runtimeOnlyArtifactsIncluded = 0;
  let backtestOnlyArtifactsIncluded = 0;

  const runtimeOnlyDiagnostics = runtimeOnly.map((entry, index) => {
    const includeArtifacts = index < artifactLimit;
    const nearestCandidate = nearestByEntry.get(entry);
    const nearestReplaySignal = findNearestSignal({
      entry,
      signals: replaySignals,
      toleranceMs,
      timestampOffsetMs: backtestTimestampOffsetMs,
    });
    const nearestReplayEvaluation = findNearestEvaluation({
      entry,
      evaluations: replaySignalEvaluations,
      toleranceMs,
      timestampOffsetMs: backtestTimestampOffsetMs,
    });

    const classification = nearestReplaySignal
      ? classifySignalDiagnostic(nearestReplaySignal.signal)
      : nearestReplayEvaluation
        ? classifyEvaluationDiagnostic(nearestReplayEvaluation.evaluation)
        : nearestCandidate?.nearest
          ? {
              classification: 'timing_or_price_drift',
              reason: nearestCandidate.reason,
            }
          : {
              classification: 'no_replay_candidate',
              reason: 'no_replay_signal_or_backtest_candidate',
            };

    return {
      entry,
      ...classification,
      ...(nearestCandidate ? { nearestCandidate } : {}),
      ...(nearestReplaySignal
        ? {
            replaySignal: toSignalDiagnostic({
              signal: nearestReplaySignal.signal,
              timestampDiffMs: nearestReplaySignal.timestampDiffMs,
            }),
            ...(includeArtifacts
              ? { replaySignalArtifact: nearestReplaySignal.signal }
              : {}),
          }
        : {}),
      ...(nearestReplayEvaluation
        ? {
            replayEvaluation: toEvaluationDiagnostic({
              evaluation: nearestReplayEvaluation.evaluation,
              timestampDiffMs: nearestReplayEvaluation.timestampDiffMs,
            }),
            ...(includeArtifacts
              ? { replayEvaluationArtifact: nearestReplayEvaluation.evaluation }
              : {}),
          }
        : {}),
    };
  });

  const backtestOnlyDiagnostics = backtestOnly.map((entry, index) => {
    const includeArtifacts = index < artifactLimit;
    const nearestCandidate = nearestByEntry.get(entry);
    const nearestRuntimeSignal = findNearestSignal({
      entry,
      signals: runtimeSignals,
      toleranceMs,
      timestampOffsetMs: 0,
    });
    const nearestRuntimeEvaluation = findNearestEvaluation({
      entry,
      evaluations: runtimeSignalEvaluations,
      toleranceMs,
      timestampOffsetMs: 0,
    });
    const nearestRuntimeEvaluationOutcome = findNearestRuntimeEvaluationOutcome(
      {
        entry,
        lineageScopes: runtimeLineageScopes,
        toleranceMs,
      },
    );
    const runtimeLineageCoversEntry = hasRuntimeLineageCoverage({
      entry,
      lineageScopes: runtimeLineageScopes,
    });

    const classification = nearestRuntimeSignal
      ? classifySignalDiagnostic(nearestRuntimeSignal.signal)
      : nearestRuntimeEvaluation
        ? classifyEvaluationDiagnostic(nearestRuntimeEvaluation.evaluation)
        : nearestRuntimeEvaluationOutcome
          ? {
              classification: 'core_skipped',
              reason: nearestRuntimeEvaluationOutcome.reason,
            }
          : nearestCandidate?.nearest
            ? {
                classification: 'timing_or_price_drift',
                reason: nearestCandidate.reason,
              }
            : runtimeLineageCoversEntry
              ? {
                  classification: 'runtime_evaluation_detail_unavailable',
                  reason:
                    'runtime_scope_covers_timestamp_but_skip_detail_was_not_stored',
                }
              : {
                  classification: 'no_runtime_evaluation',
                  reason: 'no_runtime_signal_or_evaluation',
                };

    return {
      entry,
      ...classification,
      ...(nearestCandidate ? { nearestCandidate } : {}),
      ...(nearestRuntimeSignal
        ? {
            runtimeSignal: toSignalDiagnostic({
              signal: nearestRuntimeSignal.signal,
              timestampDiffMs: nearestRuntimeSignal.timestampDiffMs,
            }),
            ...(includeArtifacts
              ? { runtimeSignalArtifact: nearestRuntimeSignal.signal }
              : {}),
          }
        : {}),
      ...(nearestRuntimeEvaluation
        ? {
            runtimeEvaluation: toEvaluationDiagnostic({
              evaluation: nearestRuntimeEvaluation.evaluation,
              timestampDiffMs: nearestRuntimeEvaluation.timestampDiffMs,
            }),
            ...(includeArtifacts
              ? {
                  runtimeEvaluationArtifact:
                    nearestRuntimeEvaluation.evaluation,
                }
              : {}),
          }
        : {}),
      ...(nearestRuntimeEvaluationOutcome
        ? { runtimeEvaluationOutcome: nearestRuntimeEvaluationOutcome }
        : {}),
    };
  });

  for (const diagnostic of runtimeOnlyDiagnostics) {
    if (
      diagnostic.replaySignalArtifact ||
      diagnostic.replayEvaluationArtifact
    ) {
      runtimeOnlyArtifactsIncluded += 1;
    }
  }
  for (const diagnostic of backtestOnlyDiagnostics) {
    if (
      diagnostic.runtimeSignalArtifact ||
      diagnostic.runtimeEvaluationArtifact
    ) {
      backtestOnlyArtifactsIncluded += 1;
    }
  }

  return {
    runtimeOnly: capReplayDetails(runtimeOnlyDiagnostics, limit),
    backtestOnly: capReplayDetails(backtestOnlyDiagnostics, limit),
    summary: {
      runtimeOnly: summarizeMismatchDiagnostics(runtimeOnlyDiagnostics),
      backtestOnly: summarizeMismatchDiagnostics(backtestOnlyDiagnostics),
      artifacts: {
        limit: artifactLimit,
        runtimeOnlyIncluded: runtimeOnlyArtifactsIncluded,
        runtimeOnlyOmitted: Math.max(
          0,
          runtimeOnlyDiagnostics.length - runtimeOnlyArtifactsIncluded,
        ),
        backtestOnlyIncluded: backtestOnlyArtifactsIncluded,
        backtestOnlyOmitted: Math.max(
          0,
          backtestOnlyDiagnostics.length - backtestOnlyArtifactsIncluded,
        ),
      },
    },
  };
};

export const buildReplayRuntimeComparisonDetails = ({
  matched,
  runtimeOnly,
  backtestOnly,
  runtimeEntries,
  backtestEntries,
  toleranceMs,
  limit = resolveReplayParityDetailsLimit(),
  backtestTimestampOffsetMs = 0,
  runtimeSignals,
  runtimeSignalEvaluations,
  replaySignals,
  replaySignalEvaluations,
  runtimeLineageScopes,
}: {
  matched: Array<{
    runtime: TradeParityEntry;
    backtest: TradeParityEntry;
    timestampDiffMs: number;
    priceDeltaPct: number | null;
  }>;
  runtimeOnly: TradeParityEntry[];
  backtestOnly: TradeParityEntry[];
  runtimeEntries: TradeParityEntry[];
  backtestEntries: TradeParityEntry[];
  toleranceMs: number;
  limit?: number;
  backtestTimestampOffsetMs?: number;
  runtimeSignals?: Signal[];
  runtimeSignalEvaluations?: RuntimeSignalEvaluationRecord[];
  replaySignals?: Signal[];
  replaySignalEvaluations?: RuntimeSignalEvaluationRecord[];
  runtimeLineageScopes?: RuntimeLineageScopeRecord[];
}): ReplayRuntimeComparisonDetails => {
  const runtimeDetails = runtimeEntries.map(toRuntimeParityDetail);
  const backtestDetails = backtestEntries.map((entry) =>
    toBacktestParityDetail(entry, backtestTimestampOffsetMs),
  );
  const runtimeOnlyDetails = runtimeOnly.map(toRuntimeParityDetail);
  const backtestOnlyDetails = backtestOnly.map((entry) =>
    toBacktestParityDetail(entry, backtestTimestampOffsetMs),
  );
  const nearestCandidates = [
    ...buildNearestCandidates({
      entries: runtimeOnlyDetails,
      candidates: backtestDetails,
      toleranceMs,
      requireSameStrategy: true,
    }),
    ...buildNearestCandidates({
      entries: backtestOnlyDetails,
      candidates: runtimeDetails,
      toleranceMs,
      requireSameStrategy: true,
    }),
  ];

  const cappedNearestCandidates = capReplayDetails(nearestCandidates, limit);
  const cappedRuntimeOnlyDetails = capReplayDetails(runtimeOnlyDetails, limit);
  const cappedBacktestOnlyDetails = capReplayDetails(
    backtestOnlyDetails,
    limit,
  );

  return {
    capped:
      matched.length > limit ||
      runtimeOnlyDetails.length > limit ||
      backtestOnlyDetails.length > limit ||
      nearestCandidates.length > limit,
    limit,
    matched: capReplayDetails(
      matched.map((item) =>
        buildMatchedReplayDetail({
          runtime: toRuntimeParityDetail(item.runtime),
          backtest: toBacktestParityDetail(
            item.backtest,
            backtestTimestampOffsetMs,
          ),
          timestampDiffMs: item.timestampDiffMs,
          priceDeltaPct: item.priceDeltaPct,
        }),
      ),
      limit,
    ),
    orderFailed: [],
    runtimeOnly: cappedRuntimeOnlyDetails,
    backtestOnly: cappedBacktestOnlyDetails,
    nearestCandidates: cappedNearestCandidates,
    mismatchDrilldown: buildReplayMismatchDrilldown({
      runtimeOnly: runtimeOnlyDetails,
      backtestOnly: backtestOnlyDetails,
      nearestCandidates,
      runtimeSignals,
      runtimeSignalEvaluations,
      replaySignals,
      replaySignalEvaluations,
      runtimeLineageScopes,
      toleranceMs,
      backtestTimestampOffsetMs,
      limit,
    }),
  };
};

export const buildReplayExchangeComparisonDetails = ({
  matched,
  orderFailed = [],
  exchangeOnly,
  backtestOnly,
  exchangeEntries,
  backtestEntries,
  strategyNameByOrderLinkKey,
  toleranceMs,
  limit = resolveReplayParityDetailsLimit(),
  backtestTimestampOffsetMs = 0,
  runtimeSignals,
  runtimeSignalEvaluations,
  replaySignals,
  replaySignalEvaluations,
  runtimeLineageScopes,
}: {
  matched: ExchangeMatchedBacktestEntry[];
  orderFailed?: ExchangeOrderFailedBacktestEntry[];
  exchangeOnly: ExchangeEntryRecord[];
  backtestOnly: TradeParityEntry[];
  exchangeEntries: ExchangeEntryRecord[];
  backtestEntries: TradeParityEntry[];
  strategyNameByOrderLinkKey: Map<string, string>;
  toleranceMs: number;
  limit?: number;
  backtestTimestampOffsetMs?: number;
  runtimeSignals?: Signal[];
  runtimeSignalEvaluations?: RuntimeSignalEvaluationRecord[];
  replaySignals?: Signal[];
  replaySignalEvaluations?: RuntimeSignalEvaluationRecord[];
  runtimeLineageScopes?: RuntimeLineageScopeRecord[];
}): ReplayRuntimeComparisonDetails => {
  const toExchangeDetail = (entry: ExchangeEntryRecord) =>
    toExchangeParityDetail({
      entry,
      inferredStrategy: resolveReplayStrategyNameFromExchangeEntry({
        exchangeEntry: entry,
        strategyNameByOrderLinkKey,
      }),
    });
  const exchangeDetails = exchangeEntries.map(toExchangeDetail);
  const backtestDetails = backtestEntries.map((entry) =>
    toBacktestParityDetail(entry, backtestTimestampOffsetMs),
  );
  const exchangeOnlyDetails = exchangeOnly.map(toExchangeDetail);
  const backtestOnlyDetails = backtestOnly.map((entry) =>
    toBacktestParityDetail(entry, backtestTimestampOffsetMs),
  );
  const nearestCandidates = [
    ...buildNearestCandidates({
      entries: exchangeOnlyDetails,
      candidates: backtestDetails,
      toleranceMs,
    }),
    ...buildNearestCandidates({
      entries: backtestOnlyDetails,
      candidates: exchangeDetails,
      toleranceMs,
    }),
  ];

  const cappedNearestCandidates = capReplayDetails(nearestCandidates, limit);
  const cappedExchangeOnlyDetails = capReplayDetails(
    exchangeOnlyDetails,
    limit,
  );
  const cappedBacktestOnlyDetails = capReplayDetails(
    backtestOnlyDetails,
    limit,
  );

  return {
    capped:
      matched.length > limit ||
      orderFailed.length > limit ||
      exchangeOnlyDetails.length > limit ||
      backtestOnlyDetails.length > limit ||
      nearestCandidates.length > limit,
    limit,
    matched: capReplayDetails(
      matched.map((item) =>
        buildMatchedReplayDetail({
          runtime: toExchangeDetail(item.exchange),
          backtest: toBacktestParityDetail(
            item.backtest,
            backtestTimestampOffsetMs,
          ),
          timestampDiffMs: item.timestampDiffMs,
          priceDeltaPct: item.priceDeltaPct,
        }),
      ),
      limit,
    ),
    orderFailed: capReplayDetails(
      orderFailed.map((item) => {
        const detail = buildMatchedReplayDetail({
          runtime: toExchangeDetail(item.exchange),
          backtest: toBacktestParityDetail(
            item.backtest,
            backtestTimestampOffsetMs,
          ),
          timestampDiffMs: item.timestampDiffMs,
          priceDeltaPct: item.priceDeltaPct,
        });
        return {
          runtime: detail.runtime,
          backtest: detail.backtest,
          timestampDiffMs: detail.timestampDiffMs,
          priceDeltaPct: detail.priceDeltaPct,
          reason: item.reason,
        };
      }),
      limit,
    ),
    runtimeOnly: cappedExchangeOnlyDetails,
    backtestOnly: cappedBacktestOnlyDetails,
    nearestCandidates: cappedNearestCandidates,
    mismatchDrilldown: buildReplayMismatchDrilldown({
      runtimeOnly: exchangeOnlyDetails,
      backtestOnly: backtestOnlyDetails,
      nearestCandidates,
      runtimeSignals,
      runtimeSignalEvaluations,
      replaySignals,
      replaySignalEvaluations,
      runtimeLineageScopes,
      toleranceMs,
      backtestTimestampOffsetMs,
      limit,
    }),
  };
};
