import { createRuntimeOrderLinkPrefix } from '@tradejs/core/trade';
import {
  buildExchangeFallbackRuntimeTrades,
  takeClosedPnlMatch,
} from '../runtimeTrades';

describe('runtime exchange trade reconstruction', () => {
  it('aggregates entry fills and reconciles exact closed pnl', () => {
    const orderLinkId = `${createRuntimeOrderLinkPrefix('TrendShift')}abc123def456`;
    const trades = buildExchangeFallbackRuntimeTrades({
      entryRows: [
        {
          symbol: 'BTCUSDT',
          qty: 2,
          entryPrice: 100,
          entryTimestamp: 1_000,
          direction: 'LONG',
          orderId: 'fill-1',
          orderLinkId,
        },
        {
          symbol: 'BTCUSDT',
          qty: 3,
          entryPrice: 110,
          entryTimestamp: 1_100,
          direction: 'LONG',
          orderId: 'fill-2',
          orderLinkId,
        },
      ],
      closedPnlRows: [
        {
          symbol: 'BTCUSDT',
          qty: 5,
          entryPrice: 106,
          exitPrice: 120,
          closedPnl: 70,
          closedAt: 2_000,
          orderId: 'exchange-order',
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
        qty: 5,
        entryPrice: 106,
        status: 'closed',
        closedPnl: 70,
      }),
    ]);
  });

  it('removes an exact reconciliation row from every lookup bucket', () => {
    const row = {
      symbol: 'ETHUSDT',
      qty: 1,
      entryPrice: 100,
      exitPrice: 110,
      closedPnl: 10,
      closedAt: 2_000,
      orderId: 'exchange-order',
      orderLinkId: 'runtime-order',
    };
    const exactByOrderLinkId = new Map([['runtime-order', row]]);
    const exactByOrderId = new Map([['exchange-order', row]]);
    const symbolBuckets = new Map([['ETHUSDT', [row]]]);

    expect(
      takeClosedPnlMatch({
        exactByOrderLinkId,
        exactByOrderId,
        symbolBuckets,
        trade: {
          orderId: 'runtime-order',
          strategy: 'TrendShift',
          symbol: 'ETHUSDT',
          direction: 'LONG',
          qty: 1,
          entryPrice: 100,
          entryTimestamp: 1_000,
          status: 'active',
        },
      }),
    ).toBe(row);
    expect(exactByOrderLinkId.size).toBe(0);
    expect(exactByOrderId.size).toBe(0);
    expect(symbolBuckets.get('ETHUSDT')).toEqual([]);
  });

  it('reconstructs an active exchange trade with risk levels and fees', () => {
    const orderLinkId = `${createRuntimeOrderLinkPrefix('TrendShift')}active123456`;
    const trades = buildExchangeFallbackRuntimeTrades({
      entryRows: [
        {
          symbol: 'ETHUSDT',
          qty: 2,
          entryPrice: 100,
          entryTimestamp: 1_000,
          direction: 'SHORT',
          orderLinkId,
          openFee: 0.1,
          fundingFee: -0.02,
        },
      ],
      closedPnlRows: [],
      openPositions: [
        {
          symbol: 'ETHUSDT',
          qty: 2,
          price: 100,
          currentPrice: 95,
          unrealizedPnl: 10,
          direction: 'SHORT',
          takeProfitPrice: 90,
          stopLossPrice: 105,
        },
      ],
      strategyNames: ['TrendShift'],
      existingTrades: [],
      endTime: 2_000,
    });

    expect(trades).toEqual([
      expect.objectContaining({
        orderId: orderLinkId,
        status: 'active',
        currentPnl: 10,
        openFee: 0.1,
        fundingFee: -0.02,
        aiAnalysis: { takeProfitPrice: 90, stopLossPrice: 105 },
      }),
    ]);
  });

  it('reconstructs closed trades even when entry executions are unavailable', () => {
    const orderLinkId = `${createRuntimeOrderLinkPrefix('DoubleTap')}closed123456`;
    const trades = buildExchangeFallbackRuntimeTrades({
      entryRows: [],
      closedPnlRows: [
        {
          symbol: 'SOLUSDT',
          qty: 3,
          entryPrice: 100,
          exitPrice: 110,
          closedPnl: 30,
          closedAt: 2_000,
          direction: 'LONG',
          entryTimestamp: 1_000,
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
        strategy: 'DoubleTap',
        status: 'closed',
        entryTimestamp: 1_000,
        exitTimestamp: 2_000,
        closedPnl: 30,
      }),
    ]);
  });
});
