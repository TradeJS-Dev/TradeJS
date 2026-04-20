import { randomUUID } from 'node:crypto';
import { TTL_3M } from '@tradejs/core/constants';
import { logger } from '@tradejs/infra/logger';
import { delKey, getData, redisKeys, setData } from '@tradejs/infra/redis';
import { Direction, RuntimeTradeRecord } from '@tradejs/types';

const now = () => Date.now();

const toOrderId = () =>
  `tjs-${randomUUID().replace(/-/g, '').slice(0, 24).toLowerCase()}`;

const calculateClosedPnl = ({
  direction,
  entryPrice,
  exitPrice,
  qty,
}: Pick<RuntimeTradeRecord, 'direction' | 'qty' | 'entryPrice'> & {
  exitPrice: number;
}) => {
  const pnl =
    direction === 'LONG'
      ? (exitPrice - entryPrice) * qty
      : (entryPrice - exitPrice) * qty;

  return Number.isFinite(pnl) ? pnl : null;
};

export const createRuntimeOrderId = (): string => toOrderId();

export const recordRuntimeTradeOpen = async (params: {
  userName?: string;
  orderId: string;
  signalId?: string;
  strategy: string;
  symbol: string;
  direction: Direction;
  qty: number;
  entryPrice: number;
  entryTimestamp: number;
}) => {
  const { userName } = params;
  if (!userName) {
    return null;
  }

  const record: RuntimeTradeRecord = {
    ...params,
    status: 'active',
    currentPrice: params.entryPrice,
    currentPnl: 0,
    closedPnl: null,
    exitPrice: null,
    exitTimestamp: null,
    lastSyncedAt: now(),
  };

  try {
    await Promise.all([
      setData(redisKeys.runtimeTrade(userName, record.orderId), record, {
        expire: 0,
      }),
      setData(
        redisKeys.runtimeActiveTrade(userName, record.symbol),
        { orderId: record.orderId },
        { expire: 0 },
      ),
    ]);
  } catch (error) {
    logger.error(
      'runtime trade open journal failed: %s %s',
      record.symbol,
      (error as Error)?.message || String(error),
    );
  }

  return record;
};

export const markRuntimeTradeClosed = async (params: {
  userName?: string;
  symbol: string;
  strategy?: string;
  exitPrice?: number | null;
  exitTimestamp?: number | null;
  closedPnl?: number | null;
}) => {
  const { userName, symbol, strategy, exitPrice, exitTimestamp, closedPnl } =
    params;
  if (!userName) {
    return null;
  }

  const activeRef = (await getData(
    redisKeys.runtimeActiveTrade(userName, symbol),
    null,
  )) as { orderId?: string } | null;
  const orderId = String(activeRef?.orderId || '').trim();
  if (!orderId) {
    return null;
  }

  const existing = (await getData(
    redisKeys.runtimeTrade(userName, orderId),
    null,
  )) as RuntimeTradeRecord | null;
  if (!existing) {
    await delKey(redisKeys.runtimeActiveTrade(userName, symbol));
    return null;
  }

  if (strategy && existing.strategy !== strategy) {
    return null;
  }

  const resolvedExitPrice =
    typeof exitPrice === 'number' && Number.isFinite(exitPrice)
      ? exitPrice
      : existing.currentPrice ?? existing.entryPrice;
  const resolvedClosedPnl =
    typeof closedPnl === 'number' && Number.isFinite(closedPnl)
      ? closedPnl
      : typeof resolvedExitPrice === 'number' &&
          Number.isFinite(resolvedExitPrice)
        ? calculateClosedPnl({
            direction: existing.direction,
            entryPrice: existing.entryPrice,
            exitPrice: resolvedExitPrice,
            qty: existing.qty,
          })
        : existing.closedPnl ?? existing.currentPnl ?? null;

  const next: RuntimeTradeRecord = {
    ...existing,
    status: 'closed',
    currentPrice: resolvedExitPrice,
    currentPnl: resolvedClosedPnl,
    closedPnl: resolvedClosedPnl,
    exitPrice: resolvedExitPrice,
    exitTimestamp:
      typeof exitTimestamp === 'number' && Number.isFinite(exitTimestamp)
        ? exitTimestamp
        : now(),
    lastSyncedAt: now(),
  };

  try {
    await Promise.all([
      setData(redisKeys.runtimeTrade(userName, orderId), next, {
        expire: TTL_3M,
      }),
      delKey(redisKeys.runtimeActiveTrade(userName, symbol)),
    ]);
  } catch (error) {
    logger.error(
      'runtime trade close journal failed: %s %s',
      symbol,
      (error as Error)?.message || String(error),
    );
  }

  return next;
};
