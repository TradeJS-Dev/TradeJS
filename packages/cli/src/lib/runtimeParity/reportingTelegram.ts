import {
  summarizeBacktestOnlyClassifications,
  summarizeRuntimeOnlyClassifications,
} from './classification';
import {
  buildMismatchSummaryRows,
  buildStrategyIssueRows,
  formatMinutes,
  formatPercent,
  formatRuntimeEntriesSummary,
  formatSourceCountsSummary,
  type RuntimeParityReportContext,
} from './reportingShared';

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
