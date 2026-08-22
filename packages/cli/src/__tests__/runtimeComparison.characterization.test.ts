import type {
  ExchangeEntryRecord,
  RuntimeSignalEvaluationRecord,
} from '@tradejs/types';
import { createRuntimeOrderLinkPrefix } from '@tradejs/core/trade';
import type { TradeParityEntry } from '../lib/runtimeParity';
import { buildStrategyNameByOrderLinkKey } from '../lib/runtimeParityDetails';
import {
  compareExchangeEntriesToBacktest,
  splitExchangeMatchesByRuntimeOrderStatus,
} from '../lib/replay/runtimeComparison';

jest.mock('../lib/replay/cliConfig', () => ({
  replayInterval: '15',
  replayProjectRoot: '/tmp/tradejs-runtime-comparison',
  replayUserName: 'root',
}));

const exchangeEntry = (
  timestamp: number,
  overrides: Partial<ExchangeEntryRecord> = {},
): ExchangeEntryRecord => ({
  symbol: 'BTCUSDT',
  direction: 'LONG',
  qty: 1,
  entryPrice: 100,
  entryTimestamp: timestamp,
  ...overrides,
});

const backtestEntry = (
  id: string,
  timestamp: number,
  overrides: Partial<TradeParityEntry> = {},
): TradeParityEntry => ({
  id,
  source: 'backtest',
  strategy: 'TrendShift',
  symbol: 'BTCUSDT',
  direction: 'LONG',
  timestamp,
  price: 100,
  ...overrides,
});

describe('runtime comparison characterization', () => {
  it('matches each exchange execution to the nearest available backtest entry', () => {
    const result = compareExchangeEntriesToBacktest({
      exchangeEntries: [exchangeEntry(1_090), exchangeEntry(2_110)],
      backtestEntries: [
        backtestEntry('first', 100),
        backtestEntry('second', 1_100),
        backtestEntry('outside', 5_000),
      ],
      toleranceMs: 20,
      backtestTimestampOffsetMs: 1_000,
    });

    expect(
      result.matched.map(({ exchange, backtest, timestampDiffMs }) => ({
        exchangeTimestamp: exchange.entryTimestamp,
        backtestId: backtest.id,
        timestampDiffMs,
      })),
    ).toEqual([
      {
        exchangeTimestamp: 1_090,
        backtestId: 'first',
        timestampDiffMs: 10,
      },
      {
        exchangeTimestamp: 2_110,
        backtestId: 'second',
        timestampDiffMs: 10,
      },
    ]);
    expect(result.exchangeOnly).toEqual([]);
    expect(result.backtestOnly.map(({ id }) => id)).toEqual(['outside']);
  });

  it('keeps an exchange match out of completed results when runtime evidence records a failed order', () => {
    const orderLinkId = `${createRuntimeOrderLinkPrefix('TrendShift')}abcdef`;
    const comparison = compareExchangeEntriesToBacktest({
      exchangeEntries: [exchangeEntry(1_100, { orderLinkId })],
      backtestEntries: [backtestEntry('matched', 100)],
      toleranceMs: 10,
      backtestTimestampOffsetMs: 1_000,
    });
    const evaluation: RuntimeSignalEvaluationRecord = {
      evaluationId: 'evaluation-1',
      userName: 'root',
      strategy: 'TrendShift',
      symbol: 'BTCUSDT',
      interval: '15',
      timestamp: 100,
      evaluatedAt: 100,
      status: 'signal',
      direction: 'LONG',
      orderStatus: 'failed',
      reason: 'SET_STOP_LOSS_FAILED',
    };

    const result = splitExchangeMatchesByRuntimeOrderStatus({
      matched: comparison.matched,
      strategyNameByOrderLinkKey: buildStrategyNameByOrderLinkKey([
        'TrendShift',
      ]),
      runtimeSignals: [],
      runtimeSignalEvaluations: [evaluation],
      toleranceMs: 10,
      signalTimestampOffsetMs: 1_000,
    });

    expect(result.completed).toEqual([]);
    expect(result.orderFailed).toEqual([
      expect.objectContaining({
        reason: 'SET_STOP_LOSS_FAILED',
        backtest: expect.objectContaining({ id: 'matched' }),
      }),
    ]);
  });
});
