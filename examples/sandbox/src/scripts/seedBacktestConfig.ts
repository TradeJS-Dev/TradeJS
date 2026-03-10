import Redis from 'ioredis';
import {
  SANDBOX_E2E_BACKTEST_CONFIG,
  SANDBOX_E2E_GRID_CONFIG,
  SANDBOX_E2E_STRATEGY_CONFIG,
  SANDBOX_E2E_SYMBOL,
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

const setRedisJson = async (key: string, payload: unknown): Promise<void> => {
  await redis.del(key);
  try {
    await redis.call('JSON.SET', key, '$', JSON.stringify(payload));
  } catch {
    await redis.set(key, JSON.stringify(payload));
  }
};

const run = async () => {
  try {
    const strategyPrefix = `users:${SANDBOX_E2E_USER}:tests:${SANDBOX_E2E_STRATEGY}:*`;
    const cachePrefix = `users:${SANDBOX_E2E_USER}:cache:tests:*`;
    const resultsPrefix = `users:${SANDBOX_E2E_USER}:backtests:results:${SANDBOX_E2E_BACKTEST_CONFIG}:*`;
    const runtimeSignalPrefix = `signals:${SANDBOX_E2E_SYMBOL}:*`;
    const storeSignalPrefix = `store:signals:${SANDBOX_E2E_SYMBOL}:*`;
    const analysisPrefix = `analysis:${SANDBOX_E2E_SYMBOL}:*`;

    const deletedTests = await deleteByPattern(strategyPrefix);
    const deletedCache = await deleteByPattern(cachePrefix);
    const deletedResults = await deleteByPattern(resultsPrefix);
    const deletedRuntimeSignals = await deleteByPattern(runtimeSignalPrefix);
    const deletedStoreSignals = await deleteByPattern(storeSignalPrefix);
    const deletedAnalyses = await deleteByPattern(analysisPrefix);

    const backtestConfigKey = `users:${SANDBOX_E2E_USER}:backtests:configs:${SANDBOX_E2E_BACKTEST_CONFIG}`;
    const strategyConfigKey = `users:${SANDBOX_E2E_USER}:strategies:${SANDBOX_E2E_STRATEGY}:config`;
    await setRedisJson(backtestConfigKey, SANDBOX_E2E_GRID_CONFIG);
    await setRedisJson(strategyConfigKey, SANDBOX_E2E_STRATEGY_CONFIG);

    console.log(
      [
        `Prepared backtest config: ${backtestConfigKey}`,
        `Prepared strategy config: ${strategyConfigKey}`,
        `Deleted tests keys: ${deletedTests}`,
        `Deleted cache keys: ${deletedCache}`,
        `Deleted backtest result keys: ${deletedResults}`,
        `Deleted runtime signal keys: ${deletedRuntimeSignals}`,
        `Deleted store signal keys: ${deletedStoreSignals}`,
        `Deleted analysis keys: ${deletedAnalyses}`,
      ].join('\n'),
    );
  } finally {
    await redis.quit();
  }
};

void run();
