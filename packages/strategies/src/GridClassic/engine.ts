import type { Candle, Direction, StrategyFigurePoint } from '@tradejs/types';
import type { GridClassicConfig, GridClassicMode } from './config';
import type { GridClassicEntryEconomics } from './contracts';
import {
  createCausalRangeGeometryEngine,
  type CausalRangeGeometry,
  type CausalRangeLine,
  type CausalRangeGeometryOptions,
} from '@tradejs/indicators/range-geometry';

export type GridClassicEntrySignalStage =
  | 'none'
  | 'candidate'
  | 'waiting'
  | 'confirmed'
  | 'immediate'
  | 'breakout_candidate'
  | 'breakout_accepted'
  | 'breakout_retest_confirmed'
  | 'failed_breakout_reclaimed';

export type GridClassicSetupFamily =
  | 'mean_reversion'
  | 'breakout_continuation'
  | 'failed_breakout_reversal';

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
  latestHighPivotAgeBars: number | null;
  latestLowPivotAgeBars: number | null;
  alternatingPivotCount: number;
  recentContainmentRatio: number | null;
  recentOutsideCloseCount: number;
  rangeQualityAccepted: boolean;
  strategyMode: GridClassicMode;
  setupId: string | null;
  setupGeometry: CausalRangeGeometry | null;
  breakoutLevel: number | null;
  breakoutAgeBars: number | null;
  entrySignalStage: GridClassicEntrySignalStage;
  entryConfirmationAgeBars: number | null;
  entryDirection: Direction | null;
  setupFamily?: GridClassicSetupFamily | null;
  failedBreakoutDirection?: Direction | null;
  reversalDirection?: Direction | null;
  candidateTimestamp?: number | null;
  acceptedTimestamp?: number | null;
  reclaimTimestamp?: number | null;
  reclaimAgeBars?: number | null;
  failedBreakoutLevel?: number | null;
  projectedBreakoutBoundary?: number | null;
  projectedRangeCenter?: number | null;
  sweepExtreme?: number | null;
  candidateAtr?: number | null;
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

type PendingEntryConfirmation = {
  direction: Direction;
  barIndex: number;
  midpoint: number;
};

type PendingContinuation = {
  setupId: string;
  direction: Direction;
  level: number;
  breakoutBarIndex: number;
  acceptedAtIndex: number | null;
  geometry: CausalRangeGeometry;
};

type PendingFailedBreakout = {
  setupId: string;
  breakoutDirection: Direction;
  reversalDirection: Direction;
  fixedLevel: number;
  breakoutBarIndex: number;
  candidateTimestamp: number;
  candidateAtr: number;
  acceptedAtIndex: number | null;
  acceptedTimestamp: number | null;
  geometry: CausalRangeGeometry;
  sweepExtreme: number;
};

const finite = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const positiveInteger = (value: unknown, fallback: number) =>
  Math.max(1, Math.floor(finite(value, fallback)));

const nonNegativeInteger = (value: unknown, fallback: number) =>
  Math.max(0, Math.floor(finite(value, fallback)));

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
  strategyMode: config.GRIDCLASSIC_MODE ?? 'mean_reversion',
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
  entryConfirmationBars: nonNegativeInteger(
    config.GRIDCLASSIC_ENTRY_CONFIRMATION_BARS,
    0,
  ),
  maxPivotAgeBars: nonNegativeInteger(config.GRIDCLASSIC_MAX_PIVOT_AGE_BARS, 0),
  minAlternatingPivots: nonNegativeInteger(
    config.GRIDCLASSIC_MIN_ALTERNATING_PIVOTS,
    0,
  ),
  recentContainmentBars: nonNegativeInteger(
    config.GRIDCLASSIC_RECENT_CONTAINMENT_BARS,
    0,
  ),
  minRecentContainmentRatio: Math.min(
    1,
    Math.max(0, finite(config.GRIDCLASSIC_MIN_RECENT_CONTAINMENT_RATIO, 0)),
  ),
  continuationAcceptanceBars: positiveInteger(
    config.GRIDCLASSIC_CONTINUATION_ACCEPTANCE_BARS,
    1,
  ),
  continuationRetestMaxBars: positiveInteger(
    config.GRIDCLASSIC_CONTINUATION_RETEST_MAX_BARS,
    4,
  ),
  continuationRetestToleranceAtr: Math.max(
    0,
    finite(config.GRIDCLASSIC_CONTINUATION_RETEST_TOLERANCE_ATR, 0.3),
  ),
  continuationRequireDirectionalRetest: Boolean(
    config.GRIDCLASSIC_CONTINUATION_REQUIRE_DIRECTIONAL_RETEST,
  ),
});

export const buildGridClassicDetectorKey = (config: GridClassicConfig) =>
  JSON.stringify({
    geometry: getGridClassicGeometryOptions(config),
    engine: getEngineOptions(config),
    ...(config.GRIDCLASSIC_FAILED_BREAKOUT_REVERSAL_ENABLED
      ? { failedBreakoutReversal: { enabled: true } }
      : {}),
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

const projectLine = (line: CausalRangeLine, timestamp: number) => {
  const duration = line.endTimestamp - line.startTimestamp;
  if (Math.abs(duration) <= Number.EPSILON) return line.endPrice;
  const progress = (timestamp - line.startTimestamp) / duration;
  return line.startPrice + (line.endPrice - line.startPrice) * progress;
};

const projectGeometryPrice = ({
  geometry,
  timestamp,
  kind,
}: {
  geometry: CausalRangeGeometry;
  timestamp: number;
  kind: 'upper' | 'lower' | 'center';
}) => {
  const line =
    kind === 'upper'
      ? geometry.upperLine
      : kind === 'lower'
        ? geometry.lowerLine
        : geometry.centerLine;
  const price =
    kind === 'upper'
      ? geometry.upperPrice
      : kind === 'lower'
        ? geometry.lowerPrice
        : geometry.centerPrice;
  const projected = line ? projectLine(line, timestamp) : price;
  return projected != null && Number.isFinite(projected) ? projected : null;
};

const projectGeometry = (
  geometry: CausalRangeGeometry,
  timestamp: number,
): CausalRangeGeometry | null => {
  const upperPrice = projectGeometryPrice({
    geometry,
    timestamp,
    kind: 'upper',
  });
  const lowerPrice = projectGeometryPrice({
    geometry,
    timestamp,
    kind: 'lower',
  });
  const centerPrice = projectGeometryPrice({
    geometry,
    timestamp,
    kind: 'center',
  });
  if (
    upperPrice == null ||
    lowerPrice == null ||
    centerPrice == null ||
    upperPrice <= lowerPrice
  ) {
    return null;
  }
  return {
    ...cloneGeometry(geometry),
    upperPrice,
    lowerPrice,
    centerPrice,
  };
};

const isOutsideBothBoundaries = ({
  direction,
  close,
  fixedLevel,
  projectedBoundary,
}: {
  direction: Direction;
  close: number;
  fixedLevel: number;
  projectedBoundary: number;
}) =>
  direction === 'LONG'
    ? close > Math.max(fixedLevel, projectedBoundary)
    : close < Math.min(fixedLevel, projectedBoundary);

const isFullBoundaryReclaim = ({
  candle,
  direction,
  fixedLevel,
  projectedBoundary,
}: {
  candle: Candle;
  direction: Direction;
  fixedLevel: number;
  projectedBoundary: number;
}) =>
  direction === 'LONG'
    ? candle.close < Math.min(fixedLevel, projectedBoundary) &&
      candle.high >= Math.max(fixedLevel, projectedBoundary)
    : candle.close > Math.max(fixedLevel, projectedBoundary) &&
      candle.low <= Math.min(fixedLevel, projectedBoundary);

const cloneGeometry = (geometry: CausalRangeGeometry): CausalRangeGeometry => ({
  ...geometry,
  pivots: geometry.pivots.map((pivot) => ({ ...pivot })),
  upperLine: geometry.upperLine ? { ...geometry.upperLine } : null,
  lowerLine: geometry.lowerLine ? { ...geometry.lowerLine } : null,
  centerLine: geometry.centerLine ? { ...geometry.centerLine } : null,
});

const countAlternatingPivots = (geometry: CausalRangeGeometry) => {
  const sorted = geometry.pivots
    .slice()
    .sort((left, right) => left.barIndex - right.barIndex);
  let count = 0;
  let previousKind: 'high' | 'low' | null = null;
  for (const pivot of sorted) {
    if (pivot.kind !== previousKind) {
      count += 1;
      previousKind = pivot.kind;
    }
  }
  return count;
};

const evaluateRangeQuality = ({
  geometry,
  candles,
  currentBarIndex,
  atr,
  maxPivotAgeBars,
  minAlternatingPivots,
  recentContainmentBars,
  minRecentContainmentRatio,
  containmentToleranceAtr,
}: {
  geometry: CausalRangeGeometry;
  candles: Candle[];
  currentBarIndex: number;
  atr: number;
  maxPivotAgeBars: number;
  minAlternatingPivots: number;
  recentContainmentBars: number;
  minRecentContainmentRatio: number;
  containmentToleranceAtr: number;
}) => {
  const highPivots = geometry.pivots.filter((pivot) => pivot.kind === 'high');
  const lowPivots = geometry.pivots.filter((pivot) => pivot.kind === 'low');
  const latestHighPivot = highPivots.at(-1);
  const latestLowPivot = lowPivots.at(-1);
  const latestHighPivotAgeBars = latestHighPivot
    ? Math.max(0, currentBarIndex - latestHighPivot.barIndex)
    : null;
  const latestLowPivotAgeBars = latestLowPivot
    ? Math.max(0, currentBarIndex - latestLowPivot.barIndex)
    : null;
  const alternatingPivotCount = countAlternatingPivots(geometry);
  const recentCandles =
    recentContainmentBars > 0 ? candles.slice(-recentContainmentBars) : [];
  let recentOutsideCloseCount = 0;
  let recentContainmentRatio: number | null = null;
  if (recentCandles.length > 0 && geometry.upperLine && geometry.lowerLine) {
    const tolerance = atr * Math.max(0, containmentToleranceAtr);
    for (const candle of recentCandles) {
      const upper = projectLine(geometry.upperLine, candle.timestamp);
      const lower = projectLine(geometry.lowerLine, candle.timestamp);
      if (
        candle.close > upper + tolerance ||
        candle.close < lower - tolerance
      ) {
        recentOutsideCloseCount += 1;
      }
    }
    recentContainmentRatio =
      (recentCandles.length - recentOutsideCloseCount) / recentCandles.length;
  }
  const pivotAgeAccepted =
    maxPivotAgeBars <= 0 ||
    (latestHighPivotAgeBars != null &&
      latestLowPivotAgeBars != null &&
      latestHighPivotAgeBars <= maxPivotAgeBars &&
      latestLowPivotAgeBars <= maxPivotAgeBars);
  const alternationAccepted =
    minAlternatingPivots <= 0 || alternatingPivotCount >= minAlternatingPivots;
  const recentContainmentAccepted =
    minRecentContainmentRatio <= 0 ||
    (recentContainmentRatio != null &&
      recentContainmentRatio >= minRecentContainmentRatio);

  return {
    latestHighPivotAgeBars,
    latestLowPivotAgeBars,
    alternatingPivotCount,
    recentContainmentRatio,
    recentOutsideCloseCount,
    rangeQualityAccepted:
      geometry.detected &&
      pivotAgeAccepted &&
      alternationAccepted &&
      recentContainmentAccepted,
  };
};

export const buildGridClassicSignalContext = ({
  snapshot,
  direction,
  gridLevel,
  filledLevels,
  remainingLevels,
  stopLossPrice,
  economics = null,
}: {
  snapshot: GridClassicSnapshot;
  direction: Direction;
  gridLevel: number;
  filledLevels: number;
  remainingLevels: number;
  stopLossPrice: number;
  economics?: GridClassicEntryEconomics | null;
}) => {
  const geometry = snapshot.setupGeometry ?? snapshot.geometry;
  return {
    strategyMode: snapshot.strategyMode,
    setupId: snapshot.setupId,
    breakoutLevel: snapshot.breakoutLevel,
    breakoutAgeBars: snapshot.breakoutAgeBars,
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
    latestHighPivotAgeBars: snapshot.latestHighPivotAgeBars,
    latestLowPivotAgeBars: snapshot.latestLowPivotAgeBars,
    alternatingPivotCount: snapshot.alternatingPivotCount,
    recentContainmentRatio: snapshot.recentContainmentRatio,
    recentOutsideCloseCount: snapshot.recentOutsideCloseCount,
    rangeQualityAccepted: snapshot.rangeQualityAccepted,
    entrySignalStage: snapshot.entrySignalStage,
    entryConfirmationAgeBars: snapshot.entryConfirmationAgeBars,
    targetDistanceBps: economics?.targetDistanceBps ?? null,
    grossReward: economics?.grossReward ?? null,
    executionCosts: economics?.executionCosts ?? null,
    netReward: economics?.netReward ?? null,
    netRisk: economics?.netRisk ?? null,
    netRiskRatio: economics?.netRiskRatio ?? null,
    distanceToLower:
      geometry.lowerPrice == null ? null : snapshot.close - geometry.lowerPrice,
    distanceToUpper:
      geometry.upperPrice == null ? null : geometry.upperPrice - snapshot.close,
    distanceToCenter:
      geometry.centerPrice == null
        ? null
        : Math.abs(snapshot.close - geometry.centerPrice),
    distanceToStop: Math.abs(snapshot.close - stopLossPrice),
    ...(snapshot.setupFamily === 'failed_breakout_reversal'
      ? {
          setupFamily: snapshot.setupFamily,
          failedBreakoutDirection: snapshot.failedBreakoutDirection ?? null,
          reversalDirection: snapshot.reversalDirection ?? null,
          candidateTimestamp: snapshot.candidateTimestamp ?? null,
          acceptedTimestamp: snapshot.acceptedTimestamp ?? null,
          reclaimTimestamp: snapshot.reclaimTimestamp ?? null,
          reclaimAgeBars: snapshot.reclaimAgeBars ?? null,
          failedBreakoutLevel: snapshot.failedBreakoutLevel ?? null,
          projectedBreakoutBoundary: snapshot.projectedBreakoutBoundary ?? null,
          projectedRangeCenter: snapshot.projectedRangeCenter ?? null,
          sweepExtreme: snapshot.sweepExtreme ?? null,
          candidateAtr: snapshot.candidateAtr ?? null,
        }
      : {}),
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
  const recentCandles: Candle[] = [];
  const recentCandleLimit = Math.max(
    getGridClassicGeometryOptions(config).lookbackBars,
    engineOptions.recentContainmentBars,
  );
  let barIndex = -1;
  let lastTimestamp: number | null = null;
  let snapshot: GridClassicSnapshot | null = null;
  let pendingEntryConfirmation: PendingEntryConfirmation | null = null;
  let pendingContinuation: PendingContinuation | null = null;
  let pendingFailedBreakout: PendingFailedBreakout | null = null;
  let lastMatureGeometry: CausalRangeGeometry | null = null;

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
    barIndex += 1;
    recentCandles.push({ ...candle });
    if (recentCandles.length > recentCandleLimit) {
      recentCandles.splice(0, recentCandles.length - recentCandleLimit);
    }

    const atr = updateAtr(atrState, candle, engineOptions.atrPeriod);
    const geometry = geometryEngine.next(candle, atr);
    const candleRangeAtr = (candle.high - candle.low) / atr;
    const volatilityShock =
      (engineOptions.strategyMode === 'mean_reversion' &&
        geometry.volatilityExpansion) ||
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
    const quality = evaluateRangeQuality({
      geometry,
      candles: recentCandles,
      currentBarIndex: barIndex,
      atr,
      maxPivotAgeBars: engineOptions.maxPivotAgeBars,
      minAlternatingPivots: engineOptions.minAlternatingPivots,
      recentContainmentBars: engineOptions.recentContainmentBars,
      minRecentContainmentRatio: engineOptions.minRecentContainmentRatio,
      containmentToleranceAtr:
        getGridClassicGeometryOptions(config).containmentToleranceAtr,
    });
    const signalBaseAccepted =
      geometry.detected &&
      geometry.breakoutDirection == null &&
      !volatilityShock &&
      quality.rangeQualityAccepted;
    const immediateCandidate =
      signalBaseAccepted && longInEdge && longConfirmed
        ? ('LONG' as const)
        : signalBaseAccepted && shortInEdge && shortConfirmed
          ? ('SHORT' as const)
          : null;
    let entryDirection: Direction | null = null;
    let entrySignalStage: GridClassicEntrySignalStage = 'none';
    let entryConfirmationAgeBars: number | null = null;
    let setupId: string | null = null;
    let setupGeometry: CausalRangeGeometry | null = null;
    let breakoutLevel: number | null = null;
    let breakoutAgeBars: number | null = null;
    const failedBreakoutReversalEnabled = Boolean(
      config.GRIDCLASSIC_FAILED_BREAKOUT_REVERSAL_ENABLED,
    );
    let setupFamily: GridClassicSetupFamily | null = null;
    let failedBreakoutDirection: Direction | null = null;
    let reversalDirection: Direction | null = null;
    let candidateTimestamp: number | null = null;
    let acceptedTimestamp: number | null = null;
    let reclaimTimestamp: number | null = null;
    let reclaimAgeBars: number | null = null;
    let failedBreakoutLevel: number | null = null;
    let projectedBreakoutBoundary: number | null = null;
    let projectedRangeCenter: number | null = null;
    let sweepExtreme: number | null = null;
    let candidateAtr: number | null = null;

    if (engineOptions.strategyMode === 'mean_reversion') {
      if (engineOptions.entryConfirmationBars > 0 && pendingEntryConfirmation) {
        const pending = pendingEntryConfirmation;
        const ageBars = barIndex - pending.barIndex;
        entryConfirmationAgeBars = ageBars;
        const confirmationInside =
          pending.direction === 'LONG'
            ? lower != null &&
              candle.close >= lower &&
              candle.close >= pending.midpoint &&
              longInEdge
            : upper != null &&
              candle.close <= upper &&
              candle.close <= pending.midpoint &&
              shortInEdge;
        if (
          ageBars >= 1 &&
          ageBars <= engineOptions.entryConfirmationBars &&
          signalBaseAccepted &&
          confirmationInside
        ) {
          entryDirection = pending.direction;
          entrySignalStage = 'confirmed';
          pendingEntryConfirmation = null;
        } else if (
          ageBars > engineOptions.entryConfirmationBars ||
          !signalBaseAccepted
        ) {
          pendingEntryConfirmation = null;
        } else {
          entrySignalStage = 'waiting';
        }
      }

      if (entryDirection == null && immediateCandidate) {
        if (engineOptions.entryConfirmationBars <= 0) {
          entryDirection = immediateCandidate;
          entrySignalStage = 'immediate';
          entryConfirmationAgeBars = 0;
        } else {
          pendingEntryConfirmation = {
            direction: immediateCandidate,
            barIndex,
            midpoint: (candle.high + candle.low) / 2,
          };
          entrySignalStage = 'candidate';
          entryConfirmationAgeBars = 0;
        }
      }
    } else {
      const tolerance = atr * engineOptions.continuationRetestToleranceAtr;
      const pending = pendingContinuation;
      if (pending) {
        const ageBars = barIndex - pending.breakoutBarIndex;
        setupId = pending.setupId;
        setupGeometry = cloneGeometry(pending.geometry);
        breakoutLevel = pending.level;
        breakoutAgeBars = ageBars;
        entryConfirmationAgeBars = ageBars;
        const invalidated =
          pending.direction === 'LONG'
            ? candle.close < pending.level - tolerance
            : candle.close > pending.level + tolerance;
        const expired =
          ageBars >
          engineOptions.continuationAcceptanceBars +
            engineOptions.continuationRetestMaxBars;
        if (invalidated || expired || volatilityShock) {
          pendingContinuation = null;
          if (
            pendingFailedBreakout?.setupId === pending.setupId &&
            pendingFailedBreakout.acceptedAtIndex == null
          ) {
            pendingFailedBreakout = null;
          }
        } else if (pending.acceptedAtIndex == null) {
          const accepted =
            ageBars >= engineOptions.continuationAcceptanceBars &&
            (pending.direction === 'LONG'
              ? candle.close > pending.level
              : candle.close < pending.level);
          entrySignalStage = accepted
            ? 'breakout_accepted'
            : 'breakout_candidate';
          if (accepted) {
            pending.acceptedAtIndex = barIndex;
            if (pendingFailedBreakout?.setupId === pending.setupId) {
              const projectedBoundary = projectGeometryPrice({
                geometry: pendingFailedBreakout.geometry,
                timestamp: candle.timestamp,
                kind:
                  pendingFailedBreakout.breakoutDirection === 'LONG'
                    ? 'upper'
                    : 'lower',
              });
              if (
                projectedBoundary != null &&
                isOutsideBothBoundaries({
                  direction: pendingFailedBreakout.breakoutDirection,
                  close: candle.close,
                  fixedLevel: pendingFailedBreakout.fixedLevel,
                  projectedBoundary,
                })
              ) {
                pendingFailedBreakout.acceptedAtIndex = barIndex;
                pendingFailedBreakout.acceptedTimestamp = candle.timestamp;
              }
            }
          }
        } else if (barIndex > pending.acceptedAtIndex) {
          entrySignalStage = 'breakout_accepted';
          if (
            pendingFailedBreakout?.setupId === pending.setupId &&
            pendingFailedBreakout.acceptedAtIndex == null
          ) {
            const projectedBoundary = projectGeometryPrice({
              geometry: pendingFailedBreakout.geometry,
              timestamp: candle.timestamp,
              kind:
                pendingFailedBreakout.breakoutDirection === 'LONG'
                  ? 'upper'
                  : 'lower',
            });
            if (
              projectedBoundary != null &&
              isOutsideBothBoundaries({
                direction: pendingFailedBreakout.breakoutDirection,
                close: candle.close,
                fixedLevel: pendingFailedBreakout.fixedLevel,
                projectedBoundary,
              })
            ) {
              pendingFailedBreakout.acceptedAtIndex = barIndex;
              pendingFailedBreakout.acceptedTimestamp = candle.timestamp;
            }
          }
          const held =
            pending.direction === 'LONG'
              ? candle.low <= pending.level + tolerance &&
                candle.low >= pending.level - tolerance &&
                candle.close >= pending.level &&
                (!engineOptions.continuationRequireDirectionalRetest ||
                  candle.close > candle.open)
              : candle.high >= pending.level - tolerance &&
                candle.high <= pending.level + tolerance &&
                candle.close <= pending.level &&
                (!engineOptions.continuationRequireDirectionalRetest ||
                  candle.close < candle.open);
          if (held) {
            entryDirection = pending.direction;
            entrySignalStage = 'breakout_retest_confirmed';
            pendingContinuation = null;
            pendingFailedBreakout = null;
          }
        }
      } else if (lastMatureGeometry && pendingFailedBreakout == null) {
        const upperLevel = lastMatureGeometry.upperLine
          ? projectLine(lastMatureGeometry.upperLine, candle.timestamp)
          : lastMatureGeometry.upperPrice;
        const lowerLevel = lastMatureGeometry.lowerLine
          ? projectLine(lastMatureGeometry.lowerLine, candle.timestamp)
          : lastMatureGeometry.lowerPrice;
        const direction: Direction | null =
          upperLevel != null && candle.close > upperLevel + tolerance
            ? 'LONG'
            : lowerLevel != null && candle.close < lowerLevel - tolerance
              ? 'SHORT'
              : null;
        const level = direction === 'LONG' ? upperLevel : lowerLevel;
        if (direction && level != null && !volatilityShock) {
          const nextSetupId = `gridclassic-continuation:${direction}:${candle.timestamp}:${level.toFixed(8)}`;
          pendingContinuation = {
            setupId: nextSetupId,
            direction,
            level,
            breakoutBarIndex: barIndex,
            acceptedAtIndex: null,
            geometry: cloneGeometry(lastMatureGeometry),
          };
          if (failedBreakoutReversalEnabled && pendingFailedBreakout == null) {
            pendingFailedBreakout = {
              setupId: nextSetupId,
              breakoutDirection: direction,
              reversalDirection: direction === 'LONG' ? 'SHORT' : 'LONG',
              fixedLevel: level,
              breakoutBarIndex: barIndex,
              candidateTimestamp: candle.timestamp,
              candidateAtr: atr,
              acceptedAtIndex: null,
              acceptedTimestamp: null,
              geometry: cloneGeometry(lastMatureGeometry),
              sweepExtreme: direction === 'LONG' ? candle.high : candle.low,
            };
          }
          setupId = nextSetupId;
          setupGeometry = cloneGeometry(lastMatureGeometry);
          breakoutLevel = level;
          breakoutAgeBars = 0;
          entrySignalStage = 'breakout_candidate';
          entryConfirmationAgeBars = 0;
        }
      }

      if (failedBreakoutReversalEnabled && pendingFailedBreakout) {
        const failed = pendingFailedBreakout;
        failed.sweepExtreme =
          failed.breakoutDirection === 'LONG'
            ? Math.max(failed.sweepExtreme, candle.high)
            : Math.min(failed.sweepExtreme, candle.low);
        const boundary = projectGeometryPrice({
          geometry: failed.geometry,
          timestamp: candle.timestamp,
          kind: failed.breakoutDirection === 'LONG' ? 'upper' : 'lower',
        });
        const center = projectGeometryPrice({
          geometry: failed.geometry,
          timestamp: candle.timestamp,
          kind: 'center',
        });
        const acceptedAge =
          failed.acceptedAtIndex == null
            ? null
            : barIndex - failed.acceptedAtIndex;
        const failedExpired =
          acceptedAge != null &&
          acceptedAge > engineOptions.continuationRetestMaxBars;

        if (boundary == null || center == null || volatilityShock) {
          pendingFailedBreakout = null;
        } else if (failedExpired) {
          pendingFailedBreakout = null;
        } else {
          setupId = failed.setupId;
          setupGeometry = cloneGeometry(failed.geometry);
          breakoutLevel = failed.fixedLevel;
          breakoutAgeBars = barIndex - failed.breakoutBarIndex;
          setupFamily = 'failed_breakout_reversal';
          failedBreakoutDirection = failed.breakoutDirection;
          reversalDirection = failed.reversalDirection;
          candidateTimestamp = failed.candidateTimestamp;
          acceptedTimestamp = failed.acceptedTimestamp;
          failedBreakoutLevel = failed.fixedLevel;
          projectedBreakoutBoundary = boundary;
          projectedRangeCenter = center;
          sweepExtreme = failed.sweepExtreme;
          candidateAtr = failed.candidateAtr;

          if (
            entryDirection == null &&
            acceptedAge != null &&
            acceptedAge >= 1 &&
            isFullBoundaryReclaim({
              candle,
              direction: failed.breakoutDirection,
              fixedLevel: failed.fixedLevel,
              projectedBoundary: boundary,
            })
          ) {
            const projectedGeometry = projectGeometry(
              failed.geometry,
              candle.timestamp,
            );
            if (projectedGeometry) {
              entryDirection = failed.reversalDirection;
              entrySignalStage = 'failed_breakout_reclaimed';
              entryConfirmationAgeBars = acceptedAge;
              setupId = failed.setupId;
              setupGeometry = projectedGeometry;
              breakoutLevel = failed.fixedLevel;
              breakoutAgeBars = barIndex - failed.breakoutBarIndex;
              reclaimTimestamp = candle.timestamp;
              reclaimAgeBars = acceptedAge;
              pendingContinuation = null;
              pendingFailedBreakout = null;
            }
          }
        }
      }
    }

    if (signalBaseAccepted && pendingContinuation == null) {
      lastMatureGeometry = cloneGeometry(geometry);
    }

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
      ...quality,
      rangeQualityAccepted:
        setupGeometry != null ? true : quality.rangeQualityAccepted,
      strategyMode: engineOptions.strategyMode,
      setupId,
      setupGeometry,
      breakoutLevel,
      breakoutAgeBars,
      entrySignalStage,
      entryConfirmationAgeBars,
      entryDirection,
      ...(failedBreakoutReversalEnabled
        ? {
            setupFamily,
            failedBreakoutDirection,
            reversalDirection,
            candidateTimestamp,
            acceptedTimestamp,
            reclaimTimestamp,
            reclaimAgeBars,
            failedBreakoutLevel,
            projectedBreakoutBoundary,
            projectedRangeCenter,
            sweepExtreme,
            candidateAtr,
          }
        : {}),
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
