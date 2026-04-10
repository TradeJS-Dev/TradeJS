import Redis from 'ioredis';

const TTL_1D = 86_400;

const toJson = (value: unknown): string => JSON.stringify(value);

const logger = {
  log: (level: string, message: string, ...args: unknown[]) => {
    const method =
      level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    (console as any)[method](`[infra:redis] ${message}`, ...args);
  },
};

declare global {
  // предотвращаем множественные коннекты при HMR в Next.js
  // eslint-disable-next-line no-var
  var __redis__: Redis | undefined;
}

let redisConnectionWarningShown = false;
let redisUnavailable = false;

const isRedisConnectivityError = (error: Error): boolean =>
  /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|MaxRetriesPerRequestError|Connection is closed|Stream isn't writeable/i.test(
    error.message,
  );

const toNonNegativeInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const toPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const markRedisUnavailable = (error: Error) => {
  redisUnavailable = true;
  if (redisConnectionWarningShown) return;
  redisConnectionWarningShown = true;
  logger.log(
    'warn',
    'Redis is unavailable: %s. Cache-dependent features are temporarily disabled.',
    error.message,
  );
};

const getRedis = () => {
  if (!global.__redis__) {
    const host = process.env.REDIS_HOST || '127.0.0.1';
    const port = toPositiveInt(process.env.REDIS_PORT, 6379);
    const connectTimeout = toPositiveInt(
      process.env.REDIS_CONNECT_TIMEOUT_MS,
      3_000,
    );
    const maxRetriesPerRequest = toNonNegativeInt(
      process.env.REDIS_MAX_RETRIES_PER_REQUEST,
      1,
    );

    global.__redis__ = new Redis({
      host,
      port,
      connectTimeout,
      maxRetriesPerRequest,
      enableOfflineQueue: false,
      retryStrategy: (attempt) => Math.min(attempt * 200, 2_000),
    });
    global.__redis__.on('error', (error: Error) => {
      if (isRedisConnectivityError(error)) {
        markRedisUnavailable(error);
        return;
      }

      logger.log('error', 'Redis client error: %s', String(error));
    });
    global.__redis__.on('ready', () => {
      redisUnavailable = false;
      if (redisConnectionWarningShown) {
        redisConnectionWarningShown = false;
        logger.log('info', 'Redis connection restored');
      }
    });
  }
  return global.__redis__;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getRedisStatus = (redis: Redis): string =>
  String((redis as unknown as { status?: unknown }).status ?? 'ready');

const waitForRedisReady = async (redis: Redis): Promise<boolean> => {
  if (getRedisStatus(redis) === 'ready') {
    return true;
  }

  const readyTimeoutMs = toPositiveInt(
    process.env.REDIS_READY_TIMEOUT_MS,
    toPositiveInt(process.env.REDIS_CONNECT_TIMEOUT_MS, 3_000),
  );
  const startedAt = Date.now();

  while (Date.now() - startedAt < readyTimeoutMs) {
    if (getRedisStatus(redis) === 'ready') {
      return true;
    }

    if (getRedisStatus(redis) === 'end') {
      return false;
    }

    await sleep(50);
  }

  return getRedisStatus(redis) === 'ready';
};

const getReadyRedis = async (): Promise<Redis | null> => {
  if (redisUnavailable) return null;

  const redis = getRedis();
  const ready = await waitForRedisReady(redis);
  if (ready) {
    return redis;
  }

  markRedisUnavailable(
    new Error(`Redis is not ready (status=${getRedisStatus(redis)})`),
  );
  return null;
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

const parseJsonOrDeleteKey = async (
  redis: Redis,
  key: string,
  raw: string,
  fallback: any,
) => {
  try {
    return JSON.parse(raw);
  } catch (e) {
    logger.log('error', 'failed JSON.parse(%s): %s', key, String(e));
    await redis.del(key);
    return fallback;
  }
};

export const getKeys = async (prefix: string): Promise<string[]> => {
  if (redisUnavailable) return [];

  const redis = await getReadyRedis();
  if (!redis) return [];
  const keys: string[] = [];

  try {
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
  } catch (e) {
    if (e instanceof Error && isRedisConnectivityError(e)) {
      markRedisUnavailable(e);
      return [];
    }
    logger.log('warn', 'failed SCAN for %s: %s', prefix, String(e));
    return [];
  }

  return keys;
};

export const getData = async (
  key: string,
  fallback: any = [],
): Promise<any> => {
  if (redisUnavailable) return fallback;

  const redis = await getReadyRedis();
  if (!redis) return fallback;

  try {
    const rawJson = await redis.call('JSON.GET', key);
    const raw = toResultString(rawJson);
    if (raw == null) return fallback;
    return parseJsonOrDeleteKey(redis, key, raw, fallback);
  } catch (e) {
    if (e instanceof Error && isRedisConnectivityError(e)) {
      markRedisUnavailable(e);
      return fallback;
    }
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
    return parseJsonOrDeleteKey(redis, key, raw, fallback);
  } catch (e) {
    if (e instanceof Error && isRedisConnectivityError(e)) {
      markRedisUnavailable(e);
      return fallback;
    }
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
  if (redisUnavailable) return false;

  const { raiseOnMisconf = false } = options;
  const redis = await getReadyRedis();
  if (!redis) return false;

  try {
    const result = await redis.del(key);

    if (result === 1) {
      return true;
    }

    return false;
  } catch (e) {
    if (e instanceof Error && isRedisConnectivityError(e)) {
      markRedisUnavailable(e);
      return false;
    }
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
  if (redisUnavailable) return;

  const { expire } = { ...DEFAULT_OPTIONS, ...options };
  const redis = await getReadyRedis();
  if (!redis) return;
  const value = toJson(data);

  try {
    await redis.call('JSON.SET', key, '$', value);
    if (expire) {
      await redis.expire(key, expire);
    }
  } catch (e) {
    if (e instanceof Error && isRedisConnectivityError(e)) {
      markRedisUnavailable(e);
      return;
    }
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
      if (e2 instanceof Error && isRedisConnectivityError(e2)) {
        markRedisUnavailable(e2);
        return;
      }
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
