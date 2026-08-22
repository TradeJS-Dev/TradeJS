import type {
  RuntimeSignalEvaluationRecord,
  RuntimeTradeRecord,
  Signal,
} from '@tradejs/types';
import { loadRuntimeParityEvidence } from '../evidence';

describe('loadRuntimeParityEvidence', () => {
  it('returns only evidence inside the requested strategy, symbol and time window', async () => {
    const loadRuntimeTrades = jest.fn(
      async () =>
        [
          {
            orderId: 'inside',
            strategy: 'TrendShift',
            symbol: 'BTCUSDT',
            entryTimestamp: 150,
          },
          {
            orderId: 'outside-time',
            strategy: 'TrendShift',
            symbol: 'BTCUSDT',
            entryTimestamp: 250,
          },
          {
            orderId: 'outside-strategy',
            strategy: 'Grid',
            symbol: 'BTCUSDT',
            entryTimestamp: 150,
          },
        ] as RuntimeTradeRecord[],
    );
    const loadRuntimeSignals = jest.fn(
      async () =>
        [
          {
            signalId: 'inside',
            strategy: 'TrendShift',
            symbol: 'BTCUSDT',
            timestamp: 100,
          },
          {
            signalId: 'outside-symbol',
            strategy: 'TrendShift',
            symbol: 'ETHUSDT',
            timestamp: 150,
          },
        ] as Signal[],
    );
    const loadRuntimeSignalEvaluations = jest.fn(
      async () =>
        [
          {
            evaluationId: 'inside',
            strategy: 'TrendShift',
            symbol: 'BTCUSDT',
            timestamp: 200,
          },
          {
            evaluationId: 'outside-time',
            strategy: 'TrendShift',
            symbol: 'BTCUSDT',
            timestamp: 201,
          },
        ] as RuntimeSignalEvaluationRecord[],
    );

    const result = await loadRuntimeParityEvidence(
      {
        userName: 'root',
        window: { start: 100, end: 200 },
        strategy: 'TrendShift',
        symbols: new Set(['BTCUSDT']),
      },
      {
        loadRuntimeTrades,
        loadRuntimeSignals,
        loadRuntimeSignalEvaluations,
      },
    );

    expect(result.runtimeTrades.map(({ orderId }) => orderId)).toEqual([
      'inside',
    ]);
    expect(result.runtimeSignals.map(({ signalId }) => signalId)).toEqual([
      'inside',
    ]);
    expect(
      result.runtimeSignalEvaluations.map(({ evaluationId }) => evaluationId),
    ).toEqual(['inside']);
    expect(loadRuntimeTrades).toHaveBeenCalledWith('root', {
      startTime: 100,
      endTime: 200,
    });
  });
});
