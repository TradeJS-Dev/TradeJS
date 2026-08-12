import { summarizeReplayComparison } from '../scripts/replayRuntimeEvidence';

describe('replay runtime evidence strategy scoping', () => {
  it('keeps only the requested strategy lineage and rows', () => {
    const summary = summarizeReplayComparison(
      {
        mode: 'runtime',
        lineage: {
          replay: [
            { strategy: 'DoubleTap', lineage: { gitSha: 'doubletap' } },
            { strategy: 'TrendLine', lineage: { gitSha: 'trendline' } },
          ],
        },
        rows: [
          { strategyName: 'DoubleTap', matched: 1 },
          { strategyName: 'TrendLine', matched: 2 },
        ],
        details: {
          matched: [
            { backtest: { strategy: 'DoubleTap' }, pnl: { delta: 1 } },
            { backtest: { strategy: 'TrendLine' }, pnl: { delta: 2 } },
          ],
          backtestOnly: [],
          runtimeOnly: [],
        },
      },
      ['DoubleTap'],
    );

    expect(summary.lineage).toEqual({
      replay: [{ strategy: 'DoubleTap', lineage: { gitSha: 'doubletap' } }],
    });
    expect(summary.rows).toEqual([{ strategyName: 'DoubleTap', matched: 1 }]);
    expect(summary.counts).toEqual({
      matched: 1,
      backtestOnly: 0,
      runtimeOnly: 0,
    });
  });
});
