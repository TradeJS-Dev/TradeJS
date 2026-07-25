/** @jest-environment node */

import type { Candle } from '@tradejs/types';
import {
  createGridRangeGeometryEngine,
  GridRangeGeometryOptions,
} from '../rangeGeometry';

const makeCandle = (index: number, close: number): Candle => ({
  timestamp: 1_700_000_000_000 + index * 900_000,
  open: close,
  high: close + 0.4,
  low: close - 0.4,
  close,
  volume: 1_000,
  turnover: close * 1_000,
});

const options: GridRangeGeometryOptions = {
  pivotLeftBars: 2,
  pivotRightBars: 2,
  lookbackBars: 48,
  minPivotsPerSide: 2,
  minWidthAtr: 4,
  maxWidthAtr: 20,
  maxCenterSlopeAtrPerBar: 0.05,
  maxBoundaryDivergenceAtr: 1,
  minContainmentRatio: 0.75,
  containmentToleranceAtr: 0.2,
};

const rangeCycle = [100, 103, 105, 103, 100, 97, 95, 97];

describe('Grid range geometry', () => {
  it('confirms pivots only after the configured right-side bars', () => {
    const engine = createGridRangeGeometryEngine({ options });
    const candles = rangeCycle.map((close, index) => makeCandle(index, close));

    for (const candle of candles.slice(0, 4)) engine.next(candle, 1);
    expect(engine.getState().highPivotCount).toBe(0);

    engine.next(candles[4], 1);
    expect(engine.getState().highPivotCount).toBe(1);
  });

  it('detects a horizontal range from confirmed high and low regressions', () => {
    const engine = createGridRangeGeometryEngine({ options });
    let state = engine.getState();
    const closes = Array.from({ length: 6 }, () => rangeCycle).flat();
    closes.forEach((close, index) => {
      state = engine.next(makeCandle(index, close), 1);
    });

    expect(state).toEqual(
      expect.objectContaining({
        ready: true,
        detected: true,
        highPivotCount: expect.any(Number),
        lowPivotCount: expect.any(Number),
      }),
    );
    expect(state.highPivotCount).toBeGreaterThanOrEqual(2);
    expect(state.lowPivotCount).toBeGreaterThanOrEqual(2);
    expect(state.widthAtr).toBeGreaterThan(9);
    expect(Math.abs(state.centerSlopeAtrPerBar ?? 1)).toBeLessThan(0.01);
    expect(state.containmentRatio).toBeGreaterThanOrEqual(0.75);
  });

  it('does not classify a materially sloped channel as sideways', () => {
    const engine = createGridRangeGeometryEngine({
      options: {
        ...options,
        maxCenterSlopeAtrPerBar: 0.02,
      },
    });
    let state = engine.getState();
    const closes = Array.from({ length: 6 }, (_, cycleIndex) =>
      rangeCycle.map((value) => value + cycleIndex * 2),
    ).flat();
    closes.forEach((close, index) => {
      state = engine.next(makeCandle(index, close), 1);
    });

    expect(state.ready).toBe(true);
    expect(state.centerSlopeAtrPerBar).toBeGreaterThan(0.02);
    expect(state.detected).toBe(false);
  });
});
