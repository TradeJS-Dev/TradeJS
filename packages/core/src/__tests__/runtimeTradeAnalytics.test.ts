import type { RuntimeTradeRecord } from '@tradejs/types';
import {
  buildRuntimeStrategyAnalytics,
  resolveStrategyNameByOrderLinkId,
  selectTradesForWindow,
  toRuntimeTradeView,
} from '../runtimeTrades';
import { createRuntimeOrderLinkPrefix } from '../trade';

describe('runtime trade analytics', () => {
  const trades = [
    {
      orderId: 'closed',
      strategy: 'TrendLine',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 1,
      entryPrice: 100,
      actualEntryPrice: 101,
      entryTimestamp: 100,
      exitTimestamp: 200,
      status: 'closed',
      closedPnl: 12,
      exitType: 'tp',
      actualExitPrice: 111,
      aiAnalysis: { takeProfitPrice: 110 },
    },
    {
      orderId: 'active',
      strategy: 'TrendLine',
      symbol: 'ETHUSDT',
      direction: 'SHORT',
      qty: 1,
      entryPrice: 200,
      entryTimestamp: 300,
      status: 'active',
      currentPnl: -3,
    },
  ] satisfies RuntimeTradeRecord[];

  it('builds an equity curve and concentration summary', () => {
    const result = buildRuntimeStrategyAnalytics({
      trades,
      startTime: 0,
      endTime: 400,
    });

    expect(result.orderLog).toEqual([
      [0, 100],
      [200, 112],
      [400, 109],
    ]);
    expect(result.stat).toMatchObject({ orders: 2, netProfit: 9, amount: 109 });
    expect(result.summary).toMatchObject({
      activePnl: -3,
      closedPnl: 12,
      totalPnl: 9,
      symbolConcentrationTop1: 80,
    });
  });

  it('keeps active-window semantics and maps execution diagnostics', () => {
    expect(
      selectTradesForWindow(trades, 250, new Set(['active'])).map(
        ({ orderId }) => orderId,
      ),
    ).toEqual(['active']);

    expect(toRuntimeTradeView(trades[0], 400)).toMatchObject({
      durationHours: 0,
      entrySlippagePercent: 1,
      exitSlippagePercent: 0.9091,
      takeProfitPercent: 10,
    });
  });

  it('excludes stale active trades unless runtime storage still marks them active', () => {
    const activeTrades = [
      { ...trades[1], orderId: 'stale', entryTimestamp: 10 },
      { ...trades[1], orderId: 'current', entryTimestamp: 20 },
    ];

    expect(
      selectTradesForWindow(activeTrades, 200, new Set(['current'])).map(
        ({ orderId }) => orderId,
      ),
    ).toEqual(['current']);
  });

  it('maps directional levels, fees and execution slippage', () => {
    const view = toRuntimeTradeView(
      {
        ...trades[0],
        entryPrice: 100,
        actualEntryPrice: 101,
        exitPrice: 95,
        actualExitPrice: 94,
        exitType: 'sl',
        openFee: 1,
        closeFee: 2,
        fundingFee: -0.5,
        aiAnalysis: { takeProfitPrice: 105, stopLossPrice: 95 },
      },
      400,
    );

    expect(view).toMatchObject({
      takeProfitPercent: 5,
      stopLossPercent: 5,
      entrySlippagePercent: 1,
      exitSlippagePercent: -1.0526,
      totalFee: 2.5,
    });
  });

  it('resolves strategy names from canonical runtime order links', () => {
    const orderLinkId = `${createRuntimeOrderLinkPrefix('TrendShift')}abc123def456`;

    expect(
      resolveStrategyNameByOrderLinkId({
        orderLinkId,
        strategyNames: ['TrendLine', 'TrendShift'],
      }),
    ).toBe('TrendShift');
  });
});
