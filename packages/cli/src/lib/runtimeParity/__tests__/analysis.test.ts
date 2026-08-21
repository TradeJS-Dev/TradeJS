import type { RuntimeTradeRecord } from '@tradejs/types';
import type { TradeParityEntry } from '../../runtimeParity';
import { analyzeRuntimeParity } from '../analysis';
import type { ReplayTarget } from '../targets';

const backtestEntry = (id: string, timestamp: number): TradeParityEntry => ({
  id,
  source: 'backtest',
  strategy: 'TrendShift',
  symbol: 'BTCUSDT',
  direction: 'LONG',
  timestamp,
  price: 100,
});

describe('analyzeRuntimeParity', () => {
  it('matches comparable trades and aggregates unmatched entries per strategy', () => {
    const runtimeTrade = {
      orderId: 'runtime-1',
      strategy: 'TrendShift',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 1,
      entryPrice: 101,
      entryTimestamp: 100,
      status: 'active',
    } as RuntimeTradeRecord;
    const target: ReplayTarget = {
      strategy: 'TrendShift',
      symbol: 'BTCUSDT',
      sources: ['runtime'],
    };

    const result = analyzeRuntimeParity({
      runtimeTrades: [runtimeTrade],
      runtimeSignals: [],
      runtimeSignalEvaluations: [],
      backtestEntries: [
        backtestEntry('matched', 100),
        backtestEntry('backtest-only', 200),
      ],
      replaySignalEvaluations: [],
      replayTargets: [target],
      successfulTargetKeys: new Set(['TrendShift::BTCUSDT']),
      replayErrors: [],
      toleranceMs: 0,
    });

    expect(result.runtimeEntries).toHaveLength(1);
    expect(result.comparison.matched).toHaveLength(1);
    expect(result.comparison.runtimeOnly).toEqual([]);
    expect(result.comparison.backtestOnly.map(({ id }) => id)).toEqual([
      'backtest-only',
    ]);
    expect(result.strategyRows).toEqual([
      [
        'TrendShift',
        {
          runtime: 1,
          runtimeDuplicates: 0,
          backtest: 2,
          matched: 1,
          runtimeOnly: 0,
          backtestOnly: 1,
          targets: 1,
          compared: 1,
          errors: 0,
        },
      ],
    ]);
  });
});
