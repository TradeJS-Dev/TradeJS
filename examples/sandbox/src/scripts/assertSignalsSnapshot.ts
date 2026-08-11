import Redis from 'ioredis';
import {
  SANDBOX_E2E_SIGNALS_EXPECTED,
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
