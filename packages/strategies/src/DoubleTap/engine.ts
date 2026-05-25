import { Candle, Direction } from '@tradejs/types';
import { DoubleTapConfig } from './config';

export type DoubleTapPatternKind = 'double_bottom' | 'double_top';

export interface DoubleTapPivot {
  timestamp: number;
  index: number;
  value: number;
  kind: 'high' | 'low';
  traded: boolean;
}

export interface DoubleTapPattern {
  kind: DoubleTapPatternKind;
  direction: Direction;
  pivots: [DoubleTapPivot, DoubleTapPivot, DoubleTapPivot, DoubleTapPivot];
  neckline: number;
  targetPrice: number;
  stopLossPrice: number;
  height: number;
  pivotTolerancePct: number;
  breakoutDistancePct: number;
  timestamp: number;
  close: number;
}

export interface DoubleTapRuntimeState {
  pattern: DoubleTapPattern | null;
  pivots: DoubleTapPivot[];
}

type SwingDirection = 1 | 0 | null;

interface EngineState {
  candles: Candle[];
  pivots: DoubleTapPivot[];
  dir: SwingDirection;
  pattern: DoubleTapPattern | null;
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
  maxBreakoutDistancePct: Math.max(
    0,
    Number(config.DOUBLETAP_MAX_BREAKOUT_DISTANCE_PCT ?? 0),
  ),
});

const highest = (candles: Candle[]) =>
  candles.reduce(
    (max, candle) => Math.max(max, Number(candle.high)),
    -Infinity,
  );

const lowest = (candles: Candle[]) =>
  candles.reduce((min, candle) => Math.min(min, Number(candle.low)), Infinity);

const getRecentWindow = (candles: Candle[], length: number) =>
  candles.slice(Math.max(0, candles.length - length));

const isCurrentWindowHigh = (candle: Candle, window: Candle[]) => {
  const high = asNumber(candle.high);
  return high != null && high >= highest(window);
};

const isCurrentWindowLow = (candle: Candle, window: Candle[]) => {
  const low = asNumber(candle.low);
  return low != null && low <= lowest(window);
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
  if (pivots.length > 12) {
    pivots.shift();
  }
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
  if (!latest || latest.kind !== kind) {
    return;
  }
  const isMoreExtreme =
    kind === 'high' ? value > latest.value : value < latest.value;
  if (!isMoreExtreme) {
    return;
  }
  latest.timestamp = candle.timestamp;
  latest.index = index;
  latest.value = value;
};

const buildPattern = ({
  pivots,
  candle,
  prevClose,
  multiplier,
  tolerancePct,
  targetFibPct,
  stopFibPct,
  minPatternHeightPct,
  maxBreakoutDistancePct,
}: {
  pivots: DoubleTapPivot[];
  candle: Candle;
  prevClose: number | null;
  multiplier: 1 | -1;
  tolerancePct: number;
  targetFibPct: number;
  stopFibPct: number;
  minPatternHeightPct: number;
  maxBreakoutDistancePct: number;
}): DoubleTapPattern | null => {
  if (pivots.length < 5 || prevClose == null) {
    return null;
  }

  const rows = pivots.length;
  const p1 = pivots[rows - 5];
  const p2 = pivots[rows - 4];
  const p3 = pivots[rows - 3];
  const p4 = pivots[rows - 2];
  if (!p1 || !p2 || !p3 || !p4 || p4.traded) {
    return null;
  }

  const close = asNumber(candle.close);
  if (close == null) {
    return null;
  }

  const height = (p2.value + p4.value) / 2 - p3.value;
  const normalizedHeight = Math.abs(height);
  if (normalizedHeight <= 0) {
    return null;
  }

  const heightPct =
    p3.value !== 0 ? (normalizedHeight / Math.abs(p3.value)) * 100 : 0;
  if (heightPct < minPatternHeightPct) {
    return null;
  }

  const upper = p2.value + height * (tolerancePct / 100);
  const lower = p2.value - height * (tolerancePct / 100);
  const crossedNeckline =
    close * multiplier < p3.value * multiplier &&
    !(prevClose * multiplier < p3.value * multiplier);
  const pivotsAligned =
    p1.value * multiplier < p3.value * multiplier &&
    p4.value * multiplier <= upper * multiplier &&
    p4.value * multiplier >= lower * multiplier;

  if (!crossedNeckline || !pivotsAligned) {
    return null;
  }

  const breakoutDistancePct =
    p3.value !== 0
      ? (Math.abs(close - p3.value) / Math.abs(p3.value)) * 100
      : 0;
  if (
    maxBreakoutDistancePct > 0 &&
    breakoutDistancePct > maxBreakoutDistancePct
  ) {
    return null;
  }

  const lowerInvalidation = Math.min(p2.value, p4.value);
  const upperInvalidation = Math.max(p2.value, p4.value);
  const stopLossPrice =
    multiplier === -1
      ? lowerInvalidation + normalizedHeight * (stopFibPct / 100)
      : upperInvalidation - normalizedHeight * (stopFibPct / 100);
  const targetPrice = p3.value - height * (targetFibPct / 100);

  p4.traded = true;

  return {
    kind: multiplier === -1 ? 'double_bottom' : 'double_top',
    direction: multiplier === -1 ? 'LONG' : 'SHORT',
    pivots: [p1, p2, p3, p4],
    neckline: p3.value,
    targetPrice,
    stopLossPrice,
    height: normalizedHeight,
    pivotTolerancePct: tolerancePct,
    breakoutDistancePct,
    timestamp: candle.timestamp,
    close,
  };
};

export const buildDoubleTapSignalContext = (pattern: DoubleTapPattern) => ({
  patternKind: pattern.kind,
  signalDirection: pattern.direction,
  neckline: pattern.neckline,
  targetPrice: pattern.targetPrice,
  stopLossPrice: pattern.stopLossPrice,
  height: pattern.height,
  pivotTolerancePct: pattern.pivotTolerancePct,
  breakoutDistancePct: pattern.breakoutDistancePct,
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
  const {
    pivotLength,
    tolerancePct,
    targetFibPct,
    stopFibPct,
    minPatternHeightPct,
    maxBreakoutDistancePct,
  } = getConfigNumbers(config);
  const state: EngineState = {
    candles: [],
    pivots: [],
    dir: null,
    pattern: null,
  };

  const apply = (candle: Candle): DoubleTapRuntimeState => {
    const prevCandle = state.candles[state.candles.length - 1];
    const prevClose = prevCandle ? asNumber(prevCandle.close) : null;
    state.candles.push(candle);
    const window = getRecentWindow(state.candles, pivotLength);
    const currentIndex = state.candles.length - 1;
    const high = asNumber(candle.high);
    const low = asNumber(candle.low);
    const currentIsHigh = isCurrentWindowHigh(candle, window);
    const currentIsLow = isCurrentWindowLow(candle, window);
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
    const doubleTop = buildPattern({
      pivots: state.pivots,
      candle,
      prevClose,
      multiplier: 1,
      tolerancePct,
      targetFibPct,
      stopFibPct,
      minPatternHeightPct,
      maxBreakoutDistancePct,
    });
    const doubleBottom =
      doubleTop ??
      buildPattern({
        pivots: state.pivots,
        candle,
        prevClose,
        multiplier: -1,
        tolerancePct,
        targetFibPct,
        stopFibPct,
        minPatternHeightPct,
        maxBreakoutDistancePct,
      });
    state.pattern = doubleBottom;

    return {
      pattern: state.pattern,
      pivots: [...state.pivots],
    };
  };

  for (const candle of initialCandles) {
    apply(candle);
  }

  return {
    next: apply,
    getState: () => ({
      pattern: state.pattern,
      pivots: [...state.pivots],
    }),
  };
};
