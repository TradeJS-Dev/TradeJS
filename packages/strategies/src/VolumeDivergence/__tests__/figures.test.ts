import { buildVolumeDivergenceFigures } from '../figures';

describe('buildVolumeDivergenceFigures', () => {
  it('returns base lines/points for bullish divergence', () => {
    const figures = buildVolumeDivergenceFigures({
      kind: 'bullish',
      previousPivotIndex: 0,
      currentPivotIndex: 1,
      previousPivotLow: 90,
      previousPivotHigh: 100,
      currentPivotLow: 85,
      currentPivotHigh: 102,
      fullData: [{ timestamp: 1000 } as any, { timestamp: 2000 } as any],
    });

    expect(figures.lines).toHaveLength(1);
    expect(figures.points).toHaveLength(1);
    expect(figures.lines[0].points[0].value).toBe(90);
    expect(figures.lines[0].points[1].value).toBe(85);
  });
});
