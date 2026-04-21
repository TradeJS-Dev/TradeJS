import {
  compareTradeParityEntries,
  dedupeRuntimeParityEntries,
  extractBacktestEntryParityEntries,
  extractRuntimeParityEntries,
  summarizeMatchedParity,
} from '../lib/runtimeParity';
import { resolveTimeWindow } from '../lib/timeWindow';
import type { OrderLogData, RuntimeTradeRecord } from '@tradejs/types';

describe('resolveTimeWindow', () => {
  it('keeps default window when no overrides are provided', () => {
    expect(
      resolveTimeWindow({
        defaultStartMs: 1_000,
        defaultEndMs: 2_000,
      }),
    ).toEqual({
      start: 1_000,
      end: 2_000,
      source: 'default',
    });
  });

  it('builds a recent window from days', () => {
    expect(
      resolveTimeWindow({
        days: 2,
        nowMs: 10_000,
        defaultStartMs: 1_000,
        defaultEndMs: 10_000,
      }),
    ).toEqual({
      start: 10_000 - 2 * 24 * 60 * 60 * 1000,
      end: 10_000,
      source: 'days',
    });
  });

  it('normalizes explicit second timestamps to ms', () => {
    expect(
      resolveTimeWindow({
        startTime: 1_700_000_000,
        endTime: 1_700_000_900,
        defaultStartMs: 0,
      }),
    ).toEqual({
      start: 1_700_000_000_000,
      end: 1_700_000_900_000,
      source: 'explicit',
    });
  });
});

describe('runtime parity helpers', () => {
  const runtimeTrades: RuntimeTradeRecord[] = [
    {
      orderId: 'ord-1',
      signalId: 'sig-1',
      strategy: 'TrendLine',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 1,
      entryPrice: 100,
      entryTimestamp: 1_000,
      status: 'closed',
    },
    {
      orderId: 'ord-2',
      signalId: 'sig-2',
      strategy: 'TrendLine',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 1,
      entryPrice: 110,
      entryTimestamp: 4_000,
      status: 'closed',
    },
  ];

  const orderLog: OrderLogData = [
    {
      symbol: 'BTCUSDT',
      qty: 1,
      price: 101,
      timestamp: 1_100,
      direction: 'LONG',
      type: 'OPEN_LONG',
      profit: -1,
      amount: 99,
      index: 0,
      signal: {
        signalId: 'bt-1',
        symbol: 'BTCUSDT',
        interval: '15',
        strategy: 'TrendLine',
        direction: 'LONG',
        timestamp: 1_000,
        figures: {},
        prices: {
          currentPrice: 101,
          takeProfitPrice: 120,
          stopLossPrice: 95,
          riskRatio: 2,
        },
        indicators: {},
      },
    },
    {
      symbol: 'BTCUSDT',
      qty: 1,
      price: 109,
      timestamp: 4_100,
      direction: 'LONG',
      type: 'OPEN_LONG',
      profit: -1,
      amount: 98,
      index: 1,
      signal: {
        signalId: 'bt-2',
        symbol: 'BTCUSDT',
        interval: '15',
        strategy: 'TrendLine',
        direction: 'LONG',
        timestamp: 4_500,
        figures: {},
        prices: {
          currentPrice: 109,
          takeProfitPrice: 130,
          stopLossPrice: 102,
          riskRatio: 2,
        },
        indicators: {},
      },
    },
    {
      symbol: 'BTCUSDT',
      qty: 1,
      price: 120,
      timestamp: 7_000,
      direction: 'LONG',
      type: 'TAKE_PROFIT_LONG',
      profit: 20,
      amount: 118,
      index: 2,
    },
  ];

  it('extracts only backtest entry orders', () => {
    expect(extractBacktestEntryParityEntries(orderLog)).toEqual([
      expect.objectContaining({
        id: 'bt-1',
        source: 'backtest',
        strategy: 'TrendLine',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        timestamp: 1_000,
        price: 101,
      }),
      expect.objectContaining({
        id: 'bt-2',
        source: 'backtest',
        strategy: 'TrendLine',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        timestamp: 4_500,
        price: 109,
      }),
    ]);
  });

  it('matches nearest entries within tolerance and leaves extras unmatched', () => {
    const comparison = compareTradeParityEntries({
      runtimeEntries: extractRuntimeParityEntries(runtimeTrades),
      backtestEntries: extractBacktestEntryParityEntries(orderLog),
      toleranceMs: 600,
    });

    expect(comparison.matched).toHaveLength(2);
    expect(comparison.runtimeOnly).toEqual([]);
    expect(comparison.backtestOnly).toEqual([]);
    expect(comparison.matched[0]).toEqual(
      expect.objectContaining({
        timestampDiffMs: 0,
        priceDeltaPct: 1,
      }),
    );
    expect(comparison.matched[1]).toEqual(
      expect.objectContaining({
        timestampDiffMs: 500,
      }),
    );
  });

  it('dedupes repeated runtime entries by strategy, symbol, direction, and timestamp', () => {
    const runtimeEntries = extractRuntimeParityEntries([
      ...runtimeTrades,
      {
        orderId: 'ord-1-copy',
        signalId: 'sig-1-copy',
        strategy: 'TrendLine',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 1,
        entryPrice: 100.1,
        entryTimestamp: 1_000,
        status: 'closed',
      },
    ]);

    const deduped = dedupeRuntimeParityEntries(runtimeEntries);

    expect(deduped.entries.map((entry) => entry.id)).toEqual([
      'ord-1',
      'ord-2',
    ]);
    expect(deduped.duplicateEntries.map((entry) => entry.id)).toEqual([
      'ord-1-copy',
    ]);
    expect(deduped.duplicateGroups).toHaveLength(1);
    expect(deduped.duplicateGroups[0]).toEqual(
      expect.objectContaining({
        strategy: 'TrendLine',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        timestamp: 1_000,
      }),
    );
  });

  it('summarizes matched deltas', () => {
    const comparison = compareTradeParityEntries({
      runtimeEntries: extractRuntimeParityEntries(runtimeTrades),
      backtestEntries: extractBacktestEntryParityEntries(orderLog),
      toleranceMs: 600,
    });

    const summary = summarizeMatchedParity(comparison.matched);

    expect(summary.avgPriceDeltaPct).toBeCloseTo((1 + (1 / 110) * 100) / 2, 6);
    expect(summary.maxPriceDeltaPct).toBeCloseTo(1, 6);
    expect(summary.avgTimestampDiffMs).toBe(250);
    expect(summary.maxTimestampDiffMs).toBe(500);
  });
});
