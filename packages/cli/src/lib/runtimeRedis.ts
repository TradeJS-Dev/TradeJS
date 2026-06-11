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

export type RuntimeStrategyConfigRecord = {
  key: string;
  strategyName: string;
  strategyConfig: StrategyConfig;
};

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

export const resolveStrategyNameByConfigKey = (
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

export const getRuntimeStrategyConfigKeys = async (
  userName: string,
): Promise<string[]> => {
  const keys = await getKeys(`${redisKeys.strategies(userName)}:`);
  return keys
    .filter((key) => key.endsWith(':config'))
    .sort((left, right) => left.localeCompare(right));
};

export const loadRuntimeStrategyNames = async (
  userName: string,
): Promise<string[]> =>
  (await getRuntimeStrategyConfigKeys(userName))
    .map((key) => resolveStrategyNameByConfigKey(userName, key))
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right));

export const loadRuntimeStrategyConfigs = async (
  userName: string,
  {
    onInvalidConfig,
  }: {
    onInvalidConfig?: (key: string) => void;
  } = {},
): Promise<RuntimeStrategyConfigRecord[]> => {
  const configKeys = await getRuntimeStrategyConfigKeys(userName);
  const strategyConfigs = await Promise.all(
    configKeys.map(async (key): Promise<RuntimeStrategyConfigRecord | null> => {
      const strategyName = resolveStrategyNameByConfigKey(userName, key);
      if (!strategyName) {
        return null;
      }

      const strategyConfig = (await getData(
        key,
        null,
      )) as StrategyConfig | null;
      if (
        !strategyConfig ||
        typeof strategyConfig !== 'object' ||
        Array.isArray(strategyConfig)
      ) {
        onInvalidConfig?.(key);
        return null;
      }

      return {
        key,
        strategyName,
        strategyConfig,
      };
    }),
  );

  return strategyConfigs.filter(Boolean) as RuntimeStrategyConfigRecord[];
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
