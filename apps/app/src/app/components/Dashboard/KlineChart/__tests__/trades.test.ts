import type { OrderLog } from '@tradejs/types';
import { compareTradeEntries, getChartTrades } from '../trades';

const order = (index: number, overrides: Partial<OrderLog> = {}): OrderLog => ({
  index,
  timestamp: 100 + index,
  type: 'OPEN_LONG',
  symbol: 'BTCUSDT',
  direction: 'LONG',
  qty: 2,
  price: 100,
  profit: -1,
  fee: 1,
  amount: 999,
  ...overrides,
});

it('groups increases and partial exits and adds recorded P&L without charging fees twice', () => {
  const trades = getChartTrades([
    order(3, { type: 'STOP_LOSS_LONG', qty: 2, profit: -15, fee: 2 }),
    order(0),
    order(1, { positionIntent: 'increase', qty: 1 }),
    order(2, { type: 'TAKE_PROFIT_LONG', qty: 1, profit: 8 }),
    order(4, { fee: undefined }),
  ]);
  expect(trades).toHaveLength(2);
  expect(trades[0]).toMatchObject({
    id: 0,
    remaining: 0,
    profit: -9,
    fee: 5,
    lastExit: { index: 3 },
  });
  expect(trades[0].events.map(({ index }) => index)).toEqual([0, 1, 2, 3]);
  expect(trades[1]).toMatchObject({ id: 4, remaining: 2, fee: null });
});

it('matches direction and entry time and distinguishes changed exit legs and unmatched trades', () => {
  const primary = getChartTrades([
    order(0),
    order(1, { type: 'TAKE_PROFIT_LONG', price: 120 }),
    order(2),
  ]);
  const secondary = getChartTrades([
    order(10, { timestamp: 100 }),
    order(11, { timestamp: 101, type: 'STOP_LOSS_LONG', price: 90 }),
    order(12, { timestamp: 102, direction: 'SHORT', type: 'OPEN_SHORT' }),
  ]);
  const { A, B } = compareTradeEntries(primary, secondary);
  expect([...A]).toEqual([
    [0, 'Exit changed'],
    [2, 'Only A'],
  ]);
  expect([...B]).toEqual([
    [10, 'Exit changed'],
    [12, 'Only B'],
  ]);
  expect(compareTradeEntries(primary, primary).A.get(0)).toBe('Matched');
});
