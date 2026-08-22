import chalk from 'chalk';
import { formatUnix } from '@tradejs/core/time';
import type { RuntimeDuplicateGroup } from '../runtimeParity';
import {
  summarizeBacktestOnlyClassifications,
  summarizeRuntimeOnlyClassifications,
  type ClassifiedBacktestOnlyEntry,
  type ClassifiedRuntimeOnlyEntry,
} from './classification';
import {
  buildMismatchSummaryRows,
  buildStrategyIssueRows,
  formatEntryLabel,
  formatMinutes,
  formatPercent,
  formatRuntimeEntriesSummary,
  formatSourceCountsSummary,
  type RuntimeParityReportContext,
} from './reportingShared';

const DETAIL_LIMIT = 10;

export type RuntimeParityTerminalReportContext = Omit<
  RuntimeParityReportContext,
  'matchedCount' | 'window'
> & {
  window: { start: number; end: number; source: string };
  runtimeGatesEnabled: boolean;
  runtimeGatesRequested: boolean;
  runtimeDuplicateGroupsCount: number;
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
