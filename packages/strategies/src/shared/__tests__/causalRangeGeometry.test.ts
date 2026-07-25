/** @jest-environment node */

import type { Candle } from '@tradejs/types';
import {
  createCausalRangeGeometryEngine,
  type CausalRangeGeometryOptions,
} from '../causalRangeGeometry';

const makeCandle = (index: number, close: number): Candle => ({
  timestamp: 1_700_000_000_000 + index * 900_000,
  open: close,
  high: close + 0.4,
  low: close - 0.4,
  close,
  volume: 1_000,
  turnover: close * 1_000,
});

const options: CausalRangeGeometryOptions = {
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
  breakoutToleranceAtr: 0.25,
  minRangeAgeBars: 8,
  maxVolatilityExpansion: 2,
};

const rangeCycle = [100, 103, 105, 103, 100, 97, 95, 97];

describe('causal range geometry', () => {
  it('confirms a pivot only after all configured right bars exist', () => {
    const engine = createCausalRangeGeometryEngine({ options });
    const candles = rangeCycle.map((close, index) => makeCandle(index, close));

    candles.slice(0, 4).forEach((candle) => engine.next(candle, 1));
    expect(engine.getState().highPivotCount).toBe(0);
    engine.next(candles[4], 1);
    expect(engine.getState().highPivotCount).toBe(1);
  });

  it('does not change an already emitted prefix when future candles exist', () => {
    const prefix = rangeCycle
      .concat(rangeCycle)
      .map((close, index) => makeCandle(index, close));
    const future = rangeCycle.map((close, index) =>
      makeCandle(prefix.length + index, close + 8),
    );
    const prefixOnly = createCausalRangeGeometryEngine({ options });
    const withFuture = createCausalRangeGeometryEngine({ options });

    const prefixState = prefix.map((candle) => prefixOnly.next(candle, 1));
    const comparedPrefix = prefix.map((candle) => withFuture.next(candle, 1));
    future.forEach((candle) => withFuture.next(candle, 1));

    expect(comparedPrefix).toEqual(prefixState);
  });

  it('detects a horizontal range but rejects a materially sloped channel', () => {
    const horizontal = createCausalRangeGeometryEngine({ options });
    const sloped = createCausalRangeGeometryEngine({
      options: { ...options, maxCenterSlopeAtrPerBar: 0.02 },
    });
    const closes = Array.from({ length: 6 }, () => rangeCycle).flat();
    const slopedCloses = Array.from({ length: 6 }, (_, cycleIndex) =>
      rangeCycle.map((value) => value + cycleIndex * 2),
    ).flat();

    closes.forEach((close, index) =>
      horizontal.next(makeCandle(index, close), 1),
    );
    slopedCloses.forEach((close, index) =>
      sloped.next(makeCandle(index, close), 1),
    );

    expect(horizontal.getState()).toEqual(
      expect.objectContaining({
        ready: true,
        detected: true,
        centerPrice: expect.any(Number),
      }),
    );
    expect(sloped.getState().ready).toBe(true);
    expect(
      Math.abs(sloped.getState().centerSlopeAtrPerBar ?? 0),
    ).toBeGreaterThan(0.02);
    expect(sloped.getState().detected).toBe(false);
  });

  it('is idempotent for the same timestamp and keeps bounded history', () => {
    const engine = createCausalRangeGeometryEngine({ options });
    const closes = Array.from({ length: 20 }, () => rangeCycle).flat();
    closes.forEach((close, index) => engine.next(makeCandle(index, close), 1));
    const duplicate = makeCandle(closes.length - 1, 999);
    const before = engine.getState();
    const after = engine.next(duplicate, 100);

    expect(after).toEqual(before);
    expect(after.historySize).toBeLessThanOrEqual(options.lookbackBars);
    expect(after.pivotHistorySize).toBeLessThanOrEqual(options.lookbackBars);
  });
});
