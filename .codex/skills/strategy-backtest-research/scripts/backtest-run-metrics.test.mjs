import assert from 'node:assert/strict';
import test from 'node:test';

import {
  reconstructTrades,
  summarizeTradeWindow,
} from './backtest-run-metrics.mjs';

test('reconstructs scale-in levels and includes entry fees in trade pnl', () => {
  const { trades, increaseEvents, incompleteCycles } = reconstructTrades([
    [
      {
        timestamp: 100,
        type: 'OPEN_LONG',
        positionIntent: 'open',
        profit: -0.1,
        symbol: 'BTCUSDT',
        direction: 'LONG',
        orderId: 'open-1',
      },
      {
        timestamp: 200,
        type: 'OPEN_LONG',
        positionIntent: 'increase',
        profit: -0.2,
      },
      {
        timestamp: 300,
        type: 'OPEN_LONG',
        positionIntent: 'increase',
        profit: -0.3,
      },
      {
        timestamp: 400,
        type: 'OPEN_LONG',
        positionIntent: 'increase',
        profit: -0.4,
      },
      {
        timestamp: 500,
        type: 'TAKE_PROFIT_LONG',
        profit: 5,
      },
    ],
  ]);

  assert.equal(incompleteCycles, 0);
  assert.deepEqual(
    increaseEvents.map((event) => event.level),
    [2, 3, 4],
  );
  assert.deepEqual(trades, [
    {
      id: 'open-1',
      timestamp: 500,
      pnl: 4,
      symbol: 'BTCUSDT',
      direction: 'LONG',
      exitReason: 'take_profit',
      increases: 3,
    },
  ]);
});

test('keeps a trade open across partial take-profit fills', () => {
  const { trades, incompleteCycles } = reconstructTrades([
    [
      {
        timestamp: 100,
        type: 'OPEN_LONG',
        positionIntent: 'open',
        qty: 1,
        profit: -0.1,
        symbol: 'BTCUSDT',
        direction: 'LONG',
        orderId: 'open-partial',
      },
      {
        timestamp: 200,
        type: 'TAKE_PROFIT_LONG',
        qty: 0.4,
        profit: 2,
      },
      {
        timestamp: 300,
        type: 'TAKE_PROFIT_LONG',
        qty: 0.6,
        profit: 3,
      },
    ],
  ]);

  assert.equal(incompleteCycles, 0);
  assert.deepEqual(trades, [
    {
      id: 'open-partial',
      timestamp: 300,
      pnl: 4.9,
      symbol: 'BTCUSDT',
      direction: 'LONG',
      exitReason: 'take_profit',
      increases: 0,
    },
  ]);
});

test('summarizes strict loss, losing months, and scale-in counts', () => {
  const trades = [
    {
      timestamp: Date.UTC(2026, 0, 10),
      pnl: 4,
      increases: 3,
      symbol: 'BTCUSDT',
      direction: 'LONG',
      exitReason: 'take_profit',
    },
    {
      timestamp: Date.UTC(2026, 1, 10),
      pnl: -6,
      increases: 1,
      symbol: 'ETHUSDT',
      direction: 'SHORT',
      exitReason: 'stop_loss',
    },
  ];
  const increaseEvents = [
    { timestamp: Date.UTC(2026, 0, 9), level: 2 },
    { timestamp: Date.UTC(2026, 0, 9), level: 3 },
    { timestamp: Date.UTC(2026, 0, 9), level: 4 },
    { timestamp: Date.UTC(2026, 1, 9), level: 2 },
  ];
  const summary = summarizeTradeWindow({
    trades,
    increaseEvents,
    startTimestamp: Date.UTC(2026, 0, 1),
    endTimestamp: Date.UTC(2026, 1, 28),
  });

  assert.equal(summary.core.trades, 2);
  assert.equal(summary.core.totalPnl, -2);
  assert.equal(summary.distribution.largestLoss, -6);
  assert.equal(summary.risk.losingMonthsCount, 1);
  assert.deepEqual(summary.increases.levels, { 2: 2, 3: 1, 4: 1 });
  assert.deepEqual(summary.losingMonthValues, [{ month: '2026-02', pnl: -6 }]);
});
