import Redis from 'ioredis';
import {
  SANDBOX_E2E_EXPECTED,
  SANDBOX_E2E_STRATEGY,
  SANDBOX_E2E_USER,
} from './e2eConfig';

type BacktestStat = {
  orders?: number;
  wins?: number;
  losses?: number;
  amount?: number;
  netProfit?: number;
  winRate?: number;
  maxDrawdown?: number;
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

const assertEqual = (label: string, actual: number, expected: number): void => {
  if (actual !== expected) {
    throw new Error(
      `${label} mismatch. expected=${expected}, actual=${actual}`,
    );
  }
};

const run = async () => {
  try {
    const statKeys = await scanKeys(
      `users:${SANDBOX_E2E_USER}:tests:${SANDBOX_E2E_STRATEGY}:*:stat`,
    );

    if (statKeys.length !== 1) {
      throw new Error(
        `Expected exactly 1 stat key, found ${statKeys.length}: ${statKeys.join(', ')}`,
      );
    }

    const stat = await readRedisJson<BacktestStat>(statKeys[0]);

    if (!stat) {
      throw new Error(`Missing stat payload for key ${statKeys[0]}`);
    }

    const snapshot = {
      orders: Number(stat.orders ?? 0),
      wins: Number(stat.wins ?? 0),
      losses: Number(stat.losses ?? 0),
      amount: Number(stat.amount ?? 0),
      netProfit: Number(stat.netProfit ?? 0),
      winRate: Number(stat.winRate ?? 0),
      maxDrawdown: Number(stat.maxDrawdown ?? 0),
    };

    console.log('Actual sandbox snapshot:', JSON.stringify(snapshot, null, 2));

    assertEqual('orders', snapshot.orders, SANDBOX_E2E_EXPECTED.orders);
    assertEqual('wins', snapshot.wins, SANDBOX_E2E_EXPECTED.wins);
    assertEqual('losses', snapshot.losses, SANDBOX_E2E_EXPECTED.losses);
    assertEqual('amount', snapshot.amount, SANDBOX_E2E_EXPECTED.amount);
    assertEqual(
      'netProfit',
      snapshot.netProfit,
      SANDBOX_E2E_EXPECTED.netProfit,
    );
    assertEqual('winRate', snapshot.winRate, SANDBOX_E2E_EXPECTED.winRate);
    assertEqual(
      'maxDrawdown',
      snapshot.maxDrawdown,
      SANDBOX_E2E_EXPECTED.maxDrawdown,
    );

    console.log('Sandbox backtest snapshot check passed');
    console.log(JSON.stringify(snapshot, null, 2));
  } finally {
    await redis.quit();
  }
};

void run();
