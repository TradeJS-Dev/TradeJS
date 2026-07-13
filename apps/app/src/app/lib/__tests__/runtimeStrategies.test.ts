import type { ClosedPnlRecord, RuntimeTradeRecord } from '@tradejs/types';
import { createRuntimeOrderLinkPrefix } from '@tradejs/core/trade';
import {
  buildExchangeFallbackRuntimeTrades,
  buildRuntimeStrategyIdentityKey,
  buildRuntimeStrategyAnalytics,
  resolveStrategyNameByConfigKey,
  resolveStrategyNameByOrderLinkId,
  selectTradesForWindow,
  takeClosedPnlMatch,
  toRuntimeTradeView,
} from '../runtimeStrategies';

describe('runtimeStrategies helpers', () => {
  it('builds isolated runtime identity keys with crypto defaults', () => {
    expect(buildRuntimeStrategyIdentityKey({ strategyName: 'TrendLine' })).toBe(
      'TrendLine:config:crypto:default:default:default',
    );
    expect(
      buildRuntimeStrategyIdentityKey({
        strategyName: 'TrendLine',
        universe: 'tradfi',
        accountId: 'tradfi-main',
        deploymentId: 'tradfi-live',
        policyProfileId: 'tradfi',
      }),
    ).toBe('TrendLine:config:tradfi:tradfi-main:tradfi-live:tradfi');
  });

  it('resolves strategy name from runtime config key', () => {
    expect(
      resolveStrategyNameByConfigKey(
        'root',
        'users:root:strategies:TrendLine:config',
      ),
    ).toBe('TrendLine');
    expect(
      resolveStrategyNameByConfigKey(
        'root',
        'users:root:strategies:TrendLine:conservative',
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
      symbolConcentrationTop1: 80,
      symbolConcentrationTop5: 100,
    });
  });

  it('maps runtime trade take-profit and stop-loss percentages', () => {
    const longView = toRuntimeTradeView({
      orderId: 'long-1',
      strategy: 'TrendLine',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 1,
      entryPrice: 100,
      entryTimestamp: 100,
      status: 'closed',
      closedPnl: 10,
      aiAnalysis: {
        takeProfitPrice: 105,
        stopLossPrice: 98,
      },
    } as RuntimeTradeRecord);
    const shortView = toRuntimeTradeView({
      orderId: 'short-1',
      strategy: 'TrendLine',
      symbol: 'ETHUSDT',
      direction: 'SHORT',
      qty: 1,
      entryPrice: 100,
      entryTimestamp: 100,
      status: 'closed',
      closedPnl: -2,
      aiAnalysis: {
        takeProfitPrice: 96,
        stopLossPrice: 102,
      },
    } as RuntimeTradeRecord);

    expect(longView.takeProfitPercent).toBe(5);
    expect(longView.stopLossPercent).toBe(2);
    expect(longView.takeProfitPrice).toBe(105);
    expect(longView.stopLossPrice).toBe(98);
    expect(shortView.takeProfitPercent).toBe(4);
    expect(shortView.stopLossPercent).toBe(2);
    expect(shortView.takeProfitPrice).toBe(96);
    expect(shortView.stopLossPrice).toBe(102);
  });

  it('maps runtime trade execution diagnostics for order cards', () => {
    const view = toRuntimeTradeView(
      {
        orderId: 'diag-1',
        strategy: 'TrendLine',
        symbol: 'CYSUSDT',
        direction: 'LONG',
        qty: 11,
        entryPrice: 0.46,
        actualEntryPrice: 0.4634,
        entryTimestamp: 1_000,
        status: 'closed',
        currentPnl: -0.2407,
        closedPnl: -0.2407,
        exitPrice: 0.4431,
        actualExitPrice: 0.4431,
        exitTimestamp: 3_601_000,
        exitType: 'sl',
        openFee: 0.00560714,
        closeFee: 0.00536151,
        fundingFee: 0.00652146,
        aiAnalysis: {
          stopLossPrice: 0.44,
          takeProfitPrice: 0.5,
        },
      } as RuntimeTradeRecord,
      5_000_000,
    );

    expect(view.qty).toBe(11);
    expect(view.durationHours).toBe(1);
    expect(view.actualEntryPrice).toBe(0.4634);
    expect(view.actualExitPrice).toBe(0.4431);
    expect(view.entrySlippagePercent).toBeCloseTo(0.7391, 4);
    expect(view.exitSlippagePercent).toBeCloseTo(0.7045, 4);
    expect(view.exitType).toBe('sl');
    expect(view.totalFee).toBe(0.01749011);
  });

  it('builds active exchange fallback trades with exchange TP, SL, and funding', () => {
    const orderLinkId = `${createRuntimeOrderLinkPrefix('AdaptiveMomentumRibbon')}abc123def456`;
    const trades = buildExchangeFallbackRuntimeTrades({
      entryRows: [
        {
          symbol: 'ZAMAUSDT',
          qty: 223,
          entryPrice: 0.03037,
          entryTimestamp: 1_000,
          direction: 'LONG',
          orderId: 'bybit-entry-1',
          orderLinkId,
          openFee: 0.00677251,
          fundingFee: -0.001,
          totalFee: 0.00577251,
        },
      ],
      closedPnlRows: [],
      openPositions: [
        {
          symbol: 'ZAMAUSDT',
          qty: 223,
          price: 0.03037,
          currentPrice: 0.03221,
          unrealizedPnl: 0.41,
          direction: 'LONG',
          takeProfitPrice: 0.034,
          stopLossPrice: 0.029,
        },
      ],
      strategyNames: ['AdaptiveMomentumRibbon'],
      existingTrades: [],
      endTime: 10_000,
    });

    expect(trades).toEqual([
      expect.objectContaining({
        orderId: orderLinkId,
        strategy: 'AdaptiveMomentumRibbon',
        status: 'active',
        currentPrice: 0.03221,
        currentPnl: 0.41,
        openFee: 0.00677251,
        fundingFee: -0.001,
        totalFee: 0.00577251,
        aiAnalysis: {
          takeProfitPrice: 0.034,
          stopLossPrice: 0.029,
        },
      }),
    ]);
    expect(toRuntimeTradeView(trades[0]!, 10_000).takeProfitPrice).toBe(0.034);
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

  it('matches closed pnl by exchange orderId when runtime order id is not orderLinkId', () => {
    const row = {
      symbol: 'CYSUSDT',
      qty: 11,
      entryPrice: 0.4634,
      exitPrice: 0.4431,
      closedPnl: -0.2407,
      closedAt: 1_780_825_606_000,
      orderId: 'bybit-order-1',
      orderLinkId: 'tjs-amr-order-1',
    } satisfies ClosedPnlRecord;
    const exactByOrderLinkId = new Map<string, ClosedPnlRecord>([
      ['tjs-amr-order-1', row],
    ]);
    const exactByOrderId = new Map<string, ClosedPnlRecord>([
      ['bybit-order-1', row],
    ]);
    const symbolBuckets = new Map<string, ClosedPnlRecord[]>([
      ['CYSUSDT', [row]],
    ]);

    const match = takeClosedPnlMatch({
      exactByOrderLinkId,
      exactByOrderId,
      symbolBuckets,
      trade: {
        orderId: 'bybit-order-1',
        strategy: 'AdaptiveMomentumRibbon',
        symbol: 'CYSUSDT',
        direction: 'LONG',
        qty: 11,
        entryPrice: 0.4634,
        entryTimestamp: 1_780_812_000_000,
        status: 'active',
      } as RuntimeTradeRecord,
    });

    expect(match?.closedPnl).toBe(-0.2407);
    expect(exactByOrderLinkId.size).toBe(0);
    expect(exactByOrderId.size).toBe(0);
    expect(symbolBuckets.get('CYSUSDT')).toEqual([]);
  });

  it('matches the nearest closed pnl row by symbol and direction', () => {
    const olderShortRow = {
      symbol: 'CYSUSDT',
      direction: 'SHORT',
      qty: 11,
      entryPrice: 0.47,
      exitPrice: 0.45,
      closedPnl: 0.2,
      closedAt: 1_780_820_000_000,
      orderId: 'short-row',
    } satisfies ClosedPnlRecord;
    const laterLongRow = {
      symbol: 'CYSUSDT',
      direction: 'LONG',
      qty: 11,
      entryPrice: 0.4634,
      exitPrice: 0.44,
      closedPnl: -0.31,
      closedAt: 1_780_830_000_000,
      orderId: 'later-long-row',
    } satisfies ClosedPnlRecord;
    const nearestLongRow = {
      symbol: 'CYSUSDT',
      direction: 'LONG',
      qty: 11,
      entryPrice: 0.4634,
      exitPrice: 0.4431,
      closedPnl: -0.2407,
      closedAt: 1_780_825_606_000,
      orderId: 'nearest-long-row',
    } satisfies ClosedPnlRecord;
    const symbolBuckets = new Map<string, ClosedPnlRecord[]>([
      ['CYSUSDT', [laterLongRow, olderShortRow, nearestLongRow]],
    ]);

    const match = takeClosedPnlMatch({
      exactByOrderLinkId: new Map(),
      symbolBuckets,
      trade: {
        orderId: 'runtime-order-without-exact-match',
        strategy: 'AdaptiveMomentumRibbon',
        symbol: 'CYSUSDT',
        direction: 'LONG',
        qty: 11,
        entryPrice: 0.4634,
        entryTimestamp: 1_780_812_000_000,
        status: 'closed',
        closedPnl: 0,
      } as RuntimeTradeRecord,
    });

    expect(match).toBe(nearestLongRow);
    expect(symbolBuckets.get('CYSUSDT')).toEqual([laterLongRow, olderShortRow]);
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

  it('builds exchange fallback trades from closed pnl rows when entry executions are missing', () => {
    const orderLinkId = `${createRuntimeOrderLinkPrefix('DoubleTap')}abc123def456`;
    const trades = buildExchangeFallbackRuntimeTrades({
      entryRows: [],
      closedPnlRows: [
        {
          symbol: 'ETHUSDT',
          qty: 0.5,
          entryPrice: 2000,
          exitPrice: 2100,
          closedPnl: 50,
          closedAt: 2_000,
          direction: 'LONG',
          entryTimestamp: 1_000,
          orderId: 'bybit-closed-1',
          orderLinkId,
        },
      ],
      openPositions: [],
      strategyNames: ['DoubleTap'],
      existingTrades: [],
      endTime: 3_000,
    });

    expect(trades).toEqual([
      expect.objectContaining({
        orderId: orderLinkId,
        strategy: 'DoubleTap',
        symbol: 'ETHUSDT',
        direction: 'LONG',
        status: 'closed',
        closedPnl: 50,
        entryTimestamp: 1_000,
        exitTimestamp: 2_000,
      }),
    ]);
  });
});
