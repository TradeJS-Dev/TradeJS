import { formatUnix } from '@tradejs/core/time';
import type {
  summarizeMatchedParity,
  TradeParityEntry,
} from '../runtimeParity';
import type {
  ClassifiedBacktestOnlyEntry,
  ClassifiedRuntimeOnlyEntry,
} from './classification';
import type { StrategyParitySummaryRow } from './analysis';
import type { ReplayError, ReplayTargetSourceCounts } from './targets';

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
