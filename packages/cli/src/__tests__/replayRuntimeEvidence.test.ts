import { summarizeReplayComparison } from '../scripts/replayRuntimeEvidence';

const lineage = (seed: string) => ({
  schemaVersion: 3,
  strategyRevision: `sr1:${seed.repeat(16)}`,
  deploymentCompositionId: 'dc1:aaaaaaaaaaaaaaaa',
  strategyPackageVersion: '3.0.0',
  strategyDependencyVersions: { '@tradejs/strategy-kit': '3.0.0' },
  runtimePackageVersion: '3.2.0',
});

describe('replay runtime evidence strategy scoping', () => {
  it('keeps only the requested strategy lineage and rows', () => {
    const summary = summarizeReplayComparison(
      {
        mode: 'runtime',
        lineage: {
          replay: [
            { strategy: 'DoubleTap', lineage: lineage('1') },
            { strategy: 'TrendLine', lineage: lineage('2') },
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
      replay: [{ strategy: 'DoubleTap', lineage: lineage('1') }],
    });
    expect(summary.rows).toEqual([{ strategyName: 'DoubleTap', matched: 1 }]);
    expect(summary.counts).toEqual({
      matched: 1,
      backtestOnly: 0,
      runtimeOnly: 0,
    });
  });
});
