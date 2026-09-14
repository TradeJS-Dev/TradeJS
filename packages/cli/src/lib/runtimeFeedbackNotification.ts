import { verifyRuntimeFeedbackReplayBundle } from './runtimeFeedbackArtifacts';
import { sendTelegramReport } from './telegramReports';

type JsonRecord = Record<string, unknown>;

type SendRuntimeFeedbackMessage = (
  message: string,
  options: { userName: string },
) => Promise<unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  value != null && typeof value === 'object' && !Array.isArray(value);

const asRecord = (value: unknown): JsonRecord => (isRecord(value) ? value : {});

const asArray = (value: unknown): JsonRecord[] =>
  Array.isArray(value) ? value.map(asRecord) : [];

const finiteNumber = (value: unknown, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const requiredTimestamp = (value: unknown, field: string) => {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Runtime feedback replay is missing ${field}`);
  }
  return timestamp;
};

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const formatMskDateTime = (timestamp: number) =>
  new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));

const formatConnectorName = (value: unknown) => {
  const connectorName = String(value ?? 'unknown').trim() || 'unknown';
  return connectorName.toLowerCase() === 'bybit' ? 'ByBit' : connectorName;
};

const sumRows = (rows: JsonRecord[], field: string) =>
  rows.reduce((total, row) => total + finiteNumber(row[field]), 0);

export const buildRuntimeFeedbackTelegramMessage = (
  replayEvidence: JsonRecord,
) => {
  if (replayEvidence.reportType !== 'replay-runtime-evidence') {
    throw new Error('Invalid runtime feedback replay evidence payload');
  }

  const window = asRecord(replayEvidence.window);
  const startTime = requiredTimestamp(window.startTime, 'window.startTime');
  const endTime = requiredTimestamp(window.endTime, 'window.endTime');
  const deployment = asRecord(replayEvidence.deployment);
  const replay = asRecord(replayEvidence.replay);
  if (
    !isRecord(replay.runtimeComparison) ||
    !isRecord(replay.runtimeComparison.counts) ||
    !Array.isArray(replay.runtimeComparison.rows) ||
    !isRecord(replay.runtimeComparison.lineage)
  ) {
    throw new Error('Runtime feedback replay comparison is missing');
  }
  const comparison = asRecord(replay.runtimeComparison);
  const comparisonCounts = asRecord(comparison.counts);
  const runtimeCounts = asRecord(asRecord(replayEvidence.runtime).counts);
  const lineage = asRecord(comparison.lineage);
  const rows = asArray(comparison.rows);

  const matched = finiteNumber(comparisonCounts.matched);
  const runtimeOnly = finiteNumber(comparisonCounts.runtimeOnly);
  const backtestOnly = finiteNumber(comparisonCounts.backtestOnly);
  const orderFailed = sumRows(rows, 'orderFailed');
  const runtimeEntries = sumRows(rows, 'runtimeTrades');
  const backtestEntries = sumRows(rows, 'backtestEntries');
  const replayScopes = finiteNumber(lineage.replayScopes);
  const comparableScopes = finiteNumber(lineage.comparableScopes);
  const excludedRuntimeTrades = finiteNumber(lineage.excludedRuntimeTrades);
  const issueRows = rows.filter(
    (row) =>
      finiteNumber(row.runtimeOnly) > 0 ||
      finiteNumber(row.backtestOnly) > 0 ||
      finiteNumber(row.orderFailed) > 0,
  );

  const lines = [
    '🧪 <b>TradeJS runtime parity</b>',
    '',
    '🕒 <b>Window</b>',
    `<b>${escapeHtml(formatMskDateTime(startTime))} - ${escapeHtml(formatMskDateTime(endTime))} MSK</b>`,
    '',
    `🔌 Connector: <b>${escapeHtml(formatConnectorName(deployment.connectorName ?? deployment.provider))}</b>`,
    '🧬 Source: <b>verified runtime feedback</b>',
    `📦 Deployment: <b>${escapeHtml(String(deployment.id ?? 'unknown'))}</b>`,
    `🔐 Composition: <code>${escapeHtml(String(deployment.deploymentCompositionId ?? 'unknown'))}</code>`,
    '',
    '📌 <b>Overview</b>',
    `• Runtime evidence: trades=<b>${finiteNumber(runtimeCounts.trades)}</b>, signals=<b>${finiteNumber(runtimeCounts.signals)}</b>, evaluations=<b>${finiteNumber(runtimeCounts.evaluations)}</b>`,
    `• Comparable entries: runtime=<b>${runtimeEntries}</b> / backtest=<b>${backtestEntries}</b>`,
    `• Matched: <b>${matched}</b> / order failed: <b>${orderFailed}</b>`,
    `• Runtime only: <b>${runtimeOnly}</b> / Backtest only: <b>${backtestOnly}</b>`,
    `• Lineage scopes: <b>${comparableScopes} / ${replayScopes}</b>`,
  ];

  if (excludedRuntimeTrades > 0) {
    lines.push(
      `• Excluded runtime trades outside comparable lineage: <b>${excludedRuntimeTrades}</b>`,
    );
  }

  if (issueRows.length) {
    lines.push('', '📊 <b>Strategy issues</b>');
    for (const row of issueRows.slice(0, 10)) {
      const issues = [
        finiteNumber(row.orderFailed) > 0
          ? `orderFailed=${finiteNumber(row.orderFailed)}`
          : null,
        finiteNumber(row.runtimeOnly) > 0
          ? `runtimeOnly=${finiteNumber(row.runtimeOnly)}`
          : null,
        finiteNumber(row.backtestOnly) > 0
          ? `backtestOnly=${finiteNumber(row.backtestOnly)}`
          : null,
      ].filter((value): value is string => value != null);
      lines.push(
        `• ${escapeHtml(String(row.strategyName ?? '[unknown]'))}: ${issues.join(', ')}`,
      );
    }
    if (issueRows.length > 10) {
      lines.push(`... <b>${issueRows.length - 10}</b> more`);
    }
  } else if (rows.length) {
    lines.push(
      '',
      `📊 <b>Strategies</b>: clean <b>${rows.length}</b> / total <b>${rows.length}</b>`,
    );
  }

  return lines.join('\n');
};

export const notifyRuntimeFeedbackBundle = async ({
  bundleDir,
  send = sendTelegramReport,
}: {
  bundleDir: string;
  send?: SendRuntimeFeedbackMessage;
}) => {
  const verified = await verifyRuntimeFeedbackReplayBundle(bundleDir);
  const message = buildRuntimeFeedbackTelegramMessage(verified.replayEvidence);
  await send(message, { userName: verified.manifest.userName });
  return {
    artifactId: verified.manifest.artifactId,
    userName: verified.manifest.userName,
    message,
  };
};
