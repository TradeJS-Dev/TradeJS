import {
  compactHistoricalReplayResultForPortfolio,
  mergeHistoricalReplayResults,
  type HistoricalSignalsReplayResult,
} from '../historicalSignalsReplayResults';

const result = (
  pnl: number,
  openedAt: number,
  exitedAt: number,
): HistoricalSignalsReplayResult => ({
  strategies: [
    {
      strategyName: 'Alpha',
      strategyConfig: {} as never,
      orderLog: [],
      positionLog: [
        {
          direction: 'LONG',
          open: { timestamp: openedAt, amount: 100 },
          close: { timestamp: exitedAt, amount: 100 + pnl },
          netProfit: pnl,
        },
      ],
      stat: null,
    },
  ],
  signals: [],
  orderLog: [],
  positionLog: [],
  cycleCount: 5,
  abortedCycles: 0,
  runtimeLineages: [],
  replayLineageScopes: [],
});

describe('historical replay result batches', () => {
  it('merges fixed-risk symbol batches through canonical position PnL', () => {
    const merged = mergeHistoricalReplayResults([
      result(10, 1, 2),
      result(-4, 3, 4),
    ]);

    expect(merged.strategies[0].positionLog).toHaveLength(2);
    expect(merged.strategies[0].stat).toMatchObject({
      orders: 2,
      wins: 1,
      losses: 1,
      netProfit: 6,
      amount: 106,
    });
    expect(merged.cycleCount).toBe(10);
  });

  it('rejects an empty batch list', () => {
    expect(() => mergeHistoricalReplayResults([])).toThrow(
      'Cannot merge an empty historical replay result list',
    );
  });

  it('rejects a batch that omits a strategy from the first batch', () => {
    const incomplete = result(5, 3, 4);
    incomplete.strategies = [];

    expect(() =>
      mergeHistoricalReplayResults([result(10, 1, 2), incomplete]),
    ).toThrow('Replay batch is missing strategy Alpha');
  });

  it('sorts merged artifacts and falls back to position amounts for PnL', () => {
    const first = result(10, 2, 5);
    const second = result(-4, 1, 5);
    delete second.strategies[0].positionLog[0].netProfit;
    first.strategies[0].orderLog = [{ timestamp: 2 } as never];
    second.strategies[0].orderLog = [{ timestamp: 1 } as never];
    first.signals = [{ timestamp: 2 } as never];
    second.signals = [{ timestamp: 1 } as never];
    first.orderLog = [{ timestamp: 2 } as never];
    second.orderLog = [{ timestamp: 1 } as never];

    const merged = mergeHistoricalReplayResults([first, second]);

    expect(
      merged.strategies[0].positionLog.map(
        (position) => position.open.timestamp,
      ),
    ).toEqual([2, 1]);
    expect(merged.strategies[0].stat).toMatchObject({ netProfit: 6 });
    expect(
      merged.strategies[0].orderLog.map((order) => order.timestamp),
    ).toEqual([1, 2]);
    expect(merged.signals.map((signal) => signal.timestamp)).toEqual([1, 2]);
    expect(merged.orderLog.map((order) => order.timestamp)).toEqual([1, 2]);
  });

  it('drops heavy signal and order artifacts but keeps realized positions', () => {
    const batch = result(10, 1, 2);
    batch.signals = [{ timestamp: 1, additionalIndicators: {} } as never];
    batch.orderLog = [{ signal: { additionalIndicators: {} } } as never];
    batch.strategies[0].orderLog = batch.orderLog;

    const compact = compactHistoricalReplayResultForPortfolio(batch);

    expect(compact.signals).toEqual([]);
    expect(compact.orderLog).toEqual([]);
    expect(compact.strategies[0].orderLog).toEqual([]);
    expect(compact.strategies[0].positionLog).toEqual(
      batch.strategies[0].positionLog,
    );
    expect(compact.strategies[0].stat).toEqual(batch.strategies[0].stat);
  });
});
