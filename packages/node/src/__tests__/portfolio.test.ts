import {
  createPortfolioCoordinator,
  createMemoryPortfolioStore,
} from '../portfolio';
import type {
  PortfolioPolicyConfig,
  PortfolioObservation,
  PortfolioReservation,
  PortfolioPosition,
} from '@tradejs/types';
const policy: PortfolioPolicyConfig = {
  id: 'test',
  scope: 'strategy',
  riskUnit: 10,
  observationIntervalMs: 100,
  maxPriceAgeMs: 100,
  maxPositions: 1,
};
const entry = (id: string) => ({
  id,
  signalId: id,
  strategy: 'Test',
  symbol: `${id}USDT`,
  direction: 'LONG' as const,
  qty: 1,
  timestamp: 1000,
});
function fixture(p = policy) {
  const store = createMemoryPortfolioStore();
  const positions: PortfolioPosition[] = [];
  const orders: PortfolioObservation['orders'] = [];
  const observe = jest.fn(
    async (asOf: number, _reservations: readonly PortfolioReservation[]) => ({
      asOf,
      positions,
      orders,
    }),
  );
  const close = jest.fn(async (position: PortfolioPosition) => {
    positions.splice(
      positions.findIndex((x) => x.id === position.id),
      1,
    );
  });
  const create = () =>
    createPortfolioCoordinator({
      policy: p,
      strategy: 'Test',
      store,
      execution: { observe, close },
    });
  return { store, positions, orders, observe, close, create };
}
test('two independent coordinators sharing CAS cannot exceed a cap', async () => {
  const f = fixture();
  const send = jest.fn(async (mark: (qty: number) => Promise<string>) => {
    await mark(1);
    return true;
  });
  const results = await Promise.all([
    f.create().submit(1000, entry('A'), send),
    f.create().submit(1000, entry('B'), send),
  ]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(
    results.filter((r) => r.reason === 'PORTFOLIO_POSITION_LIMIT'),
  ).toHaveLength(1);
  expect((await f.store.read())?.reservations).toHaveLength(1);
});
test('definite pre-submission failure releases reservation, ambiguous submitted failure survives restart', async () => {
  const f = fixture();
  await expect(
    f.create().submit(1000, entry('A'), async () => {
      throw new Error('preflight');
    }),
  ).rejects.toThrow('preflight');
  expect((await f.store.read())?.reservations).toHaveLength(0);
  await expect(
    f.create().submit(1000, entry('B'), async (mark) => {
      await mark(1);
      throw new Error('timeout');
    }),
  ).rejects.toThrow('timeout');
  const send = jest.fn();
  expect((await f.create().submit(1000, entry('C'), send)).reason).toBe(
    'PORTFOLIO_POSITION_LIMIT',
  );
  expect(send).not.toHaveBeenCalled();
});
test('atomic close claim prevents duplicate close across coordinators and reserves the exit cycle', async () => {
  const f = fixture({
    ...policy,
    profitExit: { scope: 'position', multiple: 2 },
  });
  f.positions.push({
    id: 'A',
    strategy: 'Test',
    symbol: 'AUSDT',
    direction: 'LONG',
    entryPrice: 100,
    markPrice: 120,
    markedAt: 1000,
    qty: 1,
  });
  await Promise.all([f.create().tick(1000), f.create().tick(1000)]);
  expect(f.close).toHaveBeenCalledTimes(1);
  expect(f.positions).toEqual([]);
  expect((await f.create().submit(1000, entry('B'), jest.fn())).reason).toBe(
    'PORTFOLIO_CLOSING',
  );
});
test('persisted fingerprint blocks changing policy on occupied scope', async () => {
  const f = fixture();
  await f.create().tick(1000);
  const changed = createPortfolioCoordinator({
    policy: { ...policy, maxPositions: 9 },
    strategy: 'Test',
    store: f.store,
    execution: { observe: f.observe, close: f.close },
  });
  await expect(changed.tick(1000)).rejects.toThrow('policy changed');
});
test('storage failure cannot submit an order', async () => {
  const send = jest.fn();
  const c = createPortfolioCoordinator({
    policy,
    strategy: 'Test',
    store: {
      read: async () => {
        throw new Error('storage down');
      },
      compare: async () => false,
    },
    execution: { observe: jest.fn(), close: jest.fn() },
  });
  await expect(c.submit(1000, entry('A'), send)).rejects.toThrow(
    'storage down',
  );
  expect(send).not.toHaveBeenCalled();
});

test('authoritative rejection frees the slot and prevents duplicate submission', async () => {
  const f = fixture();
  await f.create().submit(1000, entry('A'), async (mark, reject) => {
    await mark(1);
    await reject();
    return false;
  });
  expect((await f.store.read())?.reservations).toEqual([]);
  expect((await f.create().submit(1000, entry('A'), jest.fn())).reason).toBe(
    'PORTFOLIO_DUPLICATE_ENTRY',
  );
  expect(
    (await f.create().submit(1000, entry('B'), async () => true)).reason,
  ).toBeUndefined();
});
test('an acknowledged close keeps entry blocked until disappearance and is retried only next cycle', async () => {
  const f = fixture({
    ...policy,
    profitExit: { scope: 'position', multiple: 2 },
  });
  f.positions.push({
    id: 'A',
    strategy: 'Test',
    symbol: 'AUSDT',
    direction: 'LONG',
    entryPrice: 100,
    markPrice: 120,
    markedAt: 1000,
    qty: 1,
  });
  f.close.mockImplementation(async () => undefined);
  const c = f.create();
  await c.tick(1000);
  await c.tick(1000);
  expect(f.close).toHaveBeenCalledTimes(1);
  expect((await c.submit(1000, entry('B'), jest.fn())).reason).toBe(
    'PORTFOLIO_CLOSING',
  );
  await c.tick(1100);
  expect(f.close).toHaveBeenCalledTimes(2);
});

test('a close starting after reservation invalidates the still-unsent entry', async () => {
  const f = fixture();
  let sent = false;
  await expect(
    f.create().submit(1000, entry('B'), async (mark) => {
      const state = (await f.store.read())!;
      await f.store.compare(state, {
        ...state,
        revision: state.revision + 1,
        blockedThrough: 1099,
      });
      await mark(1);
      sent = true;
    }),
  ).rejects.toThrow('NO_LONGER_ADMITTED');
  expect(sent).toBe(false);
  expect((await f.store.read())?.reservations).toEqual([]);
});

test('rejected retry releases capacity even if preparation aborts', async () => {
  const f = fixture();
  await expect(
    f.create().submit(1000, entry('A'), async (mark, reject) => {
      await mark(1);
      await reject(true);
      expect((await f.store.read())?.reservations).toEqual([]);
      throw new Error('preparation failed');
    }),
  ).rejects.toThrow('preparation failed');
  expect((await f.store.read())?.reservations).toEqual([]);
});

test('retry reacquires capacity and uses a different execution identity', async () => {
  const f = fixture();
  const ids: string[] = [];
  await f.create().submit(1000, entry('A'), async (mark, reject) => {
    ids.push(await mark(1));
    await reject(true);
    ids.push(await mark(0.5));
    expect((await f.store.read())?.reservations).toMatchObject([
      { id: ids[1], qty: 0.5, submitted: true },
    ]);
    await reject();
  });
  expect(ids[0]).not.toBe(ids[1]);
  expect((await f.store.read())?.reservations).toEqual([]);
});

test('retry cannot take a slot admitted to another entry after rejection', async () => {
  const f = fixture();
  await expect(
    f.create().submit(1000, entry('A'), async (mark, reject) => {
      await mark(1);
      await reject(true);
      await f.create().submit(1000, entry('B'), async (markOther) => {
        await markOther(1);
      });
      await mark(0.5);
    }),
  ).rejects.toThrow('PORTFOLIO_POSITION_LIMIT');
  expect((await f.store.read())?.reservations.map((r) => r.symbol)).toEqual([
    'BUSDT',
  ]);
});
