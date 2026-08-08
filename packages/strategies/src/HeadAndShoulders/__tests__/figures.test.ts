import { HeadAndShouldersPattern } from '../engine';
import { buildHeadAndShouldersFigures } from '../figures';

describe('HeadAndShoulders figures', () => {
  it('renders the five pivots, sloped neckline, target, stop, and entry', () => {
    const pattern: HeadAndShouldersPattern = {
      setupId: 'head-and-shoulders-1',
      kind: 'head_and_shoulders',
      direction: 'SHORT',
      entryMode: 'breakout',
      entryStage: 'breakout',
      pivots: [
        { timestamp: 1, index: 1, value: 110, kind: 'high' },
        { timestamp: 2, index: 3, value: 95, kind: 'low' },
        { timestamp: 3, index: 5, value: 120, kind: 'high' },
        { timestamp: 4, index: 7, value: 96, kind: 'low' },
        { timestamp: 5, index: 9, value: 111, kind: 'high' },
      ],
      neckline: 97,
      necklineSlopePerBar: 0.25,
      targetPrice: 72.5,
      stopLossPrice: 121.225,
      headHeight: 24.5,
      headHeightPct: 25.65,
      headHeightAtr: 3,
      shoulderDifferencePct: 4.08,
      leftHeadProminenceRatio: 0.41,
      rightHeadProminenceRatio: 0.37,
      patternDurationBars: 8,
      patternSymmetryRatio: 1,
      patternAgeBars: 10,
      necklineSlopeRatio: 0.04,
      priorMoveAtr: 1.5,
      breakoutDistancePct: 3.09,
      breakoutDistanceAtr: 0.4,
      breakoutDistanceHeightRatio: 0.12,
      breakoutDelayBars: 2,
      breakoutCrossedOnSignalBar: true,
      breakoutTimestamp: 6,
      confirmationBars: 0,
      confirmationBodyAtr: null,
      confirmationCloseLocation: null,
      confirmationVolumeRel: null,
      timestamp: 6,
      close: 94,
    };

    const figures = buildHeadAndShouldersFigures({
      pattern,
      entryTimestamp: 6,
      entryPrice: 94,
    });

    expect(figures.lines?.map((line) => line.kind)).toEqual([
      'headshoulders_head_and_shoulders_pattern',
      'headshoulders_neckline',
      'headshoulders_target',
      'headshoulders_stop',
    ]);
    expect(figures.points).toHaveLength(2);
    expect(figures.points?.[0].points).toHaveLength(5);
  });
});
