import type { Candle, Direction, StrategyFigurePoint } from '@tradejs/types';
import type { GridClassicConfig } from './config';
import {
  createCausalRangeGeometryEngine,
  type CausalRangeGeometry,
  type CausalRangeGeometryOptions,
} from '../shared/causalRangeGeometry';

export interface GridClassicSnapshot {
  timestamp: number;
  close: number;
  atr: number;
  candleRangeAtr: number;
  volatilityShock: boolean;
  geometry: CausalRangeGeometry;
  longRejection: boolean;
  shortRejection: boolean;
  longCloseInside: boolean;
  shortCloseInside: boolean;
  entryDirection: Direction | null;
}

export interface GridClassicRuntimeState {
  snapshot: GridClassicSnapshot | null;
  closeSeries: StrategyFigurePoint[];
}

type AtrState = {
  value: number | null;
  count: number;
  previousClose: number | null;
};

const finite = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const positiveInteger = (value: unknown, fallback: number) =>
  Math.max(1, Math.floor(finite(value, fallback)));

export const getGridClassicGeometryOptions = (
  config: GridClassicConfig,
): CausalRangeGeometryOptions => ({
  pivotLeftBars: positiveInteger(config.GRIDCLASSIC_PIVOT_LEFT_BARS, 3),
  pivotRightBars: positiveInteger(config.GRIDCLASSIC_PIVOT_RIGHT_BARS, 3),
  lookbackBars: positiveInteger(config.GRIDCLASSIC_LOOKBACK_BARS, 96),
  minPivotsPerSide: positiveInteger(config.GRIDCLASSIC_MIN_PIVOTS_PER_SIDE, 3),
  minWidthAtr: Math.max(0, finite(config.GRIDCLASSIC_MIN_WIDTH_ATR, 3)),
  maxWidthAtr: Math.max(0, finite(config.GRIDCLASSIC_MAX_WIDTH_ATR, 14)),
  maxCenterSlopeAtrPerBar: Math.max(
    0,
    finite(config.GRIDCLASSIC_MAX_CENTER_SLOPE_ATR_PER_BAR, 0.025),
  ),
  maxBoundaryDivergenceAtr: Math.max(
    0,
    finite(config.GRIDCLASSIC_MAX_BOUNDARY_DIVERGENCE_ATR, 0.8),
  ),
  minContainmentRatio: Math.min(
    1,
    Math.max(0, finite(config.GRIDCLASSIC_MIN_CONTAINMENT_RATIO, 0.78)),
  ),
  containmentToleranceAtr: Math.max(
    0,
    finite(config.GRIDCLASSIC_CONTAINMENT_TOLERANCE_ATR, 0.2),
  ),
  breakoutToleranceAtr: Math.max(
    0,
    finite(config.GRIDCLASSIC_BREAKOUT_TOLERANCE_ATR, 0.25),
  ),
  minRangeAgeBars: positiveInteger(config.GRIDCLASSIC_MIN_RANGE_AGE_BARS, 32),
  maxVolatilityExpansion: Math.max(
    0,
    finite(config.GRIDCLASSIC_MAX_VOLATILITY_EXPANSION, 1.8),
  ),
});

const getEngineOptions = (config: GridClassicConfig) => ({
  atrPeriod: positiveInteger(config.GRIDCLASSIC_ATR_PERIOD, 14),
  edgeZoneFraction: Math.min(
    0.45,
    Math.max(0.01, finite(config.GRIDCLASSIC_EDGE_ZONE_FRACTION, 0.22)),
  ),
  entryConfirmation: config.GRIDCLASSIC_ENTRY_CONFIRMATION,
  minRejectionWickRatio: Math.max(
    0,
    finite(config.GRIDCLASSIC_MIN_REJECTION_WICK_RATIO, 1),
  ),
  maxCandleRangeAtr: Math.max(
    0.1,
    finite(config.GRIDCLASSIC_MAX_CANDLE_RANGE_ATR, 3),
  ),
  maxFigurePoints: positiveInteger(config.GRIDCLASSIC_MAX_FIGURE_POINTS, 180),
});

export const buildGridClassicDetectorKey = (config: GridClassicConfig) =>
  JSON.stringify({
    geometry: getGridClassicGeometryOptions(config),
    engine: getEngineOptions(config),
  });

const updateAtr = (state: AtrState, candle: Candle, period: number): number => {
  const trueRange =
    state.previousClose == null
      ? candle.high - candle.low
      : Math.max(
          candle.high - candle.low,
          Math.abs(candle.high - state.previousClose),
          Math.abs(candle.low - state.previousClose),
        );
  state.count += 1;
  state.value =
    state.value == null
      ? trueRange
      : state.count <= period
        ? (state.value * (state.count - 1) + trueRange) / state.count
        : (state.value * (period - 1) + trueRange) / period;
  state.previousClose = candle.close;
  return Math.max(state.value, Number.EPSILON);
};

const hasConfirmation = ({
  mode,
  rejection,
  closeInside,
}: {
  mode: GridClassicConfig['GRIDCLASSIC_ENTRY_CONFIRMATION'];
  rejection: boolean;
  closeInside: boolean;
}) =>
  mode === 'rejection'
    ? rejection
    : mode === 'close_inside'
      ? closeInside
      : rejection || closeInside;

export const buildGridClassicSignalContext = ({
  snapshot,
  direction,
  gridLevel,
  filledLevels,
  remainingLevels,
  stopLossPrice,
}: {
  snapshot: GridClassicSnapshot;
  direction: Direction;
  gridLevel: number;
  filledLevels: number;
  remainingLevels: number;
  stopLossPrice: number;
}) => {
  const { geometry } = snapshot;
  return {
    timestamp: snapshot.timestamp,
    currentPrice: snapshot.close,
    direction,
    gridLevel,
    filledLevels,
    remainingLevels,
    rangeReady: geometry.ready,
    rangeDetected: geometry.detected,
    upperPrice: geometry.upperPrice,
    lowerPrice: geometry.lowerPrice,
    centerPrice: geometry.centerPrice,
    position: geometry.position,
    widthAtr: geometry.widthAtr,
    centerSlopeAtrPerBar: geometry.centerSlopeAtrPerBar,
    boundaryDivergenceAtr: geometry.boundaryDivergenceAtr,
    containmentRatio: geometry.containmentRatio,
    highPivotCount: geometry.highPivotCount,
    lowPivotCount: geometry.lowPivotCount,
    rangeAgeBars: geometry.rangeAgeBars,
    breakoutDirection: geometry.breakoutDirection,
    volatilityExpansionRatio: geometry.volatilityExpansionRatio,
    volatilityExpansion: geometry.volatilityExpansion,
    volatilityShock: snapshot.volatilityShock,
    longRejection: snapshot.longRejection,
    shortRejection: snapshot.shortRejection,
    longCloseInside: snapshot.longCloseInside,
    shortCloseInside: snapshot.shortCloseInside,
    distanceToLower:
      geometry.lowerPrice == null ? null : snapshot.close - geometry.lowerPrice,
    distanceToUpper:
      geometry.upperPrice == null ? null : geometry.upperPrice - snapshot.close,
    distanceToCenter:
      geometry.centerPrice == null
        ? null
        : Math.abs(snapshot.close - geometry.centerPrice),
    distanceToStop: Math.abs(snapshot.close - stopLossPrice),
  };
};

export type GridClassicSignalContext = ReturnType<
  typeof buildGridClassicSignalContext
>;

export const createGridClassicEngine = ({
  config,
  initialCandles = [],
}: {
  config: GridClassicConfig;
  initialCandles?: Candle[];
}) => {
  const engineOptions = getEngineOptions(config);
  const geometryEngine = createCausalRangeGeometryEngine({
    options: getGridClassicGeometryOptions(config),
  });
  const atrState: AtrState = {
    value: null,
    count: 0,
    previousClose: null,
  };
  const closeSeries: StrategyFigurePoint[] = [];
  let lastTimestamp: number | null = null;
  let snapshot: GridClassicSnapshot | null = null;

  const next = (candle: Candle): GridClassicRuntimeState => {
    if (
      ![
        candle.timestamp,
        candle.open,
        candle.high,
        candle.low,
        candle.close,
      ].every(Number.isFinite)
    ) {
      return { snapshot, closeSeries: closeSeries.slice() };
    }
    if (lastTimestamp != null && candle.timestamp <= lastTimestamp) {
      return { snapshot, closeSeries: closeSeries.slice() };
    }
    lastTimestamp = candle.timestamp;

    const atr = updateAtr(atrState, candle, engineOptions.atrPeriod);
    const geometry = geometryEngine.next(candle, atr);
    const candleRangeAtr = (candle.high - candle.low) / atr;
    const volatilityShock =
      geometry.volatilityExpansion ||
      candleRangeAtr > engineOptions.maxCandleRangeAtr;
    const lower = geometry.lowerPrice;
    const upper = geometry.upperPrice;
    const body = Math.max(Math.abs(candle.close - candle.open), atr * 0.01);
    const lowerWick = Math.max(
      0,
      Math.min(candle.open, candle.close) - candle.low,
    );
    const upperWick = Math.max(
      0,
      candle.high - Math.max(candle.open, candle.close),
    );
    const longCloseInside =
      lower != null && candle.low <= lower && candle.close >= lower;
    const shortCloseInside =
      upper != null && candle.high >= upper && candle.close <= upper;
    const longRejection =
      lower != null &&
      candle.low <= lower + atr * 0.1 &&
      candle.close >= lower &&
      candle.close > candle.open &&
      lowerWick / body >= engineOptions.minRejectionWickRatio;
    const shortRejection =
      upper != null &&
      candle.high >= upper - atr * 0.1 &&
      candle.close <= upper &&
      candle.close < candle.open &&
      upperWick / body >= engineOptions.minRejectionWickRatio;
    const position = geometry.position;
    const longInEdge =
      position != null &&
      position >=
        -getGridClassicGeometryOptions(config).breakoutToleranceAtr /
          Math.max(geometry.widthAtr ?? 1, Number.EPSILON) &&
      position <= engineOptions.edgeZoneFraction;
    const shortInEdge =
      position != null &&
      position <=
        1 +
          getGridClassicGeometryOptions(config).breakoutToleranceAtr /
            Math.max(geometry.widthAtr ?? 1, Number.EPSILON) &&
      position >= 1 - engineOptions.edgeZoneFraction;
    const longConfirmed = hasConfirmation({
      mode: engineOptions.entryConfirmation,
      rejection: longRejection,
      closeInside: longCloseInside,
    });
    const shortConfirmed = hasConfirmation({
      mode: engineOptions.entryConfirmation,
      rejection: shortRejection,
      closeInside: shortCloseInside,
    });
    const entryDirection =
      geometry.detected &&
      geometry.breakoutDirection == null &&
      !volatilityShock &&
      longInEdge &&
      longConfirmed
        ? 'LONG'
        : geometry.detected &&
            geometry.breakoutDirection == null &&
            !volatilityShock &&
            shortInEdge &&
            shortConfirmed
          ? 'SHORT'
          : null;

    closeSeries.push({ timestamp: candle.timestamp, value: candle.close });
    if (closeSeries.length > engineOptions.maxFigurePoints) {
      closeSeries.splice(0, closeSeries.length - engineOptions.maxFigurePoints);
    }
    snapshot = {
      timestamp: candle.timestamp,
      close: candle.close,
      atr,
      candleRangeAtr,
      volatilityShock,
      geometry,
      longRejection,
      shortRejection,
      longCloseInside,
      shortCloseInside,
      entryDirection,
    };
    return { snapshot, closeSeries: closeSeries.slice() };
  };

  initialCandles.forEach(next);

  return {
    next,
    getState: (): GridClassicRuntimeState => ({
      snapshot,
      closeSeries: closeSeries.slice(),
    }),
  };
};
