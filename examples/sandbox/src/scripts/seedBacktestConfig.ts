import Redis from 'ioredis';
import {
  SANDBOX_E2E_ACCOUNT,
  SANDBOX_E2E_BACKTEST_CONFIG,
  SANDBOX_E2E_CONNECTOR_PROVIDER,
  SANDBOX_E2E_DEPLOYMENT,
  SANDBOX_E2E_GRID_CONFIG,
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
    const runtimeSignalBucketPrefix = `users:${SANDBOX_E2E_USER}:runtime:signals:days:*`;
    const runtimeSignalEvaluationBucketPrefix = `users:${SANDBOX_E2E_USER}:runtime:signal-evaluations:days:*`;
    const runtimeSignalStatsBucketPrefix = `users:${SANDBOX_E2E_USER}:runtime:signal-evaluation-stats:days:*`;
    const storeSignalPrefix = `store:signals:${SANDBOX_E2E_SYMBOL}:*`;
    const analysisPrefix = `analysis:${SANDBOX_E2E_SYMBOL}:*`;
    const runtimeDeploymentPrefix = `users:${SANDBOX_E2E_USER}:runtime:deployments:${SANDBOX_E2E_DEPLOYMENT}*`;
    const legacyRuntimeStrategyPrefix = `users:${SANDBOX_E2E_USER}:strategies:*`;
    const runtimeControlEventPrefix = `users:${SANDBOX_E2E_USER}:runtime:strategy-control-events:*`;

    const deletedTests = await deleteByPattern(strategyPrefix);
    const deletedCache = await deleteByPattern(cachePrefix);
    const deletedResults = await deleteByPattern(resultsPrefix);
    const deletedRuntimeSignalBuckets = await deleteByPattern(
      runtimeSignalBucketPrefix,
    );
    const deletedRuntimeSignalEvaluationBuckets = await deleteByPattern(
      runtimeSignalEvaluationBucketPrefix,
    );
    const deletedRuntimeSignalStatsBuckets = await deleteByPattern(
      runtimeSignalStatsBucketPrefix,
    );
    const deletedStoreSignals = await deleteByPattern(storeSignalPrefix);
    const deletedAnalyses = await deleteByPattern(analysisPrefix);
    const deletedRuntimeDeployments = await deleteByPattern(
      runtimeDeploymentPrefix,
    );
    const deletedLegacyRuntimeStrategies = await deleteByPattern(
      legacyRuntimeStrategyPrefix,
    );
    const deletedRuntimeControlEvents = await deleteByPattern(
      runtimeControlEventPrefix,
    );

    const backtestConfigKey = `users:${SANDBOX_E2E_USER}:backtests:configs:${SANDBOX_E2E_BACKTEST_CONFIG}`;
    const tradingAccountKey = `users:${SANDBOX_E2E_USER}:trading-accounts:${SANDBOX_E2E_ACCOUNT}`;
    await setRedisJson(backtestConfigKey, SANDBOX_E2E_GRID_CONFIG);
    await setRedisJson(tradingAccountKey, {
      id: SANDBOX_E2E_ACCOUNT,
      label: 'Sandbox account',
      provider: SANDBOX_E2E_CONNECTOR_PROVIDER,
      enabled: true,
      isDefault: true,
      universes: ['crypto'],
      environment: 'testnet',
      readOnly: true,
    });

    console.log(
      [
        `Prepared backtest config: ${backtestConfigKey}`,
        `Prepared sandbox trading account: ${tradingAccountKey}`,
        `Deleted tests keys: ${deletedTests}`,
        `Deleted cache keys: ${deletedCache}`,
        `Deleted backtest result keys: ${deletedResults}`,
        `Deleted runtime signal bucket keys: ${deletedRuntimeSignalBuckets}`,
        `Deleted runtime signal evaluation bucket keys: ${deletedRuntimeSignalEvaluationBuckets}`,
        `Deleted runtime signal stats bucket keys: ${deletedRuntimeSignalStatsBuckets}`,
        `Deleted store signal keys: ${deletedStoreSignals}`,
        `Deleted analysis keys: ${deletedAnalyses}`,
        `Deleted runtime deployment keys: ${deletedRuntimeDeployments}`,
        `Deleted legacy runtime strategy keys: ${deletedLegacyRuntimeStrategies}`,
        `Deleted runtime control events: ${deletedRuntimeControlEvents}`,
      ].join('\n'),
    );
  } finally {
    await redis.quit();
  }
};

void run();
