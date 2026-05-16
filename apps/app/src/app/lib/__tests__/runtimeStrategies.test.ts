import type { ClosedPnlRecord, RuntimeTradeRecord } from '@tradejs/types';
import { createRuntimeOrderLinkPrefix } from '@tradejs/core/trade';
import {
  buildExchangeFallbackRuntimeTrades,
  buildRuntimeStrategyAnalytics,
  resolveStrategyNameByConfigKey,
  resolveStrategyNameByOrderLinkId,
  selectTradesForWindow,
  takeClosedPnlMatch,
} from '../runtimeStrategies';

describe('runtimeStrategies helpers', () => {
  it('resolves strategy name from runtime config key', () => {
    expect(
      resolveStrategyNameByConfigKey(
        'root',
        'users:root:strategies:TrendLine:config',
      ),
    ).toBe('TrendLine');
    expect(
      resolveStrategyNameByConfigKey('root', 'users:root:strategies:TrendLine'),
    ).toBeNull();
  });

  it('selects active trades and recent closed trades for window', () => {
    const trades = [
      {
        orderId: 'a1',
        strategy: 'TrendLine',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 1,
        entryPrice: 100,
        entryTimestamp: 250,
        status: 'active',
      },
      {
        orderId: 'c1',
        strategy: 'TrendLine',
        symbol: 'ETHUSDT',
        direction: 'SHORT',
        qty: 1,
        entryPrice: 100,
        entryTimestamp: 10,
        status: 'closed',
        exitTimestamp: 220,
      },
      {
        orderId: 'c2',
        strategy: 'TrendLine',
        symbol: 'SOLUSDT',
        direction: 'LONG',
        qty: 1,
        entryPrice: 100,
        entryTimestamp: 10,
        status: 'closed',
        exitTimestamp: 20,
      },
    ] as RuntimeTradeRecord[];

    expect(
      selectTradesForWindow(trades, 200).map((trade) => trade.orderId),
    ).toEqual(['a1', 'c1']);
  });

  it('excludes stale active trades outside the window unless they are still active in redis refs', () => {
    const trades = [
      {
        orderId: 'stale-active',
        strategy: 'TrendLine',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 1,
        entryPrice: 100,
        entryTimestamp: 10,
        status: 'active',
      },
      {
        orderId: 'current-active',
        strategy: 'TrendLine',
        symbol: 'ETHUSDT',
        direction: 'LONG',
        qty: 1,
        entryPrice: 100,
        entryTimestamp: 20,
        status: 'active',
      },
    ] as RuntimeTradeRecord[];

    expect(
      selectTradesForWindow(trades, 200, new Set(['current-active'])).map(
        (trade) => trade.orderId,
      ),
    ).toEqual(['current-active']);
  });

  it('builds whole-strategy equity analytics', () => {
    const analytics = buildRuntimeStrategyAnalytics({
      trades: [
        {
          orderId: 'o1',
          strategy: 'TrendLine',
          symbol: 'BTCUSDT',
          direction: 'LONG',
          qty: 1,
          entryPrice: 100,
          entryTimestamp: 100,
          exitTimestamp: 200,
          status: 'closed',
          closedPnl: 12,
        },
        {
          orderId: 'o2',
          strategy: 'TrendLine',
          symbol: 'ETHUSDT',
          direction: 'SHORT',
          qty: 1,
          entryPrice: 200,
          entryTimestamp: 300,
          status: 'active',
          currentPnl: -3,
        },
      ] as RuntimeTradeRecord[],
      startTime: 0,
      endTime: 400,
    });

    expect(analytics.orderLog).toEqual([
      [0, 100],
      [200, 112],
      [400, 109],
    ]);
    expect(analytics.stat.netProfit).toBe(9);
    expect(analytics.stat.amount).toBe(109);
    expect(analytics.stat.orders).toBe(2);
    expect(analytics.summary).toEqual({
      totalTrades: 2,
      activeTrades: 1,
      closedTrades: 1,
      wins: 1,
      losses: 1,
      activePnl: -3,
      closedPnl: 12,
      totalPnl: 9,
    });
  });

  it('matches closed pnl by orderLinkId before symbol/time fallback', () => {
    const exactByOrderLinkId = new Map<string, ClosedPnlRecord>([
      [
        'tjs-order-1',
        {
          symbol: 'BTCUSDT',
          qty: 1,
          entryPrice: 100,
          exitPrice: 112,
          closedPnl: 12,
          closedAt: 1_700_000_001_000,
          orderId: 'bybit-order-1',
          orderLinkId: 'tjs-order-1',
        },
      ],
    ]);
    const row = exactByOrderLinkId.get('tjs-order-1')!;
    const symbolBuckets = new Map<string, ClosedPnlRecord[]>([
      ['BTCUSDT', [row]],
    ]);

    const match = takeClosedPnlMatch({
      exactByOrderLinkId,
      symbolBuckets,
      trade: {
        orderId: 'tjs-order-1',
        strategy: 'TrendLine',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 1,
        entryPrice: 100,
        entryTimestamp: 1_700_000_000_000,
        status: 'active',
      } as RuntimeTradeRecord,
    });

    expect(match?.closedPnl).toBe(12);
    expect(exactByOrderLinkId.size).toBe(0);
    expect(symbolBuckets.get('BTCUSDT')).toEqual([]);
  });

  it('resolves strategy name from encoded orderLinkId', () => {
    const orderLinkId = `${createRuntimeOrderLinkPrefix('TrendShift')}abc123def456`;

    expect(
      resolveStrategyNameByOrderLinkId({
        orderLinkId,
        strategyNames: ['TrendLine', 'TrendShift'],
      }),
    ).toBe('TrendShift');
  });

  it('builds exchange fallback trades grouped by orderLinkId', () => {
    const orderLinkId = `${createRuntimeOrderLinkPrefix('TrendShift')}abc123def456`;
    const trades = buildExchangeFallbackRuntimeTrades({
      entryRows: [
        {
          symbol: 'ZKUSDT',
          qty: 2,
          entryPrice: 1,
          entryTimestamp: 1_000,
          direction: 'SHORT',
          orderId: 'bybit-1',
          orderLinkId,
        },
        {
          symbol: 'ZKUSDT',
          qty: 3,
          entryPrice: 1.1,
          entryTimestamp: 1_100,
          direction: 'SHORT',
          orderId: 'bybit-1',
          orderLinkId,
        },
      ],
      closedPnlRows: [
        {
          symbol: 'ZKUSDT',
          qty: 5,
          entryPrice: 1.06,
          exitPrice: 0.95,
          closedPnl: 0.55,
          closedAt: 2_000,
          orderId: 'bybit-1',
          orderLinkId,
        },
      ],
      openPositions: [],
      strategyNames: ['TrendShift'],
      existingTrades: [],
      endTime: 3_000,
    });

    expect(trades).toEqual([
      expect.objectContaining({
        orderId: orderLinkId,
        strategy: 'TrendShift',
        symbol: 'ZKUSDT',
        qty: 5,
        status: 'closed',
        closedPnl: 0.55,
        exitTimestamp: 2_000,
      }),
    ]);
    expect(trades[0]?.entryPrice).toBeCloseTo(1.06, 8);
  });
});
