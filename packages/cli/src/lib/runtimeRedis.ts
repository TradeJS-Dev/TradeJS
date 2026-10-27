import {
  getData,
  getHashJsonValues,
  getKeys,
  redisKeys,
} from '@tradejs/infra/redis';
import {
  getRuntimeStorageDayKey,
  getRuntimeStorageDayKeys,
} from '@tradejs/core/time';
import {
  RuntimeTradeRecord,
  StrategyConfig,
  StrategyResults,
} from '@tradejs/types';
export {
  getRuntimeStrategyConfigKeys,
  loadRuntimeStrategyConfigs,
  loadRuntimeStrategyNames,
  resolveStrategyConfigIdentityByKey,
  resolveStrategyNameByConfigKey,
  type RuntimeStrategyConfigRecord,
} from '@tradejs/infra/runtimeStrategyConfigs';
export const isRuntimeStrategyEnabled = (strategyConfig: StrategyConfig) => {
  const enabled = (strategyConfig as Record<string, unknown>).ENABLE;
  return enabled !== false;
};

export const isRuntimeTradeRecord = (
  value: unknown,
): value is RuntimeTradeRecord => {
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
    typeof record.qty === 'number' &&
    (record.direction === 'LONG' || record.direction === 'SHORT')
  );
};

export const loadRuntimeTrades = async (
  userName: string,
  {
    startTime,
    endTime,
  }: {
    startTime?: number;
    endTime?: number;
  } = {},
): Promise<RuntimeTradeRecord[]> => {
  const hasWindow =
    Number.isFinite(startTime) &&
    Number.isFinite(endTime) &&
    startTime != null &&
    endTime != null;
  const filterByWindow = (trade: RuntimeTradeRecord) =>
    !hasWindow ||
    (trade.entryTimestamp >= startTime! && trade.entryTimestamp <= endTime!);

  if (hasWindow) {
    const dayKeys = getRuntimeStorageDayKeys(startTime, endTime);
    const bucketTrades = (
      await Promise.all(
        dayKeys.map((dayKey) =>
          getHashJsonValues<RuntimeTradeRecord>(
            redisKeys.runtimeTradeBucket(userName, dayKey),
          ),
        ),
      )
    ).flat();

    const dedupedBucketTrades = new Map<string, RuntimeTradeRecord>();
    for (const trade of bucketTrades) {
      if (!isRuntimeTradeRecord(trade)) {
        continue;
      }
      dedupedBucketTrades.set(trade.orderId, trade);
    }

    const windowedTrades = [...dedupedBucketTrades.values()]
      .filter(filterByWindow)
      .sort((left, right) => left.entryTimestamp - right.entryTimestamp);

    return windowedTrades;
  }

  const tradePrefix = redisKeys.runtimeTrades(userName);
  const bucketPrefix = redisKeys.runtimeTradeBuckets(userName);
  const keys = (await getKeys(tradePrefix)).filter(
    (key) => !key.startsWith(bucketPrefix),
  );
  const trades = await Promise.all(keys.map((key) => getData(key, null)));

  return trades
    .filter(isRuntimeTradeRecord)
    .filter(filterByWindow)
    .sort((left, right) => left.entryTimestamp - right.entryTimestamp);
};

export const loadRuntimeClosedTrades = async (
  userName: string,
  {
    startTime,
    endTime,
  }: {
    startTime: number;
    endTime: number;
  },
): Promise<RuntimeTradeRecord[]> => {
  const dayKeys = getRuntimeStorageDayKeys(startTime, endTime);
  const trades = (
    await Promise.all(
      dayKeys.map((dayKey) =>
        getHashJsonValues<RuntimeTradeRecord>(
          redisKeys.runtimeClosedTradeBucket(userName, dayKey),
        ),
      ),
    )
  ).flat();
  const deduped = new Map<string, RuntimeTradeRecord>();

  for (const trade of trades) {
    if (
      !isRuntimeTradeRecord(trade) ||
      trade.status !== 'closed' ||
      !Number.isFinite(trade.exitTimestamp) ||
      trade.exitTimestamp! < startTime ||
      trade.exitTimestamp! >= endTime
    ) {
      continue;
    }
    deduped.set(trade.orderId, trade);
  }

  return [...deduped.values()].sort(
    (left, right) => left.exitTimestamp! - right.exitTimestamp!,
  );
};

/** Evidence includes retained positions that overlap the window, not just entries. */
export const loadRuntimeEvidenceTrades = async (
  userName: string,
  { startTime, endTime }: { startTime: number; endTime: number },
): Promise<RuntimeTradeRecord[]> => {
  const prefix = redisKeys.runtimeTradeBuckets(userName);
  const lastDay = getRuntimeStorageDayKey(endTime - 1);
  const keys = (await getKeys(prefix)).filter((key) => {
    const day = key.slice(prefix.length);
    return (
      key.startsWith(prefix) &&
      /^\d{4}-\d{2}-\d{2}$/.test(day) &&
      day <= lastDay
    );
  });
  const retained = new Map<string, RuntimeTradeRecord>();
  // Bound concurrent bucket reads; never fall back to unrelated unbucketed history.
  for (let offset = 0; offset < keys.length; offset += 16) {
    const buckets = await Promise.all(
      keys
        .slice(offset, offset + 16)
        .map((key) => getHashJsonValues<RuntimeTradeRecord>(key)),
    );
    for (const row of buckets.flat())
      if (isRuntimeTradeRecord(row)) retained.set(row.orderId, row);
  }
  // A closing-day bucket may outlive the entry-day bucket.
  for (const row of await loadRuntimeClosedTrades(userName, {
    startTime,
    endTime,
  }))
    retained.set(row.orderId, row);
  return [...retained.values()]
    .filter(
      (row) =>
        row.entryTimestamp < endTime &&
        (row.status === 'active' ||
          (Number.isFinite(row.exitTimestamp) &&
            row.exitTimestamp! >= startTime)),
    )
    .map((row) => {
      const closesAfterCutoff =
        row.status === 'closed' && row.exitTimestamp! >= endTime;
      if (
        !closesAfterCutoff &&
        !(row.status === 'active' && row.lastSyncedAt! >= endTime)
      )
        return row;
      // Later observations cannot supply historical marks, fees or a close at cutoff.
      return {
        ...row,
        status: 'active' as const,
        currentPrice: null,
        currentPnl: null,
        closedPnl: null,
        exitPrice: null,
        actualExitPrice: null,
        exitTimestamp: null,
        exitType: null,
        closeFee: null,
        fundingFee: null,
        totalFee: null,
        lastSyncedAt: undefined,
      };
    })
    .sort((a, b) => a.entryTimestamp - b.entryTimestamp);
};

export const loadRuntimeActiveTradeOrderIds = async (
  userName: string,
): Promise<Set<string>> => {
  const keys = await getKeys(redisKeys.runtimeActiveTrades(userName));
  const refs = await Promise.all(keys.map((key) => getData(key, null)));

  return new Set(
    refs
      .map((ref) =>
        ref &&
        typeof ref === 'object' &&
        'orderId' in ref &&
        typeof ref.orderId === 'string' &&
        ref.orderId.trim()
          ? ref.orderId.trim()
          : null,
      )
      .filter((orderId): orderId is string => orderId != null),
  );
};

export const loadRuntimeActiveTrades = async (
  userName: string,
): Promise<RuntimeTradeRecord[]> => {
  const orderIds = await loadRuntimeActiveTradeOrderIds(userName);
  const trades = await Promise.all(
    [...orderIds].map((orderId) =>
      getData(redisKeys.runtimeTrade(userName, orderId), null),
    ),
  );

  return trades.filter(
    (trade): trade is RuntimeTradeRecord =>
      isRuntimeTradeRecord(trade) && trade.status === 'active',
  );
};

export const loadStrategyResultSymbols = async ({
  userName,
  strategy,
}: {
  userName: string;
  strategy: string;
}): Promise<string[]> => {
  const results = (await getData(
    redisKeys.strategyResults(userName, strategy),
    {},
  )) as StrategyResults;

  return Object.keys(results ?? {}).sort((left, right) =>
    left.localeCompare(right),
  );
};
