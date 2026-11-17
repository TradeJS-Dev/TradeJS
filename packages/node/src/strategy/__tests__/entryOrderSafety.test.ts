import type {
  Connector,
  Direction,
  PortfolioOrderObservation,
} from '@tradejs/types';
import { entrySafetyStorage } from '@tradejs/infra/redis';
import {
  createPortfolioCoordinator,
  createMemoryPortfolioStore,
} from '../../portfolio';
import {
  withEntryOrderSafety,
  inspectEntryOrderSafety,
  recoverEntryOrderSafety,
  getEntryCompensation,
  entryCompensationId,
  entrySafetyKey,
} from '../entryOrderSafety';

const mockClaims = new Map<string, string>();
const mockReceipts = new Set<string>();
const mockReceiptValues = new Map<string, string>();
jest.mock('@tradejs/infra/redis', () => ({
  entrySafetyStorage: {
    read: jest.fn(async (key: string) => mockClaims.get(key) ?? null),
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
          mockReceiptValues.set(receipt, observation!);
        }
        mockClaims.delete(key);
        return true;
      },
    ),
    readCompensation: jest.fn(
      async (id: string) => mockReceiptValues.get(id) ?? null,
    ),
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
  mockReceiptValues.clear();
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

const recovery = async (f: ReturnType<typeof fixture>) => {
  const context = { connector: f.c, userName: 'alice', symbol: 'BTCUSDT' };
  const expectedClaim = await inspectEntryOrderSafety(context);
  expect(expectedClaim).not.toBeNull();
  return {
    ...context,
    expectedClaim: expectedClaim!,
    writersStopped: true as const,
  };
};

async function crashDuringClose(f: ReturnType<typeof fixture>) {
  jest
    .mocked(f.c.getEntryOrderObservation!)
    .mockImplementation(async ({ orderId }) =>
      orderId.startsWith('tjs-x-')
        ? null
        : { id: orderId, status: 'filled', filledQty: 1 },
    );
  const result = await complete(
    f.run(async (safe) => {
      await f.place(safe);
      throw new Error('stop-failed');
    }),
  );
  expect(result).toBeInstanceOf(AggregateError);
  expect(mockClaims.size).toBe(1);
}

test('journals the actual admitted and compensation IDs before each corresponding RPC', async () => {
  const f = fixture();
  jest.mocked(f.c.placeOrder).mockImplementation(async (request) => {
    const admitted = await request.beforeSubmit?.({ qty: 1 });
    const journal = JSON.parse([...mockClaims.values()][0]);
    expect(journal.originalOrderId).toBe('client-id');
    expect(journal.sentOrderIds).toEqual([admitted]);
    return true;
  });
  jest.mocked(f.c.closePosition).mockImplementation(async (request) => {
    const journal = JSON.parse([...mockClaims.values()][0]);
    expect(journal.closeOrderIds).toContain(request.orderId);
    f.setPosition(null);
    return true;
  });
  await complete(
    f.run(async (safe) => {
      await f.place(safe, async () => 'portfolio-admitted');
      throw new Error('stop-failed');
    }),
  );
  expect(mockClaims.size).toBe(0);
});

test('restart recovery verifies terminal late close and flatness then atomically writes portfolio receipt', async () => {
  const f = fixture();
  await crashDuringClose(f);
  const request = await recovery(f);
  const journal = JSON.parse(request.expectedClaim);
  expect(journal.closeOrderIds).toHaveLength(1);
  jest
    .mocked(f.c.getEntryOrderObservation!)
    .mockImplementation(async ({ orderId }) => ({
      id: orderId,
      status: 'filled',
      filledQty: 1,
    }));
  jest.clearAllMocks();
  await expect(recoverEntryOrderSafety(request)).resolves.toBeUndefined();
  expect(f.c.getEntryOrderObservation).toHaveBeenCalledTimes(2);
  expect(f.c.placeOrder).not.toHaveBeenCalled();
  expect(f.c.cancelEntryOrder).not.toHaveBeenCalled();
  expect(f.c.closePosition).not.toHaveBeenCalled();
  expect(f.c.setStopLoss).not.toHaveBeenCalled();
  expect(mockClaims.size).toBe(0);
  expect(
    mockReceipts.has(entryCompensationId(f.c, 'alice', 'BTCUSDT', 'client-id')),
  ).toBe(true);
});

test('flatness without terminal late-close evidence leaves restart recovery blocked', async () => {
  const f = fixture();
  await crashDuringClose(f);
  const result = await complete(recoverEntryOrderSafety(await recovery(f)));
  expect(result).toBeInstanceOf(Error);
  expect(mockClaims.size).toBe(1);
  expect(mockReceipts.size).toBe(0);
});

test('restart recovery cannot release a changed claim after its exchange reads', async () => {
  const f = fixture();
  await crashDuringClose(f);
  const request = await recovery(f);
  jest
    .mocked(f.c.getEntryOrderObservation!)
    .mockImplementation(async ({ orderId }) => ({
      id: orderId,
      status: 'filled',
      filledQty: 1,
    }));
  jest.mocked(f.c.getEntryPositionObservation!).mockImplementation(async () => {
    mockClaims.set(entrySafetyKey(f.c, 'alice', 'BTCUSDT'), 'new-owner');
    return null;
  });
  await expect(recoverEntryOrderSafety(request)).rejects.toThrow(
    'ENTRY_SAFETY_CLAIM_LOST',
  );
  expect([...mockClaims.values()]).toEqual(['new-owner']);
  expect(mockReceipts.size).toBe(0);
});

test.each(['legacy', 'prepared', 'missing-close-journal'])(
  'recovery never clears an incomplete %s record',
  async (variant) => {
    const f = fixture();
    await crashDuringClose(f);
    const key = entrySafetyKey(f.c, 'alice', 'BTCUSDT');
    const record = JSON.parse(mockClaims.get(key)!);
    if (variant === 'legacy') record.schema = 'tradejs-entry-safety/v1';
    if (variant === 'prepared') record.phase = 'prepared';
    if (variant === 'missing-close-journal') delete record.closeOrderIds;
    mockClaims.set(key, JSON.stringify(record));
    await expect(recoverEntryOrderSafety(await recovery(f))).rejects.toThrow(
      'ENTRY_RECOVERY_INCOMPLETE_JOURNAL',
    );
    expect(mockClaims.size).toBe(1);
  },
);

test('failed durable compensation journal prevents the close RPC', async () => {
  const f = fixture();
  const original = jest
    .mocked(entrySafetyStorage.replace)
    .getMockImplementation()!;
  jest
    .mocked(entrySafetyStorage.replace)
    .mockImplementation(async (key, previous, next) => {
      if (JSON.parse(next).closeOrderIds.length) return false;
      return original(key, previous, next);
    });
  try {
    const result = await complete(
      f.run(async (safe) => {
        await f.place(safe);
        throw new Error('stop-failed');
      }),
    );
    expect(result).toBeInstanceOf(AggregateError);
    expect(f.c.closePosition).not.toHaveBeenCalled();
    expect(mockClaims.size).toBe(1);
  } finally {
    jest.mocked(entrySafetyStorage.replace).mockImplementation(original);
  }
});

test('failed admitted-ID journal prevents actual submission', async () => {
  const f = fixture();
  const submission = jest.fn();
  jest.mocked(f.c.placeOrder).mockImplementation(async (request) => {
    await request.beforeSubmit?.({ qty: 1 });
    submission();
    return true;
  });
  jest.mocked(entrySafetyStorage.replace).mockResolvedValueOnce(false);
  const result = await complete(f.run((safe) => f.place(safe)));
  expect(result).toBeInstanceOf(Error);
  expect(submission).not.toHaveBeenCalled();
  expect(f.c.cancelEntryOrder).not.toHaveBeenCalled();
});

test('recovery accepts persisted authoritative rejection evidence for the earlier quantity retry', async () => {
  const f = fixture();
  await crashDuringClose(f);
  const key = entrySafetyKey(f.c, 'alice', 'BTCUSDT');
  const record = JSON.parse(mockClaims.get(key)!);
  record.sentOrderIds.unshift('previous-definitely-rejected');
  record.rejectedOrderIds.push('previous-definitely-rejected');
  mockClaims.set(key, JSON.stringify(record));
  jest
    .mocked(f.c.getEntryOrderObservation!)
    .mockImplementation(async ({ orderId }) => {
      if (orderId === 'previous-definitely-rejected')
        throw new Error('history unavailable');
      return { id: orderId, status: 'filled', filledQty: 1 };
    });
  await expect(
    recoverEntryOrderSafety(await recovery(f)),
  ).resolves.toBeUndefined();
  expect(mockClaims.size).toBe(0);
});

test('recovery requires explicit writer-stop confirmation and never releases a protected open position', async () => {
  const f = fixture();
  await crashDuringClose(f);
  const request = await recovery(f);
  await expect(
    recoverEntryOrderSafety({
      ...request,
      writersStopped: false as unknown as true,
    }),
  ).rejects.toThrow('ENTRY_RECOVERY_UNAVAILABLE');
  jest
    .mocked(f.c.getEntryOrderObservation!)
    .mockImplementation(async ({ orderId }) => ({
      id: orderId,
      status: 'filled',
      filledQty: 1,
    }));
  f.setPosition({
    symbol: 'BTCUSDT',
    direction: 'LONG',
    qty: 1,
    price: 101,
    slPrice: 90,
    priceTickSize: 0.1,
  });
  const result = await complete(recoverEntryOrderSafety(request));
  expect(result).toBeInstanceOf(Error);
  expect(mockClaims.size).toBe(1);
  expect(mockReceipts.size).toBe(0);
});

test('a non-portfolio quantity retry gets a new ID and pending retry cannot reuse the first rejection evidence', async () => {
  const f = fixture();
  let firstId: string | undefined;
  let secondId: string | undefined;
  jest.mocked(f.c.placeOrder).mockImplementation(async (request) => {
    firstId = (await request.beforeSubmit?.({ qty: 1 })) as string;
    await request.onRejected?.(true);
    secondId = (await request.beforeSubmit?.({ qty: 0.5 })) as string;
    f.setPosition(null);
    throw new Error('second-submit-timeout');
  });
  jest.mocked(f.c.getEntryOrderObservation!).mockResolvedValue(null);
  await complete(f.run((safe) => f.place(safe)));
  expect(secondId).not.toBe(firstId);
  const request = await recovery(f);
  const record = JSON.parse(request.expectedClaim);
  expect(record.sentOrderIds).toEqual([firstId, secondId]);
  expect(record.rejectedOrderIds).toEqual([firstId]);
  const result = await complete(recoverEntryOrderSafety(request));
  expect(result).toBeInstanceOf(Error);
  expect(mockClaims.size).toBe(1);
  expect(mockReceipts.size).toBe(0);
  expect(f.c.getEntryOrderObservation).toHaveBeenCalledWith({
    symbol: 'BTCUSDT',
    orderId: secondId,
  });
});

test('portfolio callback cannot admit the same ID for another actual submission', async () => {
  const f = fixture();
  const sends = jest.fn();
  jest.mocked(f.c.placeOrder).mockImplementation(async (request) => {
    await request.beforeSubmit?.({ qty: 1 });
    sends();
    await request.onRejected?.(true);
    await request.beforeSubmit?.({ qty: 0.5 });
    sends();
    return true;
  });
  const result = await complete(
    f.run((safe) => f.place(safe, async () => 'same-admitted')),
  );
  expect((result as Error).message).toBe('ENTRY_ORDER_ID_REUSED');
  expect(sends).toHaveBeenCalledTimes(1);
});

test('complete v2 prepared journal recovers a pre-submit crash with a proof-based no-fill receipt', async () => {
  const f = fixture();
  f.setPosition(null);
  mockClaims.set(
    entrySafetyKey(f.c, 'alice', 'BTCUSDT'),
    JSON.stringify({
      schema: 'tradejs-entry-safety/v2',
      token: 'prepared-nonce',
      orderId: 'client-id',
      originalOrderId: 'client-id',
      plannedOrderId: 'client-id',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      timestamp: 1,
      phase: 'prepared',
      sentOrderIds: [],
      rejectedOrderIds: [],
      closeOrderIds: [],
    }),
  );
  await expect(
    recoverEntryOrderSafety(await recovery(f)),
  ).resolves.toBeUndefined();
  expect(f.c.getEntryOrderObservation).not.toHaveBeenCalled();
  expect(f.c.getEntryPositionObservation).toHaveBeenCalledTimes(1);
  expect(mockClaims.size).toBe(0);
  expect(mockReceipts.size).toBe(1);
});

test('restart between portfolio retry admission and submit journal releases the exact unsent reservation', async () => {
  const f = fixture();
  f.setPosition(null);
  const store = createMemoryPortfolioStore();
  const policy = {
    id: 'recovery',
    scope: 'strategy' as const,
    riskUnit: 10,
    maxPositions: 1,
    observationIntervalMs: 100,
    maxPriceAgeMs: 100,
  };
  const create = () =>
    createPortfolioCoordinator({
      policy,
      strategy: 'Test',
      store,
      execution: {
        observe: async (asOf, reservations) => ({
          asOf,
          positions: [],
          orders: await Promise.all(
            reservations.map(
              async (r) =>
                (await getEntryCompensation(f.c, 'alice', r.symbol, r.id)) ?? {
                  id: r.id,
                  status: 'pending' as const,
                  filledQty: 0,
                },
            ),
          ),
        }),
        close: async () => {},
      },
    });
  let stopped!: () => void;
  const crashWindow = new Promise<void>((resolve) => {
    stopped = resolve;
  });
  let attempt = 0;
  jest.mocked(f.c.placeOrder).mockImplementation(async (request) => {
    await request.beforeSubmit?.({ qty: 1 });
    await request.onRejected?.(true);
    await request.beforeSubmit?.({ qty: 0.5 });
    throw new Error('unreachable after simulated process loss');
  });
  void f.run((safe) =>
    create().submit(
      1000,
      {
        id: 'client-id',
        signalId: 'signal',
        strategy: 'Test',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 1,
        timestamp: 1000,
      },
      async (mark, reject) =>
        safe.placeOrder({
          symbol: 'BTCUSDT',
          direction: 'LONG',
          qty: 1,
          price: 100,
          timestamp: 1000,
          onRejected: reject,
          beforeSubmit: async (context) => {
            const id = await mark(context.qty, context.beforeAdmission);
            if (++attempt === 2) {
              stopped();
              // The lost process never resumes its continuation or sends the second RPC.
              return await new Promise<string>(() => {});
            }
            return id;
          },
        }),
    ),
  );
  await crashWindow;
  const before = await store.read();
  const reservationId = before!.reservations[0].id;
  expect(reservationId).not.toBe('client-id');
  expect(before!.reservations[0].submitted).toBe(true);
  const request = await recovery(f);
  const journal = JSON.parse(request.expectedClaim);
  expect(journal.phase).toBe('admitting');
  expect(journal.plannedOrderId).toBe(reservationId);
  expect(journal.sentOrderIds).toEqual(['client-id']);
  expect(journal.rejectedOrderIds).toEqual(['client-id']);
  await recoverEntryOrderSafety(request);
  const receipt = await getEntryCompensation(
    f.c,
    'alice',
    'BTCUSDT',
    reservationId,
  );
  expect(receipt).toEqual({
    id: reservationId,
    status: 'rejected',
    filledQty: 0,
    compensated: true,
  });
  await create().tick(1000);
  expect((await store.read())!.reservations).toEqual([]);
  expect(f.c.getEntryOrderObservation).not.toHaveBeenCalled();
});

test('a swallowed nested entry error cannot release the outer portfolio safety claim', async () => {
  const f = fixture();
  f.setFact(null);
  const result = await complete(
    f.run(async (safe) => {
      try {
        await withEntryOrderSafety({
          connector: safe,
          userName: 'alice',
          symbol: 'BTCUSDT',
          direction: 'LONG',
          orderId: 'client-id',
          execute: (nested) => f.place(nested),
        });
      } catch {
        /* Runtime translates the failure into a failed signal. */
      }
      return 'failed-signal';
    }),
  );
  expect(result).toBeInstanceOf(AggregateError);
  expect(mockClaims.size).toBe(1);
});
