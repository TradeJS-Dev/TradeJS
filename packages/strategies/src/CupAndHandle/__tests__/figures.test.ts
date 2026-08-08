import { buildCupAndHandleFigures } from '../figures';
import { CupAndHandlePattern } from '../engine';

describe('CupAndHandle figures', () => {
  it('renders cup, handle, neckline, target, stop, pivots and entry', () => {
    const pattern: CupAndHandlePattern = {
      setupId: 'cup-and-handle-1',
      kind: 'cup_and_handle',
      direction: 'LONG',
      entryMode: 'close_acceptance',
      entryStage: 'close_accepted',
      pivots: [
        { timestamp: 1, index: 0, value: 110, kind: 'high' },
        { timestamp: 2, index: 1, value: 80, kind: 'low' },
        { timestamp: 3, index: 2, value: 109, kind: 'high' },
        { timestamp: 4, index: 3, value: 96, kind: 'low' },
      ],
      neckline: 110,
      targetPrice: 139.5,
      stopLossPrice: 94.525,
      cupDepth: 29.5,
      cupDepthPct: 26.94,
      cupDepthAtr: 4,
      cupDurationBars: 10,
      cupSymmetryRatio: 1,
      rimDifferencePct: 3.39,
      handleDepth: 13,
      handleDepthRatio: 0.44,
      handleDurationBars: 3,
      patternAgeBars: 14,
      breakoutDistancePct: 1.82,
      breakoutDistanceAtr: 0.3,
      breakoutDistanceDepthRatio: 0.068,
      breakoutCrossedOnSignalBar: true,
      breakoutTimestamp: 5,
      confirmationBars: 1,
      timestamp: 6,
      close: 112,
    };

    const figures = buildCupAndHandleFigures({
      pattern,
      entryTimestamp: 6,
      entryPrice: 112,
    });

    expect(figures.lines).toHaveLength(5);
    expect(figures.points).toHaveLength(2);
    expect(figures.lines?.map((line) => line.kind)).toEqual([
      'cuphandle_cup_and_handle_cup',
      'cuphandle_cup_and_handle_handle',
      'cuphandle_neckline',
      'cuphandle_target',
      'cuphandle_stop',
    ]);
    expect(figures.points?.[0].points).toHaveLength(4);
  });
});
