import { buildDoubleTapFigures } from '../figures';
import { DoubleTapPattern } from '../engine';

describe('DoubleTap figures', () => {
  it('renders pattern, neckline, target, stop, pivots and entry', () => {
    const pattern: DoubleTapPattern = {
      setupId: 'double-bottom-1',
      kind: 'double_bottom',
      direction: 'LONG',
      entryMode: 'close_acceptance',
      entryStage: 'close_accepted',
      pivots: [
        { timestamp: 1, index: 0, value: 110, kind: 'high', traded: false },
        { timestamp: 2, index: 1, value: 90, kind: 'low', traded: false },
        { timestamp: 3, index: 2, value: 105, kind: 'high', traded: false },
        { timestamp: 4, index: 3, value: 91, kind: 'low', traded: true },
      ],
      neckline: 105,
      targetPrice: 119,
      stopLossPrice: 90,
      height: 14,
      patternHeightAtr: 2,
      patternAgeBars: 4,
      tapSpacingBars: 2,
      legDurationSymmetryRatio: 1,
      pivotTolerancePct: 15,
      breakoutDistancePct: 0.4,
      breakoutDistanceAtr: 0.5,
      breakoutDistanceHeightRatio: 0.07,
      breakoutTimestamp: 4,
      confirmationBars: 1,
      timestamp: 5,
      close: 106,
    };

    const figures = buildDoubleTapFigures({
      pattern,
      entryTimestamp: 5,
      entryPrice: 106,
    });

    expect(figures.lines).toHaveLength(4);
    expect(figures.points).toHaveLength(2);
    expect(figures.lines?.map((line) => line.kind)).toEqual([
      'doubletap_double_bottom_pattern',
      'doubletap_neckline',
      'doubletap_target',
      'doubletap_stop',
    ]);
    expect(figures.points?.[0].points).toHaveLength(4);
  });
});
