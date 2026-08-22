import chalk from 'chalk';
import { formatUnix } from '@tradejs/core/time';
import { createTable } from '../runFormatting';
import {
  REPLAY_RUNTIME_COMPARISON_HEADERS,
  formatReplayRuntimeCompareTolerance,
  getReplayRuntimeUnmatchedCount,
  type ReplayRuntimeComparisonSummary,
  type ReplayRuntimeParityRow,
} from './support';

export type ReplayComparisonReportContext = {
  mode: 'runtime' | 'exchange';
  connectorName: string;
  rows: ReplayRuntimeParityRow[];
  details: ReplayRuntimeComparisonSummary['details'];
};

const formatDrilldownSummary = (summary: Record<string, number>) =>
  Object.entries(summary)
    .filter(([, count]) => count > 0)
    .map(([classification, count]) => `${classification}=${count}`)
    .join(', ');

const colorizeRows = (rows: ReplayRuntimeParityRow[]) =>
  rows.map((row) => {
    const btPnlColor =
      row.backtestNetProfit > 0
        ? chalk.green
        : row.backtestNetProfit < 0
          ? chalk.red
          : chalk.gray;
    const rtPnlColor =
      row.runtimePnl > 0
        ? chalk.green
        : row.runtimePnl < 0
          ? chalk.red
          : chalk.gray;

    return [
      chalk.blue(row.strategyName),
      chalk.cyan(String(row.backtestEntries)),
      btPnlColor(`${row.backtestNetProfit.toFixed(2)}$`),
      chalk.yellow(String(row.runtimeTrades)),
      rtPnlColor(`${row.runtimePnl.toFixed(2)}$`),
      chalk.green(String(row.matched)),
      chalk.red(String(row.orderFailed)),
      chalk.yellow(String(row.runtimeOnly)),
      chalk.magenta(String(row.backtestOnly)),
      chalk.red(String(getReplayRuntimeUnmatchedCount(row))),
    ];
  });

export const buildReplayComparisonReport = (
  context: ReplayComparisonReportContext,
): string[] => {
  const source = context.mode === 'exchange' ? 'EXCHANGE' : 'RUNTIME';
  const inference =
    context.mode === 'exchange'
      ? ', inferredStrategy=orderLinkId | nearest backtest entry'
      : '';
  const runtimeOnlyLabel =
    context.mode === 'exchange' ? 'exchangeOnly' : 'runtimeOnly';
  const runtimeOnlyDrilldownSummary = formatDrilldownSummary(
    context.details?.mismatchDrilldown?.summary.runtimeOnly ?? {},
  );
  const backtestOnlyDrilldownSummary = formatDrilldownSummary(
    context.details?.mismatchDrilldown?.summary.backtestOnly ?? {},
  );
  const lines = [
    '',
    `SIGNALS REPLAY VS ${source} BY STRATEGY (connector=${context.connectorName}${inference}, tolerance=${formatReplayRuntimeCompareTolerance()})`,
    createTable(REPLAY_RUNTIME_COMPARISON_HEADERS, colorizeRows(context.rows)),
  ];

  if (runtimeOnlyDrilldownSummary || backtestOnlyDrilldownSummary) {
    lines.push(
      chalk.gray(
        `Mismatch drilldown: ${runtimeOnlyLabel}=[${runtimeOnlyDrilldownSummary || 'none'}], backtestOnly=[${backtestOnlyDrilldownSummary || 'none'}]`,
      ),
    );
  }
  lines.push('');
  return lines;
};

export const buildNoExchangeEntriesReport = ({
  connectorName,
  window,
}: {
  connectorName: string;
  window: { start: number; end: number };
}): string[] => [
  '',
  chalk.yellow(
    `SIGNALS REPLAY VS EXCHANGE: no lineage-linked exchange entry executions found for ${connectorName} in ${formatUnix(
      window.start,
    )} -> ${formatUnix(window.end)}`,
  ),
  '',
];

export const buildNoRuntimeTradesReport = ({
  connectorName,
  window,
}: {
  connectorName: string;
  window: { start: number; end: number };
}): string[] => [
  '',
  chalk.yellow(
    `SIGNALS REPLAY VS RUNTIME: no local runtime trades found for ${connectorName} in ${formatUnix(
      window.start,
    )} -> ${formatUnix(window.end)} with matching lineage; checking lineage-linked exchange executions`,
  ),
  '',
];

export const writeReplayComparisonReport = (lines: string[]) => {
  for (const line of lines) {
    console.log(line);
  }
};
