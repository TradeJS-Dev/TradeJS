import { randomUUID } from 'node:crypto';
import { TTL_1M } from '@tradejs/core/constants';
import { getRuntimeStorageDayKey } from '@tradejs/core/time';
import { createRuntimeOrderLinkPrefix } from '@tradejs/core/trade';
import { logger } from '@tradejs/infra/logger';
import {
  delKey,
  getData,
  redisKeys,
  setData,
  setHashJsonField,
} from '@tradejs/infra/redis';
import {
  Direction,
  Interval,
  RuntimeTradeRecord,
  RuntimeTradeFillSource,
  RuntimeTradeTelemetryQuality,
  SignalAnalysis,
} from '@tradejs/types';

const now = () => Date.now();

const toRandomOrderSuffix = () =>
  randomUUID().replace(/-/g, '').slice(0, 12).toLowerCase();

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

export const createRuntimeOrderId = (strategy?: string): string => {
  const prefix = createRuntimeOrderLinkPrefix(strategy);

  if (prefix === 'tjs-') {
    return `tjs-${randomUUID().replace(/-/g, '').slice(0, 24).toLowerCase()}`;
  }

  return `${prefix}${toRandomOrderSuffix()}`;
};

export const recordRuntimeTradeOpen = async (params: {
  userName?: string;
  orderId: string;
  signalId?: string;
  strategy: string;
  symbol: string;
  interval?: Interval;
  direction: Direction;
  qty: number;
  entryPrice: number;
  entryTimestamp: number;
  signalTimestamp?: number | null;
  signalClosePrice?: number | null;
  arrivalSnapshotTime?: number | null;
  arrivalSource?: string | null;
  arrivalMid?: number | null;
  bid?: number | null;
  ask?: number | null;
  spreadBps?: number | null;
  orderSubmitTime?: number | null;
  orderAckTime?: number | null;
  fillAvgPrice?: number | null;
  fillSource?: RuntimeTradeFillSource | null;
  fillTime?: number | null;
  telemetryQuality?: RuntimeTradeTelemetryQuality | null;
  fee?: number | null;
  openFee?: number | null;
  totalFee?: number | null;
  aiAnalysis?: Partial<SignalAnalysis> | null;
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
  const dayKey = getRuntimeStorageDayKey(record.entryTimestamp);

  try {
    await Promise.all([
      setData(redisKeys.runtimeTrade(userName, record.orderId), record, {
        expire: 0,
      }),
      setHashJsonField(
        redisKeys.runtimeTradeBucket(userName, dayKey),
        record.orderId,
        record,
        { expire: 0 },
      ),
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

export const getActiveRuntimeTrade = async (params: {
  userName?: string;
  symbol: string;
}): Promise<RuntimeTradeRecord | null> => {
  const { userName, symbol } = params;
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

  return existing;
};

export const markRuntimeTradeClosed = async (params: {
  userName?: string;
  symbol: string;
  strategy?: string;
  exitPrice?: number | null;
  exitTimestamp?: number | null;
  closedPnl?: number | null;
  exitType?: RuntimeTradeRecord['exitType'];
}) => {
  const {
    userName,
    symbol,
    strategy,
    exitPrice,
    exitTimestamp,
    closedPnl,
    exitType,
  } = params;
  if (!userName) {
    return null;
  }

  const existing = await getActiveRuntimeTrade({ userName, symbol });
  if (!existing) {
    return null;
  }
  const orderId = existing.orderId;

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
    exitType: exitType ?? existing.exitType ?? null,
    lastSyncedAt: now(),
  };
  const dayKey = getRuntimeStorageDayKey(existing.entryTimestamp);

  try {
    await Promise.all([
      setData(redisKeys.runtimeTrade(userName, orderId), next, {
        expire: TTL_1M,
      }),
      setHashJsonField(
        redisKeys.runtimeTradeBucket(userName, dayKey),
        orderId,
        next,
        { expire: TTL_1M },
      ),
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
