import type { StrategyConfig, StrategyResults } from '@tradejs/types';
import { getData, getKeys, redisKeys, setData } from './redis';

export interface RuntimeStrategyConfigRecord {
  key: string;
  strategyName: string;
  configId: string;
  strategyConfig: StrategyConfig;
}

const RESERVED_STRATEGY_NAMES = new Set(['charts']);
const RESERVED_CONFIG_IDS = new Set(['results']);

const isStrategyConfig = (value: unknown): value is StrategyConfig =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

export const resolveStrategyConfigIdentityByKey = (
  userName: string,
  key: string,
): { strategyName: string; configId: string } | null => {
  const parts = key.split(':');
  if (parts.length !== 5) return null;

  const [users, keyUserName, strategiesKey, strategyName, configId] = parts;
  if (
    users !== 'users' ||
    keyUserName !== userName ||
    strategiesKey !== 'strategies' ||
    !strategyName ||
    !configId ||
    RESERVED_STRATEGY_NAMES.has(strategyName) ||
    RESERVED_CONFIG_IDS.has(configId) ||
    !/^[a-zA-Z0-9_-]+$/.test(configId)
  ) {
    return null;
  }

  return { strategyName, configId };
};

export const resolveStrategyNameByConfigKey = (
  userName: string,
  key: string,
): string | null =>
  resolveStrategyConfigIdentityByKey(userName, key)?.strategyName ?? null;

export const getRuntimeStrategyConfigKeys = async (
  userName: string,
): Promise<string[]> => {
  const keys = await getKeys(`${redisKeys.strategies(userName)}:`);
  return keys
    .filter((key) => resolveStrategyConfigIdentityByKey(userName, key))
    .sort((left, right) => left.localeCompare(right));
};

export const loadRuntimeStrategyConfigs = async (
  userName: string,
  {
    onInvalidConfig,
  }: {
    onInvalidConfig?: (key: string) => void;
  } = {},
): Promise<RuntimeStrategyConfigRecord[]> => {
  const configKeys = await getRuntimeStrategyConfigKeys(userName);
  const records = await Promise.all(
    configKeys.map(async (key): Promise<RuntimeStrategyConfigRecord | null> => {
      const identity = resolveStrategyConfigIdentityByKey(userName, key);
      if (!identity) return null;

      const strategyConfig = await getData(key, null);
      if (!isStrategyConfig(strategyConfig)) {
        onInvalidConfig?.(key);
        return null;
      }

      return { key, ...identity, strategyConfig };
    }),
  );

  return records.filter(
    (record): record is RuntimeStrategyConfigRecord => record != null,
  );
};

export const loadRuntimeStrategyNames = async (
  userName: string,
): Promise<string[]> =>
  [
    ...new Set(
      (await getRuntimeStrategyConfigKeys(userName))
        .map(
          (key) =>
            resolveStrategyConfigIdentityByKey(userName, key)?.strategyName,
        )
        .filter((strategyName): strategyName is string =>
          Boolean(strategyName),
        ),
    ),
  ].sort((left, right) => left.localeCompare(right));

export const getRuntimeStrategyConfig = async (
  userName: string,
  strategyName: string,
  configId = 'config',
): Promise<StrategyConfig | null> => {
  const value = await getData(
    redisKeys.strategyConfig(userName, strategyName, configId),
    null,
  );
  return isStrategyConfig(value) ? value : null;
};

export const saveRuntimeStrategyConfig = async ({
  userName,
  strategyName,
  configId,
  strategyConfig,
}: {
  userName: string;
  strategyName: string;
  configId: string;
  strategyConfig: StrategyConfig;
}): Promise<RuntimeStrategyConfigRecord> => {
  const key = redisKeys.strategyConfig(userName, strategyName, configId);
  await setData(key, strategyConfig, { expire: 0 });
  return { key, strategyName, configId, strategyConfig };
};

export const getRuntimeStrategyResultConfig = async (
  userName: string,
  strategyName: string,
  symbol: string,
): Promise<StrategyConfig | null> => {
  const results = (await getData(
    redisKeys.strategyResults(userName, strategyName),
    null,
  )) as StrategyResults | null;
  const config = results?.[symbol]?.config;
  return isStrategyConfig(config) ? config : null;
};
