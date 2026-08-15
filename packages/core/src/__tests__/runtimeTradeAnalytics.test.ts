import type { RuntimeTradeRecord } from '@tradejs/types';
import {
  buildRuntimeStrategyAnalytics,
  selectTradesForWindow,
  toRuntimeTradeView,
} from '../backtest';

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
});
