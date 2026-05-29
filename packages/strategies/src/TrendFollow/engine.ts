import { Candle, Direction, StrategyFigurePoint } from '@tradejs/types';
import { TrendFollowConfig } from './config';

export interface TrendFollowPivot {
  timestamp: number;
  index: number;
  value: number;
  kind: 'high' | 'low';
}

export interface TrendFollowSnapshot {
  trendState: 1 | -1 | 0;
  signalDirection: Direction | null;
  bullCross: boolean;
  bearCross: boolean;
  entryLevel: number | null;
  trailStop: number | null;
  atr: number;
  barsSinceSignal: number | null;
  lastPivotHigh: TrendFollowPivot | null;
  lastPivotLow: TrendFollowPivot | null;
  distanceToStopPct: number | null;
  breakoutDistancePct: number | null;
  timestamp: number;
  close: number;
}

export interface TrendFollowSignal {
  direction: Direction;
  entryLevel: number;
  trailStop: number;
  atr: number;
  pivot: TrendFollowPivot;
  barsSinceSignal: number;
  breakoutDistancePct: number;
  distanceToStopPct: number;
  timestamp: number;
  close: number;
}

export interface TrendFollowFigureSeries {
  trailStop: StrategyFigurePoint[];
}

export interface TrendFollowRuntimeState {
  signal: TrendFollowSignal | null;
  snapshot: TrendFollowSnapshot | null;
  series: TrendFollowFigureSeries;
}

type AtrState = {
  value: number | null;
  count: number;
};

type EngineState = {
  candles: Candle[];
  atrState: AtrState;
  prevClose: number | null;
  trendState: 1 | -1 | 0;
  lastPivotHigh: TrendFollowPivot | null;
  lastPivotLow: TrendFollowPivot | null;
  lastSignalIndex: number | null;
  trailStop: number | null;
  entryLevel: number | null;
  signal: TrendFollowSignal | null;
  snapshot: TrendFollowSnapshot | null;
  series: TrendFollowFigureSeries;
};

const asFiniteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const clampPositive = (value: number, fallback: number) =>
  Number.isFinite(value) && value > 0 ? value : fallback;

const calculateTrueRange = (candle: Candle, prevClose: number | null) => {
  const high = asFiniteNumber(candle.high);
  const low = asFiniteNumber(candle.low);
  const close = asFiniteNumber(candle.close);
  if (high == null || low == null || close == null) {
    return 0;
  }
  if (prevClose == null || !Number.isFinite(prevClose)) {
    return Math.max(high - low, 0);
  }
  return Math.max(
    high - low,
    Math.abs(high - prevClose),
    Math.abs(low - prevClose),
  );
};

const updateAtrState = ({
  atrState,
  tr,
  period,
}: {
  atrState: AtrState;
  tr: number;
  period: number;
}): AtrState => {
  const safeTr = Number.isFinite(tr) ? Math.max(tr, 0) : 0;
  const safePeriod = Math.max(1, Math.floor(period));

  if (atrState.value == null) {
    return { value: safeTr, count: 1 };
  }

  if (atrState.count < safePeriod) {
    const nextCount = atrState.count + 1;
    return {
      value: (atrState.value * atrState.count + safeTr) / nextCount,
      count: nextCount,
    };
  }

  return {
    value: (atrState.value * (safePeriod - 1) + safeTr) / safePeriod,
    count: atrState.count + 1,
  };
};

const pushBoundedPoint = (
  series: StrategyFigurePoint[],
  point: StrategyFigurePoint,
  maxPoints: number,
) => {
  series.push(point);
  if (series.length > maxPoints) {
    series.splice(0, series.length - maxPoints);
  }
};

const getConfigNumbers = (config: TrendFollowConfig) => ({
  pivotLength: Math.max(2, Math.floor(config.TRENDFOLLOW_PIVOT_LENGTH ?? 10)),
  minBarsBetween: Math.max(
    0,
    Math.floor(config.TRENDFOLLOW_MIN_BARS_BETWEEN_SIGNALS ?? 0),
  ),
  atrLength: Math.max(1, Math.floor(config.TRENDFOLLOW_ATR_LENGTH ?? 14)),
  atrMult: clampPositive(config.TRENDFOLLOW_ATR_MULT, 4),
  maxFigurePoints: Math.max(
    20,
    Math.floor(config.TRENDFOLLOW_MAX_FIGURE_POINTS ?? 180),
  ),
});

const getWindow = (
  candles: Candle[],
  candidateIndex: number,
  lookback: number,
) =>
  candles.slice(
    Math.max(0, candidateIndex - lookback),
    candidateIndex + lookback + 1,
  );

const isPivotHigh = (
  candles: Candle[],
  candidateIndex: number,
  lookback: number,
) => {
  const candidate = candles[candidateIndex];
  const candidateHigh = asFiniteNumber(candidate?.high);
  if (candidateHigh == null) {
    return false;
  }
  return getWindow(candles, candidateIndex, lookback).every(
    (candle) => candidateHigh >= Number(candle.high),
  );
};

const isPivotLow = (
  candles: Candle[],
  candidateIndex: number,
  lookback: number,
) => {
  const candidate = candles[candidateIndex];
  const candidateLow = asFiniteNumber(candidate?.low);
  if (candidateLow == null) {
    return false;
  }
  return getWindow(candles, candidateIndex, lookback).every(
    (candle) => candidateLow <= Number(candle.low),
  );
};

export const buildTrendFollowSignalContext = (signal: TrendFollowSignal) => ({
  signalDirection: signal.direction,
  entryLevel: signal.entryLevel,
  trailStop: signal.trailStop,
  atr: signal.atr,
  pivotKind: signal.pivot.kind,
  pivotTimestamp: signal.pivot.timestamp,
  pivotValue: signal.pivot.value,
  barsSinceSignal: signal.barsSinceSignal,
  breakoutDistancePct: signal.breakoutDistancePct,
  distanceToStopPct: signal.distanceToStopPct,
  currentPrice: signal.close,
});

export type TrendFollowSignalContext = ReturnType<
  typeof buildTrendFollowSignalContext
>;

export const createTrendFollowEngine = ({
  config,
  initialCandles = [],
}: {
  config: TrendFollowConfig;
  initialCandles?: Candle[];
}): {
  next: (candle: Candle) => TrendFollowRuntimeState;
  getState: () => TrendFollowRuntimeState;
} => {
  const { pivotLength, minBarsBetween, atrLength, atrMult, maxFigurePoints } =
    getConfigNumbers(config);
  const state: EngineState = {
    candles: [],
    atrState: { value: null, count: 0 },
    prevClose: null,
    trendState: 0,
    lastPivotHigh: null,
    lastPivotLow: null,
    lastSignalIndex: null,
    trailStop: null,
    entryLevel: null,
    signal: null,
    snapshot: null,
    series: { trailStop: [] },
  };

  const apply = (candle: Candle): TrendFollowRuntimeState => {
    state.signal = null;
    const prevClose = state.prevClose;
    const close = Number(candle.close);
    const tr = calculateTrueRange(candle, prevClose);
    state.atrState = updateAtrState({
      atrState: state.atrState,
      tr,
      period: atrLength,
    });
    const atr = state.atrState.value ?? 0;

    state.candles.push(candle);
    const currentIndex = state.candles.length - 1;
    const candidateIndex = currentIndex - pivotLength;
    const candidate =
      candidateIndex >= pivotLength ? state.candles[candidateIndex] : null;

    if (candidate && isPivotHigh(state.candles, candidateIndex, pivotLength)) {
      state.lastPivotHigh = {
        timestamp: candidate.timestamp,
        index: candidateIndex,
        value: Number(candidate.high),
        kind: 'high',
      };
    }

    if (candidate && isPivotLow(state.candles, candidateIndex, pivotLength)) {
      state.lastPivotLow = {
        timestamp: candidate.timestamp,
        index: candidateIndex,
        value: Number(candidate.low),
        kind: 'low',
      };
    }

    const barsSinceLastSignal =
      state.lastSignalIndex == null
        ? 999_999
        : currentIndex - state.lastSignalIndex;
    const filterPass =
      minBarsBetween === 0 || barsSinceLastSignal >= minBarsBetween;
    const bullCross =
      state.lastPivotHigh != null &&
      prevClose != null &&
      prevClose <= state.lastPivotHigh.value &&
      close > state.lastPivotHigh.value &&
      state.trendState !== 1 &&
      filterPass;
    const bearCross =
      state.lastPivotLow != null &&
      prevClose != null &&
      prevClose >= state.lastPivotLow.value &&
      close < state.lastPivotLow.value &&
      state.trendState !== -1 &&
      filterPass;

    if (bullCross && state.lastPivotHigh) {
      state.trendState = 1;
      state.entryLevel = state.lastPivotHigh.value;
      state.trailStop = close - atr * atrMult;
      state.lastSignalIndex = currentIndex;
      state.signal = {
        direction: 'LONG',
        entryLevel: state.entryLevel,
        trailStop: state.trailStop,
        atr,
        pivot: state.lastPivotHigh,
        barsSinceSignal: 0,
        breakoutDistancePct:
          state.entryLevel !== 0
            ? ((close - state.entryLevel) / Math.abs(state.entryLevel)) * 100
            : 0,
        distanceToStopPct:
          close !== 0 ? (Math.abs(close - state.trailStop) / close) * 100 : 0,
        timestamp: candle.timestamp,
        close,
      };
    } else if (bearCross && state.lastPivotLow) {
      state.trendState = -1;
      state.entryLevel = state.lastPivotLow.value;
      state.trailStop = close + atr * atrMult;
      state.lastSignalIndex = currentIndex;
      state.signal = {
        direction: 'SHORT',
        entryLevel: state.entryLevel,
        trailStop: state.trailStop,
        atr,
        pivot: state.lastPivotLow,
        barsSinceSignal: 0,
        breakoutDistancePct:
          state.entryLevel !== 0
            ? ((state.entryLevel - close) / Math.abs(state.entryLevel)) * 100
            : 0,
        distanceToStopPct:
          close !== 0 ? (Math.abs(close - state.trailStop) / close) * 100 : 0,
        timestamp: candle.timestamp,
        close,
      };
    } else if (state.trendState === 1) {
      const newStop = close - atr * atrMult;
      state.trailStop =
        state.trailStop == null ? newStop : Math.max(state.trailStop, newStop);
    } else if (state.trendState === -1) {
      const newStop = close + atr * atrMult;
      state.trailStop =
        state.trailStop == null ? newStop : Math.min(state.trailStop, newStop);
    }

    const barsSinceSignal =
      state.lastSignalIndex == null
        ? null
        : currentIndex - state.lastSignalIndex;
    const distanceToStopPct =
      state.trailStop != null && close !== 0
        ? (Math.abs(close - state.trailStop) / close) * 100
        : null;
    const breakoutDistancePct =
      state.entryLevel != null && state.entryLevel !== 0
        ? state.trendState === 1
          ? ((close - state.entryLevel) / Math.abs(state.entryLevel)) * 100
          : state.trendState === -1
            ? ((state.entryLevel - close) / Math.abs(state.entryLevel)) * 100
            : null
        : null;

    if (state.trailStop != null && state.trendState !== 0) {
      pushBoundedPoint(
        state.series.trailStop,
        { timestamp: candle.timestamp, value: state.trailStop },
        maxFigurePoints,
      );
    }

    state.snapshot = {
      trendState: state.trendState,
      signalDirection: state.signal?.direction ?? null,
      bullCross,
      bearCross,
      entryLevel: state.entryLevel,
      trailStop: state.trailStop,
      atr,
      barsSinceSignal,
      lastPivotHigh: state.lastPivotHigh,
      lastPivotLow: state.lastPivotLow,
      distanceToStopPct,
      breakoutDistancePct,
      timestamp: candle.timestamp,
      close,
    };
    state.prevClose = close;

    return {
      signal: state.signal,
      snapshot: state.snapshot,
      series: state.series,
    };
  };

  for (const candle of initialCandles) {
    apply(candle);
  }

  return {
    next: apply,
    getState: () => ({
      signal: state.signal,
      snapshot: state.snapshot,
      series: state.series,
    }),
  };
};
