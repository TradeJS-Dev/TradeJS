import 'dotenv/config';
import args from 'args';
import { TTL_1M } from '@tradejs/core/constants';
import { logger } from '@tradejs/infra/logger';
import {
  delKey,
  getData,
  getKeys,
  redisKeys,
  setData,
} from '@tradejs/infra/redis';
import {
  DEFAULT_CONNECTOR_NAME,
  getConnectorCreatorByName,
  resolveConnectorName,
} from '@tradejs/node/connectors';
import { sendTelegramReport } from '../lib/telegramReports';
import {
  loadRuntimeSignalEvaluationStatsBuckets,
  loadRuntimeSignals,
} from '../lib/runtimeSignalsLoader';
import {
  getRuntimeStorageDayKeys,
  RuntimeSignalStatsBucket,
} from '../lib/runtimeSignalsStorage';
import {
  ClosedPnlRecord,
  Connector,
  ConnectorCreator,
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

const formatPnlText = (value: number, knownCount: number) =>
  knownCount > 0 ? formatSigned(value) : 'n/a';

const resolveSummaryTitle = (hours: number) => {
  if (hours === 24) {
    return 'TradeJS daily summary';
  }

  if (hours === 168) {
    return 'TradeJS weekly summary';
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

const isRuntimeTradeRecord = (value: unknown): value is RuntimeTradeRecord => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.orderId === 'string' &&
    typeof record.strategy === 'string' &&
    typeof record.symbol === 'string' &&
    typeof record.entryTimestamp === 'number' &&
    typeof record.entryPrice === 'number' &&
    typeof record.qty === 'number'
  );
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

const resolveStrategyNameByConfigKey = (
  userName: string,
  key: string,
): string | null => {
  const parts = key.split(':');
  if (parts.length !== 5) {
    return null;
  }

  const [users, keyUserName, strategiesKey, strategyName, configKey] = parts;
  if (
    users !== 'users' ||
    keyUserName !== userName ||
    strategiesKey !== 'strategies' ||
    configKey !== 'config' ||
    !strategyName
  ) {
    return null;
  }

  return strategyName;
};

const loadRuntimeStrategyNames = async (
  userName: string,
): Promise<string[]> => {
  const keys = await getKeys(`${redisKeys.strategies(userName)}:`);

  return keys
    .filter((key) => key.endsWith(':config'))
    .map((key) => resolveStrategyNameByConfigKey(userName, key))
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right));
};

const loadRuntimeTrades = async (
  userName: string,
): Promise<RuntimeTradeRecord[]> => {
  const keys = await getKeys(redisKeys.runtimeTrades(userName));
  const trades = await Promise.all(keys.map((key) => getData(key, null)));

  return trades
    .filter(isRuntimeTradeRecord)
    .sort((left, right) => left.entryTimestamp - right.entryTimestamp);
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

const loadClosedPnlRows = async ({
  connector,
  startTime,
  endTime,
}: {
  connector: Connector;
  startTime: number;
  endTime: number;
}): Promise<ClosedPnlRecord[]> => {
  if (typeof connector.getClosedPnl !== 'function') {
    return [];
  }

  try {
    const rows = await connector.getClosedPnl({
      startTime,
      endTime,
      limit: 100,
    });

    return rows.sort((left, right) => left.closedAt - right.closedAt);
  } catch (error) {
    logger.warn(
      'signals summary: getClosedPnl failed: %s',
      (error as Error)?.message || String(error),
    );
    return [];
  }
};

const consumeClosedPnlMatch = (
  buckets: Map<string, ClosedPnlRecord[]>,
  trade: RuntimeTradeRecord,
) => {
  const rows = buckets.get(trade.symbol);
  if (!rows?.length) {
    return null;
  }

  const minimumClosedAt = trade.entryTimestamp - 5 * 60_000;
  const matchIndex = rows.findIndex(
    (row) => Number.isFinite(row.closedAt) && row.closedAt >= minimumClosedAt,
  );

  if (matchIndex < 0) {
    return null;
  }

  const [row] = rows.splice(matchIndex, 1);
  return row ?? null;
};

const syncRuntimeTrades = async ({
  userName,
  connector,
  trades,
  startTime,
  endTime,
}: {
  userName: string;
  connector: Connector;
  trades: RuntimeTradeRecord[];
  startTime: number;
  endTime: number;
}) => {
  const openPositions =
    typeof connector.getOpenPositionPnl === 'function'
      ? await connector.getOpenPositionPnl()
      : [];
  const openPositionsBySymbol = new Map(
    openPositions.map((position) => [position.symbol, position]),
  );
  const activeOrderIdBySymbol = new Map<string, string | null>();
  const symbols = [...new Set(trades.map((trade) => trade.symbol))];

  await Promise.all(
    symbols.map(async (symbol) => {
      const activeRef = (await getData(
        redisKeys.runtimeActiveTrade(userName, symbol),
        null,
      )) as { orderId?: string } | null;
      activeOrderIdBySymbol.set(
        symbol,
        typeof activeRef?.orderId === 'string' ? activeRef.orderId : null,
      );
    }),
  );

  const closedPnlRows = await loadClosedPnlRows({
    connector,
    startTime,
    endTime,
  });
  const closedPnlBuckets = new Map<string, ClosedPnlRecord[]>();

  for (const row of closedPnlRows) {
    const bucket = closedPnlBuckets.get(row.symbol) ?? [];
    bucket.push(row);
    closedPnlBuckets.set(row.symbol, bucket);
  }

  const syncedTrades: RuntimeTradeRecord[] = [];

  for (const trade of trades) {
    if (trade.status !== 'active') {
      syncedTrades.push(trade);
      continue;
    }

    const openPosition = openPositionsBySymbol.get(trade.symbol);
    const activeOrderId = activeOrderIdBySymbol.get(trade.symbol);
    const isCurrentActiveTrade = activeOrderId === trade.orderId;

    if (
      isCurrentActiveTrade &&
      openPosition &&
      openPosition.direction === trade.direction
    ) {
      const nextTrade: RuntimeTradeRecord = {
        ...trade,
        status: 'active',
        currentPrice: openPosition.currentPrice,
        currentPnl: openPosition.unrealizedPnl,
        lastSyncedAt: endTime,
      };

      await setData(
        redisKeys.runtimeTrade(userName, trade.orderId),
        nextTrade,
        {
          expire: 0,
        },
      );
      syncedTrades.push(nextTrade);
      continue;
    }

    const matchedClosedPnl = consumeClosedPnlMatch(closedPnlBuckets, trade);
    const nextTrade: RuntimeTradeRecord = {
      ...trade,
      status: 'closed',
      currentPrice: matchedClosedPnl?.exitPrice ?? trade.currentPrice ?? null,
      currentPnl:
        matchedClosedPnl?.closedPnl ??
        trade.closedPnl ??
        trade.currentPnl ??
        null,
      closedPnl:
        matchedClosedPnl?.closedPnl ??
        trade.closedPnl ??
        trade.currentPnl ??
        null,
      exitPrice: matchedClosedPnl?.exitPrice ?? trade.exitPrice ?? null,
      exitTimestamp:
        matchedClosedPnl?.closedAt ?? trade.exitTimestamp ?? endTime,
      lastSyncedAt: endTime,
    };

    await Promise.all([
      setData(redisKeys.runtimeTrade(userName, trade.orderId), nextTrade, {
        expire: TTL_1M,
      }),
      ...(isCurrentActiveTrade
        ? [delKey(redisKeys.runtimeActiveTrade(userName, trade.symbol))]
        : []),
    ]);
    syncedTrades.push(nextTrade);
  }

  return syncedTrades;
};

const buildSummaryPrelude = ({
  hours,
  startTime,
  endTime,
  totalWindowPnlText,
}: {
  hours: number;
  startTime: number;
  endTime: number;
  totalWindowPnlText: string;
}) => {
  const windowPnlLabel = hours === 24 ? '24h PnL' : `${hours}h PnL`;

  return [
    `📋 <b>${escapeHtml(resolveSummaryTitle(hours))}</b>`,
    '',
    '🕒 <b>Window</b>',
    `<b>${escapeHtml(formatMskDateTime(startTime))} - ${escapeHtml(formatMskDateTime(endTime))} ${SUMMARY_TIMEZONE_LABEL}</b>`,
    '',
    `⏱ Range: <b>${hours}h</b>`,
    `💰 <b>${windowPnlLabel}:</b> <b>${escapeHtml(totalWindowPnlText)}</b>`,
  ];
};

const resolveTradeStatusEmoji = (status: RuntimeTradeRecord['status']) => {
  if (status === 'active') {
    return '🟢';
  }

  if (status === 'closed') {
    return '✅';
  }

  return '❔';
};

const buildTradeSummaryLine = (stats: {
  total: number;
  active: number;
  closed: number;
  activePnl: number;
  activePnlKnown: number;
  closedPnl: number;
  closedPnlKnown: number;
  totalPnl: number;
  totalPnlKnown: number;
}) => {
  if (stats.total === 0) {
    return `total=<b>0</b>`;
  }

  const parts = [`total=<b>${stats.total}</b>`];
  const activePnlText = formatPnlText(stats.activePnl, stats.activePnlKnown);
  const closedPnlText = formatPnlText(stats.closedPnl, stats.closedPnlKnown);
  const totalPnlText = formatPnlText(stats.totalPnl, stats.totalPnlKnown);
  const hasMixedStatuses = stats.active > 0 && stats.closed > 0;

  if (hasMixedStatuses) {
    parts.push(
      `🟢=<b>${stats.active}</b> (PnL <b>${escapeHtml(activePnlText)}</b>)`,
    );
    parts.push(
      `✅=<b>${stats.closed}</b> (PnL <b>${escapeHtml(closedPnlText)}</b>)`,
    );

    if (stats.totalPnlKnown > 0) {
      parts.push(`totalPnL=<b>${escapeHtml(totalPnlText)}</b>`);
    }

    return parts.join(', ');
  }

  if (stats.active > 0) {
    parts.push(`🟢 (PnL <b>${escapeHtml(activePnlText)}</b>)`);
  }

  if (stats.closed > 0) {
    parts.push(`✅ (PnL <b>${escapeHtml(closedPnlText)}</b>)`);
  }

  return parts.join(', ');
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
      total: number;
      active: number;
      closed: number;
      activePnl: number;
      activePnlKnown: number;
      closedPnl: number;
      closedPnlKnown: number;
      totalPnl: number;
      totalPnlKnown: number;
      trades: Array<{
        symbol: string;
        status: RuntimeTradeRecord['status'];
        pnlText: string;
        entryTimestamp: number;
        orderId: string;
      }>;
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

  for (const trade of trades) {
    strategyNames.add(trade.strategy);
    const stats = tradeStats.get(trade.strategy) ?? {
      total: 0,
      active: 0,
      closed: 0,
      activePnl: 0,
      activePnlKnown: 0,
      closedPnl: 0,
      closedPnlKnown: 0,
      totalPnl: 0,
      totalPnlKnown: 0,
      trades: [],
    };
    const pnl =
      trade.status === 'active'
        ? trade.currentPnl
        : trade.closedPnl ?? trade.currentPnl;
    const pnlText =
      typeof pnl === 'number' && Number.isFinite(pnl)
        ? formatSigned(pnl)
        : 'n/a';

    stats.total += 1;
    if (trade.status === 'active') {
      stats.active += 1;
      if (typeof pnl === 'number' && Number.isFinite(pnl)) {
        stats.activePnl += pnl;
        stats.activePnlKnown += 1;
        stats.totalPnl += pnl;
        stats.totalPnlKnown += 1;
      }
    } else {
      stats.closed += 1;
      if (typeof pnl === 'number' && Number.isFinite(pnl)) {
        stats.closedPnl += pnl;
        stats.closedPnlKnown += 1;
        stats.totalPnl += pnl;
        stats.totalPnlKnown += 1;
      }
    }
    stats.trades.push({
      symbol: trade.symbol,
      status: trade.status,
      pnlText,
      entryTimestamp: trade.entryTimestamp,
      orderId: trade.orderId,
    });
    tradeStats.set(trade.strategy, stats);
  }

  const sortedStrategies = [...strategyNames].sort((left, right) =>
    left.localeCompare(right),
  );
  const totalWindowPnl = [...tradeStats.values()].reduce(
    (sum, stats) => sum + stats.totalPnl,
    0,
  );
  const totalWindowPnlKnown = [...tradeStats.values()].reduce(
    (sum, stats) => sum + stats.totalPnlKnown,
    0,
  );
  const totalWindowPnlText =
    totalWindowPnlKnown > 0 ? formatSigned(totalWindowPnl) : 'n/a';
  const prelude = buildSummaryPrelude({
    hours,
    startTime,
    endTime,
    totalWindowPnlText,
  });

  signalLines.push(...prelude);
  signalLines.push('');
  signalLines.push('📡 <b>Signals</b>');
  tradeLines.push(...prelude);
  tradeLines.push('');
  tradeLines.push('💼 <b>Trades</b>');

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

  for (const strategyName of sortedStrategies) {
    const stats = tradeStats.get(strategyName);
    if (!stats) {
      tradeLines.push('');
      tradeLines.push(`<b>${escapeHtml(strategyName)}</b>`);
      tradeLines.push(`total=<b>0</b>`);
      continue;
    }

    tradeLines.push('');
    tradeLines.push(`<b>${escapeHtml(strategyName)}</b>`);
    tradeLines.push(buildTradeSummaryLine(stats));
    const sortedTrades = [...stats.trades].sort(
      (left, right) =>
        left.entryTimestamp - right.entryTimestamp ||
        left.symbol.localeCompare(right.symbol) ||
        left.orderId.localeCompare(right.orderId),
    );
    for (const trade of sortedTrades) {
      tradeLines.push(
        `- ${escapeHtml(trade.symbol)}: PnL <b>${escapeHtml(trade.pnlText)}</b> ${resolveTradeStatusEmoji(trade.status)}`,
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
  const connectorName = await resolveSummaryConnectorName(flags.connector);
  const connectorFactory = await getConnectorCreatorByName(
    connectorName,
    projectRoot,
  );

  if (!connectorFactory) {
    throw new Error(`Connector "${connectorName}" is not registered`);
  }

  const connector = await (connectorFactory as ConnectorCreator)({
    userName: flags.user,
  });
  const [configuredStrategyNames, signals, evaluationStatsBuckets, trades] =
    await Promise.all([
      loadRuntimeStrategyNames(flags.user),
      loadRuntimeSignals(flags.user),
      loadRuntimeSignalEvaluationStatsBuckets(flags.user),
      loadRuntimeTrades(flags.user),
    ]);
  const syncedTrades = await syncRuntimeTrades({
    userName: flags.user,
    connector,
    trades,
    startTime,
    endTime,
  });
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
  const signalIds = new Set(
    signals.map((signal) => signal.signalId).filter(Boolean),
  );
  const windowTrades = syncedTrades.filter(
    (trade) =>
      trade.entryTimestamp >= startTime &&
      trade.entryTimestamp < endTime &&
      trade.signalId != null &&
      signalIds.has(trade.signalId),
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
    'signals summary window=%sh signals=%s evaluations=%s trades=%s connector=%s user=%s',
    hours,
    windowSignals.length,
    windowEvaluationsCount,
    windowTrades.length,
    connectorName,
    flags.user,
  );

  if (flags.printOnly) {
    console.log(signalsMessage);
    console.log('');
    console.log(tradesMessage);
    return;
  }

  await sendTelegramReport(signalsMessage, { userName: flags.user });
  await sendTelegramReport(tradesMessage, { userName: flags.user });
};

if (process.env.NODE_ENV !== 'test') {
  signalsSummary()
    .then(() => {
      process.exit(0);
    })
    .catch(() => {
      process.exit(1);
    });
}
