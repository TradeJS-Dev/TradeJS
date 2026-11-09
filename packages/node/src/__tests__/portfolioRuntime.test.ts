import type { Connector, PortfolioReservation } from '@tradejs/types';
import {
  getPortfolioRuntime,
  observeRuntimePortfolio,
} from '../strategy/portfolioRuntime';
const mockTrade = jest.fn();
jest.mock('../runtimeJournal', () => ({
  getActiveRuntimeTrade: (...args: unknown[]) => mockTrade(...args),
  markRuntimeTradeClosed: jest.fn(),
}));
const policy = {
  id: 'fixture',
  scope: 'strategy',
  riskUnit: 10,
  maxPositions: 1,
  observationIntervalMs: 100,
  maxPriceAgeMs: 100,
};
const binding = {
  userName: 'test',
  accountId: 'account',
  deploymentId: 'deployment',
};
const reservation: PortfolioReservation = {
  id: 'order',
  signalId: 'signal',
  strategy: 'Fixture',
  symbol: 'AUSDT',
  direction: 'LONG',
  qty: 1,
  timestamp: 1000,
  submitted: true,
  oppositeHandled: false,
};
const connector = () =>
  ({
    getOpenPositionPnl: async () => [
      {
        symbol: 'AUSDT',
        direction: 'LONG',
        qty: 1,
        price: 100,
        currentPrice: 120,
        unrealizedPnl: 20,
        observedAt: 1000,
      },
    ],
    getEntryExecutions: async () => [],
  }) as unknown as Connector;
beforeEach(() => mockTrade.mockReset());
test('disabled policies require no connector capabilities or binding; isolated simulations fail explicitly', () => {
  expect(
    getPortfolioRuntime({
      value: undefined,
      strategy: 'Fixture',
      connector: {} as Connector,
      connectorName: 'bybit',
      env: 'LIVE',
    }),
  ).toBeUndefined();
  expect(() =>
    getPortfolioRuntime({
      value: policy,
      strategy: 'Fixture',
      connector: connector(),
      connectorName: 'bybit',
      env: 'BACKTEST',
    }),
  ).toThrow('shared portfolio replay');
  expect(() =>
    getPortfolioRuntime({
      value: policy,
      strategy: 'Fixture',
      connector: connector(),
      connectorName: 'bybit',
      env: 'LIVE',
    }),
  ).toThrow('binding');
});
test('journal attribution requires matching direction, quantity and entry price', async () => {
  mockTrade.mockResolvedValue({
    orderId: 'old',
    strategy: 'Fixture',
    direction: 'LONG',
    qty: 1,
    entryPrice: 110,
  });
  expect(
    (await observeRuntimePortfolio(connector(), binding, 1000, [], () => 1000))
      .positions[0].strategy,
  ).toBeNull();
  mockTrade.mockResolvedValue({
    orderId: 'old',
    strategy: 'Fixture',
    direction: 'LONG',
    qty: 1,
    entryPrice: 100,
  });
  expect(
    (await observeRuntimePortfolio(connector(), binding, 1000, [], () => 1000))
      .positions[0],
  ).toMatchObject({ id: 'old', strategy: 'Fixture', markedAt: 1000 });
});
test('ack without execution cannot attribute a position, confirmed execution can', async () => {
  const c = connector();
  expect(
    (await observeRuntimePortfolio(c, binding, 1000, [reservation], () => 1000))
      .positions[0].strategy,
  ).toBeNull();
  c.getEntryExecutions = async () => [
    {
      symbol: 'AUSDT',
      direction: 'LONG',
      qty: 1,
      entryPrice: 100,
      entryTimestamp: 1000,
      orderLinkId: 'order',
    },
  ];
  const observed = await observeRuntimePortfolio(
    c,
    binding,
    1000,
    [reservation],
    () => 1000,
  );
  expect(observed.positions[0]).toMatchObject({
    id: 'order',
    strategy: 'Fixture',
  });
  expect(observed.orders[0]).toMatchObject({ status: 'filled', filledQty: 1 });
});
test('authoritative cancellation takes precedence over absent execution rows', async () => {
  const c = connector();
  c.getEntryOrderObservation = async () => ({
    id: 'order',
    status: 'cancelled',
    filledQty: 0,
  });
  expect(
    (await observeRuntimePortfolio(c, binding, 1000, [reservation], () => 1000))
      .orders[0].status,
  ).toBe('cancelled');
});
