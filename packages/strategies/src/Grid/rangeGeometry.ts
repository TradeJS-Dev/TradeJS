import type { Candle } from '@tradejs/types';
import type { GridConfig } from './config';
export type { GridRangeFilterMode } from './config';
import {
  createCausalRangeGeometryEngine,
  type CausalRangeGeometry,
} from '../shared/causalRangeGeometry';

export interface GridRangeGeometry {
  ready: boolean;
  detected: boolean;
  upperPrice: number | null;
  lowerPrice: number | null;
  position: number | null;
  widthAtr: number | null;
  centerSlopeAtrPerBar: number | null;
  boundaryDivergenceAtr: number | null;
  containmentRatio: number | null;
  highPivotCount: number;
  lowPivotCount: number;
  startTimestamp: number | null;
  upperStartPrice: number | null;
  lowerStartPrice: number | null;
}

export interface GridRangeGeometryOptions {
  pivotLeftBars: number;
  pivotRightBars: number;
  lookbackBars: number;
  minPivotsPerSide: number;
  minWidthAtr: number;
  maxWidthAtr: number;
  maxCenterSlopeAtrPerBar: number;
  maxBoundaryDivergenceAtr: number;
  minContainmentRatio: number;
  containmentToleranceAtr: number;
}

const finite = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const positiveInteger = (value: unknown, fallback: number) =>
  Math.max(1, Math.floor(finite(value, fallback)));

export const getGridRangeGeometryOptions = (
  config: GridConfig,
): GridRangeGeometryOptions => ({
  pivotLeftBars: positiveInteger(config.GRID_RANGE_PIVOT_LEFT_BARS, 3),
  pivotRightBars: positiveInteger(config.GRID_RANGE_PIVOT_RIGHT_BARS, 3),
  lookbackBars: positiveInteger(config.GRID_RANGE_LOOKBACK_BARS, 96),
  minPivotsPerSide: positiveInteger(config.GRID_RANGE_MIN_PIVOTS_PER_SIDE, 2),
  minWidthAtr: Math.max(0, finite(config.GRID_RANGE_MIN_WIDTH_ATR, 3)),
  maxWidthAtr: Math.max(0, finite(config.GRID_RANGE_MAX_WIDTH_ATR, 18)),
  maxCenterSlopeAtrPerBar: Math.max(
    0,
    finite(config.GRID_RANGE_MAX_CENTER_SLOPE_ATR_PER_BAR, 0.03),
  ),
  maxBoundaryDivergenceAtr: Math.max(
    0,
    finite(config.GRID_RANGE_MAX_BOUNDARY_DIVERGENCE_ATR, 1),
  ),
  minContainmentRatio: Math.min(
    1,
    Math.max(0, finite(config.GRID_RANGE_MIN_CONTAINMENT_RATIO, 0.75)),
  ),
  containmentToleranceAtr: Math.max(
    0,
    finite(config.GRID_RANGE_CONTAINMENT_TOLERANCE_ATR, 0.2),
  ),
});

export const buildGridRangeGeometryKey = (config: GridConfig) =>
  JSON.stringify(getGridRangeGeometryOptions(config));

export const getEmptyGridRangeGeometry = (): GridRangeGeometry => ({
  ready: false,
  detected: false,
  upperPrice: null,
  lowerPrice: null,
  position: null,
  widthAtr: null,
  centerSlopeAtrPerBar: null,
  boundaryDivergenceAtr: null,
  containmentRatio: null,
  highPivotCount: 0,
  lowPivotCount: 0,
  startTimestamp: null,
  upperStartPrice: null,
  lowerStartPrice: null,
});

const toGridGeometry = (geometry: CausalRangeGeometry): GridRangeGeometry => ({
  ready: geometry.ready,
  detected: geometry.detected,
  upperPrice: geometry.upperPrice,
  lowerPrice: geometry.lowerPrice,
  position: geometry.position,
  widthAtr: geometry.widthAtr,
  centerSlopeAtrPerBar: geometry.centerSlopeAtrPerBar,
  boundaryDivergenceAtr: geometry.boundaryDivergenceAtr,
  containmentRatio: geometry.containmentRatio,
  highPivotCount: geometry.highPivotCount,
  lowPivotCount: geometry.lowPivotCount,
  startTimestamp: geometry.upperLine?.startTimestamp ?? null,
  upperStartPrice: geometry.upperLine?.startPrice ?? null,
  lowerStartPrice: geometry.lowerLine?.startPrice ?? null,
});

export const createGridRangeGeometryEngine = ({
  options,
}: {
  options: GridRangeGeometryOptions;
}) => {
  const engine = createCausalRangeGeometryEngine({
    options: {
      ...options,
      breakoutToleranceAtr: 0,
      minRangeAgeBars: 0,
      maxVolatilityExpansion: 0,
      lineStartMode: 'history',
    },
  });

  return {
    next: (candle: Candle, atr: number) =>
      toGridGeometry(engine.next(candle, atr)),
    getState: () => toGridGeometry(engine.getState()),
  };
};
