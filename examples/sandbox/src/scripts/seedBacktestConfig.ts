import Redis from 'ioredis';
import {
  SANDBOX_E2E_BACKTEST_CONFIG,
  SANDBOX_E2E_GRID_CONFIG,
  SANDBOX_E2E_STRATEGY,
  SANDBOX_E2E_USER,
} from './e2eConfig';

const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
});

const scanKeys = async (pattern: string): Promise<string[]> => {
  const result: string[] = [];
  let cursor = '0';

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      'MATCH',
      pattern,
      'COUNT',
      '500',
    );
    cursor = nextCursor;
    if (keys.length) {
      result.push(...keys);
    }
  } while (cursor !== '0');

  return result;
};

const deleteByPattern = async (pattern: string): Promise<number> => {
  const keys = await scanKeys(pattern);
  if (!keys.length) {
    return 0;
  }

  let deleted = 0;
  for (const chunk of chunkArray(keys, 200)) {
    deleted += await redis.del(...chunk);
  }

  return deleted;
};

const chunkArray = <T>(list: T[], chunkSize: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < list.length; index += chunkSize) {
    chunks.push(list.slice(index, index + chunkSize));
  }
  return chunks;
};

const run = async () => {
  try {
    const strategyPrefix = `users:${SANDBOX_E2E_USER}:tests:${SANDBOX_E2E_STRATEGY}:*`;
    const cachePrefix = `users:${SANDBOX_E2E_USER}:cache:tests:*`;
    const resultsPrefix = `users:${SANDBOX_E2E_USER}:backtests:results:${SANDBOX_E2E_BACKTEST_CONFIG}:*`;

    const deletedTests = await deleteByPattern(strategyPrefix);
    const deletedCache = await deleteByPattern(cachePrefix);
    const deletedResults = await deleteByPattern(resultsPrefix);

    const backtestConfigKey = `users:${SANDBOX_E2E_USER}:backtests:configs:${SANDBOX_E2E_BACKTEST_CONFIG}`;
    await redis.del(backtestConfigKey);

    try {
      await redis.call(
        'JSON.SET',
        backtestConfigKey,
        '$',
        JSON.stringify(SANDBOX_E2E_GRID_CONFIG),
      );
    } catch {
      await redis.set(
        backtestConfigKey,
        JSON.stringify(SANDBOX_E2E_GRID_CONFIG),
      );
    }

    console.log(
      [
        `Prepared backtest config: ${backtestConfigKey}`,
        `Deleted tests keys: ${deletedTests}`,
        `Deleted cache keys: ${deletedCache}`,
        `Deleted backtest result keys: ${deletedResults}`,
      ].join('\n'),
    );
  } finally {
    await redis.quit();
  }
};

void run();
