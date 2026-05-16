import type { ClosedPnlRecord, RuntimeTradeRecord } from '@tradejs/types';
import {
  buildRuntimeStrategyStats,
  resolveStrategyNameByConfigKey,
  selectFocusSymbol,
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
        entryTimestamp: 100,
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

  it('builds aggregate runtime stats', () => {
    expect(
      buildRuntimeStrategyStats([
        {
          orderId: 'o1',
          strategy: 'TrendLine',
          symbol: 'BTCUSDT',
          direction: 'LONG',
          qty: 1,
          entryPrice: 100,
          entryTimestamp: 1,
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
          entryTimestamp: 2,
          status: 'active',
          currentPnl: -3,
        },
      ] as RuntimeTradeRecord[]),
    ).toEqual({
      trades: 2,
      activeTrades: 1,
      closedTrades: 1,
      wins: 1,
      losses: 0,
      winRate: 100,
      totalPnl: 9,
      closedPnl: 12,
      activePnl: -3,
      avgClosedPnl: 12,
    });
  });

  it('prefers active symbol as chart focus', () => {
    expect(
      selectFocusSymbol([
        {
          orderId: 'o1',
          strategy: 'TrendLine',
          symbol: 'BTCUSDT',
          direction: 'LONG',
          qty: 1,
          entryPrice: 100,
          entryTimestamp: 1,
          status: 'closed',
        },
        {
          orderId: 'o2',
          strategy: 'TrendLine',
          symbol: 'ETHUSDT',
          direction: 'SHORT',
          qty: 1,
          entryPrice: 200,
          entryTimestamp: 2,
          status: 'active',
        },
      ] as RuntimeTradeRecord[]),
    ).toBe('ETHUSDT');
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
});
