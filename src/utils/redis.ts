import Redis from 'ioredis';
import { logger } from '@utils/logger';
import { toJson } from '@utils/toJson';
import { TTL_1D } from '@constants';

declare global {
  // предотвращаем множественные коннекты при HMR в Next.js
  // eslint-disable-next-line no-var
  var __redis__: Redis | undefined;
}

const getRedis = () => {
  if (!global.__redis__) {
    global.__redis__ = new Redis({
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT ?? 6379),
    });
  }
  return global.__redis__;
};

interface Options {
  stringify?: boolean; // форматированный JSON
  expire?: number; // TTL в секундах
}

const DEFAULT_OPTIONS: Options = {
  stringify: false,
  expire: TTL_1D,
};

export const getKeys = async (prefix: string): Promise<string[]> => {
  const redis = getRedis();
  const keys: string[] = [];

  let cursor = '0';
  do {
    const [nextCursor, batch] = await redis.scan(
      cursor,
      'MATCH',
      `${prefix}*`,
      'COUNT',
      '200',
    );
    cursor = nextCursor;
    for (const key of batch) {
      if (key.startsWith(prefix)) {
        keys.push(key);
      }
    }
  } while (cursor !== '0');

  return keys;
};

export const getData = async (
  key: string,
  fallback: any = [],
): Promise<any> => {
  const redis = getRedis();

  try {
    const raw = await redis.get(key);
    if (raw == null) return fallback;

    try {
      return JSON.parse(raw);
    } catch (e) {
      logger.log('error', 'failed JSON.parse(%s): %s', key, String(e));
      await redis.del(key);
      return fallback;
    }
  } catch (e) {
    logger.log('error', 'failed GET %s: %s', key, String(e));
    return fallback;
  }
};

export const deleteData = async (key: string): Promise<boolean> => {
  const redis = getRedis();

  try {
    const result = await redis.del(key);

    if (result === 1) {
      return true;
    }

    return false;
  } catch (e) {
    logger.log('error', 'failed DEL %s: %s', key, String(e));
    return false;
  }
};

export const setData = async <T>(
  key: string,
  data: T,
  options: Options = {},
): Promise<void> => {
  const { stringify, expire } = { ...DEFAULT_OPTIONS, ...options };
  const redis = getRedis();
  const value = toJson(data, stringify);

  try {
    if (expire) {
      await redis.set(key, value, 'EX', expire);
    } else {
      await redis.set(key, value);
    }
  } catch (e) {
    logger.log('error', 'failed SET %s: %s', key, String(e));
  }
};

export const redisKeys = {
  bots: () => 'bots:',
  bot: (userName: string) => `bots:${userName}`,
  backtests: () => 'backtests:',
  backtest: (userName: string) => `backtests:${userName}`,
  users: () => 'users:',
  user: (userName: string) => `users:${userName}`,
  tests: () => 'tests:',
  testOrders: (userName: string, testName: string) =>
    `tests:${userName}:${testName}:orders`,
  testConfig: (userName: string, testName: string) =>
    `tests:${userName}:${testName}:config`,
  testStat: (userName: string, testName: string) =>
    `tests:${userName}:${testName}:stat`,
  cacheChunk: (chunkId: string) => `cache:tests:chunks:${chunkId}`,
  cacheOrders: (orderLogId: string) => `cache:tests:orders:${orderLogId}`,
  cachePositions: (orderLogId: string) => `cache:tests:positions:${orderLogId}`,
  signal: (symbol: string, signalId: string) => `signals:${symbol}:${signalId}`,
  signalsBySymbol: (symbol: string) => `signals:${symbol}:`,
};
