/** @jest-environment node */

import { buildGridFigures } from '../figures';

const series = {
  emaFast: [
    { timestamp: 10, value: 101 },
    { timestamp: 20, value: 102 },
  ],
  emaSlow: [
    { timestamp: 5, value: 99 },
    { timestamp: 20, value: 100 },
  ],
};

describe('Grid figures', () => {
  it('draws descending long levels with EMA, basket target, stop and entry marker', () => {
    const figures = buildGridFigures({
      direction: 'LONG',
      series,
      entryTimestamp: 20,
      entryPrice: 100,
      stepDistance: 2,
      maxLevels: 3,
      stopLossPrice: 90,
      takeProfitPrice: 106,
    });

    expect(figures.lines?.map(({ kind }) => kind)).toEqual([
      'grid_ema_fast',
      'grid_ema_slow',
      'grid_entry_level',
      'grid_entry_level',
      'grid_entry_level',
      'grid_basket_target',
      'grid_hard_stop',
    ]);
    expect(
      figures.lines
        ?.filter(({ kind }) => kind === 'grid_entry_level')
        .map(({ points }) => points[0]?.value),
    ).toEqual([98, 96, 94]);
    expect(figures.lines?.[2]?.points[0]?.timestamp).toBe(5);
    expect(figures.points?.[0]).toEqual(
      expect.objectContaining({
        kind: 'grid_entry',
        color: '#40d98f',
        points: [{ timestamp: 20, value: 100 }],
      }),
    );
  });

  it('draws ascending short levels and falls back to the entry timestamp without EMA history', () => {
    const figures = buildGridFigures({
      direction: 'SHORT',
      series: { emaFast: [], emaSlow: [] },
      entryTimestamp: 30,
      entryPrice: 100,
      stepDistance: 2,
      maxLevels: 0,
      stopLossPrice: 110,
      takeProfitPrice: 94,
    });

    const level = figures.lines?.find(
      ({ kind }) => kind === 'grid_entry_level',
    );
    expect(level?.points).toEqual([
      { timestamp: 30, value: 102 },
      { timestamp: 30, value: 102 },
    ]);
    expect(figures.lines?.some(({ kind }) => kind === 'grid_ema_fast')).toBe(
      false,
    );
    expect(figures.lines?.some(({ kind }) => kind === 'grid_ema_slow')).toBe(
      false,
    );
    expect(figures.points?.[0]?.color).toBe('#f67171');
  });

  it('draws confirmed range boundaries when geometry is ready', () => {
    const figures = buildGridFigures({
      direction: 'LONG',
      series,
      entryTimestamp: 20,
      entryPrice: 100,
      stepDistance: 2,
      maxLevels: 3,
      stopLossPrice: 90,
      takeProfitPrice: 106,
      rangeGeometry: {
        ready: true,
        detected: true,
        upperPrice: 108,
        lowerPrice: 94,
        position: 0.43,
        widthAtr: 7,
        centerSlopeAtrPerBar: 0,
        boundaryDivergenceAtr: 0.2,
        containmentRatio: 0.8,
        highPivotCount: 3,
        lowPivotCount: 3,
        startTimestamp: 5,
        upperStartPrice: 107,
        lowerStartPrice: 93,
      },
    });

    expect(
      figures.lines
        ?.filter(({ kind }) => kind?.startsWith('grid_range_'))
        .map(({ kind, points }) => ({ kind, points })),
    ).toEqual([
      {
        kind: 'grid_range_upper',
        points: [
          { timestamp: 5, value: 107 },
          { timestamp: 20, value: 108 },
        ],
      },
      {
        kind: 'grid_range_lower',
        points: [
          { timestamp: 5, value: 93 },
          { timestamp: 20, value: 94 },
        ],
      },
    ]);
  });
});
