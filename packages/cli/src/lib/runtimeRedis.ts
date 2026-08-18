import {
  getData,
  getHashJsonValues,
  getKeys,
  redisKeys,
} from '@tradejs/infra/redis';
import { getRuntimeStorageDayKeys } from '@tradejs/core/time';
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

    if (windowedTrades.length > 0 || dayKeys.length === 0) {
      return windowedTrades;
    }
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
