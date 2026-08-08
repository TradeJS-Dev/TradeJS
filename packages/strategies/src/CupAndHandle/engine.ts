import { Candle, Direction } from '@tradejs/types';
import { CupAndHandleConfig, CupAndHandleEntryMode } from './config';

export type CupAndHandlePatternKind =
  | 'cup_and_handle'
  | 'inverted_cup_and_handle';
export type CupAndHandleEntryStage =
  | 'breakout'
  | 'close_accepted'
  | 'retest_held';

export interface CupAndHandlePivot {
  timestamp: number;
  index: number;
  value: number;
  kind: 'high' | 'low';
}

export interface CupAndHandlePattern {
  setupId: string;
  kind: CupAndHandlePatternKind;
  direction: Direction;
  entryMode: CupAndHandleEntryMode;
  entryStage: CupAndHandleEntryStage;
  pivots: [
    CupAndHandlePivot,
    CupAndHandlePivot,
    CupAndHandlePivot,
    CupAndHandlePivot,
  ];
  neckline: number;
  targetPrice: number;
  stopLossPrice: number;
  cupDepth: number;
  cupDepthPct: number;
  cupDepthAtr: number;
  cupDurationBars: number;
  cupSymmetryRatio: number;
  rimDifferencePct: number;
  handleDepth: number;
  handleDepthRatio: number;
  handleDurationBars: number;
  patternAgeBars: number;
  breakoutDistancePct: number;
  breakoutDistanceAtr: number;
  breakoutDistanceDepthRatio: number;
  breakoutCrossedOnSignalBar: boolean;
  breakoutTimestamp: number;
  confirmationBars: number;
  timestamp: number;
  close: number;
}

export interface CupAndHandlePendingSetup {
  setupId: string;
  mode: Exclude<CupAndHandleEntryMode, 'breakout'>;
  stage: 'neckline_crossed' | 'retest_pending';
  breakoutIndex: number;
  pattern: CupAndHandlePattern;
}

export interface CupAndHandleRuntimeState {
  pattern: CupAndHandlePattern | null;
  pending: CupAndHandlePendingSetup | null;
  pivots: CupAndHandlePivot[];
}

interface EngineState {
  candles: Candle[];
  candleStartIndex: number;
  currentIndex: number;
  pivots: CupAndHandlePivot[];
  pattern: CupAndHandlePattern | null;
  pending: CupAndHandlePendingSetup | null;
  consumedSetupIds: string[];
  lastTimestamp: number | null;
}

const asNumber = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const clampNumber = ({
  value,
  fallback,
  min,
  max,
}: {
  value: unknown;
  fallback: number;
  min: number;
  max?: number;
}) => {
  const numeric = Number(value);
  const resolved = Number.isFinite(numeric) ? numeric : fallback;
  return Math.min(max ?? Infinity, Math.max(min, resolved));
};

const getConfigNumbers = (config: CupAndHandleConfig) => ({
  pivotLookback: Math.max(
    1,
    Math.floor(Number(config.CUPHANDLE_PIVOT_LOOKBACK ?? 3)),
  ),
  rimTolerancePct: clampNumber({
    value: config.CUPHANDLE_RIM_TOLERANCE_PCT,
    fallback: 15,
    min: 0,
  }),
  targetDepthPct: clampNumber({
    value: config.CUPHANDLE_TARGET_DEPTH_PCT,
    fallback: 100,
    min: 0,
  }),
  stopBufferDepthPct: clampNumber({
    value: config.CUPHANDLE_STOP_BUFFER_DEPTH_PCT,
    fallback: 5,
    min: 0,
  }),
  minCupDepthPct: clampNumber({
    value: config.CUPHANDLE_MIN_CUP_DEPTH_PCT,
    fallback: 0.8,
    min: 0,
  }),
  minCupDepthAtr: clampNumber({
    value: config.CUPHANDLE_MIN_CUP_DEPTH_ATR,
    fallback: 2,
    min: 0,
  }),
  atrPeriod: Math.max(2, Math.floor(Number(config.CUPHANDLE_ATR_PERIOD ?? 14))),
  minCupBars: Math.max(
    2,
    Math.floor(Number(config.CUPHANDLE_MIN_CUP_BARS ?? 8)),
  ),
  maxCupBars: Math.max(
    2,
    Math.floor(Number(config.CUPHANDLE_MAX_CUP_BARS ?? 160)),
  ),
  minCupSymmetryRatio: clampNumber({
    value: config.CUPHANDLE_MIN_CUP_SYMMETRY_RATIO,
    fallback: 0.25,
    min: 0,
    max: 1,
  }),
  minHandleBars: Math.max(
    1,
    Math.floor(Number(config.CUPHANDLE_MIN_HANDLE_BARS ?? 2)),
  ),
  maxHandleBars: Math.max(
    1,
    Math.floor(Number(config.CUPHANDLE_MAX_HANDLE_BARS ?? 40)),
  ),
  minHandleDepthRatio: clampNumber({
    value: config.CUPHANDLE_MIN_HANDLE_DEPTH_RATIO,
    fallback: 0.08,
    min: 0,
  }),
  maxHandleDepthRatio: clampNumber({
    value: config.CUPHANDLE_MAX_HANDLE_DEPTH_RATIO,
    fallback: 0.5,
    min: 0,
  }),
  maxPatternAgeBars: Math.max(
    4,
    Math.floor(Number(config.CUPHANDLE_MAX_PATTERN_AGE_BARS ?? 220)),
  ),
  minBreakoutDistanceAtr: clampNumber({
    value: config.CUPHANDLE_MIN_BREAKOUT_DISTANCE_ATR,
    fallback: 0.05,
    min: 0,
  }),
  maxBreakoutDistanceDepthRatio: clampNumber({
    value: config.CUPHANDLE_MAX_BREAKOUT_DISTANCE_DEPTH_RATIO,
    fallback: 0.35,
    min: 0,
  }),
  maxBreakoutDistancePct: clampNumber({
    value: config.CUPHANDLE_MAX_BREAKOUT_DISTANCE_PCT,
    fallback: 0.8,
    min: 0,
  }),
  requireBreakoutCross: Boolean(config.CUPHANDLE_REQUIRE_BREAKOUT_CROSS),
  entryMode: config.CUPHANDLE_ENTRY_MODE ?? 'close_acceptance',
  confirmationMaxBars: Math.max(
    1,
    Math.floor(Number(config.CUPHANDLE_CONFIRMATION_MAX_BARS ?? 2)),
  ),
  retestMaxBars: Math.max(
    1,
    Math.floor(Number(config.CUPHANDLE_RETEST_MAX_BARS ?? 4)),
  ),
  retestToleranceAtr: clampNumber({
    value: config.CUPHANDLE_RETEST_TOLERANCE_ATR,
    fallback: 0.25,
    min: 0,
  }),
});

const calculateAtr = (candles: Candle[], period: number): number | null => {
  const relevant = candles.slice(-(period + 1));
  if (relevant.length < 2) return null;

  const trueRanges: number[] = [];
  for (let index = 1; index < relevant.length; index += 1) {
    const candle = relevant[index];
    const previous = relevant[index - 1];
    const high = asNumber(candle?.high);
    const low = asNumber(candle?.low);
    const previousClose = asNumber(previous?.close);
    if (high == null || low == null || previousClose == null) continue;
    trueRanges.push(
      Math.max(
        high - low,
        Math.abs(high - previousClose),
        Math.abs(low - previousClose),
      ),
    );
  }

  if (trueRanges.length === 0) return null;
  return trueRanges.reduce((sum, value) => sum + value, 0) / trueRanges.length;
};

const pushBoundedCandle = (
  state: Pick<EngineState, 'candles' | 'candleStartIndex' | 'currentIndex'>,
  candle: Candle,
  maxCandles: number,
) => {
  state.currentIndex += 1;
  state.candles.push(candle);
  if (state.candles.length > maxCandles) {
    const overflow = state.candles.length - maxCandles;
    state.candles.splice(0, overflow);
    state.candleStartIndex += overflow;
  }
  return state.currentIndex;
};

const getBufferedCandle = (
  state: Pick<EngineState, 'candles' | 'candleStartIndex'>,
  absoluteIndex: number,
) => state.candles[absoluteIndex - state.candleStartIndex] ?? null;

const getPivotWindow = (
  state: Pick<EngineState, 'candles' | 'candleStartIndex'>,
  candidateIndex: number,
  lookback: number,
) => {
  const candles: Candle[] = [];
  for (
    let index = candidateIndex - lookback;
    index <= candidateIndex + lookback;
    index += 1
  ) {
    const candle = getBufferedCandle(state, index);
    if (!candle) return [];
    candles.push(candle);
  }
  return candles;
};

const resolveConfirmedPivot = ({
  state,
  candidateIndex,
  lookback,
}: {
  state: Pick<EngineState, 'candles' | 'candleStartIndex'>;
  candidateIndex: number;
  lookback: number;
}): CupAndHandlePivot | null => {
  const candidate = getBufferedCandle(state, candidateIndex);
  const high = asNumber(candidate?.high);
  const low = asNumber(candidate?.low);
  if (!candidate || high == null || low == null) return null;

  const window = getPivotWindow(state, candidateIndex, lookback);
  if (window.length !== lookback * 2 + 1) return null;
  const otherCandles = window.filter((_, index) => index !== lookback);
  const isHigh =
    otherCandles.every((candle) => high >= Number(candle.high)) &&
    otherCandles.some((candle) => high > Number(candle.high));
  const isLow =
    otherCandles.every((candle) => low <= Number(candle.low)) &&
    otherCandles.some((candle) => low < Number(candle.low));

  if (isHigh === isLow) return null;
  return {
    timestamp: candidate.timestamp,
    index: candidateIndex,
    value: isHigh ? high : low,
    kind: isHigh ? 'high' : 'low',
  };
};

const recordPivot = (state: EngineState, pivot: CupAndHandlePivot | null) => {
  if (!pivot) return;
  const latest = state.pivots[state.pivots.length - 1];
  if (!latest || latest.kind !== pivot.kind) {
    state.pivots.push(pivot);
    if (state.pivots.length > 16) state.pivots.shift();
    return;
  }

  const isMoreExtreme =
    pivot.kind === 'high'
      ? pivot.value >= latest.value
      : pivot.value <= latest.value;
  if (isMoreExtreme) state.pivots[state.pivots.length - 1] = pivot;
};

const clonePattern = (
  pattern: CupAndHandlePattern | null,
): CupAndHandlePattern | null =>
  pattern ? { ...pattern, pivots: [...pattern.pivots] } : null;

const clonePending = (
  pending: CupAndHandlePendingSetup | null,
): CupAndHandlePendingSetup | null =>
  pending
    ? {
        ...pending,
        pattern: clonePattern(pending.pattern) as CupAndHandlePattern,
      }
    : null;

const rememberConsumed = (state: EngineState, setupId: string) => {
  if (state.consumedSetupIds.includes(setupId)) return;
  state.consumedSetupIds.push(setupId);
  if (state.consumedSetupIds.length > 64) state.consumedSetupIds.shift();
};

const isBeyondNeckline = (
  direction: Direction,
  close: number,
  neckline: number,
  minimumDistance: number,
) =>
  direction === 'LONG'
    ? close >= neckline + minimumDistance
    : close <= neckline - minimumDistance;

const buildBreakoutPattern = ({
  state,
  candle,
  prevClose,
  atr,
  direction,
  options,
}: {
  state: EngineState;
  candle: Candle;
  prevClose: number | null;
  atr: number | null;
  direction: Direction;
  options: ReturnType<typeof getConfigNumbers>;
}): CupAndHandlePattern | null => {
  if (state.pivots.length < 4) return null;
  const pivots = state.pivots.slice(-4) as [
    CupAndHandlePivot,
    CupAndHandlePivot,
    CupAndHandlePivot,
    CupAndHandlePivot,
  ];
  const [leftRim, cupExtreme, rightRim, handleExtreme] = pivots;
  const expectedKinds =
    direction === 'LONG'
      ? (['high', 'low', 'high', 'low'] as const)
      : (['low', 'high', 'low', 'high'] as const);
  if (pivots.some((pivot, index) => pivot.kind !== expectedKinds[index])) {
    return null;
  }

  const close = asNumber(candle.close);
  if (close == null) return null;
  const rimAverage = (leftRim.value + rightRim.value) / 2;
  const neckline =
    direction === 'LONG'
      ? Math.max(leftRim.value, rightRim.value)
      : Math.min(leftRim.value, rightRim.value);
  const cupDepth =
    direction === 'LONG'
      ? rimAverage - cupExtreme.value
      : cupExtreme.value - rimAverage;
  if (cupDepth <= 0) return null;

  const cupDepthPct =
    rimAverage !== 0 ? (cupDepth / Math.abs(rimAverage)) * 100 : 0;
  const cupDepthAtr = atr != null && atr > 0 ? cupDepth / atr : 0;
  const rimDifferencePct =
    (Math.abs(leftRim.value - rightRim.value) / cupDepth) * 100;
  if (
    cupDepthPct < options.minCupDepthPct ||
    cupDepthAtr < options.minCupDepthAtr ||
    rimDifferencePct > options.rimTolerancePct
  ) {
    return null;
  }

  const cupDurationBars = rightRim.index - leftRim.index;
  const leftLegBars = cupExtreme.index - leftRim.index;
  const rightLegBars = rightRim.index - cupExtreme.index;
  const cupSymmetryRatio =
    Math.max(leftLegBars, rightLegBars) > 0
      ? Math.min(leftLegBars, rightLegBars) /
        Math.max(leftLegBars, rightLegBars)
      : 0;
  const handleDurationBars = handleExtreme.index - rightRim.index;
  const patternAgeBars = state.currentIndex - leftRim.index;
  if (
    cupDurationBars < options.minCupBars ||
    cupDurationBars > options.maxCupBars ||
    cupSymmetryRatio < options.minCupSymmetryRatio ||
    handleDurationBars < options.minHandleBars ||
    handleDurationBars > options.maxHandleBars ||
    patternAgeBars > options.maxPatternAgeBars
  ) {
    return null;
  }

  const handleDepth =
    direction === 'LONG'
      ? rightRim.value - handleExtreme.value
      : handleExtreme.value - rightRim.value;
  const handleDepthRatio = handleDepth / cupDepth;
  const handlePreservesCup =
    direction === 'LONG'
      ? handleExtreme.value > cupExtreme.value
      : handleExtreme.value < cupExtreme.value;
  if (
    !handlePreservesCup ||
    handleDepth <= 0 ||
    handleDepthRatio < options.minHandleDepthRatio ||
    handleDepthRatio > options.maxHandleDepthRatio
  ) {
    return null;
  }

  const breakoutDistance = Math.abs(close - neckline);
  const breakoutDistancePct =
    neckline !== 0 ? (breakoutDistance / Math.abs(neckline)) * 100 : 0;
  const breakoutDistanceAtr =
    atr != null && atr > 0 ? breakoutDistance / atr : 0;
  const breakoutDistanceDepthRatio = breakoutDistance / cupDepth;
  if (
    !isBeyondNeckline(direction, close, neckline, 0) ||
    breakoutDistanceAtr < options.minBreakoutDistanceAtr ||
    (options.maxBreakoutDistanceDepthRatio > 0 &&
      breakoutDistanceDepthRatio > options.maxBreakoutDistanceDepthRatio) ||
    (options.maxBreakoutDistancePct > 0 &&
      breakoutDistancePct > options.maxBreakoutDistancePct)
  ) {
    return null;
  }

  const kind: CupAndHandlePatternKind =
    direction === 'LONG' ? 'cup_and_handle' : 'inverted_cup_and_handle';
  const setupId = `${kind}:${leftRim.timestamp}:${cupExtreme.timestamp}:${rightRim.timestamp}:${handleExtreme.timestamp}`;
  if (state.consumedSetupIds.includes(setupId)) return null;

  const directionMultiplier = direction === 'LONG' ? 1 : -1;
  const stopLossPrice =
    handleExtreme.value -
    directionMultiplier * cupDepth * (options.stopBufferDepthPct / 100);
  const targetPrice =
    neckline + directionMultiplier * cupDepth * (options.targetDepthPct / 100);
  const breakoutCrossedOnSignalBar =
    prevClose != null &&
    (direction === 'LONG'
      ? prevClose <= neckline && close > neckline
      : prevClose >= neckline && close < neckline);
  if (options.requireBreakoutCross && !breakoutCrossedOnSignalBar) return null;

  return {
    setupId,
    kind,
    direction,
    entryMode: options.entryMode,
    entryStage: 'breakout',
    pivots,
    neckline,
    targetPrice,
    stopLossPrice,
    cupDepth,
    cupDepthPct,
    cupDepthAtr,
    cupDurationBars,
    cupSymmetryRatio,
    rimDifferencePct,
    handleDepth,
    handleDepthRatio,
    handleDurationBars,
    patternAgeBars,
    breakoutDistancePct,
    breakoutDistanceAtr,
    breakoutDistanceDepthRatio,
    breakoutCrossedOnSignalBar,
    breakoutTimestamp: candle.timestamp,
    confirmationBars: 0,
    timestamp: candle.timestamp,
    close,
  };
};

const resolvePending = ({
  state,
  candle,
  atr,
  options,
}: {
  state: EngineState;
  candle: Candle;
  atr: number | null;
  options: ReturnType<typeof getConfigNumbers>;
}): CupAndHandlePattern | null => {
  const pending = state.pending;
  if (!pending) return null;
  const confirmationBars = state.currentIndex - pending.breakoutIndex;
  if (confirmationBars < 1) return null;

  const close = asNumber(candle.close);
  const high = asNumber(candle.high);
  const low = asNumber(candle.low);
  if (close == null || high == null || low == null) return null;

  const pattern = pending.pattern;
  const invalidated =
    pattern.direction === 'LONG'
      ? low <= pattern.stopLossPrice
      : high >= pattern.stopLossPrice;
  const maxBars =
    pending.mode === 'retest'
      ? options.retestMaxBars
      : options.confirmationMaxBars;
  if (invalidated || confirmationBars > maxBars) {
    rememberConsumed(state, pending.setupId);
    state.pending = null;
    return null;
  }

  const effectiveAtr = atr != null && atr > 0 ? atr : pattern.cupDepth;
  const minimumDistance = effectiveAtr * options.minBreakoutDistanceAtr;
  const closeAccepted = isBeyondNeckline(
    pattern.direction,
    close,
    pattern.neckline,
    minimumDistance,
  );
  let entryStage: CupAndHandleEntryStage | null = null;

  if (pending.mode === 'close_acceptance') {
    if (closeAccepted) entryStage = 'close_accepted';
  } else {
    const tolerance = effectiveAtr * options.retestToleranceAtr;
    const touched =
      pattern.direction === 'LONG'
        ? low <= pattern.neckline + tolerance &&
          low >= pattern.neckline - tolerance
        : high >= pattern.neckline - tolerance &&
          high <= pattern.neckline + tolerance;
    if (touched && closeAccepted) entryStage = 'retest_held';
  }

  if (!entryStage) return null;
  rememberConsumed(state, pending.setupId);
  state.pending = null;
  return {
    ...pattern,
    entryStage,
    confirmationBars,
    timestamp: candle.timestamp,
    close,
  };
};

export const buildCupAndHandleSignalContext = (
  pattern: CupAndHandlePattern,
) => ({
  setupId: pattern.setupId,
  patternKind: pattern.kind,
  signalDirection: pattern.direction,
  entryMode: pattern.entryMode,
  entryStage: pattern.entryStage,
  neckline: pattern.neckline,
  targetPrice: pattern.targetPrice,
  stopLossPrice: pattern.stopLossPrice,
  cupDepth: pattern.cupDepth,
  cupDepthPct: pattern.cupDepthPct,
  cupDepthAtr: pattern.cupDepthAtr,
  cupDurationBars: pattern.cupDurationBars,
  cupSymmetryRatio: pattern.cupSymmetryRatio,
  rimDifferencePct: pattern.rimDifferencePct,
  handleDepth: pattern.handleDepth,
  handleDepthRatio: pattern.handleDepthRatio,
  handleDurationBars: pattern.handleDurationBars,
  patternAgeBars: pattern.patternAgeBars,
  breakoutDistancePct: pattern.breakoutDistancePct,
  breakoutDistanceAtr: pattern.breakoutDistanceAtr,
  breakoutDistanceDepthRatio: pattern.breakoutDistanceDepthRatio,
  breakoutCrossedOnSignalBar: pattern.breakoutCrossedOnSignalBar,
  breakoutTimestamp: pattern.breakoutTimestamp,
  confirmationBars: pattern.confirmationBars,
  currentPrice: pattern.close,
  pivots: pattern.pivots.map(({ timestamp, value, kind }) => ({
    timestamp,
    value,
    kind,
  })),
});

export type CupAndHandleSignalContext = ReturnType<
  typeof buildCupAndHandleSignalContext
>;

export const createCupAndHandleEngine = ({
  config,
  initialCandles = [],
}: {
  config: CupAndHandleConfig;
  initialCandles?: Candle[];
}): {
  next: (candle: Candle) => CupAndHandleRuntimeState;
  getState: () => CupAndHandleRuntimeState;
} => {
  const options = getConfigNumbers(config);
  const state: EngineState = {
    candles: [],
    candleStartIndex: 0,
    currentIndex: -1,
    pivots: [],
    pattern: null,
    pending: null,
    consumedSetupIds: [],
    lastTimestamp: null,
  };

  const snapshot = (): CupAndHandleRuntimeState => ({
    pattern: clonePattern(state.pattern),
    pending: clonePending(state.pending),
    pivots: state.pivots.map((pivot) => ({ ...pivot })),
  });

  const apply = (candle: Candle): CupAndHandleRuntimeState => {
    if (state.lastTimestamp === candle.timestamp) return snapshot();
    state.lastTimestamp = candle.timestamp;
    state.pattern = null;

    const previous = state.candles[state.candles.length - 1];
    const prevClose = previous ? asNumber(previous.close) : null;
    const maxCandles = Math.max(
      options.pivotLookback * 2 + 1,
      options.atrPeriod + 1,
    );
    const currentIndex = pushBoundedCandle(state, candle, maxCandles);
    const atr = calculateAtr(state.candles, options.atrPeriod);
    const pendingPattern = resolvePending({ state, candle, atr, options });

    const candidateIndex = currentIndex - options.pivotLookback;
    recordPivot(
      state,
      resolveConfirmedPivot({
        state,
        candidateIndex,
        lookback: options.pivotLookback,
      }),
    );

    if (pendingPattern) {
      state.pattern = pendingPattern;
      return snapshot();
    }
    if (state.pending) return snapshot();

    const breakout =
      buildBreakoutPattern({
        state,
        candle,
        prevClose,
        atr,
        direction: 'LONG',
        options,
      }) ??
      buildBreakoutPattern({
        state,
        candle,
        prevClose,
        atr,
        direction: 'SHORT',
        options,
      });
    if (!breakout) return snapshot();

    if (options.entryMode === 'breakout') {
      rememberConsumed(state, breakout.setupId);
      state.pattern = breakout;
      return snapshot();
    }

    state.pending = {
      setupId: breakout.setupId,
      mode: options.entryMode,
      stage:
        options.entryMode === 'retest' ? 'retest_pending' : 'neckline_crossed',
      breakoutIndex: currentIndex,
      pattern: breakout,
    };
    return snapshot();
  };

  for (const candle of initialCandles) apply(candle);

  return { next: apply, getState: snapshot };
};
