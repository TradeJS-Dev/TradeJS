import 'dotenv/config';
import args from 'args';
import { logger } from '@tradejs/infra/logger';
import {
  DEFAULT_CONNECTOR_NAME,
  getConnectorCreatorByName,
  resolveConnectorName,
} from '@tradejs/node/connectors';
import {
  loadRuntimeActiveTradeOrderIds,
  loadRuntimeStrategyNames,
  loadRuntimeTrades,
} from '../lib/runtimeRedis';
import {
  formatRuntimeTradeSyncError,
  isRuntimeTradeSyncFallbackClose,
  syncRuntimeTrades,
} from '../lib/runtimeTradeSync';
import {
  sendTelegramReport,
  type TelegramReportAttachment,
} from '../lib/telegramReports';
import {
  loadRuntimeSignalEvaluationStatsBuckets,
  loadRuntimeSignals,
} from '../lib/runtimeSignalsLoader';
import {
  getRuntimeStorageDayKeys,
  RuntimeSignalStatsBucket,
} from '../lib/runtimeSignalsStorage';
import { buildRuntimeDebugReportAttachment } from '../lib/runtimeDebugEvidence';
import { listRuntimeDeployments } from '@tradejs/infra/runtimeDeployments';
import {
  ConnectorCreator,
  MarketUniverse,
  RuntimeDeployment,
  RuntimeTradeRecord,
  Signal,
  SignalOrderStatus,
} from '@tradejs/types';

args.option(['u', 'user'], 'Use user config', 'root');
args.option(
  'connector',
  'Connector provider or name for summary (e.g. bybit, binance, coinbase, custom)',
  'bybit',
);
args.option(['H', 'hours'], 'Summary window in hours', 24);
args.option(['P', 'printOnly'], 'Print summary instead of Telegram', false);
args.option(
  'debugAttachment',
  'Attach runtime Redis debug JSON for replay diagnostics',
  true,
);

const flags = args.parse(process.argv);
const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();
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

const formatSigned = (value: number) =>
  `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;

const formatPnlMoneyText = (value: number, knownCount: number) =>
  knownCount > 0 ? `${formatSigned(value)}$` : 'n/a';

const formatWinRateText = (wins: number, closedKnown: number) =>
  closedKnown > 0
    ? `${((wins / closedKnown) * 100).toFixed(2)}% (${wins}/${closedKnown})`
    : 'n/a';

const resolveSummaryTitle = (hours: number) => {
  if (hours === 24) {
    return 'TradeJS daily summary';
  }

  if (hours === 168) {
    return 'TradeJS weekly summary';
  }

  if (hours === 720) {
    return 'TradeJS monthly summary';
  }

  return `TradeJS ${hours}h summary`;
};

const normalizeStatus = (
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

const shouldAttachDebugReport = (value: unknown) =>
  value !== false && String(value).toLowerCase() !== 'false';

const getSummaryDateParts = (timestamp: number) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: SUMMARY_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date(timestamp))
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;

const formatSummaryIsoDayKey = (timestamp: number) => {
  const parts = getSummaryDateParts(timestamp);

  return `${parts.year}-${parts.month}-${parts.day}`;
};

const unescapeHtml = (value: string) =>
  value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const stripTelegramHtml = (value: string) =>
  unescapeHtml(value.replace(/<\/?(?:b|code)>/g, ''));

const buildSignalsSummaryAttachment = ({
  userName,
  endTime,
  content,
}: {
  userName: string;
  endTime: number;
  content: string;
}): TelegramReportAttachment => {
  const dayKey = formatSummaryIsoDayKey(endTime);

  return {
    filename: `tradejs-signals-summary-${userName}-${dayKey}.txt`,
    content: stripTelegramHtml(content),
    caption: `Signals summary ${dayKey} ${SUMMARY_TIMEZONE_LABEL}`,
  };
};

const appendReportAttachmentSummary = ({
  message,
  signalsFilename,
  filename,
  tradesCount,
  signalsCount,
  evaluationsCount,
}: {
  message: string;
  signalsFilename: string;
  filename?: string;
  tradesCount?: number;
  signalsCount?: number;
  evaluationsCount?: number;
}) => {
  const lines = [
    message,
    '',
    '📎 <b>Signal report file</b>',
    `File: <code>${escapeHtml(signalsFilename)}</code>`,
  ];

  if (filename) {
    lines.push(
      '',
      '📎 <b>Replay debug file</b>',
      `File: <code>${escapeHtml(filename)}</code>`,
      `Inside: trades=<b>${tradesCount ?? 0}</b>, signals=<b>${signalsCount ?? 0}</b>, evaluations=<b>${evaluationsCount ?? 0}</b>`,
      'Redis refs: <code>trade</code>, <code>tradeBucket</code>, <code>activeTrade</code>, <code>signal</code>, <code>evaluation</code>',
    );
  }

  return lines.join('\n');
};

const resolveSummaryConnectorName = async (value: unknown): Promise<string> => {
  const connectorName = await resolveConnectorName(value, projectRoot);
  if (connectorName) {
    return connectorName;
  }

  logger.warn(
    'Unknown connector "%s". Fallback to %s.',
    String(value || '').trim() || String(value),
    DEFAULT_CONNECTOR_NAME,
  );
  return DEFAULT_CONNECTOR_NAME;
};

type RuntimeTradeConnectorScope = {
  connectorName: string;
  universe: MarketUniverse;
  accountId?: string;
  deploymentId?: string;
  trades: RuntimeTradeRecord[];
};

const groupRuntimeTradesByConnectorScope = ({
  trades,
  deployments,
  fallbackConnectorName,
}: {
  trades: RuntimeTradeRecord[];
  deployments: RuntimeDeployment[];
  fallbackConnectorName: string;
}): RuntimeTradeConnectorScope[] => {
  const deploymentById = new Map(
    deployments.map((deployment) => [deployment.id, deployment]),
  );
  const scopes = new Map<string, RuntimeTradeConnectorScope>();

  for (const trade of trades) {
    const deployment = trade.deploymentId
      ? deploymentById.get(trade.deploymentId)
      : undefined;
    const connectorName = deployment?.connectorName ?? fallbackConnectorName;
    const universe = (trade.universe ?? 'crypto') as MarketUniverse;
    const accountId = trade.accountId ?? deployment?.accountId;
    const deploymentId = trade.deploymentId;
    const scopeKey = JSON.stringify([
      connectorName,
      universe,
      accountId ?? null,
      deploymentId ?? null,
    ]);
    const scope = scopes.get(scopeKey) ?? {
      connectorName,
      universe,
      ...(accountId ? { accountId } : {}),
      ...(deploymentId ? { deploymentId } : {}),
      trades: [],
    };
    scope.trades.push(trade);
    scopes.set(scopeKey, scope);
  }

  return [...scopes.values()];
};

const syncRuntimeTradeScopes = async ({
  userName,
  startTime,
  endTime,
  fallbackConnectorName,
  trades,
  deployments,
}: {
  userName: string;
  startTime: number;
  endTime: number;
  fallbackConnectorName: string;
  trades: RuntimeTradeRecord[];
  deployments: RuntimeDeployment[];
}) => {
  const scopes = groupRuntimeTradesByConnectorScope({
    trades,
    deployments,
    fallbackConnectorName,
  });
  const syncedTrades: RuntimeTradeRecord[] = [];
  const connectorNames = new Set<string>();

  for (const scope of scopes) {
    const connectorName = await resolveSummaryConnectorName(
      scope.connectorName,
    );
    const connectorFactory = await getConnectorCreatorByName(
      connectorName,
      projectRoot,
    );

    if (!connectorFactory) {
      throw new Error(`Connector "${connectorName}" is not registered`);
    }

    const connector = await (connectorFactory as ConnectorCreator)({
      userName,
      universe: scope.universe,
      accountId: scope.accountId,
      deploymentId: scope.deploymentId,
    });
    connectorNames.add(connectorName);
    syncedTrades.push(
      ...(await syncRuntimeTrades({
        userName,
        connector,
        trades: scope.trades,
        startTime,
        endTime,
        openPositionCallbacks: {
          onError: (error) => {
            logger.warn(
              'signals summary: getOpenPositionPnl failed for scope account=%s deployment=%s: %s',
              scope.accountId ?? 'default',
              scope.deploymentId ?? 'default',
              formatRuntimeTradeSyncError(error),
            );
          },
        },
        closedPnlCallbacks: {
          onError: (error) => {
            logger.warn(
              'signals summary: getClosedPnl failed for scope account=%s deployment=%s: %s',
              scope.accountId ?? 'default',
              scope.deploymentId ?? 'default',
              formatRuntimeTradeSyncError(error),
            );
          },
        },
      })),
    );
  }

  return {
    trades: syncedTrades,
    connectorNames: [...connectorNames].sort(),
    scopesCount: scopes.length,
  };
};

const createRuntimeSignalStats = (): RuntimeSignalStatsBucket => ({
  evaluated: 0,
  signals: 0,
  reasonGroups: new Map<string, Map<string, number>>(),
});

const mergeRuntimeSignalStats = (
  target: RuntimeSignalStatsBucket,
  source: RuntimeSignalStatsBucket,
) => {
  target.evaluated += source.evaluated;
  target.signals += source.signals;

  for (const [group, reasons] of source.reasonGroups.entries()) {
    const targetReasons =
      target.reasonGroups.get(group) ?? new Map<string, number>();

    for (const [reason, count] of reasons.entries()) {
      targetReasons.set(reason, (targetReasons.get(reason) ?? 0) + count);
    }

    target.reasonGroups.set(group, targetReasons);
  }
};

const buildSummaryPrelude = ({
  hours,
  startTime,
  endTime,
  realizedWindowPnlText,
  winRateText,
  longCount,
  shortCount,
  openCount,
  openPnlText,
}: {
  hours: number;
  startTime: number;
  endTime: number;
  realizedWindowPnlText: string;
  winRateText: string;
  longCount: number;
  shortCount: number;
  openCount: number;
  openPnlText: string;
}) => {
  const windowPnlLabel =
    hours === 24 ? '24h Realized PnL' : `${hours}h Realized PnL`;

  return [
    `📋 <b>${escapeHtml(resolveSummaryTitle(hours))}</b>`,
    '',
    '🕒 <b>Window</b>',
    `<b>${escapeHtml(formatMskDateTime(startTime))} - ${escapeHtml(formatMskDateTime(endTime))} ${SUMMARY_TIMEZONE_LABEL}</b>`,
    '',
    `⏱ Range: <b>${hours}h</b>`,
    `💰 <b>${windowPnlLabel}:</b> <b>${escapeHtml(realizedWindowPnlText)}</b>`,
    `🏆 <b>WinRate:</b> <b>${escapeHtml(winRateText)}</b>`,
    `↗️ <b>LONG:</b> <b>${longCount}</b>, ↘️ <b>SHORT:</b> <b>${shortCount}</b>`,
    `📍 <b>Open positions:</b> <b>${openCount}</b>, Unrealized PnL: <b>${escapeHtml(openPnlText)}</b>`,
  ];
};

const resolveTradeStatusEmoji = (
  status: RuntimeTradeRecord['status'],
  pnl?: number | null,
) => {
  if (status === 'active') {
    return typeof pnl === 'number' && Number.isFinite(pnl) && pnl < 0
      ? '🔴'
      : '🟢';
  }

  if (status === 'closed') {
    return typeof pnl === 'number' && Number.isFinite(pnl) && pnl < 0
      ? '❌'
      : '✅';
  }

  return '❔';
};

const isTimestampInWindow = (
  timestamp: number | null | undefined,
  startTime: number,
  endTime: number,
) =>
  typeof timestamp === 'number' &&
  Number.isFinite(timestamp) &&
  timestamp >= startTime &&
  timestamp < endTime;

const isRuntimeTradeClosedInWindow = (
  trade: RuntimeTradeRecord,
  startTime: number,
  endTime: number,
) => {
  if (
    trade.status !== 'closed' ||
    !isTimestampInWindow(trade.exitTimestamp, startTime, endTime)
  ) {
    return false;
  }

  return !isRuntimeTradeSyncFallbackClose(trade);
};

const buildSummaryMessages = ({
  hours,
  startTime,
  endTime,
  configuredStrategyNames,
  signals,
  evaluationStatsByStrategy,
  trades,
}: {
  hours: number;
  startTime: number;
  endTime: number;
  configuredStrategyNames: string[];
  signals: Signal[];
  evaluationStatsByStrategy: Map<string, RuntimeSignalStatsBucket>;
  trades: RuntimeTradeRecord[];
}) => {
  const signalLines: string[] = [];
  const tradeLines: string[] = [];
  const statusOrder: Array<SignalOrderStatus | 'unknown'> = [
    'completed',
    'skipped',
    'failed',
    'canceled',
    'unknown',
  ];
  const strategyNames = new Set<string>();
  const signalStats = new Map<string, Map<string, number>>();
  const tradeStats = new Map<
    string,
    {
      active: number;
      closed: number;
      activePnl: number;
      activePnlKnown: number;
      closedPnl: number;
      closedPnlKnown: number;
      trades: Array<{
        symbol: string;
        status: RuntimeTradeRecord['status'];
        pnl: number | null;
        pnlText: string;
        entryTimestamp: number;
        orderId: string;
      }>;
      closedWins: number;
      closedKnown: number;
    }
  >();

  for (const strategyName of configuredStrategyNames) {
    if (strategyName) {
      strategyNames.add(strategyName);
    }
  }

  for (const signal of signals) {
    strategyNames.add(signal.strategy);
    const stats = signalStats.get(signal.strategy) ?? new Map<string, number>();
    const status = normalizeStatus(signal.orderStatus);
    stats.set(status, (stats.get(status) ?? 0) + 1);
    signalStats.set(signal.strategy, stats);
  }

  const realizedTrades = trades.filter((trade) =>
    isRuntimeTradeClosedInWindow(trade, startTime, endTime),
  );
  const openTrades = trades.filter(
    (trade) =>
      trade.status === 'active' &&
      typeof trade.entryTimestamp === 'number' &&
      Number.isFinite(trade.entryTimestamp) &&
      trade.entryTimestamp < endTime,
  );
  const reportTrades = [...realizedTrades, ...openTrades];

  for (const trade of reportTrades) {
    strategyNames.add(trade.strategy);
    const stats = tradeStats.get(trade.strategy) ?? {
      active: 0,
      closed: 0,
      activePnl: 0,
      activePnlKnown: 0,
      closedPnl: 0,
      closedPnlKnown: 0,
      trades: [],
      closedWins: 0,
      closedKnown: 0,
    };
    const pnl =
      trade.status === 'active'
        ? trade.currentPnl
        : trade.closedPnl ?? trade.currentPnl;
    const pnlText =
      typeof pnl === 'number' && Number.isFinite(pnl)
        ? `${formatSigned(pnl)}$`
        : 'n/a';

    if (trade.status === 'active') {
      stats.active += 1;
      if (typeof pnl === 'number' && Number.isFinite(pnl)) {
        stats.activePnl += pnl;
        stats.activePnlKnown += 1;
      }
    } else {
      stats.closed += 1;
      if (typeof pnl === 'number' && Number.isFinite(pnl)) {
        stats.closedPnl += pnl;
        stats.closedPnlKnown += 1;
        stats.closedKnown += 1;
        if (pnl > 0) {
          stats.closedWins += 1;
        }
      }
    }
    stats.trades.push({
      symbol: trade.symbol,
      status: trade.status,
      pnl: typeof pnl === 'number' && Number.isFinite(pnl) ? pnl : null,
      pnlText,
      entryTimestamp: trade.entryTimestamp,
      orderId: trade.orderId,
    });
    tradeStats.set(trade.strategy, stats);
  }

  const sortedStrategies = [...strategyNames].sort((left, right) =>
    left.localeCompare(right),
  );
  const realizedWindowPnl = [...tradeStats.values()].reduce(
    (sum, stats) => sum + stats.closedPnl,
    0,
  );
  const realizedWindowPnlKnown = [...tradeStats.values()].reduce(
    (sum, stats) => sum + stats.closedPnlKnown,
    0,
  );
  const realizedWindowPnlText =
    realizedWindowPnlKnown > 0 ? formatSigned(realizedWindowPnl) : 'n/a';
  const longCount = realizedTrades.filter(
    (trade) => trade.direction === 'LONG',
  ).length;
  const shortCount = realizedTrades.filter(
    (trade) => trade.direction === 'SHORT',
  ).length;
  const openPnl = [...tradeStats.values()].reduce(
    (sum, stats) => sum + stats.activePnl,
    0,
  );
  const openPnlKnown = [...tradeStats.values()].reduce(
    (sum, stats) => sum + stats.activePnlKnown,
    0,
  );
  const openPnlText =
    openTrades.length > 0 ? formatPnlMoneyText(openPnl, openPnlKnown) : 'n/a';
  const closedWins = [...tradeStats.values()].reduce(
    (sum, stats) => sum + stats.closedWins,
    0,
  );
  const closedKnown = [...tradeStats.values()].reduce(
    (sum, stats) => sum + stats.closedKnown,
    0,
  );
  const winRateText = formatWinRateText(closedWins, closedKnown);
  const prelude = buildSummaryPrelude({
    hours,
    startTime,
    endTime,
    realizedWindowPnlText,
    winRateText,
    longCount,
    shortCount,
    openCount: openTrades.length,
    openPnlText,
  });

  signalLines.push(...prelude);
  signalLines.push('');
  signalLines.push('📡 <b>Signals</b>');
  tradeLines.push(...prelude);
  tradeLines.push('');
  tradeLines.push('💼 <b>Closed Trades</b>');

  if (!sortedStrategies.length) {
    signalLines.push('⚠️ No runtime data for this window.');
    tradeLines.push('⚠️ No runtime data for this window.');
    return {
      signalsMessage: signalLines.join('\n'),
      tradesMessage: tradeLines.join('\n'),
    };
  }

  const appendEvaluationDetails = (strategyName: string) => {
    const evaluation = evaluationStatsByStrategy.get(strategyName);
    if (!evaluation) {
      return;
    }

    signalLines.push(
      `evaluated=<b>${evaluation.evaluated}</b>, signals=<b>${evaluation.signals}</b>`,
    );
    const sourceOrder = ['skip from core', 'skip from AI', 'skip from ML'];
    const sortedReasonGroups = [...evaluation.reasonGroups.entries()].sort(
      (left, right) => {
        const leftOrder = sourceOrder.indexOf(left[0]);
        const rightOrder = sourceOrder.indexOf(right[0]);
        const normalizedLeftOrder =
          leftOrder >= 0 ? leftOrder : sourceOrder.length;
        const normalizedRightOrder =
          rightOrder >= 0 ? rightOrder : sourceOrder.length;

        return (
          normalizedLeftOrder - normalizedRightOrder ||
          left[0].localeCompare(right[0])
        );
      },
    );

    for (const [source, reasons] of sortedReasonGroups) {
      signalLines.push(`<b>${escapeHtml(source)}</b>:`);
      const sortedReasons = [...reasons.entries()].sort(
        (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
      );

      for (const [reason, count] of sortedReasons) {
        signalLines.push(`${escapeHtml(reason)}: <b>${count}</b>`);
      }
    }
  };

  for (const strategyName of sortedStrategies) {
    const stats = signalStats.get(strategyName);
    if (!stats || stats.size === 0) {
      const evaluation = evaluationStatsByStrategy.get(strategyName);
      signalLines.push('');
      signalLines.push(
        evaluation?.evaluated
          ? `<b>${escapeHtml(strategyName)}</b>\nsignals=<b>0</b>`
          : `<b>${escapeHtml(strategyName)}</b>\nnone`,
      );
      appendEvaluationDetails(strategyName);
      continue;
    }

    const parts = statusOrder
      .map((status) => {
        const count = stats.get(status) ?? 0;
        return count > 0 ? `${status}=<b>${count}</b>` : null;
      })
      .filter(Boolean);
    signalLines.push('');
    signalLines.push(`<b>${escapeHtml(strategyName)}</b>`);
    signalLines.push(parts.join(', '));
    appendEvaluationDetails(strategyName);
  }

  const sortedTradeStrategies = [...tradeStats.entries()]
    .filter(([, stats]) => stats.closed > 0)
    .map(([strategyName]) => strategyName)
    .sort((left, right) => left.localeCompare(right));

  if (sortedTradeStrategies.length === 0) {
    tradeLines.push('none');
  }

  for (const strategyName of sortedTradeStrategies) {
    const stats = tradeStats.get(strategyName);
    if (!stats) continue;

    tradeLines.push('');
    tradeLines.push(
      `<b>${escapeHtml(strategyName)}</b> (<b>${stats.closed}</b>)`,
    );
    tradeLines.push(
      `Closed PnL: <b>${escapeHtml(formatPnlMoneyText(stats.closedPnl, stats.closedPnlKnown))}</b> (<b>${stats.closed}</b>)`,
    );
    const sortedTrades = stats.trades
      .filter((trade) => trade.status === 'closed')
      .sort(
        (left, right) =>
          left.entryTimestamp - right.entryTimestamp ||
          left.symbol.localeCompare(right.symbol) ||
          left.orderId.localeCompare(right.orderId),
      );
    for (const trade of sortedTrades) {
      tradeLines.push(
        `- ${escapeHtml(trade.symbol)}: PnL <b>${escapeHtml(trade.pnlText)}</b> ${resolveTradeStatusEmoji(trade.status, trade.pnl)}`,
      );
    }
  }

  const sortedOpenStrategies = [...tradeStats.entries()]
    .filter(([, stats]) => stats.active > 0)
    .map(([strategyName]) => strategyName)
    .sort((left, right) => left.localeCompare(right));

  if (sortedOpenStrategies.length > 0) {
    tradeLines.push('');
    tradeLines.push('📍 <b>Open Positions</b>');
  }

  for (const strategyName of sortedOpenStrategies) {
    const stats = tradeStats.get(strategyName);
    if (!stats) continue;

    tradeLines.push('');
    tradeLines.push(
      `<b>${escapeHtml(strategyName)}</b> (<b>${stats.active}</b>)`,
    );
    tradeLines.push(
      `Unrealized PnL: <b>${escapeHtml(formatPnlMoneyText(stats.activePnl, stats.activePnlKnown))}</b> (<b>${stats.active}</b>)`,
    );
    const sortedTrades = stats.trades
      .filter((trade) => trade.status === 'active')
      .sort(
        (left, right) =>
          left.entryTimestamp - right.entryTimestamp ||
          left.symbol.localeCompare(right.symbol) ||
          left.orderId.localeCompare(right.orderId),
      );
    for (const trade of sortedTrades) {
      tradeLines.push(
        `- ${escapeHtml(trade.symbol)}: PnL <b>${escapeHtml(trade.pnlText)}</b> ${resolveTradeStatusEmoji(trade.status, trade.pnl)}`,
      );
    }
  }

  return {
    signalsMessage: signalLines.join('\n'),
    tradesMessage: tradeLines.join('\n'),
  };
};

export const signalsSummary = async () => {
  const hours = Math.max(
    1,
    Number.parseInt(String(flags.hours ?? 24), 10) || 24,
  );
  const endTime = Date.now();
  const startTime = endTime - hours * 60 * 60 * 1000;
  const fallbackConnectorName = await resolveSummaryConnectorName(
    flags.connector,
  );
  const [
    configuredStrategyNames,
    signals,
    evaluationStatsBuckets,
    trades,
    runtimeDeployments,
  ] = await Promise.all([
    loadRuntimeStrategyNames(flags.user),
    loadRuntimeSignals(flags.user, { startTime, endTime }),
    loadRuntimeSignalEvaluationStatsBuckets(flags.user),
    loadRuntimeTrades(flags.user),
    listRuntimeDeployments(flags.user),
  ]);
  const {
    trades: syncedTrades,
    connectorNames,
    scopesCount,
  } = await syncRuntimeTradeScopes({
    userName: flags.user,
    startTime,
    endTime,
    fallbackConnectorName,
    trades,
    deployments: runtimeDeployments,
  });
  const activeTradeOrderIds = await loadRuntimeActiveTradeOrderIds(flags.user);
  const windowSignals = signals.filter(
    (signal) => signal.timestamp >= startTime && signal.timestamp < endTime,
  );
  const windowDayKeys = new Set(getRuntimeStorageDayKeys(startTime, endTime));
  const windowEvaluationStats = new Map<string, RuntimeSignalStatsBucket>();
  for (const entry of evaluationStatsBuckets) {
    if (!windowDayKeys.has(entry.dayKey)) {
      continue;
    }

    const stats =
      windowEvaluationStats.get(entry.strategy) ?? createRuntimeSignalStats();
    mergeRuntimeSignalStats(stats, entry.stats);
    windowEvaluationStats.set(entry.strategy, stats);
  }
  const windowClosedTrades = syncedTrades.filter((trade) =>
    isRuntimeTradeClosedInWindow(trade, startTime, endTime),
  );
  const openSnapshotTrades = syncedTrades.filter(
    (trade) =>
      trade.status === 'active' &&
      activeTradeOrderIds.has(trade.orderId) &&
      typeof trade.entryTimestamp === 'number' &&
      Number.isFinite(trade.entryTimestamp) &&
      trade.entryTimestamp < endTime,
  );
  const windowTrades = [...windowClosedTrades, ...openSnapshotTrades];
  const windowTradeSignalIds = new Set(
    windowTrades
      .map((trade) => trade.signalId)
      .filter((signalId): signalId is string => typeof signalId === 'string'),
  );
  const debugSignals = windowSignals.filter((signal) =>
    windowTradeSignalIds.has(signal.signalId),
  );
  const { signalsMessage, tradesMessage } = buildSummaryMessages({
    hours,
    startTime,
    endTime,
    configuredStrategyNames,
    signals: windowSignals,
    evaluationStatsByStrategy: windowEvaluationStats,
    trades: windowTrades,
  });
  const windowEvaluationsCount = [...windowEvaluationStats.values()].reduce(
    (sum, stats) => sum + stats.evaluated,
    0,
  );

  logger.info(
    'signals summary window=%sh signals=%s evaluations=%s trades=%s connectors=%s scopes=%s user=%s',
    hours,
    windowSignals.length,
    windowEvaluationsCount,
    windowClosedTrades.length,
    connectorNames.join(',') || fallbackConnectorName,
    scopesCount,
    flags.user,
  );
  const debugAttachment = shouldAttachDebugReport(flags.debugAttachment)
    ? await buildRuntimeDebugReportAttachment({
        userName: flags.user,
        startTime,
        endTime,
        signals: debugSignals,
        evaluations: [],
        trades: windowTrades,
      })
    : null;
  const signalsAttachment = buildSignalsSummaryAttachment({
    userName: flags.user,
    endTime,
    content: signalsMessage,
  });
  const tradesMessageWithAttachmentSummary = appendReportAttachmentSummary({
    message: tradesMessage,
    signalsFilename: signalsAttachment.filename,
    filename: debugAttachment?.filename,
    tradesCount: debugAttachment ? windowTrades.length : undefined,
    signalsCount: debugAttachment
      ? debugAttachment.summary?.signals ?? debugSignals.length
      : undefined,
    evaluationsCount: debugAttachment
      ? debugAttachment.summary?.evaluations ?? 0
      : undefined,
  });
  const attachments: TelegramReportAttachment[] = [
    signalsAttachment,
    ...(debugAttachment ? [debugAttachment] : []),
  ];

  if (flags.printOnly) {
    console.log(tradesMessageWithAttachmentSummary);
    console.log('');
    console.log(`Signals attachment: ${signalsAttachment.filename}`);
    console.log(signalsAttachment.content);
    if (debugAttachment) {
      console.log('');
      console.log(`Debug attachment: ${debugAttachment.filename}`);
      console.log(debugAttachment.content);
    }
    return;
  }

  await sendTelegramReport(tradesMessageWithAttachmentSummary, {
    userName: flags.user,
    attachments,
  });
};
export const main = signalsSummary;
