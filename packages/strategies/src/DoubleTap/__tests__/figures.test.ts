import { buildDoubleTapFigures } from '../figures';
import { DoubleTapPattern } from '../engine';

describe('DoubleTap figures', () => {
  it('renders pattern, neckline, target, stop, pivots and entry', () => {
    const pattern: DoubleTapPattern = {
      kind: 'double_bottom',
      direction: 'LONG',
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
      pivotTolerancePct: 15,
      breakoutDistancePct: 0.4,
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
