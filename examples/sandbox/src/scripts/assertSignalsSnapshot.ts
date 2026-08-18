import Redis from 'ioredis';
import {
  SANDBOX_E2E_ACCOUNT,
  SANDBOX_E2E_CONNECTOR_PROVIDER,
  SANDBOX_E2E_DEPLOYMENT,
  SANDBOX_E2E_SIGNALS_EXPECTED,
  SANDBOX_E2E_STRATEGY,
  SANDBOX_E2E_SYMBOL,
  SANDBOX_E2E_USER,
} from './e2eConfig';

type SignalPayload = {
  signalId?: string;
  symbol?: string;
  strategy?: string;
  direction?: string;
  interval?: string;
  timestamp?: number;
  prices?: {
    currentPrice?: number;
    takeProfitPrice?: number;
    stopLossPrice?: number;
    riskRatio?: number;
  };
};

type SignalBucketRef = {
  signalId?: string;
  symbol?: string;
  strategy?: string;
  timestamp?: number;
};

type RuntimeDeploymentSnapshot = {
  id?: string;
  connectorName?: string;
  provider?: string;
  accountId?: string;
  strategies?: Array<Record<string, unknown>>;
};

type RuntimeReleaseSnapshot = {
  strategyName?: string;
  releaseVersion?: number;
  config?: Record<string, unknown>;
  strategyPackage?: string;
  strategyPackageVersion?: string;
  runtimePackageVersion?: string;
};

type TradingAccountSnapshot = {
  id?: string;
  provider?: string;
  enabled?: boolean;
  universes?: string[];
  apiKey?: string;
  apiSecret?: string;
};

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

const parseJson = <T>(value: string | null): T | null => {
  if (!value) {
    return null;
  }

  return JSON.parse(value) as T;
};

const readRedisJson = async <T>(key: string): Promise<T | null> => {
  try {
    const jsonRaw = (await redis.call('JSON.GET', key, '$')) as string | null;
    if (!jsonRaw) {
      return null;
    }

    const parsed = JSON.parse(jsonRaw) as unknown;
    if (Array.isArray(parsed)) {
      return (parsed[0] ?? null) as T | null;
    }

    return parsed as T;
  } catch {
    const fallbackRaw = await redis.get(key);
    return parseJson<T>(fallbackRaw);
  }
};

const readRedisHashJsonValues = async <T>(key: string): Promise<T[]> => {
  const raw = (await redis.call('HGETALL', key)) as
    | Record<string, string>
    | string[]
    | null;

  if (!raw) {
    return [];
  }

  const entries = Array.isArray(raw)
    ? raw.reduce<Record<string, string>>((acc, value, index, list) => {
        if (index % 2 === 0 && list[index + 1] != null) {
          acc[String(value)] = String(list[index + 1]);
        }
        return acc;
      }, {})
    : raw;

  return Object.values(entries).map((value) => JSON.parse(value) as T);
};

const assertEqual = (
  label: string,
  actual: unknown,
  expected: unknown,
): void => {
  if (actual !== expected) {
    throw new Error(
      `${label} mismatch. expected=${String(expected)}, actual=${String(actual)}`,
    );
  }
};

const assertTrue = (label: string, condition: boolean): void => {
  if (!condition) {
    throw new Error(`${label} check failed`);
  }
};

const run = async () => {
  try {
    const runtimeSignalBucketKeys = await scanKeys(
      `users:${SANDBOX_E2E_USER}:runtime:signals:days:*`,
    );
    const storeSignalKeys = await scanKeys(
      `store:signals:${SANDBOX_E2E_SYMBOL}:*`,
    );
    const deployment = await readRedisJson<RuntimeDeploymentSnapshot>(
      `users:${SANDBOX_E2E_USER}:runtime:deployments:${SANDBOX_E2E_DEPLOYMENT}`,
    );
    const release = await readRedisJson<RuntimeReleaseSnapshot>(
      `users:${SANDBOX_E2E_USER}:strategies:${SANDBOX_E2E_STRATEGY}:releases:1`,
    );
    const tradingAccount = await readRedisJson<TradingAccountSnapshot>(
      `users:${SANDBOX_E2E_USER}:trading-accounts:${SANDBOX_E2E_ACCOUNT}`,
    );

    if (!deployment || !release || !tradingAccount) {
      throw new Error(
        'Missing canonical runtime deployment, release, or trading account',
      );
    }
    assertEqual('trading account id', tradingAccount.id, SANDBOX_E2E_ACCOUNT);
    assertEqual(
      'trading account provider',
      tradingAccount.provider,
      SANDBOX_E2E_CONNECTOR_PROVIDER,
    );
    assertEqual('trading account enabled', tradingAccount.enabled, true);
    assertEqual(
      'trading account universes',
      tradingAccount.universes?.join(','),
      'crypto',
    );
    assertTrue(
      'sandbox trading account is secret-free',
      !tradingAccount.apiKey && !tradingAccount.apiSecret,
    );
    assertEqual('deployment id', deployment.id, SANDBOX_E2E_DEPLOYMENT);
    assertEqual(
      'deployment connector',
      deployment.connectorName,
      SANDBOX_E2E_CONNECTOR_PROVIDER,
    );
    assertEqual(
      'deployment provider',
      deployment.provider,
      SANDBOX_E2E_CONNECTOR_PROVIDER,
    );
    assertEqual(
      'deployment account',
      deployment.accountId,
      SANDBOX_E2E_ACCOUNT,
    );
    assertEqual(
      'deployment strategies count',
      deployment.strategies?.length,
      1,
    );
    assertEqual(
      'deployment strategy fields',
      Object.keys(deployment.strategies?.[0] ?? {})
        .sort()
        .join(','),
      'controlState,releaseVersion,strategyName',
    );
    assertEqual(
      'deployment strategy control state',
      deployment.strategies?.[0]?.controlState,
      'active',
    );
    assertTrue(
      'deployment has no release-owned config',
      !Object.hasOwn(deployment, 'interval') &&
        !Object.hasOwn(deployment, 'universe') &&
        !Object.hasOwn(deployment.strategies?.[0] ?? {}, 'config'),
    );
    assertEqual('release strategy', release.strategyName, SANDBOX_E2E_STRATEGY);
    assertEqual('release version', release.releaseVersion, 1);
    assertEqual('release interval', release.config?.INTERVAL, '15');
    assertEqual('release universe', release.config?.UNIVERSE, 'crypto');
    assertEqual(
      'release strategy package',
      release.strategyPackage,
      '@tradejs/example-sandbox',
    );
    assertEqual(
      'release strategy package version',
      release.strategyPackageVersion,
      '1.0.0',
    );
    assertTrue(
      'release runtime package version',
      Boolean(release.runtimePackageVersion),
    );

    assertEqual(
      'runtime signal bucket count',
      runtimeSignalBucketKeys.length,
      SANDBOX_E2E_SIGNALS_EXPECTED.signalBucketCount,
    );
    assertEqual(
      'store signals count',
      storeSignalKeys.length,
      SANDBOX_E2E_SIGNALS_EXPECTED.storeSignalsCount,
    );

    const runtimeSignalRef = (
      await readRedisHashJsonValues<SignalBucketRef>(runtimeSignalBucketKeys[0])
    )[0];
    const storeSignal = await readRedisJson<SignalPayload>(storeSignalKeys[0]);

    if (!runtimeSignalRef || !storeSignal) {
      throw new Error('Missing signal payload in Redis');
    }

    assertEqual(
      'symbol',
      storeSignal.symbol,
      SANDBOX_E2E_SIGNALS_EXPECTED.symbol,
    );
    assertEqual(
      'strategy',
      storeSignal.strategy,
      SANDBOX_E2E_SIGNALS_EXPECTED.strategy,
    );
    assertEqual(
      'direction',
      storeSignal.direction,
      SANDBOX_E2E_SIGNALS_EXPECTED.direction,
    );
    assertEqual(
      'interval',
      String(storeSignal.interval),
      SANDBOX_E2E_SIGNALS_EXPECTED.interval,
    );
    assertEqual(
      'store.signalId',
      storeSignal.signalId,
      runtimeSignalRef.signalId,
    );
    assertTrue(
      'signalId prefix',
      String(storeSignal.signalId || '').startsWith('sandbox-deterministic-'),
    );
    assertTrue(
      'timestamp aligned to 15m',
      Number(storeSignal.timestamp || 0) % 900_000 === 0,
    );
    assertTrue(
      'prices relationship',
      Number(storeSignal.prices?.takeProfitPrice || 0) >
        Number(storeSignal.prices?.currentPrice || 0) &&
        Number(storeSignal.prices?.currentPrice || 0) >
          Number(storeSignal.prices?.stopLossPrice || 0),
    );

    console.log(
      'Sandbox signals snapshot check passed',
      JSON.stringify(
        {
          runtimeSignalBucketKey: runtimeSignalBucketKeys[0],
          storeSignalKey: storeSignalKeys[0],
          signalId: storeSignal.signalId,
          symbol: storeSignal.symbol,
          strategy: storeSignal.strategy,
        },
        null,
        2,
      ),
    );
  } finally {
    await redis.quit();
  }
};

void run();
