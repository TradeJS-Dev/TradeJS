/** @jest-environment node */

import type { CausalRangeGeometry } from '../../shared/causalRangeGeometry';
import { buildGridClassicFigures } from '../figures';
import { buildGridClassicGridPlan } from '../guardrails';

const geometry: CausalRangeGeometry = {
  ready: true,
  detected: true,
  upperPrice: 105,
  lowerPrice: 95,
  centerPrice: 100,
  position: 0.05,
  widthAtr: 10,
  centerSlopeAtrPerBar: 0,
  boundaryDivergenceAtr: 0,
  containmentRatio: 0.9,
  highPivotCount: 2,
  lowPivotCount: 2,
  rangeAgeBars: 40,
  breakoutDirection: null,
  volatilityExpansionRatio: 1,
  volatilityExpansion: false,
  upperLine: {
    startTimestamp: 1,
    startPrice: 105,
    endTimestamp: 10,
    endPrice: 105,
  },
  lowerLine: {
    startTimestamp: 1,
    startPrice: 95,
    endTimestamp: 10,
    endPrice: 95,
  },
  centerLine: {
    startTimestamp: 1,
    startPrice: 100,
    endTimestamp: 10,
    endPrice: 100,
  },
  pivots: [
    { kind: 'high', barIndex: 1, timestamp: 1, price: 105 },
    { kind: 'low', barIndex: 2, timestamp: 2, price: 95 },
  ],
  historySize: 40,
  pivotHistorySize: 4,
};

describe('GridClassic figures', () => {
  it('contains range, edge zones, grid, executed levels, stop, TP and breakout', () => {
    const plan = buildGridClassicGridPlan({
      direction: 'LONG',
      entryPrice: 95.5,
      lowerPrice: 95,
      upperPrice: 105,
      atr: 1,
      levels: 4,
      stepAtr: 0.7,
      stepRangeFraction: 0.1,
      levelSizeDecay: 1,
      stopAtrBuffer: 0.5,
      takeProfitMode: 'center',
      maxLossValue: 10,
      feeRate: 0.001,
      slippageRate: 0.0003,
    })!;
    const figures = buildGridClassicFigures({
      direction: 'LONG',
      geometry,
      entryTimestamp: 10,
      entryPrice: 95.5,
      plannedLevels: plan.levels,
      executedLevels: [{ level: 1, timestamp: 10, price: 95.5, qty: 1 }],
      stopLossPrice: plan.stopLossPrice,
      takeProfitPrice: plan.takeProfitPrice,
      edgeZoneFraction: 0.2,
      breakoutPoint: { timestamp: 11, value: 94.5 },
    });
    const lineKinds = figures.lines?.map((line) => line.kind);
    const pointKinds = figures.points?.map((points) => points.kind);

    expect(lineKinds).toEqual(
      expect.arrayContaining([
        'gridclassic_upper_boundary',
        'gridclassic_lower_boundary',
        'gridclassic_center',
        'gridclassic_lower_edge_zone',
        'gridclassic_upper_edge_zone',
        'gridclassic_virtual_level',
        'gridclassic_stop',
        'gridclassic_take_profit',
      ]),
    );
    expect(pointKinds).toEqual(
      expect.arrayContaining([
        'gridclassic_confirmed_pivots',
        'gridclassic_executed_levels',
        'gridclassic_entry',
        'gridclassic_breakout_or_invalidation',
      ]),
    );
  });
});
