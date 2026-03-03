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

const toResultString = (result: unknown): string | null => {
  if (result == null) return null;
  if (typeof result === 'string') return result;
  if (Buffer.isBuffer(result)) return result.toString('utf8');
  return String(result);
};

interface Options {
  expire?: number; // TTL в секундах
}

interface DelKeyOptions {
  raiseOnMisconf?: boolean;
}

const DEFAULT_OPTIONS: Options = {
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
    const rawJson = await redis.call('JSON.GET', key);
    const raw = toResultString(rawJson);
    if (raw == null) return fallback;

    try {
      return JSON.parse(raw);
    } catch (e) {
      logger.log('error', 'failed JSON.parse(%s): %s', key, String(e));
      await redis.del(key);
      return fallback;
    }
  } catch (e) {
    logger.log(
      'error',
      'failed JSON.GET %s: %s (fallback to GET)',
      key,
      String(e),
    );
  }

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

export const delKey = async (key: string): Promise<boolean> => {
  return delKeyWithOptions(key);
};

export class RedisWriteBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RedisWriteBlockedError';
  }
}

export const delKeyWithOptions = async (
  key: string,
  options: DelKeyOptions = {},
): Promise<boolean> => {
  const { raiseOnMisconf = false } = options;
  const redis = getRedis();

  try {
    const result = await redis.del(key);

    if (result === 1) {
      return true;
    }

    return false;
  } catch (e) {
    const msg = String(e);
    if (raiseOnMisconf && msg.includes('MISCONF')) {
      throw new RedisWriteBlockedError(msg);
    }
    logger.log('error', 'failed DEL %s: %s', key, String(e));
    return false;
  }
};

export const setData = async <T>(
  key: string,
  data: T,
  options: Options = {},
): Promise<void> => {
  const { expire } = { ...DEFAULT_OPTIONS, ...options };
  const redis = getRedis();
  const value = toJson(data);

  try {
    await redis.call('JSON.SET', key, '$', value);
    if (expire) {
      await redis.expire(key, expire);
    }
  } catch (e) {
    logger.log(
      'error',
      'failed JSON.SET %s: %s (fallback to SET)',
      key,
      String(e),
    );
    try {
      if (expire) {
        await redis.set(key, value, 'EX', expire);
      } else {
        await redis.set(key, value);
      }
    } catch (e2) {
      logger.log('error', 'failed SET %s: %s', key, String(e2));
    }
  }
};

export const redisKeys = {
  users: () => 'users:index:',
  user: (userName: string) => `users:index:${userName}`,
  bots: (userName: string) => `users:${userName}:bots`,
  botsPrefix: () => 'users:',
  bot: (userName: string, botId: string) => `users:${userName}:bots:${botId}`,
  backtestConfig: (userName: string, config: string) =>
    `users:${userName}:backtests:configs:${config}`,
  strategies: (userName: string) => `users:${userName}:strategies`,
  strategyConfig: (userName: string, strategyName: string) =>
    `users:${userName}:strategies:${strategyName}:config`,
  strategyResults: (userName: string, strategyName: string) =>
    `users:${userName}:strategies:${strategyName}:results`,
  tests: (userName: string, strategyName?: string) =>
    strategyName
      ? `users:${userName}:tests:${strategyName}`
      : `users:${userName}:tests:`,
  testOrders: (userName: string, strategyName: string, testName: string) =>
    `users:${userName}:tests:${strategyName}:${testName}:orders`,
  testConfig: (userName: string, strategyName: string, testName: string) =>
    `users:${userName}:tests:${strategyName}:${testName}:config`,
  testStat: (userName: string, strategyName: string, testName: string) =>
    `users:${userName}:tests:${strategyName}:${testName}:stat`,
  cacheChunk: (userName: string, chunkId: string) =>
    `users:${userName}:cache:tests:chunks:${chunkId}`,
  cacheOrders: (userName: string, orderLogId: string) =>
    `users:${userName}:cache:tests:orders:${orderLogId}`,
  cachePositions: (userName: string, orderLogId: string) =>
    `users:${userName}:cache:tests:positions:${orderLogId}`,
  signal: (symbol: string, signalId: string) => `signals:${symbol}:${signalId}`,
  signalsBySymbol: (symbol: string) => `signals:${symbol}:`,
  storeSignal: (symbol: string, signalId: string) =>
    `store:signals:${symbol}:${signalId}`,
  analysis: (symbol: string, signalId: string) =>
    `analysis:${symbol}:${signalId}`,
  backtestResults: (userName: string, config: string, timestamp: string) =>
    `users:${userName}:backtests:results:${config}:${timestamp}`,
  mlSignalsByStrategy: (strategyName: string) => `ml:${strategyName}:signals:`,
  mlSignals: () => 'ml:',
  mlSignal: (strategyName: string, signalId: string) =>
    `ml:${strategyName}:signals:${signalId}`,
  mlResultsByStrategy: (strategyName: string) => `ml:${strategyName}:results:`,
  mlResults: () => 'ml:',
  mlResult: (strategyName: string, signalId: string) =>
    `ml:${strategyName}:results:${signalId}`,
};
