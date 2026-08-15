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
});
