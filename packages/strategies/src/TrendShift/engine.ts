import { Candle, Direction, StrategyFigurePoint } from '@tradejs/types';
import { TrendShiftConfig } from './config';
import {
  getIndicatorsCoinMaFast,
  getIndicatorsCoinMaSlow,
} from '../shared/baseContext';
import { TrendShiftSignalContext } from './guardrails';

export interface TrendShiftSnapshot {
  avg: number;
  upper: number;
  lower: number;
  hold: number;
  adaptiveAtr: number;
  rawTrend: 1 | -1;
  trendState: 1 | -1;
  bullFlipRaw: boolean;
  bearFlipRaw: boolean;
  bullFlip: boolean;
  bearFlip: boolean;
  flipDistanceOk: boolean;
  closeVsAvgPct: number;
  bandWidthPct: number;
  avgSlopePct: number;
  distanceAtrRatio: number;
  labelOffset: number;
  timestamp: number;
  close: number;
}

export interface TrendShiftFigureSeries {
  avg: StrategyFigurePoint[];
  upper: StrategyFigurePoint[];
  lower: StrategyFigurePoint[];
}

export interface TrendShiftRuntimeState {
  snapshot: TrendShiftSnapshot | null;
  series: TrendShiftFigureSeries;
}

type AtrState = {
  value: number | null;
  count: number;
};

type EngineState = {
  atrState: AtrState;
  avg: number | null;
  hold: number | null;
  rawTrend: 1 | -1;
  trendState: 1 | -1;
  prevClose: number | null;
  series: TrendShiftFigureSeries;
  snapshot: TrendShiftSnapshot | null;
};

const clampPositive = (value: number, fallback: number) =>
  Number.isFinite(value) && value > 0 ? value : fallback;

const calculateTrueRange = (candle: Candle, prevClose: number | null) => {
  const high = Number(candle.high);
  const low = Number(candle.low);
  const close = Number(candle.close);

  if (
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close)
  ) {
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
    return {
      value: safeTr,
      count: 1,
    };
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

const trimSeries = (
  series: StrategyFigurePoint[],
  maxPoints: number,
): StrategyFigurePoint[] =>
  series.length <= maxPoints ? series : series.slice(series.length - maxPoints);

const asDirection = (trendState: 1 | -1): Direction =>
  trendState === 1 ? 'LONG' : 'SHORT';

export const buildTrendShiftSignalContext = ({
  snapshot,
  indicators,
}: {
  snapshot: TrendShiftSnapshot;
  indicators?: Record<string, unknown>;
}): TrendShiftSignalContext & {
  trendState: 1 | -1;
  rawTrend: 1 | -1;
  bullFlipRaw: boolean;
  bearFlipRaw: boolean;
  adaptiveAtr: number;
  upper: number;
  lower: number;
  hold: number;
  coinMaFast: number | null;
  coinMaSlow: number | null;
} => {
  const maFast = getIndicatorsCoinMaFast(indicators);
  const maSlow = getIndicatorsCoinMaSlow(indicators);
  const coinBias: TrendShiftSignalContext['coinBias'] =
    maFast != null && maSlow != null
      ? maFast > maSlow
        ? 'bullish'
        : maFast < maSlow
          ? 'bearish'
          : 'neutral'
      : 'unknown';
  const signalDirection = snapshot.bullFlip
    ? 'LONG'
    : snapshot.bearFlip
      ? 'SHORT'
      : asDirection(snapshot.trendState);
  const coinBiasAligned =
    coinBias === 'unknown' || coinBias === 'neutral'
      ? null
      : signalDirection === 'LONG'
        ? coinBias === 'bullish'
        : coinBias === 'bearish';

  return {
    signalDirection,
    trendState: snapshot.trendState,
    rawTrend: snapshot.rawTrend,
    confirmedFlip: snapshot.bullFlip || snapshot.bearFlip,
    bullFlip: snapshot.bullFlip,
    bearFlip: snapshot.bearFlip,
    bullFlipRaw: snapshot.bullFlipRaw,
    bearFlipRaw: snapshot.bearFlipRaw,
    flipDistanceOk: snapshot.flipDistanceOk,
    closeVsAvgPct: snapshot.closeVsAvgPct,
    bandWidthPct: snapshot.bandWidthPct,
    avgSlopePct: snapshot.avgSlopePct,
    distanceAtrRatio: snapshot.distanceAtrRatio,
    adaptiveAtr: snapshot.adaptiveAtr,
    avg: snapshot.avg,
    upper: snapshot.upper,
    lower: snapshot.lower,
    hold: snapshot.hold,
    currentPrice: snapshot.close,
    coinMaFast: Number.isFinite(maFast) ? maFast : null,
    coinMaSlow: Number.isFinite(maSlow) ? maSlow : null,
    coinBias,
    coinBiasAligned,
  };
};

const getConfigNumbers = (config: TrendShiftConfig) => ({
  mult: clampPositive(config.TRENDSHIFT_MULTIPLICATIVE_FACTOR, 4),
  slope: clampPositive(config.TRENDSHIFT_SLOPE, 12),
  atrLength: Math.max(1, Math.floor(config.TRENDSHIFT_ATR_LENGTH ?? 150)),
  widthPct: clampPositive(config.TRENDSHIFT_WIDTH_PCT, 75) / 100,
  minFlipAtr: Math.max(0, Number(config.TRENDSHIFT_MIN_FLIP_DISTANCE_ATR ?? 0)),
  confirmFlipWithClose: Boolean(config.TRENDSHIFT_CONFIRM_FLIP_WITH_CLOSE),
  maxFigurePoints: Math.max(
    20,
    Math.floor(config.TRENDSHIFT_MAX_FIGURE_POINTS ?? 180),
  ),
});

export const createTrendShiftEngine = ({
  config,
  initialCandles = [],
}: {
  config: TrendShiftConfig;
  initialCandles?: Candle[];
}): {
  next: (candle: Candle) => TrendShiftRuntimeState;
  getState: () => TrendShiftRuntimeState;
} => {
  const {
    mult,
    slope,
    atrLength,
    widthPct,
    minFlipAtr,
    confirmFlipWithClose,
    maxFigurePoints,
  } = getConfigNumbers(config);

  const state: EngineState = {
    atrState: {
      value: null,
      count: 0,
    },
    avg: null,
    hold: null,
    rawTrend: 1,
    trendState: 1,
    prevClose: null,
    series: {
      avg: [],
      upper: [],
      lower: [],
    },
    snapshot: null,
  };

  const apply = (candle: Candle): TrendShiftRuntimeState => {
    const close = Number(candle.close);
    if (!Number.isFinite(close)) {
      return {
        snapshot: state.snapshot,
        series: state.series,
      };
    }

    const tr = calculateTrueRange(candle, state.prevClose);
    state.atrState = updateAtrState({
      atrState: state.atrState,
      tr,
      period: atrLength,
    });

    const adaptiveAtr = Math.max((state.atrState.value ?? tr) * mult, 1e-9);
    const prevAvg = state.avg ?? close;
    const prevHold = state.hold ?? adaptiveAtr;
    const prevRawTrend = state.rawTrend;
    const prevTrendState = state.trendState;

    const avg =
      Math.abs(close - prevAvg) > adaptiveAtr
        ? (close + prevAvg) / 2
        : prevAvg + prevRawTrend * (prevHold / mult / Math.max(slope, 1));

    const rawTrend: 1 | -1 =
      avg > prevAvg ? 1 : avg < prevAvg ? -1 : prevRawTrend;

    const hold =
      rawTrend !== prevRawTrend
        ? adaptiveAtr
        : prevHold + (adaptiveAtr - prevHold) / Math.max(slope, 1);

    const upper = avg + widthPct * hold;
    const lower = avg - widthPct * hold;
    const closeDistance = Math.abs(close - avg);
    const flipDistanceOk = closeDistance >= adaptiveAtr * minFlipAtr;
    const bullFlipRaw = rawTrend === 1 && prevTrendState !== 1;
    const bearFlipRaw = rawTrend === -1 && prevTrendState !== -1;
    const bullFlip =
      bullFlipRaw && flipDistanceOk && (!confirmFlipWithClose || close > avg);
    const bearFlip =
      bearFlipRaw && flipDistanceOk && (!confirmFlipWithClose || close < avg);
    const trendState: 1 | -1 = bullFlip ? 1 : bearFlip ? -1 : prevTrendState;
    const closeVsAvgPct = avg !== 0 ? ((close - avg) / avg) * 100 : 0;
    const bandWidthPct = avg !== 0 ? ((upper - lower) / avg) * 100 : 0;
    const avgSlopePct = prevAvg !== 0 ? ((avg - prevAvg) / prevAvg) * 100 : 0;
    const distanceAtrRatio = adaptiveAtr > 0 ? closeDistance / adaptiveAtr : 0;
    const labelOffset = hold * 0.2;

    state.avg = avg;
    state.hold = hold;
    state.rawTrend = rawTrend;
    state.trendState = trendState;
    state.prevClose = close;
    state.series.avg = trimSeries(
      [...state.series.avg, { timestamp: candle.timestamp, value: avg }],
      maxFigurePoints,
    );
    state.series.upper = trimSeries(
      [...state.series.upper, { timestamp: candle.timestamp, value: upper }],
      maxFigurePoints,
    );
    state.series.lower = trimSeries(
      [...state.series.lower, { timestamp: candle.timestamp, value: lower }],
      maxFigurePoints,
    );
    state.snapshot = {
      avg,
      upper,
      lower,
      hold,
      adaptiveAtr,
      rawTrend,
      trendState,
      bullFlipRaw,
      bearFlipRaw,
      bullFlip,
      bearFlip,
      flipDistanceOk,
      closeVsAvgPct,
      bandWidthPct,
      avgSlopePct,
      distanceAtrRatio,
      labelOffset,
      timestamp: candle.timestamp,
      close,
    };

    return {
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
      snapshot: state.snapshot,
      series: state.series,
    }),
  };
};
