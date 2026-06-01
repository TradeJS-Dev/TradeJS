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

  try {
    const rows = await connector.getClosedPnl({
      startTime,
      endTime,
      limit: CLOSED_PNL_LIMIT,
    });

    if (rows.length >= CLOSED_PNL_LIMIT) {
      callbacks?.onCapped?.(rows.length);
    }

    return rows.sort((left, right) => left.closedAt - right.closedAt);
  } catch (error) {
    callbacks?.onError?.(error);
    return [];
  }
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
    if (trade.status !== 'active') {
      syncedTrades.push(trade);
      continue;
    }

    const openPosition = openPositionsBySymbol.get(trade.symbol);
    const activeOrderId = activeOrderIdBySymbol.get(trade.symbol);
    const isCurrentActiveTrade = activeOrderId === trade.orderId;

    if (!openPositionsReliable) {
      syncedTrades.push({
        ...trade,
        status: 'active',
        lastSyncedAt: endTime,
      });
      continue;
    }

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
      exitType: trade.exitType ?? null,
      openFee: matchedClosedPnl?.openFee ?? trade.openFee ?? null,
      closeFee: matchedClosedPnl?.closeFee ?? trade.closeFee ?? null,
      fundingFee: matchedClosedPnl?.fundingFee ?? trade.fundingFee ?? null,
      totalFee: matchedClosedPnl?.totalFee ?? trade.totalFee ?? null,
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
      ...(isCurrentActiveTrade
        ? [delKey(redisKeys.runtimeActiveTrade(userName, trade.symbol))]
        : []),
    ]);
    syncedTrades.push(nextTrade);
  }

  return syncedTrades;
};
