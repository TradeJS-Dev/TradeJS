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
    for (const k of batch) {
      if (k.startsWith(prefix)) {
        keys.push(k.slice(prefix.length));
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
