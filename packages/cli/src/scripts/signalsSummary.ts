import 'dotenv/config';
import args from 'args';
import { TTL_3M } from '@tradejs/core/constants';
import { logger } from '@tradejs/infra/logger';
import {
  delKey,
  getData,
  getKeys,
  redisKeys,
  setData,
} from '@tradejs/infra/redis';
import { sendTextToTG } from '@tradejs/node/cli';
import {
  DEFAULT_CONNECTOR_NAME,
  getConnectorCreatorByName,
  resolveConnectorName,
} from '@tradejs/node/connectors';
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

const isSignalRecord = (value: unknown): value is Signal => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.signalId === 'string' &&
    typeof record.strategy === 'string' &&
    typeof record.symbol === 'string' &&
    typeof record.timestamp === 'number'
  );
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

const loadRuntimeSignals = async (userName: string): Promise<Signal[]> => {
  const keys = await getKeys(redisKeys.runtimeSignals(userName));
  const signals = await Promise.all(keys.map((key) => getData(key, null)));

  return signals
    .filter(isSignalRecord)
    .sort((left, right) => left.timestamp - right.timestamp);
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
        expire: TTL_3M,
      }),
      ...(isCurrentActiveTrade
        ? [delKey(redisKeys.runtimeActiveTrade(userName, trade.symbol))]
        : []),
    ]);
    syncedTrades.push(nextTrade);
  }

  return syncedTrades;
};

const buildSummaryMessage = ({
  hours,
  startTime,
  endTime,
  configuredStrategyNames,
  signals,
  trades,
}: {
  hours: number;
  startTime: number;
  endTime: number;
  configuredStrategyNames: string[];
  signals: Signal[];
  trades: RuntimeTradeRecord[];
}) => {
  const lines: string[] = [];
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
    };
    const pnl =
      trade.status === 'active'
        ? trade.currentPnl
        : trade.closedPnl ?? trade.currentPnl;

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
    tradeStats.set(trade.strategy, stats);
  }

  const sortedStrategies = [...strategyNames].sort((left, right) =>
    left.localeCompare(right),
  );

  lines.push(`<b>TradeJS daily summary</b>`);
  lines.push(
    `Window: <b>${escapeHtml(formatMskDateTime(startTime))} - ${escapeHtml(formatMskDateTime(endTime))} ${SUMMARY_TIMEZONE_LABEL}</b>`,
  );
  lines.push(`Range: <b>${hours}h</b>`);
  lines.push('');
  lines.push('<b>Signals</b>');

  if (!sortedStrategies.length) {
    lines.push('No runtime data for this window.');
    return lines.join('\n');
  }

  for (const strategyName of sortedStrategies) {
    const stats = signalStats.get(strategyName);
    if (!stats || stats.size === 0) {
      lines.push(`${escapeHtml(strategyName)}: none`);
      continue;
    }

    const parts = statusOrder
      .map((status) => {
        const count = stats.get(status) ?? 0;
        return count > 0 ? `${status}=${count}` : null;
      })
      .filter(Boolean);
    lines.push(`${escapeHtml(strategyName)}: ${parts.join(', ')}`);
  }

  lines.push('');
  lines.push('<b>Trades</b>');

  for (const strategyName of sortedStrategies) {
    const stats = tradeStats.get(strategyName);
    if (!stats) {
      lines.push(`${escapeHtml(strategyName)}: total=0`);
      continue;
    }

    const activePnlText =
      stats.activePnlKnown > 0 ? formatSigned(stats.activePnl) : 'n/a';
    const closedPnlText =
      stats.closedPnlKnown > 0 ? formatSigned(stats.closedPnl) : 'n/a';
    const totalPnlText =
      stats.totalPnlKnown > 0 ? formatSigned(stats.totalPnl) : 'n/a';

    lines.push(
      `${escapeHtml(strategyName)}: total=${stats.total}, active=${stats.active} (PnL ${activePnlText}), closed=${stats.closed} (PnL ${closedPnlText}), totalPnL=${totalPnlText}`,
    );
  }

  return lines.join('\n');
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
  const [configuredStrategyNames, signals, trades] = await Promise.all([
    loadRuntimeStrategyNames(flags.user),
    loadRuntimeSignals(flags.user),
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
    (signal) => signal.timestamp >= startTime && signal.timestamp <= endTime,
  );
  const windowTrades = syncedTrades.filter(
    (trade) =>
      trade.entryTimestamp >= startTime && trade.entryTimestamp <= endTime,
  );
  const message = buildSummaryMessage({
    hours,
    startTime,
    endTime,
    configuredStrategyNames,
    signals: windowSignals,
    trades: windowTrades,
  });

  logger.info(
    'signals summary window=%sh signals=%s trades=%s connector=%s user=%s',
    hours,
    windowSignals.length,
    windowTrades.length,
    connectorName,
    flags.user,
  );

  if (flags.printOnly) {
    console.log(message);
    return;
  }

  await sendTextToTG(message, { userName: flags.user });
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
