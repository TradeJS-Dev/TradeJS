import type {
  Connector,
  Direction,
  PortfolioOrderObservation,
} from '@tradejs/types';
import { entrySafetyStorage } from '@tradejs/infra/redis';
import {
  withEntryOrderSafety,
  entryCompensationId,
  entrySafetyKey,
} from '../entryOrderSafety';

const mockClaims = new Map<string, string>();
const mockReceipts = new Set<string>();
jest.mock('@tradejs/infra/redis', () => ({
  entrySafetyStorage: {
    claim: jest.fn(async (key: string, value: string) => {
      if (mockClaims.has(key)) return false;
      mockClaims.set(key, value);
      return true;
    }),
    replace: jest.fn(async (key: string, previous: string, next: string) => {
      if (mockClaims.get(key) !== previous) return false;
      mockClaims.set(key, next);
      return true;
    }),
    settle: jest.fn(
      async (
        key: string,
        value: string,
        receipt?: string,
        observation?: string,
      ) => {
        if (mockClaims.get(key) !== value) return false;
        if (receipt) {
          expect(JSON.parse(observation!)).toMatchObject({ compensated: true });
          mockReceipts.add(receipt);
        }
        mockClaims.delete(key);
        return true;
      },
    ),
    readCompensation: jest.fn(async () => null),
  },
}));

type EntryPosition = Awaited<
  ReturnType<NonNullable<Connector['getEntryPositionObservation']>>
>;
const fixture = (direction: Direction = 'LONG') => {
  let position: EntryPosition = {
    symbol: 'BTCUSDT',
    qty: 1,
    price: 101,
    direction,
    priceTickSize: 0.1,
  };
  let fact: PortfolioOrderObservation | null = {
    id: 'client-id',
    status: 'filled',
    filledQty: 1,
  };
  const c: Connector = {
    accountId: 'account',
    universe: 'crypto',
    capabilities: { supportedUniverses: ['crypto'], defaultUniverse: 'crypto' },
    listInstruments: async () => [],
    kline: async () => [],
    getTickers: async () => [],
    getState: async () => ({}),
    setState: async () => {},
    getPosition: jest.fn(async () => null),
    getPositions: async () => [],
    getEntryPositionObservation: jest.fn(async () => position),
    getEntryOrderObservation: jest.fn(async ({ orderId }) =>
      fact ? { ...fact, id: orderId } : null,
    ),
    cancelEntryOrder: jest.fn(async () => true),
    placeOrder: jest.fn(async (order) => {
      await order.beforeSubmit?.({ qty: order.qty });
      return true;
    }),
    setTakeProfits: async () => true,
    setStopLoss: jest.fn(async ({ stopLossPrice }) => {
      if (position && stopLossPrice != null)
        position = {
          ...position,
          slPrice: Math.round(stopLossPrice * 10) / 10,
        };
      return true;
    }),
    closePosition: jest.fn(async () => {
      position = null;
      return true;
    }),
  };
  const run = (execute: (safe: Connector) => Promise<unknown>) =>
    withEntryOrderSafety({
      connector: c,
      userName: 'alice',
      symbol: 'BTCUSDT',
      direction,
      orderId: 'client-id',
      execute,
    });
  const place = (safe: Connector, beforeSubmit?: () => Promise<string>) =>
    safe.placeOrder({
      symbol: 'BTCUSDT',
      direction,
      qty: 1,
      price: 100,
      timestamp: 1000,
      orderId: 'client-id',
      beforeSubmit,
    });
  return {
    c,
    run,
    place,
    setPosition: (next: EntryPosition) => {
      position = next;
    },
    setFact: (next: typeof fact) => {
      fact = next;
    },
  };
};

beforeEach(() => {
  mockClaims.clear();
  mockReceipts.clear();
  jest.clearAllMocks();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());
async function complete<T>(request: Promise<T>): Promise<T | unknown> {
  const outcome = request.catch((error: unknown) => error);
  await jest.runAllTimersAsync();
  return outcome;
}

test.each(['LONG', 'SHORT'] as const)(
  'waits for terminal fill and verifies normalized %s protection before success',
  async (direction) => {
    const f = fixture(direction);
    f.setFact({ id: 'client-id', status: 'pending', filledQty: 0 });
    jest
      .mocked(f.c.getEntryOrderObservation!)
      .mockImplementationOnce(async () => ({
        id: 'client-id',
        status: 'partial',
        filledQty: 0.5,
      }))
      .mockImplementation(async () => ({
        id: 'client-id',
        status: 'filled',
        filledQty: 1,
      }));
    const result = await complete(
      f.run(async (safe) => {
        expect(await f.place(safe)).toBe(true);
        expect(await safe.getPosition('BTCUSDT')).toMatchObject({ price: 101 });
        expect(
          await safe.setStopLoss({
            symbol: 'BTCUSDT',
            direction,
            stopLossPrice: direction === 'LONG' ? 90 : 110,
          }),
        ).toBe(true);
        return 'protected';
      }),
    );
    expect(result).toBe('protected');
    expect(f.c.getPosition).not.toHaveBeenCalled();
    expect(f.c.closePosition).not.toHaveBeenCalled();
    expect(mockClaims.size).toBe(0);
  },
);

test('cancels the admitted client ID before observing terminal state and closing a late partial fill', async () => {
  const f = fixture();
  const events: string[] = [];
  f.setPosition(null);
  f.setFact({ id: 'admitted', status: 'partial', filledQty: 0.5 });
  jest.mocked(f.c.cancelEntryOrder!).mockImplementation(async ({ orderId }) => {
    events.push(`cancel:${orderId}`);
    f.setFact({ id: 'admitted', status: 'cancelled', filledQty: 0.5 });
    f.setPosition({
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 0.5,
      price: 101,
      priceTickSize: 0.1,
    });
    return true;
  });
  jest.mocked(f.c.closePosition).mockImplementation(async () => {
    events.push('close');
    f.setPosition(null);
    return true;
  });
  const result = await complete(
    f.run(async (safe) => f.place(safe, async () => 'admitted')),
  );
  expect(result).toBeInstanceOf(Error);
  expect(events).toEqual(['cancel:admitted', 'close']);
  expect(
    mockReceipts.has(entryCompensationId(f.c, 'alice', 'BTCUSDT', 'admitted')),
  ).toBe(true);
  expect(mockClaims.size).toBe(0);
});

test.each([
  'unknown-order',
  'failed-position',
  'close-ack-only',
  'cancel-ack-only',
] as const)(
  'retains a durable safety claim for %s and blocks another runtime instance',
  async (failure) => {
    const f = fixture();
    if (failure === 'unknown-order') f.setFact(null);
    if (failure === 'cancel-ack-only')
      f.setFact({ id: 'client-id', status: 'partial', filledQty: 0.5 });
    if (failure === 'failed-position')
      jest
        .mocked(f.c.getEntryPositionObservation!)
        .mockRejectedValue(new Error('unavailable'));
    if (failure === 'close-ack-only')
      jest.mocked(f.c.closePosition).mockResolvedValue(true);
    const result = await complete(
      f.run(async (safe) => {
        await f.place(safe);
        throw new Error('protection-failed');
      }),
    );
    expect(result).toBeInstanceOf(AggregateError);
    expect((result as Error).message).toBe('ENTRY_PROTECTION_UNRESOLVED');
    expect(mockClaims.size).toBe(1);
    expect(mockReceipts.size).toBe(0);
    if (failure === 'unknown-order' || failure === 'cancel-ack-only')
      expect(f.c.closePosition).not.toHaveBeenCalled();
    const again = await complete(f.run((safe) => f.place(safe)));
    expect((again as Error).message).toBe('ENTRY_RECOVERY_REQUIRED');
    expect(mockClaims.size).toBe(1);
  },
);

test('recognizes flatness after failed close acknowledgement without reporting entry success', async () => {
  const f = fixture();
  jest.mocked(f.c.closePosition).mockImplementation(async () => {
    f.setPosition(null);
    throw new Error('timeout');
  });
  const result = await complete(
    f.run(async (safe) => {
      await f.place(safe);
      throw new Error('invalid-stop');
    }),
  );
  expect((result as Error).message).toBe('invalid-stop');
  expect(mockClaims.size).toBe(0);
  expect(mockReceipts.size).toBe(1);
});

test('a stop acknowledgement with mismatched observed protection triggers verified compensation', async () => {
  const f = fixture();
  jest.mocked(f.c.setStopLoss).mockResolvedValue(true);
  const result = await complete(
    f.run(async (safe) => {
      await f.place(safe);
      await safe.setStopLoss({
        symbol: 'BTCUSDT',
        direction: 'LONG',
        stopLossPrice: 90,
      });
      return 'unsafe-success';
    }),
  );
  expect(result).toBeInstanceOf(Error);
  expect(f.c.closePosition).toHaveBeenCalledTimes(1);
  expect(mockReceipts.size).toBe(1);
});

test('keeps the gate when a timed-out compensation may still execute after an independent stop', async () => {
  const f = fixture();
  jest
    .mocked(f.c.getEntryOrderObservation!)
    .mockImplementation(async ({ orderId }) =>
      orderId.startsWith('tjs-x-')
        ? null
        : { id: orderId, status: 'filled', filledQty: 1 },
    );
  jest.mocked(f.c.closePosition).mockImplementation(async () => {
    f.setPosition(null);
    throw new Error('close-timeout');
  });
  const result = await complete(
    f.run(async (safe) => {
      await f.place(safe);
      throw new Error('invalid-stop');
    }),
  );
  expect(result).toBeInstanceOf(AggregateError);
  expect(mockClaims.size).toBe(1);
  expect(mockReceipts.size).toBe(0);
});

test('preflight false releases the prepared claim without order recovery', async () => {
  const f = fixture();
  jest.mocked(f.c.placeOrder).mockResolvedValue(false);
  expect(await f.run((safe) => f.place(safe))).toBe(false);
  expect(entrySafetyStorage.claim).toHaveBeenCalledTimes(1);
  expect(mockClaims.size).toBe(0);
  expect(f.c.cancelEntryOrder).not.toHaveBeenCalled();
});

test('an exception after submission is unknown until cancellation and terminal reconciliation', async () => {
  const f = fixture();
  jest.mocked(f.c.placeOrder).mockImplementation(async (o) => {
    await o.beforeSubmit?.({ qty: 1 });
    throw new Error('submit-timeout');
  });
  const result = await complete(f.run((safe) => f.place(safe)));
  expect((result as Error).message).toBe('submit-timeout');
  expect(f.c.cancelEntryOrder).toHaveBeenCalledWith({
    symbol: 'BTCUSDT',
    orderId: 'client-id',
  });
  expect(mockReceipts.size).toBe(1);
});

test('explicit rejection releases its claim and allows a replacement admitted ID', async () => {
  const f = fixture();
  jest.mocked(f.c.placeOrder).mockImplementation(async (o) => {
    await o.beforeSubmit?.({ qty: 1 });
    await o.onRejected?.(true);
    await o.beforeSubmit?.({ qty: 0.5 });
    return true;
  });
  let retry = 0;
  const result = await complete(
    f.run(async (safe) => {
      await f.place(safe, async () =>
        ++retry === 1 ? 'original' : 'replacement',
      );
      throw new Error('protection-failed');
    }),
  );
  expect(result).toBeInstanceOf(Error);
  expect(
    mockReceipts.has(
      entryCompensationId(f.c, 'alice', 'BTCUSDT', 'replacement'),
    ),
  ).toBe(true);
});

test('simulation does not acquire live safety claims', async () => {
  const f = fixture();
  delete f.c.cancelEntryOrder;
  delete f.c.getEntryPositionObservation;
  expect(await f.run(async () => 'simulation')).toBe('simulation');
  expect(entrySafetyStorage.claim).not.toHaveBeenCalled();
});

test('a false outcome after beforeSubmit without authoritative rejection retains the reservation callback', async () => {
  const f = fixture();
  const rejected = jest.fn();
  jest.mocked(f.c.placeOrder).mockImplementation(async (request) => {
    await request.beforeSubmit?.({ qty: 1 });
    return false;
  });
  f.setFact(null);
  const result = await complete(
    f.run((safe) =>
      safe.placeOrder({
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 1,
        price: 100,
        timestamp: 1000,
        orderId: 'client-id',
        onRejected: rejected,
      }),
    ),
  );
  expect(result).toBeInstanceOf(AggregateError);
  expect(rejected).not.toHaveBeenCalled();
  expect(mockClaims.size).toBe(1);
  expect(mockReceipts.size).toBe(0);
});

test('an ambiguous close server response cannot release the gate after an independent stop', async () => {
  const f = fixture();
  jest
    .mocked(f.c.getEntryOrderObservation!)
    .mockImplementation(async ({ orderId }) =>
      orderId.startsWith('tjs-x-')
        ? null
        : { id: orderId, status: 'filled', filledQty: 1 },
    );
  jest.mocked(f.c.closePosition).mockImplementation(async () => {
    f.setPosition(null);
    throw new Error('BYBIT_CLOSE_SUBMISSION_UNCONFIRMED:10000');
  });
  const result = await complete(
    f.run(async (safe) => {
      await f.place(safe);
      throw new Error('invalid-stop');
    }),
  );
  expect(result).toBeInstanceOf(AggregateError);
  expect(mockClaims.size).toBe(1);
  expect(mockReceipts.size).toBe(0);
});

test('an existing safety claim blocks adapter and leverage preparation before submission', async () => {
  const f = fixture();
  mockClaims.set(
    entrySafetyKey(f.c, 'alice', 'BTCUSDT'),
    'unresolved-previous-entry',
  );
  const result = await complete(f.run((safe) => f.place(safe)));
  expect((result as Error).message).toBe('ENTRY_RECOVERY_REQUIRED');
  expect(f.c.placeOrder).not.toHaveBeenCalled();
  expect(mockClaims.size).toBe(1);
});

test('a pre-submit failure clears an unsent portfolio reservation without exchange recovery', async () => {
  const f = fixture();
  const rejected = jest.fn();
  const result = await complete(
    f.run((safe) =>
      safe.placeOrder({
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 1,
        price: 100,
        timestamp: 1000,
        orderId: 'client-id',
        beforeSubmit: async () => {
          throw new Error('preflight-invalid');
        },
        onRejected: rejected,
      }),
    ),
  );
  expect((result as Error).message).toBe('preflight-invalid');
  expect(rejected).toHaveBeenCalledWith(true);
  expect(mockClaims.size).toBe(0);
  expect(f.c.cancelEntryOrder).not.toHaveBeenCalled();
});
