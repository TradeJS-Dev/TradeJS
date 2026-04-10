import Redis from 'ioredis';
import { SANDBOX_E2E_SIGNALS_EXPECTED, SANDBOX_E2E_SYMBOL } from './e2eConfig';

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
    const runtimeSignalKeys = await scanKeys(`signals:${SANDBOX_E2E_SYMBOL}:*`);
    const storeSignalKeys = await scanKeys(
      `store:signals:${SANDBOX_E2E_SYMBOL}:*`,
    );

    assertEqual(
      'runtime signals count',
      runtimeSignalKeys.length,
      SANDBOX_E2E_SIGNALS_EXPECTED.signalsCount,
    );
    assertEqual(
      'store signals count',
      storeSignalKeys.length,
      SANDBOX_E2E_SIGNALS_EXPECTED.storeSignalsCount,
    );

    const runtimeSignal = await readRedisJson<SignalPayload>(
      runtimeSignalKeys[0],
    );
    const storeSignal = await readRedisJson<SignalPayload>(storeSignalKeys[0]);

    if (!runtimeSignal || !storeSignal) {
      throw new Error('Missing signal payload in Redis');
    }

    assertEqual(
      'symbol',
      runtimeSignal.symbol,
      SANDBOX_E2E_SIGNALS_EXPECTED.symbol,
    );
    assertEqual(
      'strategy',
      runtimeSignal.strategy,
      SANDBOX_E2E_SIGNALS_EXPECTED.strategy,
    );
    assertEqual(
      'direction',
      runtimeSignal.direction,
      SANDBOX_E2E_SIGNALS_EXPECTED.direction,
    );
    assertEqual(
      'interval',
      String(runtimeSignal.interval),
      SANDBOX_E2E_SIGNALS_EXPECTED.interval,
    );
    assertEqual('store.signalId', storeSignal.signalId, runtimeSignal.signalId);
    assertTrue(
      'signalId prefix',
      String(runtimeSignal.signalId || '').startsWith(
        `sandbox-deterministic-${SANDBOX_E2E_SYMBOL}-`,
      ),
    );
    assertTrue(
      'timestamp aligned to 15m',
      Number(runtimeSignal.timestamp || 0) % 900_000 === 0,
    );
    assertTrue(
      'prices relationship',
      Number(runtimeSignal.prices?.takeProfitPrice || 0) >
        Number(runtimeSignal.prices?.currentPrice || 0) &&
        Number(runtimeSignal.prices?.currentPrice || 0) >
          Number(runtimeSignal.prices?.stopLossPrice || 0),
    );

    console.log(
      'Sandbox signals snapshot check passed',
      JSON.stringify(
        {
          runtimeSignalKey: runtimeSignalKeys[0],
          storeSignalKey: storeSignalKeys[0],
          signalId: runtimeSignal.signalId,
          symbol: runtimeSignal.symbol,
          strategy: runtimeSignal.strategy,
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
