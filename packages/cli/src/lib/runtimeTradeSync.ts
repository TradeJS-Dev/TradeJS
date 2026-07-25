import { TTL_1M } from '@tradejs/core/constants';
import { getRuntimeStorageDayKey } from '@tradejs/core/time';
import {
  delKey,
  getData,
  redisKeys,
  setData,
  setHashJsonField,
} from '@tradejs/infra/redis';
import { ClosedPnlRecord, Connector, RuntimeTradeRecord } from '@tradejs/types';

type ClosedPnlLoadCallbacks = {
  onUnsupported?: () => void;
  onCapped?: (count: number) => void;
  onError?: (error: unknown) => void;
};

const CLOSED_PNL_LIMIT = 100;
const CLOSED_PNL_RECONCILIATION_LOOKBACK_MS = 24 * 60 * 60 * 1000;
export const EXCHANGE_HISTORY_MAX_RANGE_MS = 7 * 24 * 60 * 60 * 1000;

export const isRuntimeTradeSyncFallbackClose = (trade: RuntimeTradeRecord) =>
  trade.status === 'closed' &&
  trade.exitTimestamp === trade.lastSyncedAt &&
  trade.exitPrice == null &&
  trade.actualExitPrice == null &&
  trade.closeFee == null &&
  trade.fundingFee == null;

export const splitExchangeHistoryTimeRange = ({
  startTime,
  endTime,
  maxRangeMs = EXCHANGE_HISTORY_MAX_RANGE_MS,
}: {
  startTime: number;
  endTime: number;
  maxRangeMs?: number;
}) => {
  if (
    !Number.isFinite(startTime) ||
    !Number.isFinite(endTime) ||
    !Number.isFinite(maxRangeMs) ||
    maxRangeMs <= 0 ||
    endTime <= startTime
  ) {
    return [{ startTime, endTime }];
  }

  const chunks: Array<{ startTime: number; endTime: number }> = [];
  let chunkStart = Math.trunc(startTime);
  const finalEnd = Math.trunc(endTime);
  const maxRange = Math.trunc(maxRangeMs);

  while (chunkStart < finalEnd) {
    const chunkEnd = Math.min(finalEnd, chunkStart + maxRange);
    chunks.push({ startTime: chunkStart, endTime: chunkEnd });

    if (chunkEnd >= finalEnd) {
      break;
    }
    chunkStart = chunkEnd + 1;
  }

  return chunks;
};

export const formatRuntimeTradeSyncError = (error: unknown): string => {
  if (!error || typeof error !== 'object') {
    return String(error || 'unknown error');
  }

  const record = error as Record<string, unknown>;
  const message =
    typeof record.message === 'string' && record.message.trim()
      ? record.message.trim()
      : String(error);
  const code =
    typeof record.code === 'string' && record.code.trim()
      ? record.code.trim()
      : null;
  const isAxiosError = record.isAxiosError === true;
  const config =
    record.config && typeof record.config === 'object'
      ? (record.config as Record<string, unknown>)
      : null;
  const response =
    record.response && typeof record.response === 'object'
      ? (record.response as Record<string, unknown>)
      : null;
  const method =
    typeof config?.method === 'string' && config.method.trim()
      ? config.method.toUpperCase()
      : null;
  const url =
    typeof config?.url === 'string' && config.url.trim()
      ? config.url.trim()
      : null;
  const timeout =
    typeof config?.timeout === 'number' && Number.isFinite(config.timeout)
      ? config.timeout
      : null;
  const status =
    typeof response?.status === 'number' && Number.isFinite(response.status)
      ? response.status
      : null;

  const details = [
    isAxiosError ? 'axios' : null,
    code,
    status == null ? null : `status=${status}`,
    method && url ? `${method} ${url}` : url,
    timeout == null ? null : `timeout=${timeout}ms`,
  ].filter(Boolean);

  return details.length > 0 ? `${message} (${details.join(', ')})` : message;
};

export const loadClosedPnlRows = async ({
  connector,
  startTime,
  endTime,
  callbacks,
}: {
  connector: Connector;
  startTime: number;
  endTime: number;
  callbacks?: ClosedPnlLoadCallbacks;
}): Promise<ClosedPnlRecord[]> => {
  if (typeof connector.getClosedPnl !== 'function') {
    callbacks?.onUnsupported?.();
    return [];
  }

  const rows: ClosedPnlRecord[] = [];
  const chunks = splitExchangeHistoryTimeRange({ startTime, endTime });

  for (const chunk of chunks) {
    try {
      const chunkRows = await connector.getClosedPnl({
        startTime: chunk.startTime,
        endTime: chunk.endTime,
        limit: CLOSED_PNL_LIMIT,
      });

      if (chunkRows.length >= CLOSED_PNL_LIMIT) {
        callbacks?.onCapped?.(chunkRows.length);
      }

      rows.push(...chunkRows);
    } catch (error) {
      callbacks?.onError?.(error);
    }
  }

  return rows.sort((left, right) => left.closedAt - right.closedAt);
};

export const consumeClosedPnlMatch = (
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

const isRuntimeTradeInConnectorScope = (
  trade: RuntimeTradeRecord,
  connector: Connector,
) => {
  if (trade.deploymentId && trade.deploymentId !== connector.deploymentId) {
    return false;
  }
  if (trade.accountId && trade.accountId !== connector.accountId) {
    return false;
  }
  if (
    trade.universe &&
    connector.universe &&
    trade.universe !== connector.universe
  ) {
    return false;
  }

  return true;
};

export const syncRuntimeTrades = async ({
  userName,
  connector,
  trades,
  startTime,
  endTime,
  closedPnlCallbacks,
  openPositionCallbacks,
}: {
  userName: string;
  connector: Connector;
  trades: RuntimeTradeRecord[];
  startTime: number;
  endTime: number;
  closedPnlCallbacks?: ClosedPnlLoadCallbacks;
  openPositionCallbacks?: Pick<ClosedPnlLoadCallbacks, 'onError'>;
}) => {
  let openPositions: Awaited<
    ReturnType<NonNullable<Connector['getOpenPositionPnl']>>
  > = [];
  let openPositionsReliable = true;
  if (typeof connector.getOpenPositionPnl === 'function') {
    try {
      openPositions = await connector.getOpenPositionPnl();
    } catch (error) {
      openPositionCallbacks?.onError?.(error);
      openPositionsReliable = false;
      openPositions = [];
    }
  }
  const openPositionsBySymbol = new Map(
    openPositions.map((position) => [position.symbol, position]),
  );
  const activeOrderIdByKey = new Map<string, string | null>();
  const activeTradeKeys = [
    ...new Set(
      trades
        .filter((trade) => isRuntimeTradeInConnectorScope(trade, connector))
        .map((trade) =>
          redisKeys.runtimeActiveTrade(
            userName,
            trade.symbol,
            trade.deploymentId ?? trade.accountId,
          ),
        ),
    ),
  ];

  await Promise.all(
    activeTradeKeys.map(async (key) => {
      const activeRef = (await getData(key, null)) as {
        orderId?: string;
      } | null;
      activeOrderIdByKey.set(
        key,
        typeof activeRef?.orderId === 'string' ? activeRef.orderId : null,
      );
    }),
  );

  const closedPnlRows = await loadClosedPnlRows({
    connector,
    startTime: Math.max(0, startTime - CLOSED_PNL_RECONCILIATION_LOOKBACK_MS),
    endTime,
    callbacks: closedPnlCallbacks,
  });
  const closedPnlBuckets = new Map<string, ClosedPnlRecord[]>();

  for (const row of closedPnlRows) {
    const bucket = closedPnlBuckets.get(row.symbol) ?? [];
    bucket.push(row);
    closedPnlBuckets.set(row.symbol, bucket);
  }

  const syncedTrades: RuntimeTradeRecord[] = [];

  for (const trade of trades) {
    if (!isRuntimeTradeInConnectorScope(trade, connector)) {
      syncedTrades.push(trade);
      continue;
    }

    if (trade.status !== 'active' && !isRuntimeTradeSyncFallbackClose(trade)) {
      syncedTrades.push(trade);
      continue;
    }

    const activeTradeKey = redisKeys.runtimeActiveTrade(
      userName,
      trade.symbol,
      trade.deploymentId ?? trade.accountId,
    );
    const openPosition = openPositionsBySymbol.get(trade.symbol);
    const activeOrderId = activeOrderIdByKey.get(activeTradeKey);
    const isCurrentActiveTrade = activeOrderId === trade.orderId;

    if (trade.status === 'active' && !openPositionsReliable) {
      syncedTrades.push({
        ...trade,
        status: 'active',
        lastSyncedAt: endTime,
      });
      continue;
    }

    if (
      trade.status === 'active' &&
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
      await setHashJsonField(
        redisKeys.runtimeTradeBucket(
          userName,
          getRuntimeStorageDayKey(trade.entryTimestamp),
        ),
        trade.orderId,
        nextTrade,
        { expire: 0 },
      );
      syncedTrades.push(nextTrade);
      continue;
    }

    const matchedClosedPnl = consumeClosedPnlMatch(closedPnlBuckets, trade);
    if (!matchedClosedPnl) {
      syncedTrades.push(trade);
      continue;
    }

    const nextTrade: RuntimeTradeRecord = {
      ...trade,
      status: 'closed',
      currentPrice: matchedClosedPnl.exitPrice ?? trade.currentPrice ?? null,
      currentPnl: matchedClosedPnl.closedPnl,
      closedPnl: matchedClosedPnl.closedPnl,
      actualEntryPrice:
        matchedClosedPnl.entryPrice ?? trade.actualEntryPrice ?? null,
      exitPrice: matchedClosedPnl.exitPrice ?? trade.exitPrice ?? null,
      actualExitPrice:
        matchedClosedPnl.exitPrice ?? trade.actualExitPrice ?? null,
      exitTimestamp: matchedClosedPnl.closedAt,
      exitType: trade.exitType ?? null,
      openFee: matchedClosedPnl.openFee ?? trade.openFee ?? null,
      closeFee: matchedClosedPnl.closeFee ?? trade.closeFee ?? null,
      fundingFee: matchedClosedPnl.fundingFee ?? trade.fundingFee ?? null,
      totalFee: matchedClosedPnl.totalFee ?? trade.totalFee ?? null,
      lastSyncedAt: endTime,
    };

    await Promise.all([
      setData(redisKeys.runtimeTrade(userName, trade.orderId), nextTrade, {
        expire: TTL_1M,
      }),
      setHashJsonField(
        redisKeys.runtimeTradeBucket(
          userName,
          getRuntimeStorageDayKey(trade.entryTimestamp),
        ),
        trade.orderId,
        nextTrade,
        { expire: TTL_1M },
      ),
      ...(isCurrentActiveTrade ? [delKey(activeTradeKey)] : []),
    ]);
    syncedTrades.push(nextTrade);
  }

  return syncedTrades;
};
