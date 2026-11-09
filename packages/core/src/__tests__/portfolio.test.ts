import {
  buildPortfolioContext,
  createPortfolioState,
  parsePortfolioPolicy,
  portfolioFingerprint,
  reconcilePortfolio,
  reservePortfolioEntry,
} from '../portfolio';
import type {
  PortfolioPolicyConfig,
  PortfolioPosition,
  PortfolioObservation,
  PortfolioReservation,
} from '@tradejs/types';
const policy: PortfolioPolicyConfig = {
  id: 'test',
  scope: 'strategy',
  riskUnit: 10,
  observationIntervalMs: 100,
  maxPriceAgeMs: 100,
  maxPositions: 2,
  closeOppositeOnFill: true,
};
const pos = (
  id: string,
  direction: 'LONG' | 'SHORT' = 'LONG',
  markPrice = 100,
): PortfolioPosition => ({
  id,
  symbol: `${id}USDT`,
  strategy: 'Test',
  direction,
  qty: 1,
  entryPrice: 100,
  markPrice,
  markedAt: 1000,
  stopLossPrice: direction === 'LONG' ? 90 : 110,
});
const obs = (
  positions: PortfolioPosition[] = [],
  orders: PortfolioObservation['orders'] = [],
  asOf = 1000,
): PortfolioObservation => ({ asOf, positions, orders });
const empty = () => createPortfolioState(portfolioFingerprint(policy, 'Test'));
const entry: PortfolioReservation = {
  id: 'new',
  signalId: 's',
  strategy: 'Test',
  symbol: 'NEWUSDT',
  direction: 'LONG',
  qty: 1,
  timestamp: 1000,
  submitted: false,
  oppositeHandled: false,
};

test('disabled by default; validates settings and rejects misspelled rules', () => {
  expect(parsePortfolioPolicy(undefined)).toBeUndefined();
  expect(parsePortfolioPolicy(policy)).toEqual(policy);
  for (const invalid of [
    { ...policy, riskUnit: 0 },
    { ...policy, maxPositions: 1.5 },
    { ...policy, foo: 1 },
    { ...policy, scope: { strategies: ['Test', 'Test'] } },
    { ...policy, profitExit: { scope: 'basket', multiple: 2, typo: 1 } },
  ])
    expect(() => parsePortfolioPolicy(invalid)).toThrow();
});
test('capacity counts reservations without counting a partial position twice', () => {
  const state = { ...empty(), reservations: [{ ...entry, symbol: 'AUSDT' }] };
  expect(
    buildPortfolioContext(policy, 'Test', state, obs([pos('A')])),
  ).toMatchObject({
    positionCount: 1,
    pendingEntryCount: 0,
    grossUnrealizedPnlR: 0,
    openStopRiskR: 1,
  });
  expect(
    reservePortfolioEntry(policy, 'Test', state, obs([pos('B')]), {
      ...entry,
      id: 'other',
      signalId: 'other',
      symbol: 'CUSDT',
    }).reason,
  ).toBe('PORTFOLIO_POSITION_LIMIT');
});
test('acknowledgement never triggers opposite close; first confirmed partial fill does it once', () => {
  const state = { ...empty(), reservations: [entry] };
  expect(
    reconcilePortfolio(
      policy,
      'Test',
      state,
      obs(
        [pos('old', 'SHORT')],
        [{ id: 'new', status: 'pending', filledQty: 0 }],
      ),
    ).closing,
  ).toEqual([]);
  const observation = obs(
    [pos('old', 'SHORT'), { ...pos('new'), symbol: entry.symbol }],
    [{ id: 'new', status: 'partial', filledQty: 0.5, positionId: 'new' }],
  );
  const partial = reconcilePortfolio(policy, 'Test', state, observation);
  expect(partial.closing).toEqual([
    expect.objectContaining({
      positionId: 'old',
      reason: 'PORTFOLIO_OPPOSITE_FILL',
    }),
  ]);
  expect(partial.reservations).toHaveLength(1);
  expect(
    reconcilePortfolio(policy, 'Test', partial, observation).closing,
  ).toHaveLength(1);
  observation.orders[0].status = 'filled';
  const filled = reconcilePortfolio(policy, 'Test', partial, observation);
  expect(filled.reservations).toHaveLength(0);
  expect(
    reservePortfolioEntry(policy, 'Test', filled, observation, entry).reason,
  ).toBe('PORTFOLIO_DUPLICATE_ENTRY');
});
test('basket includes losing positions and uses a fixed R; closes entire basket at equality', () => {
  const p = {
    ...policy,
    profitExit: { scope: 'basket' as const, multiple: 2 },
  };
  expect(
    reconcilePortfolio(
      p,
      'Test',
      empty(),
      obs([pos('A', 'LONG', 125), pos('B', 'LONG', 90)]),
    ).closing,
  ).toEqual([]);
  const closed = reconcilePortfolio(
    p,
    'Test',
    empty(),
    obs([pos('A', 'LONG', 130), pos('B', 'LONG', 90)]),
  );
  expect(closed.closing.map((c) => c.positionId)).toEqual(['A', 'B']);
  expect(
    reconcilePortfolio(p, 'Test', empty(), obs([pos('A', 'LONG', 130)]))
      .closing,
  ).toEqual([]);
});
test.each([null, 899, 1001])(
  'stale, missing or future mark %s blocks basket, notifies missing PnL',
  (markedAt) => {
    const observation = obs([pos('A', 'LONG', 140), { ...pos('B'), markedAt }]);
    const p = {
      ...policy,
      profitExit: { scope: 'basket' as const, multiple: 2 },
    };
    expect(reconcilePortfolio(p, 'Test', empty(), observation).closing).toEqual(
      [],
    );
    expect(
      buildPortfolioContext(p, 'Test', empty(), observation)
        .grossUnrealizedPnlR,
    ).toBeNull();
  },
);
test('individual threshold and scope do not close foreign positions', () => {
  const p = {
    ...policy,
    profitExit: { scope: 'position' as const, multiple: 2 },
  };
  const observation = obs([
    pos('A', 'SHORT', 80),
    { ...pos('B', 'LONG', 150), strategy: 'Foreign' },
  ]);
  expect(
    reconcilePortfolio(p, 'Test', empty(), observation).closing.map(
      (c) => c.positionId,
    ),
  ).toEqual(['A']);
  expect(
    reconcilePortfolio({ ...p, scope: 'account' }, 'Test', empty(), observation)
      .closing,
  ).toHaveLength(2);
  expect(
    reconcilePortfolio(
      { ...p, scope: { strategies: ['Foreign'] } },
      'Test',
      empty(),
      observation,
    ).closing.map((c) => c.positionId),
  ).toEqual(['B']);
});
test('unknown ownership blocks entries; cancelled reservation releases capacity', () => {
  expect(
    reservePortfolioEntry(
      policy,
      'Test',
      empty(),
      obs([{ ...pos('A'), strategy: null }]),
      entry,
    ).reason,
  ).toBe('PORTFOLIO_UNKNOWN_OWNERSHIP');
  expect(
    reconcilePortfolio(
      policy,
      'Test',
      { ...empty(), reservations: [entry] },
      obs([], [{ id: 'new', status: 'cancelled', filledQty: 0 }]),
    ).reservations,
  ).toEqual([]);
});
test('no reopening during close or in the same observation cycle after confirmation', () => {
  const closing = {
    ...empty(),
    closing: [
      {
        positionId: 'A',
        position: pos('A'),
        reason: 'PORTFOLIO_PROFIT_POSITION' as const,
        createdAt: 1000,
        lastAttemptAt: 1000,
      },
    ],
  };
  const confirmed = reconcilePortfolio(policy, 'Test', closing, obs());
  expect(
    reservePortfolioEntry(policy, 'Test', confirmed, obs(), entry).reason,
  ).toBe('PORTFOLIO_CLOSING');
  expect(
    reservePortfolioEntry(policy, 'Test', confirmed, obs([], [], 1100), entry)
      .reason,
  ).toBeUndefined();
});

test('rejects corrupted persisted reservations and close intents', () => {
  const { assertPortfolioState } =
    jest.requireActual<typeof import('../portfolio')>('../portfolio');
  expect(() => assertPortfolioState(empty())).not.toThrow();
  for (const state of [
    { ...empty(), revision: -1 },
    { ...empty(), reservations: [{ ...entry, submitted: 'yes' }] },
    { ...empty(), closing: [{ positionId: 'x' }] },
    { ...empty(), completedSignals: { x: NaN } },
  ])
    expect(() => assertPortfolioState(state)).toThrow('persisted');
});
