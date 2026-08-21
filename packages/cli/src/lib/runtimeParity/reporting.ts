import chalk from 'chalk';
import { formatUnix } from '@tradejs/core/time';
import type { RuntimeSignalEvaluationRecord, Signal } from '@tradejs/types';
import {
  type RuntimeDuplicateGroup,
  summarizeMatchedParity,
  type TradeParityEntry,
} from '../runtimeParity';
import {
  summarizeBacktestOnlyClassifications,
  summarizeRuntimeOnlyClassifications,
  type BacktestOnlyClassification,
  type ClassifiedBacktestOnlyEntry,
  type ClassifiedRuntimeOnlyEntry,
  type RuntimeOnlyClassification,
} from './classification';
import type { StrategyParitySummaryRow } from './analysis';
import type { ReplayError, ReplayTargetSourceCounts } from './targets';

const DETAIL_LIMIT = 10;
const TELEGRAM_DETAIL_LIMIT = 5;
const SUMMARY_TIMEZONE = 'Europe/Moscow';
const SUMMARY_TIMEZONE_LABEL = 'MSK';

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const formatMskDateTime = (timestamp: number) =>
  new Intl.DateTimeFormat('ru-RU', {
    timeZone: SUMMARY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));

export const formatPercent = (value: number | null) =>
  value == null || !Number.isFinite(value) ? 'n/a' : `${value.toFixed(2)}%`;

export const formatMinutes = (value: number | null) =>
  value == null || !Number.isFinite(value)
    ? 'n/a'
    : `${(value / 60_000).toFixed(2)}m`;

export const formatEntryLabel = (entry: TradeParityEntry) =>
  `${entry.strategy} ${entry.symbol} ${entry.direction} ${formatUnix(entry.timestamp)}`;

export const formatRuntimeEntriesSummary = ({
  rawRuntimeEntriesCount,
  runtimeEntriesCount,
  runtimeDuplicateEntriesCount,
}: {
  rawRuntimeEntriesCount: number;
  runtimeEntriesCount: number;
  runtimeDuplicateEntriesCount: number;
}) =>
  runtimeDuplicateEntriesCount > 0
    ? `${rawRuntimeEntriesCount} (deduped ${runtimeEntriesCount}, dup ${runtimeDuplicateEntriesCount})`
    : String(runtimeEntriesCount);

export const formatSourceCountsSummary = (
  sourceCounts: ReplayTargetSourceCounts,
) => {
  const parts = [
    sourceCounts.runtime > 0 ? `runtime trades=${sourceCounts.runtime}` : null,
    sourceCounts.strategyResults > 0
      ? `strategy results=${sourceCounts.strategyResults}`
      : null,
    sourceCounts.explicitTickers > 0
      ? `explicit tickers=${sourceCounts.explicitTickers}`
      : null,
    sourceCounts.connectorUniverse > 0
      ? `full universe=${sourceCounts.connectorUniverse}`
      : null,
  ].filter((value): value is string => Boolean(value));
  return parts.join(', ');
};

const normalizeSummaryText = (value: string, maxLength = 160) => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 3)}...`;
};

const pickFirstText = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
};

export type MismatchSummaryRow = {
  timestamp: number;
  strategy: string;
  line: string;
};

export const buildMismatchSummaryRows = ({
  classifiedRuntimeOnly,
  classifiedBacktestOnly,
}: {
  classifiedRuntimeOnly: ClassifiedRuntimeOnlyEntry[];
  classifiedBacktestOnly: ClassifiedBacktestOnlyEntry[];
}): MismatchSummaryRow[] => {
  const rows: MismatchSummaryRow[] = [];
  for (const item of classifiedRuntimeOnly) {
    const signalId = pickFirstText(
      item.entry.signalId,
      item.evaluation?.signalId,
    );
    const orderId = pickFirstText(item.entry.orderId, item.entry.id);
    const nearestBacktestSignalId = pickFirstText(
      item.nearestBacktestEntry?.signalId,
      item.nearestBacktestEntry?.id,
    );
    const refs = [`signalId=${signalId ?? 'n/a'}`];
    if (orderId && orderId !== signalId) refs.push(`orderId=${orderId}`);
    if (item.evaluation?.evaluationId) {
      refs.push(`evaluationId=${item.evaluation.evaluationId}`);
    }
    if (item.evaluation?.status) {
      refs.push(`evaluationStatus=${item.evaluation.status}`);
    }
    if (nearestBacktestSignalId) {
      refs.push(`nearestBacktest=${nearestBacktestSignalId}`);
    }
    if (item.evaluationTimestampDiffMs != null) {
      refs.push(`replayDrift=${formatMinutes(item.evaluationTimestampDiffMs)}`);
    }
    if (item.nearestBacktestEntryTimestampDiffMs != null) {
      refs.push(
        `backtestDrift=${formatMinutes(item.nearestBacktestEntryTimestampDiffMs)}`,
      );
    }
    rows.push({
      timestamp: item.entry.timestamp,
      strategy: item.entry.strategy,
      line: `runtimeOnly [${item.classification}] ${refs.join(' ')} ${formatEntryLabel(item.entry)} reason=${normalizeSummaryText(item.reason)}`,
    });
  }

  for (const item of classifiedBacktestOnly) {
    const signalId = pickFirstText(
      item.entry.signalId,
      item.signal?.signalId,
      item.evaluation?.signalId,
      item.entry.id,
    );
    const runtimeSignalId = pickFirstText(
      item.signal?.signalId,
      item.evaluation?.signalId,
    );
    const refs = [`signalId=${signalId ?? 'n/a'}`];
    if (runtimeSignalId && runtimeSignalId !== signalId) {
      refs.push(`runtimeSignalId=${runtimeSignalId}`);
    }
    if (item.evaluation?.evaluationId) {
      refs.push(`evaluationId=${item.evaluation.evaluationId}`);
    }
    if (item.signalTimestampDiffMs != null) {
      refs.push(`signalDrift=${formatMinutes(item.signalTimestampDiffMs)}`);
    }
    if (item.evaluationTimestampDiffMs != null) {
      refs.push(
        `evaluationDrift=${formatMinutes(item.evaluationTimestampDiffMs)}`,
      );
    }
    rows.push({
      timestamp: item.entry.timestamp,
      strategy: item.entry.strategy,
      line: `backtestOnly [${item.classification}] ${refs.join(' ')} ${formatEntryLabel(item.entry)} reason=${normalizeSummaryText(item.reason)}`,
    });
  }

  return rows.sort(
    (left, right) =>
      left.timestamp - right.timestamp ||
      left.strategy.localeCompare(right.strategy) ||
      left.line.localeCompare(right.line),
  );
};

export const buildStrategyIssueRows = (
  strategyRows: Array<[string, StrategyParitySummaryRow]>,
) =>
  strategyRows
    .map(([strategy, row]) => {
      const issues: string[] = [];
      if (row.runtimeOnly) issues.push(`runtimeOnly=${row.runtimeOnly}`);
      if (row.backtestOnly) issues.push(`backtestOnly=${row.backtestOnly}`);
      if (row.runtimeDuplicates) {
        issues.push(`runtimeDuplicates=${row.runtimeDuplicates}`);
      }
      if (row.errors) issues.push(`errors=${row.errors}`);
      return issues.length ? `- ${strategy}: ${issues.join(', ')}` : null;
    })
    .filter((line): line is string => Boolean(line));

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

export type RuntimeParityReportContext = {
  window: { start: number; end: number; source?: string };
  connectorName: string;
  replayEnv: string;
  toleranceBars: number;
  toleranceMs: number;
  replayTargetsCount: number;
  comparedTargetsCount: number;
  replayErrors: ReplayError[];
  sourceCounts: ReplayTargetSourceCounts;
  rawRuntimeEntriesCount: number;
  runtimeEntriesCount: number;
  runtimeDuplicateEntriesCount: number;
  backtestEntriesCount: number;
  matchedCount: number;
  runtimeOnlyCount: number;
  backtestOnlyCount: number;
  matchedSummary: ReturnType<typeof summarizeMatchedParity>;
  classifiedRuntimeOnly: ClassifiedRuntimeOnlyEntry[];
  classifiedBacktestOnly: ClassifiedBacktestOnlyEntry[];
  runtimeSignalEvaluationsCount: number;
  strategyRows: Array<[string, StrategyParitySummaryRow]>;
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

export type RuntimeParityTerminalReportContext = {
  window: { start: number; end: number; source: string };
  connectorName: string;
  replayEnv: string;
  runtimeGatesEnabled: boolean;
  runtimeGatesRequested: boolean;
  toleranceBars: number;
  toleranceMs: number;
  replayTargetsCount: number;
  comparedTargetsCount: number;
  replayErrors: ReplayError[];
  sourceCounts: ReplayTargetSourceCounts;
  rawRuntimeEntriesCount: number;
  runtimeEntriesCount: number;
  runtimeDuplicateGroupsCount: number;
  runtimeDuplicateEntriesCount: number;
  backtestEntriesCount: number;
  runtimeOnlyCount: number;
  backtestOnlyCount: number;
  matchedSummary: ReturnType<typeof summarizeMatchedParity>;
  classifiedRuntimeOnly: ClassifiedRuntimeOnlyEntry[];
  classifiedBacktestOnly: ClassifiedBacktestOnlyEntry[];
  runtimeSignalEvaluationsCount: number;
  strategyRows: Array<[string, StrategyParitySummaryRow]>;
  runtimeGateWarningCounts: Map<string, number>;
  detailLimit: number;
};

export const buildRuntimeParityTerminalReport = (
  context: RuntimeParityTerminalReportContext,
): string[] => {
  const mismatchRows = buildMismatchSummaryRows(context);
  const strategyIssueRows = buildStrategyIssueRows(context.strategyRows);
  const lines = [
    chalk.cyan('TradeJS runtime parity'),
    `Window: ${formatUnix(context.window.start)} -> ${formatUnix(context.window.end)} (${context.window.source})`,
    `Connector: ${context.connectorName}`,
    `Replay env: ${context.replayEnv}${
      context.runtimeGatesEnabled
        ? ' (runtime AI/ML gates enabled)'
        : ' (core/backtest gates only)'
    }`,
    `Tolerance: ${context.toleranceBars} bar(s) / ${(context.toleranceMs / 60_000).toFixed(0)}m`,
    `Summary: targets=${context.replayTargetsCount}, compared=${context.comparedTargetsCount}, errors=${context.replayErrors.length}, runtime=${context.runtimeEntriesCount}, backtest=${context.backtestEntriesCount}, runtimeOnly=${context.runtimeOnlyCount}, backtestOnly=${context.backtestOnlyCount}, evaluations=${context.runtimeSignalEvaluationsCount}`,
    `Sources: ${formatSourceCountsSummary(context.sourceCounts)}`,
    `Runtime entries: ${formatRuntimeEntriesSummary(context)}`,
    `Matched deltas: price avg/max=${formatPercent(context.matchedSummary.avgPriceDeltaPct)} / ${formatPercent(context.matchedSummary.maxPriceDeltaPct)}, time avg/max=${formatMinutes(context.matchedSummary.avgTimestampDiffMs)} / ${formatMinutes(context.matchedSummary.maxTimestampDiffMs)}`,
  ];

  if (context.runtimeDuplicateGroupsCount) {
    lines.push(
      `Runtime duplicate groups: ${context.runtimeDuplicateGroupsCount}, duplicate entries: ${context.runtimeDuplicateEntriesCount}`,
    );
  }
  if (context.classifiedRuntimeOnly.length) {
    lines.push(
      `Runtime only classifications: ${summarizeRuntimeOnlyClassifications(context.classifiedRuntimeOnly)}`,
    );
  }
  if (context.classifiedBacktestOnly.length) {
    lines.push(
      `Backtest only classifications: ${summarizeBacktestOnlyClassifications(context.classifiedBacktestOnly)}`,
    );
  }
  if (context.runtimeSignalEvaluationsCount) {
    lines.push(`Runtime evaluations: ${context.runtimeSignalEvaluationsCount}`);
  }
  if (mismatchRows.length) {
    lines.push('', chalk.yellow('Signal mismatches'));
    for (const item of mismatchRows.slice(0, context.detailLimit)) {
      lines.push(`- ${item.line}`);
    }
    if (mismatchRows.length > context.detailLimit) {
      lines.push(`- ... ${mismatchRows.length - context.detailLimit} more`);
    }
  }

  lines.push('');
  if (strategyIssueRows.length) {
    lines.push(chalk.cyan('Strategy issues'), ...strategyIssueRows);
  } else if (context.strategyRows.length) {
    lines.push(
      `Strategies: clean ${context.strategyRows.length}/${context.strategyRows.length}`,
    );
  }
  if (context.runtimeGateWarningCounts.size && !context.runtimeGatesRequested) {
    lines.push('', chalk.yellow('Warnings'));
    for (const [strategy, count] of [
      ...context.runtimeGateWarningCounts.entries(),
    ].sort(([left], [right]) => left.localeCompare(right))) {
      lines.push(
        `- ${strategy} uses AI/ML runtime gates on ${count} replay target(s); BACKTEST replay covers core execution, not live gating.`,
      );
    }
  }
  if (context.replayErrors.length) {
    lines.push('', chalk.red('Replay errors'));
    for (const error of context.replayErrors.slice(0, context.detailLimit)) {
      lines.push(`- ${error.strategy} ${error.symbol}: ${error.message}`);
    }
    if (context.replayErrors.length > context.detailLimit) {
      lines.push(
        `- ... ${context.replayErrors.length - context.detailLimit} more`,
      );
    }
  }
  return lines;
};

export const writeRuntimeParityTerminalReport = (lines: string[]) => {
  for (const line of lines) console.log(line);
};

export const printRuntimeDuplicateDetails = (
  groups: RuntimeDuplicateGroup[],
) => {
  if (!groups.length) return;
  console.log('');
  console.log(chalk.yellow('Runtime duplicates'));
  for (const group of groups.slice(0, DETAIL_LIMIT)) {
    const ids = group.entries.map((entry) => entry.orderId ?? entry.id);
    console.log(
      `- ${formatEntryLabel(group.entries[0])} count=${group.entries.length}, duplicateEntries=${group.entries.length - 1}, ids=${ids.join(',')}`,
    );
  }
  if (groups.length > DETAIL_LIMIT) {
    console.log(`- ... ${groups.length - DETAIL_LIMIT} more`);
  }
};

export const printClassifiedBacktestOnlyDetails = (
  classifiedEntries: ClassifiedBacktestOnlyEntry[],
) => {
  if (!classifiedEntries.length) return;
  console.log('');
  console.log(chalk.yellow('Backtest only'));
  for (const item of classifiedEntries.slice(0, DETAIL_LIMIT)) {
    const evidenceSuffix = item.signal
      ? ` signalId=${item.signal.signalId} signalDrift=${formatMinutes(item.signalTimestampDiffMs ?? null)}`
      : item.evaluation
        ? ` evaluationId=${item.evaluation.evaluationId} evaluationDrift=${formatMinutes(item.evaluationTimestampDiffMs ?? null)}`
        : '';
    const price =
      item.entry.price == null ? 'n/a' : item.entry.price.toFixed(6);
    console.log(
      `- [${item.classification}] ${formatEntryLabel(item.entry)} price=${price} id=${item.entry.id} reason=${item.reason}${evidenceSuffix}`,
    );
  }
  if (classifiedEntries.length > DETAIL_LIMIT) {
    console.log(`- ... ${classifiedEntries.length - DETAIL_LIMIT} more`);
  }
};

export const printClassifiedRuntimeOnlyDetails = (
  classifiedEntries: ClassifiedRuntimeOnlyEntry[],
) => {
  if (!classifiedEntries.length) return;
  console.log('');
  console.log(chalk.yellow('Runtime only'));
  for (const item of classifiedEntries.slice(0, DETAIL_LIMIT)) {
    const evidenceSuffix = item.nearestBacktestEntry
      ? ` nearestBacktestId=${item.nearestBacktestEntry.id} backtestDrift=${formatMinutes(item.nearestBacktestEntryTimestampDiffMs ?? null)}`
      : item.evaluation
        ? ` replayEvaluationId=${item.evaluation.evaluationId} replayDrift=${formatMinutes(item.evaluationTimestampDiffMs ?? null)} status=${item.evaluation.status}`
        : '';
    const price =
      item.entry.price == null ? 'n/a' : item.entry.price.toFixed(6);
    console.log(
      `- [${item.classification}] ${formatEntryLabel(item.entry)} price=${price} id=${item.entry.id} reason=${item.reason}${evidenceSuffix}`,
    );
  }
  if (classifiedEntries.length > DETAIL_LIMIT) {
    console.log(`- ... ${classifiedEntries.length - DETAIL_LIMIT} more`);
  }
};

export const buildRuntimeParityMessage = ({
  runtimeGatesEnabled,
  runtimeGateWarningCounts,
  ...context
}: RuntimeParityReportContext & {
  runtimeGatesEnabled: boolean;
  runtimeGateWarningCounts: Map<string, number>;
}) => {
  const lines: string[] = [];
  lines.push('🧪 <b>TradeJS runtime parity</b>');
  lines.push('');
  lines.push('🕒 <b>Window</b>');
  lines.push(
    `<b>${escapeHtml(formatMskDateTime(context.window.start))} - ${escapeHtml(formatMskDateTime(context.window.end))} ${SUMMARY_TIMEZONE_LABEL}</b>`,
  );
  lines.push('');
  lines.push(`🔌 Connector: <b>${escapeHtml(context.connectorName)}</b>`);
  lines.push(`🧬 Replay env: <b>${escapeHtml(context.replayEnv)}</b>`);
  lines.push(
    `🎯 Tolerance: <b>${context.toleranceBars} bar(s) / ${(context.toleranceMs / 60_000).toFixed(0)}m</b>`,
  );
  lines.push('');
  lines.push('📌 <b>Overview</b>');
  lines.push(
    `• Targets: <b>${context.replayTargetsCount}</b> / compared <b>${context.comparedTargetsCount}</b> / errors <b>${context.replayErrors.length}</b>`,
  );
  lines.push(
    `• Sources: <b>${escapeHtml(formatSourceCountsSummary(context.sourceCounts))}</b>`,
  );
  lines.push('');
  lines.push('📈 <b>Entries</b>');
  lines.push(
    `• Runtime: <b>${escapeHtml(formatRuntimeEntriesSummary(context))}</b>`,
  );
  lines.push(`• Backtest: <b>${context.backtestEntriesCount}</b>`);
  lines.push(
    `• Runtime only: <b>${context.runtimeOnlyCount}</b> / Backtest only: <b>${context.backtestOnlyCount}</b>`,
  );
  lines.push(
    `• Matched deltas: price avg/max=<b>${escapeHtml(formatPercent(context.matchedSummary.avgPriceDeltaPct))} / ${escapeHtml(formatPercent(context.matchedSummary.maxPriceDeltaPct))}</b>, time avg/max=<b>${escapeHtml(formatMinutes(context.matchedSummary.avgTimestampDiffMs))} / ${escapeHtml(formatMinutes(context.matchedSummary.maxTimestampDiffMs))}</b>`,
  );
  if (context.classifiedRuntimeOnly.length) {
    lines.push(
      `• Runtime-only classes: <code>${escapeHtml(summarizeRuntimeOnlyClassifications(context.classifiedRuntimeOnly))}</code>`,
    );
  }
  if (context.classifiedBacktestOnly.length) {
    lines.push(
      `• Backtest-only classes: <code>${escapeHtml(summarizeBacktestOnlyClassifications(context.classifiedBacktestOnly))}</code>`,
    );
  }
  if (context.runtimeSignalEvaluationsCount) {
    lines.push(
      `• Runtime evaluations: <b>${context.runtimeSignalEvaluationsCount}</b>`,
    );
  }

  const mismatchRows = buildMismatchSummaryRows(context);
  if (mismatchRows.length) {
    lines.push('');
    lines.push('🔎 <b>Mismatches</b>');
    for (const item of mismatchRows.slice(0, TELEGRAM_DETAIL_LIMIT)) {
      lines.push(`• <code>${escapeHtml(item.line)}</code>`);
    }
    if (mismatchRows.length > TELEGRAM_DETAIL_LIMIT) {
      lines.push(
        `... <b>${mismatchRows.length - TELEGRAM_DETAIL_LIMIT}</b> more`,
      );
    }
  }

  const strategyIssueRows = buildStrategyIssueRows(context.strategyRows);
  if (strategyIssueRows.length) {
    lines.push('');
    lines.push('📊 <b>Strategy issues</b>');
    for (const line of strategyIssueRows) {
      lines.push(`• ${escapeHtml(line.slice(2))}`);
    }
  } else if (context.strategyRows.length) {
    lines.push('');
    lines.push(
      `📊 <b>Strategies</b>: clean <b>${context.strategyRows.length}</b> / total <b>${context.strategyRows.length}</b>`,
    );
  }

  if (runtimeGateWarningCounts.size && !runtimeGatesEnabled) {
    lines.push('');
    lines.push('⚠️ <b>Warnings</b>');
    for (const [strategy, count] of [
      ...runtimeGateWarningCounts.entries(),
    ].sort(([left], [right]) => left.localeCompare(right))) {
      lines.push(
        `• <b>${escapeHtml(strategy)}</b>: AI/ML runtime gates configured on <b>${count}</b> target(s); BACKTEST replay covers core execution only.`,
      );
    }
  }
  if (context.replayErrors.length) {
    lines.push('');
    lines.push('❌ <b>Replay errors</b>');
    for (const error of context.replayErrors.slice(0, TELEGRAM_DETAIL_LIMIT)) {
      lines.push(
        `• <b>${escapeHtml(error.strategy)}</b> ${escapeHtml(error.symbol)}: <code>${escapeHtml(error.message)}</code>`,
      );
    }
    if (context.replayErrors.length > TELEGRAM_DETAIL_LIMIT) {
      lines.push(
        `... <b>${context.replayErrors.length - TELEGRAM_DETAIL_LIMIT}</b> more`,
      );
    }
  }
  return lines.join('\n');
};

export const buildRuntimeParityNoTargetsMessage = ({
  window,
  connectorName,
  replayEnv,
  userName,
}: {
  window: { start: number; end: number };
  connectorName: string;
  replayEnv: string;
  runtimeGatesEnabled: boolean;
  userName: string;
}) =>
  [
    '🧪 <b>TradeJS runtime parity</b>',
    '',
    '🕒 <b>Window</b>',
    `<b>${escapeHtml(formatMskDateTime(window.start))} - ${escapeHtml(formatMskDateTime(window.end))} ${SUMMARY_TIMEZONE_LABEL}</b>`,
    '',
    `🔌 Connector: <b>${escapeHtml(connectorName)}</b>`,
    `🧬 Replay env: <b>${escapeHtml(replayEnv)}</b>`,
    '',
    `⚠️ No replay targets found for user <b>${escapeHtml(userName)}</b>.`,
  ].join('\n');
