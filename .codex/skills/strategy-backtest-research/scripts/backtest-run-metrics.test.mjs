import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildConfigStatSummaries,
  reconstructTrades,
  summarizeResultStats,
  summarizeTradeWindow,
} from './backtest-run-metrics.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

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

test('summarizes authoritative Redis stats without order artifacts', () => {
  const summary = summarizeResultStats({
    results: [
      {
        stat: {
          netProfit: 12,
          orders: 3,
          wins: 2,
          losses: 1,
          maxDrawdown: 8,
        },
      },
      {
        stat: {
          profit: -4,
          orders: 2,
          wins: 1,
          losses: 1,
          maxDrawdown: 15,
        },
      },
    ],
    startTimestamp: Date.UTC(2026, 0, 1),
    endTimestamp: Date.UTC(2026, 0, 11),
  });

  assert.equal(summary.source, 'redis-result-stat');
  assert.equal(summary.authoritativeAggregate, true);
  assert.equal(summary.resultCount, 2);
  assert.equal(summary.windowDays, 10);
  assert.equal(summary.netProfit, 8);
  assert.equal(summary.orders, 5);
  assert.equal(summary.wins, 3);
  assert.equal(summary.losses, 2);
  assert.equal(summary.winRatePct, 60);
  assert.equal(summary.pnlPerTrade, 1.6);
  assert.equal(summary.observedCadenceTradesPerDay, 0.5);
  assert.equal(summary.projectedCadence, null);
  assert.equal(summary.worstSymbolMaxDrawdownPct, 15);
  assert.match(summary.warnings[0], /not portfolio MaxDD/);
});

test('labels projected cadence and scales it by actual result count', () => {
  const summary = summarizeResultStats({
    results: [
      { stat: { netProfit: 0, orders: 10, wins: 5, losses: 5 } },
      { stat: { netProfit: 0, orders: 10, wins: 5, losses: 5 } },
    ],
    startTimestamp: 0,
    endTimestamp: 100 * 24 * 60 * 60 * 1000,
    projectedUniverse: 10,
  });

  assert.equal(summary.observedCadenceTradesPerDay, 0.2);
  assert.deepEqual(summary.projectedCadence, {
    label: 'projected cadence for 10 results',
    projectedUniverse: 10,
    actualResultCount: 2,
    scaleFactor: 5,
    tradesPerDay: 1,
  });
});

test('uses null for undefined ratios and drawdown when there are no trades', () => {
  const summary = summarizeResultStats({
    results: [{ stat: { netProfit: 0, orders: 0 } }],
    startTimestamp: 100,
    endTimestamp: 100,
    projectedUniverse: 550,
  });

  assert.equal(summary.winRatePct, null);
  assert.equal(summary.pnlPerTrade, null);
  assert.equal(summary.observedCadenceTradesPerDay, null);
  assert.equal(summary.projectedCadence, null);
  assert.equal(summary.worstSymbolMaxDrawdownPct, null);
});

test('keeps authoritative Redis stats separate for two grid configs', () => {
  const manifest = {
    status: 'completed',
    testSuite: [
      { configId: 'config-a', symbol: 'BTCUSDT' },
      { configId: 'config-a', symbol: 'ETHUSDT' },
      { configId: 'config-b', symbol: 'BTCUSDT' },
      { configId: 'config-b', symbol: 'ETHUSDT' },
    ],
  };
  const results = [
    {
      test: { configId: 'config-a', symbol: 'BTCUSDT' },
      stat: { netProfit: 10, orders: 2, wins: 2, losses: 0 },
    },
    {
      test: { configId: 'config-a', symbol: 'ETHUSDT' },
      stat: { netProfit: -2, orders: 1, wins: 0, losses: 1 },
    },
    {
      test: { configId: 'config-b', symbol: 'BTCUSDT' },
      stat: { netProfit: -20, orders: 4, wins: 0, losses: 4 },
    },
    {
      test: { configId: 'config-b', symbol: 'ETHUSDT' },
      stat: { netProfit: 1, orders: 1, wins: 1, losses: 0 },
    },
  ];

  const grouped = buildConfigStatSummaries({
    results,
    manifest,
    startTimestamp: 0,
    endTimestamp: 10 * DAY_MS,
  });

  assert.deepEqual(grouped.configIds, ['config-a', 'config-b']);
  assert.equal(grouped.statSummary, null);
  assert.equal(grouped.statSummariesByConfig['config-a'].netProfit, 8);
  assert.equal(grouped.statSummariesByConfig['config-a'].orders, 3);
  assert.equal(grouped.statSummariesByConfig['config-b'].netProfit, -19);
  assert.equal(grouped.statSummariesByConfig['config-b'].orders, 5);
  assert.equal(
    grouped.statSummariesByConfig['config-a'].authoritativeAggregate,
    true,
  );
  assert.deepEqual(grouped.statSummariesByConfig['config-b'].completion, {
    status: 'complete',
    manifestStatus: 'completed',
    planned: 2,
    completed: 2,
    missing: 0,
    extra: 0,
    plannedSymbols: 2,
    completedSymbols: 2,
    errors: null,
    errorStatus: 'not_persisted',
  });
  assert.match(grouped.warnings[0], /multiple configId buckets/);
});

test('marks a partial config aggregate non-authoritative', () => {
  const grouped = buildConfigStatSummaries({
    results: [
      {
        test: { configId: 'config-a', symbol: 'BTCUSDT' },
        stat: { netProfit: 3, orders: 1, wins: 1, losses: 0 },
      },
    ],
    manifest: {
      status: 'completed',
      testSuite: [
        { configId: 'config-a', symbol: 'BTCUSDT' },
        { configId: 'config-a', symbol: 'ETHUSDT' },
      ],
    },
    startTimestamp: 0,
    endTimestamp: 10 * DAY_MS,
  });

  assert.equal(grouped.statSummary.authoritativeAggregate, false);
  assert.equal(grouped.statSummary.completion.status, 'partial');
  assert.equal(grouped.statSummary.completion.planned, 2);
  assert.equal(grouped.statSummary.completion.completed, 1);
  assert.equal(grouped.statSummary.completion.missing, 1);
  assert.equal(grouped.statSummary.completion.errors, null);
  assert.equal(grouped.statSummary.completion.errorStatus, 'not_persisted');
  assert.match(grouped.statSummary.warnings.at(-1), /not an authoritative/);
  assert.match(
    grouped.statSummary.warnings.at(-2),
    /inspect the terminal\/report log/,
  );
});
