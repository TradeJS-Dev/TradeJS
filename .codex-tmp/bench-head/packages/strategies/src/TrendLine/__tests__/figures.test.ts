import { buildTrendLineFigures } from '../figures';

describe('buildTrendLineFigures', () => {
  it('returns base lines/points for trendline', () => {
    const line = {
      id: 'tl-1',
      mode: 'lows' as const,
      distance: 1,
      points: [
        { timestamp: 2, value: 102 },
        { timestamp: 1, value: 100 },
      ],
      touches: [{ timestamp: 3, value: 103 }],
    };

    const figures = buildTrendLineFigures(line as any);

    expect(figures.lines).toHaveLength(1);
    expect(figures.points).toHaveLength(1);
    expect(figures.lines[0].points[0].timestamp).toBe(1);
  });

  it('supports highs mode and missing points/touches arrays', () => {
    const line = {
      id: 'tl-2',
      mode: 'highs' as const,
      distance: 2,
      points: undefined,
      touches: undefined,
    };

    const figures = buildTrendLineFigures(line as any);

    expect(figures.lines[0].color).toBe('#fb923c');
    expect(figures.lines[0].points).toEqual([]);
    expect(figures.points[0].points).toEqual([]);
  });
});
