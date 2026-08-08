import { Candle, Direction } from '@tradejs/types';
import { DoubleTapConfig, DoubleTapEntryMode } from './config';

export type DoubleTapPatternKind = 'double_bottom' | 'double_top';
export type DoubleTapEntryStage = 'breakout' | 'close_accepted' | 'retest_held';

export interface DoubleTapPivot {
  timestamp: number;
  index: number;
  value: number;
  kind: 'high' | 'low';
  traded: boolean;
}

export interface DoubleTapPattern {
  setupId: string;
  kind: DoubleTapPatternKind;
  direction: Direction;
  entryMode: DoubleTapEntryMode;
  entryStage: DoubleTapEntryStage;
  pivots: [DoubleTapPivot, DoubleTapPivot, DoubleTapPivot, DoubleTapPivot];
  neckline: number;
  targetPrice: number;
  stopLossPrice: number;
  height: number;
  patternHeightAtr: number;
  patternAgeBars: number;
  tapSpacingBars: number;
  legDurationSymmetryRatio: number;
  pivotTolerancePct: number;
  breakoutDistancePct: number;
  breakoutDistanceAtr: number;
  breakoutDistanceHeightRatio: number;
  breakoutTimestamp: number;
  confirmationBars: number;
  timestamp: number;
  close: number;
}

export interface DoubleTapPendingSetup {
  setupId: string;
  mode: Exclude<DoubleTapEntryMode, 'breakout'>;
  stage: 'neckline_crossed' | 'retest_pending';
  breakoutIndex: number;
  pattern: DoubleTapPattern;
}

export interface DoubleTapRuntimeState {
  pattern: DoubleTapPattern | null;
  pending: DoubleTapPendingSetup | null;
  pivots: DoubleTapPivot[];
}

type SwingDirection = 1 | 0 | null;

interface EngineState {
  candles: Candle[];
  currentIndex: number;
  pivots: DoubleTapPivot[];
  dir: SwingDirection;
  pattern: DoubleTapPattern | null;
  pending: DoubleTapPendingSetup | null;
  consumedSetupIds: Set<string>;
  lastTimestamp: number | null;
}

const asNumber = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const clampPositive = (value: number, fallback: number) =>
  Number.isFinite(value) && value > 0 ? value : fallback;

const getConfigNumbers = (config: DoubleTapConfig) => ({
  pivotLength: Math.max(1, Math.floor(config.DOUBLETAP_PIVOT_LENGTH ?? 50)),
  tolerancePct: clampPositive(config.DOUBLETAP_PIVOT_TOLERANCE_PCT, 15),
  targetFibPct: Math.max(0, Number(config.DOUBLETAP_TARGET_FIB_PCT ?? 100)),
  stopFibPct: Number(config.DOUBLETAP_STOP_FIB_PCT ?? 0),
  minPatternHeightPct: Math.max(
    0,
    Number(config.DOUBLETAP_MIN_PATTERN_HEIGHT_PCT ?? 0),
  ),
  minPatternHeightAtr: Math.max(
    0,
    Number(config.DOUBLETAP_MIN_PATTERN_HEIGHT_ATR ?? 0),
  ),
  atrPeriod: Math.max(2, Math.floor(config.DOUBLETAP_ATR_PERIOD ?? 14)),
  minTapSpacingBars: Math.max(
    1,
    Math.floor(config.DOUBLETAP_MIN_TAP_SPACING_BARS ?? 1),
  ),
  maxPatternAgeBars: Math.max(
    1,
    Math.floor(config.DOUBLETAP_MAX_PATTERN_AGE_BARS ?? 180),
  ),
  minLegSymmetryRatio: Math.min(
    1,
    Math.max(0, Number(config.DOUBLETAP_MIN_LEG_SYMMETRY_RATIO ?? 0)),
  ),
  minBreakoutDistanceAtr: Math.max(
    0,
    Number(config.DOUBLETAP_MIN_BREAKOUT_DISTANCE_ATR ?? 0),
  ),
  maxBreakoutDistanceHeightRatio: Math.max(
    0,
    Number(config.DOUBLETAP_MAX_BREAKOUT_DISTANCE_HEIGHT_RATIO ?? 0),
  ),
  maxBreakoutDistancePct: Math.max(
    0,
    Number(config.DOUBLETAP_MAX_BREAKOUT_DISTANCE_PCT ?? 0),
  ),
  entryMode: config.DOUBLETAP_ENTRY_MODE ?? 'close_acceptance',
  confirmationMaxBars: Math.max(
    1,
    Math.floor(config.DOUBLETAP_CONFIRMATION_MAX_BARS ?? 2),
  ),
  retestMaxBars: Math.max(1, Math.floor(config.DOUBLETAP_RETEST_MAX_BARS ?? 4)),
  retestToleranceAtr: Math.max(
    0,
    Number(config.DOUBLETAP_RETEST_TOLERANCE_ATR ?? 0.25),
  ),
});

const highest = (candles: Candle[]) =>
  candles.reduce(
    (max, candle) => Math.max(max, Number(candle.high)),
    -Infinity,
  );

const lowest = (candles: Candle[]) =>
  candles.reduce((min, candle) => Math.min(min, Number(candle.low)), Infinity);

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
  state: Pick<EngineState, 'candles' | 'currentIndex'>,
  candle: Candle,
  maxCandles: number,
) => {
  state.currentIndex += 1;
  state.candles.push(candle);
  if (state.candles.length > maxCandles) {
    state.candles.splice(0, state.candles.length - maxCandles);
  }
  return state.currentIndex;
};

const pushPivot = ({
  pivots,
  candle,
  index,
  kind,
  value,
}: {
  pivots: DoubleTapPivot[];
  candle: Candle;
  index: number;
  kind: DoubleTapPivot['kind'];
  value: number;
}) => {
  pivots.push({
    timestamp: candle.timestamp,
    index,
    value,
    kind,
    traded: false,
  });
  if (pivots.length > 12) pivots.shift();
};

const updateLatestPivot = ({
  pivots,
  candle,
  index,
  kind,
  value,
}: {
  pivots: DoubleTapPivot[];
  candle: Candle;
  index: number;
  kind: DoubleTapPivot['kind'];
  value: number;
}) => {
  const latest = pivots[pivots.length - 1];
  if (!latest || latest.kind !== kind) return;
  const isMoreExtreme =
    kind === 'high' ? value > latest.value : value < latest.value;
  if (!isMoreExtreme) return;
  latest.timestamp = candle.timestamp;
  latest.index = index;
  latest.value = value;
};

const markTerminal = (state: EngineState, setup: DoubleTapPendingSetup) => {
  state.consumedSetupIds.add(setup.setupId);
  const terminalPivot = state.pivots.find(
    (pivot) => pivot.timestamp === setup.pattern.pivots[3].timestamp,
  );
  if (terminalPivot) terminalPivot.traded = true;
};

const buildBreakoutPattern = ({
  state,
  candle,
  prevClose,
  atr,
  multiplier,
  tolerancePct,
  targetFibPct,
  stopFibPct,
  minPatternHeightPct,
  minPatternHeightAtr,
  minTapSpacingBars,
  maxPatternAgeBars,
  minLegSymmetryRatio,
  minBreakoutDistanceAtr,
  maxBreakoutDistanceHeightRatio,
  maxBreakoutDistancePct,
  entryMode,
}: {
  state: EngineState;
  candle: Candle;
  prevClose: number | null;
  atr: number | null;
  multiplier: 1 | -1;
  tolerancePct: number;
  targetFibPct: number;
  stopFibPct: number;
  minPatternHeightPct: number;
  minPatternHeightAtr: number;
  minTapSpacingBars: number;
  maxPatternAgeBars: number;
  minLegSymmetryRatio: number;
  minBreakoutDistanceAtr: number;
  maxBreakoutDistanceHeightRatio: number;
  maxBreakoutDistancePct: number;
  entryMode: DoubleTapEntryMode;
}): DoubleTapPattern | null => {
  const { pivots } = state;
  if (pivots.length < 5 || prevClose == null) return null;

  const rows = pivots.length;
  const p1 = pivots[rows - 5];
  const p2 = pivots[rows - 4];
  const p3 = pivots[rows - 3];
  const p4 = pivots[rows - 2];
  if (!p1 || !p2 || !p3 || !p4 || p4.traded) return null;

  const close = asNumber(candle.close);
  if (close == null) return null;

  const signedHeight = (p2.value + p4.value) / 2 - p3.value;
  const height = Math.abs(signedHeight);
  if (height <= 0) return null;

  const heightPct = p3.value !== 0 ? (height / Math.abs(p3.value)) * 100 : 0;
  const patternHeightAtr = atr != null && atr > 0 ? height / atr : 0;
  if (
    heightPct < minPatternHeightPct ||
    patternHeightAtr < minPatternHeightAtr
  ) {
    return null;
  }

  const upper = p2.value + signedHeight * (tolerancePct / 100);
  const lower = p2.value - signedHeight * (tolerancePct / 100);
  const crossedNeckline =
    close * multiplier < p3.value * multiplier &&
    !(prevClose * multiplier < p3.value * multiplier);
  const pivotsAligned =
    p1.value * multiplier < p3.value * multiplier &&
    p4.value * multiplier <= upper * multiplier &&
    p4.value * multiplier >= lower * multiplier;
  if (!crossedNeckline || !pivotsAligned) return null;

  const tapSpacingBars = p4.index - p2.index;
  const firstLegBars = p3.index - p2.index;
  const secondLegBars = p4.index - p3.index;
  const legDurationSymmetryRatio =
    Math.max(firstLegBars, secondLegBars) > 0
      ? Math.min(firstLegBars, secondLegBars) /
        Math.max(firstLegBars, secondLegBars)
      : 0;
  const patternAgeBars = state.currentIndex - p2.index;
  if (
    tapSpacingBars < minTapSpacingBars ||
    patternAgeBars > maxPatternAgeBars ||
    legDurationSymmetryRatio < minLegSymmetryRatio
  ) {
    return null;
  }

  const breakoutDistance = Math.abs(close - p3.value);
  const breakoutDistancePct =
    p3.value !== 0 ? (breakoutDistance / Math.abs(p3.value)) * 100 : 0;
  const breakoutDistanceAtr =
    atr != null && atr > 0 ? breakoutDistance / atr : 0;
  const breakoutDistanceHeightRatio = breakoutDistance / height;
  if (
    breakoutDistanceAtr < minBreakoutDistanceAtr ||
    (maxBreakoutDistanceHeightRatio > 0 &&
      breakoutDistanceHeightRatio > maxBreakoutDistanceHeightRatio) ||
    (maxBreakoutDistancePct > 0 && breakoutDistancePct > maxBreakoutDistancePct)
  ) {
    return null;
  }

  const kind: DoubleTapPatternKind =
    multiplier === -1 ? 'double_bottom' : 'double_top';
  const setupId = `${kind}:${p2.timestamp}:${p3.timestamp}:${p4.timestamp}`;
  if (state.consumedSetupIds.has(setupId)) return null;

  const lowerInvalidation = Math.min(p2.value, p4.value);
  const upperInvalidation = Math.max(p2.value, p4.value);
  const stopLossPrice =
    multiplier === -1
      ? lowerInvalidation + height * (stopFibPct / 100)
      : upperInvalidation - height * (stopFibPct / 100);

  return {
    setupId,
    kind,
    direction: multiplier === -1 ? 'LONG' : 'SHORT',
    entryMode,
    entryStage: 'breakout',
    pivots: [p1, p2, p3, p4],
    neckline: p3.value,
    targetPrice: p3.value - signedHeight * (targetFibPct / 100),
    stopLossPrice,
    height,
    patternHeightAtr,
    patternAgeBars,
    tapSpacingBars,
    legDurationSymmetryRatio,
    pivotTolerancePct: tolerancePct,
    breakoutDistancePct,
    breakoutDistanceAtr,
    breakoutDistanceHeightRatio,
    breakoutTimestamp: candle.timestamp,
    confirmationBars: 0,
    timestamp: candle.timestamp,
    close,
  };
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

const resolvePending = ({
  state,
  candle,
  atr,
  confirmationMaxBars,
  retestMaxBars,
  retestToleranceAtr,
  minBreakoutDistanceAtr,
}: {
  state: EngineState;
  candle: Candle;
  atr: number | null;
  confirmationMaxBars: number;
  retestMaxBars: number;
  retestToleranceAtr: number;
  minBreakoutDistanceAtr: number;
}): DoubleTapPattern | null => {
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
    pending.mode === 'retest' ? retestMaxBars : confirmationMaxBars;
  if (invalidated || confirmationBars > maxBars) {
    markTerminal(state, pending);
    state.pending = null;
    return null;
  }

  const effectiveAtr = atr != null && atr > 0 ? atr : pattern.height;
  const minimumDistance = effectiveAtr * minBreakoutDistanceAtr;
  const closeAccepted = isBeyondNeckline(
    pattern.direction,
    close,
    pattern.neckline,
    minimumDistance,
  );
  let entryStage: DoubleTapEntryStage | null = null;

  if (pending.mode === 'close_acceptance') {
    if (closeAccepted) entryStage = 'close_accepted';
  } else {
    const tolerance = effectiveAtr * retestToleranceAtr;
    const touched =
      pattern.direction === 'LONG'
        ? low <= pattern.neckline + tolerance &&
          low >= pattern.neckline - tolerance
        : high >= pattern.neckline - tolerance &&
          high <= pattern.neckline + tolerance;
    if (touched && closeAccepted) entryStage = 'retest_held';
  }

  if (!entryStage) return null;
  markTerminal(state, pending);
  state.pending = null;
  return {
    ...pattern,
    entryStage,
    confirmationBars,
    timestamp: candle.timestamp,
    close,
  };
};

const clonePending = (
  pending: DoubleTapPendingSetup | null,
): DoubleTapPendingSetup | null =>
  pending
    ? {
        ...pending,
        pattern: { ...pending.pattern, pivots: [...pending.pattern.pivots] },
      }
    : null;

export const buildDoubleTapSignalContext = (pattern: DoubleTapPattern) => ({
  setupId: pattern.setupId,
  patternKind: pattern.kind,
  signalDirection: pattern.direction,
  entryMode: pattern.entryMode,
  entryStage: pattern.entryStage,
  neckline: pattern.neckline,
  targetPrice: pattern.targetPrice,
  stopLossPrice: pattern.stopLossPrice,
  height: pattern.height,
  patternHeightAtr: pattern.patternHeightAtr,
  patternAgeBars: pattern.patternAgeBars,
  tapSpacingBars: pattern.tapSpacingBars,
  legDurationSymmetryRatio: pattern.legDurationSymmetryRatio,
  pivotTolerancePct: pattern.pivotTolerancePct,
  breakoutDistancePct: pattern.breakoutDistancePct,
  breakoutDistanceAtr: pattern.breakoutDistanceAtr,
  breakoutDistanceHeightRatio: pattern.breakoutDistanceHeightRatio,
  breakoutTimestamp: pattern.breakoutTimestamp,
  confirmationBars: pattern.confirmationBars,
  currentPrice: pattern.close,
  pivots: pattern.pivots.map(({ timestamp, value, kind }) => ({
    timestamp,
    value,
    kind,
  })),
});

export type DoubleTapSignalContext = ReturnType<
  typeof buildDoubleTapSignalContext
>;

export const createDoubleTapEngine = ({
  config,
  initialCandles = [],
}: {
  config: DoubleTapConfig;
  initialCandles?: Candle[];
}): {
  next: (candle: Candle) => DoubleTapRuntimeState;
  getState: () => DoubleTapRuntimeState;
} => {
  const options = getConfigNumbers(config);
  const state: EngineState = {
    candles: [],
    currentIndex: -1,
    pivots: [],
    dir: null,
    pattern: null,
    pending: null,
    consumedSetupIds: new Set(),
    lastTimestamp: null,
  };

  const snapshot = (): DoubleTapRuntimeState => ({
    pattern: state.pattern
      ? { ...state.pattern, pivots: [...state.pattern.pivots] }
      : null,
    pending: clonePending(state.pending),
    pivots: state.pivots.map((pivot) => ({ ...pivot })),
  });

  const apply = (candle: Candle): DoubleTapRuntimeState => {
    if (state.lastTimestamp === candle.timestamp) return snapshot();
    state.lastTimestamp = candle.timestamp;
    state.pattern = null;
    const previous = state.candles[state.candles.length - 1];
    const prevClose = previous ? asNumber(previous.close) : null;
    const maxCandles = Math.max(options.pivotLength + 1, options.atrPeriod + 1);
    const currentIndex = pushBoundedCandle(state, candle, maxCandles);
    const atr = calculateAtr(state.candles, options.atrPeriod);

    const pendingPattern = resolvePending({
      state,
      candle,
      atr,
      confirmationMaxBars: options.confirmationMaxBars,
      retestMaxBars: options.retestMaxBars,
      retestToleranceAtr: options.retestToleranceAtr,
      minBreakoutDistanceAtr: options.minBreakoutDistanceAtr,
    });

    const window = state.candles.slice(-options.pivotLength);
    const high = asNumber(candle.high);
    const low = asNumber(candle.low);
    const currentIsHigh = high != null && high >= highest(window);
    const currentIsLow = low != null && low <= lowest(window);
    const nextDir: SwingDirection = currentIsHigh
      ? 1
      : currentIsLow
        ? 0
        : state.dir;
    const dirChanged = state.dir != null && nextDir !== state.dir;

    if (dirChanged && nextDir === 1 && high != null) {
      pushPivot({
        pivots: state.pivots,
        candle,
        index: currentIndex,
        kind: 'high',
        value: high,
      });
    }
    if (dirChanged && nextDir === 0 && low != null) {
      pushPivot({
        pivots: state.pivots,
        candle,
        index: currentIndex,
        kind: 'low',
        value: low,
      });
    }
    if (!dirChanged && nextDir === 1 && high != null) {
      updateLatestPivot({
        pivots: state.pivots,
        candle,
        index: currentIndex,
        kind: 'high',
        value: high,
      });
    }
    if (!dirChanged && nextDir === 0 && low != null) {
      updateLatestPivot({
        pivots: state.pivots,
        candle,
        index: currentIndex,
        kind: 'low',
        value: low,
      });
    }
    state.dir = nextDir;

    if (pendingPattern) {
      state.pattern = pendingPattern;
      return snapshot();
    }
    if (state.pending) return snapshot();

    const common = {
      state,
      candle,
      prevClose,
      atr,
      tolerancePct: options.tolerancePct,
      targetFibPct: options.targetFibPct,
      stopFibPct: options.stopFibPct,
      minPatternHeightPct: options.minPatternHeightPct,
      minPatternHeightAtr: options.minPatternHeightAtr,
      minTapSpacingBars: options.minTapSpacingBars,
      maxPatternAgeBars: options.maxPatternAgeBars,
      minLegSymmetryRatio: options.minLegSymmetryRatio,
      minBreakoutDistanceAtr: options.minBreakoutDistanceAtr,
      maxBreakoutDistanceHeightRatio: options.maxBreakoutDistanceHeightRatio,
      maxBreakoutDistancePct: options.maxBreakoutDistancePct,
      entryMode: options.entryMode,
    };
    const breakout =
      buildBreakoutPattern({ ...common, multiplier: 1 }) ??
      buildBreakoutPattern({ ...common, multiplier: -1 });
    if (!breakout) return snapshot();

    if (options.entryMode === 'breakout') {
      const terminal: DoubleTapPendingSetup = {
        setupId: breakout.setupId,
        mode: 'close_acceptance',
        stage: 'neckline_crossed',
        breakoutIndex: currentIndex,
        pattern: breakout,
      };
      markTerminal(state, terminal);
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
