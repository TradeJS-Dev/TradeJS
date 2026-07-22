import { Candle, Direction, StrategyFigurePoint } from '@tradejs/types';
import { GridConfig } from './config';

export interface GridSnapshot {
  timestamp: number;
  close: number;
  emaFast: number;
  emaSlow: number;
  atr: number;
  atrPct: number;
  slowSlopeAtr: number;
  trendStrengthAtr: number;
  candleRangeAtr: number;
  recentHigh: number;
  recentLow: number;
  regimeDirection: Direction | null;
  entryDirection: Direction | null;
  stepDistance: number;
  stopDistance: number;
  takeProfitDistance: number;
  volatilityShock: boolean;
}

export interface GridFigureSeries {
  emaFast: StrategyFigurePoint[];
  emaSlow: StrategyFigurePoint[];
}

export interface GridRuntimeState {
  snapshot: GridSnapshot | null;
  series: GridFigureSeries;
}

type EngineState = {
  count: number;
  previousClose: number | null;
  emaFast: number | null;
  emaSlow: number | null;
  atr: number | null;
  slowHistory: number[];
  candles: Candle[];
  snapshot: GridSnapshot | null;
  series: GridFigureSeries;
};

const finite = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const positiveInteger = (value: unknown, fallback: number) =>
  Math.max(1, Math.floor(finite(value, fallback)));

const pushBounded = <T>(values: T[], value: T, limit: number) => {
  values.push(value);
  if (values.length > limit) {
    values.splice(0, values.length - limit);
  }
};

const nextEma = (previous: number | null, value: number, period: number) => {
  if (previous == null) {
    return value;
  }
  const alpha = 2 / (period + 1);
  return previous + alpha * (value - previous);
};

const getConfig = (config: GridConfig) => ({
  fastPeriod: positiveInteger(config.GRID_FAST_EMA, 20),
  slowPeriod: positiveInteger(config.GRID_SLOW_EMA, 55),
  atrPeriod: positiveInteger(config.GRID_ATR_PERIOD, 14),
  slopeBars: positiveInteger(config.GRID_TREND_SLOPE_BARS, 5),
  minTrendStrengthAtr: Math.max(
    0,
    finite(config.GRID_MIN_TREND_STRENGTH_ATR, 0.15),
  ),
  maxTrendStrengthAtr: Math.max(
    0,
    finite(config.GRID_MAX_TREND_STRENGTH_ATR, 2.5),
  ),
  minSlowSlopeAtr: Math.max(0, finite(config.GRID_MIN_SLOW_SLOPE_ATR, 0.04)),
  minAtrPct: Math.max(0, finite(config.GRID_MIN_ATR_PCT, 0.15)),
  maxAtrPct: Math.max(0, finite(config.GRID_MAX_ATR_PCT, 5)),
  maxPullbackBeyondSlowAtr: Math.max(
    0,
    finite(config.GRID_MAX_PULLBACK_BEYOND_SLOW_ATR, 0.5),
  ),
  stepAtrMult: Math.max(0.01, finite(config.GRID_STEP_ATR_MULT, 0.8)),
  minStepPct: Math.max(0, finite(config.GRID_MIN_STEP_PCT, 0.35)),
  stopAtrMult: Math.max(0.1, finite(config.GRID_STOP_ATR_MULT, 4.5)),
  takeProfitStepMult: Math.max(
    0.1,
    finite(config.GRID_TAKE_PROFIT_STEP_MULT, 1),
  ),
  maxLevels: positiveInteger(config.GRID_MAX_LEVELS, 4),
  maxCandleRangeAtr: Math.max(0.1, finite(config.GRID_MAX_CANDLE_RANGE_ATR, 3)),
  maxFigurePoints: positiveInteger(config.GRID_MAX_FIGURE_POINTS, 160),
});

export const buildGridDetectorKey = (config: GridConfig) =>
  JSON.stringify(getConfig(config));

export const buildGridSignalContext = ({
  snapshot,
  action,
  level,
  levelsFilled,
  positionQty,
  projectedQty,
  projectedAveragePrice,
  stopLossPrice,
  takeProfitPrice,
}: {
  snapshot: GridSnapshot;
  action: 'open' | 'increase';
  level: number;
  levelsFilled: number;
  positionQty: number;
  projectedQty: number;
  projectedAveragePrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
}) => ({
  action,
  level,
  levelsFilled,
  positionQty,
  projectedQty,
  projectedAveragePrice,
  stopLossPrice,
  takeProfitPrice,
  timestamp: snapshot.timestamp,
  currentPrice: snapshot.close,
  regimeDirection: snapshot.regimeDirection,
  entryDirection: snapshot.entryDirection,
  emaFast: snapshot.emaFast,
  emaSlow: snapshot.emaSlow,
  atr: snapshot.atr,
  atrPct: snapshot.atrPct,
  slowSlopeAtr: snapshot.slowSlopeAtr,
  trendStrengthAtr: snapshot.trendStrengthAtr,
  candleRangeAtr: snapshot.candleRangeAtr,
  recentHigh: snapshot.recentHigh,
  recentLow: snapshot.recentLow,
  stepDistance: snapshot.stepDistance,
  stopDistance: snapshot.stopDistance,
  takeProfitDistance: snapshot.takeProfitDistance,
  volatilityShock: snapshot.volatilityShock,
});

export type GridSignalContext = ReturnType<typeof buildGridSignalContext>;

export const createGridEngine = ({
  config,
  initialCandles = [],
}: {
  config: GridConfig;
  initialCandles?: Candle[];
}) => {
  const options = getConfig(config);
  const candleLimit = Math.max(options.slowPeriod, options.atrPeriod, 20);
  const slowHistoryLimit = options.slopeBars + 1;
  const state: EngineState = {
    count: 0,
    previousClose: null,
    emaFast: null,
    emaSlow: null,
    atr: null,
    slowHistory: [],
    candles: [],
    snapshot: null,
    series: { emaFast: [], emaSlow: [] },
  };

  const apply = (candle: Candle): GridRuntimeState => {
    const close = Number(candle.close);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const open = Number(candle.open);
    if (![close, high, low, open, candle.timestamp].every(Number.isFinite)) {
      return {
        snapshot: state.snapshot,
        series: {
          emaFast: state.series.emaFast.slice(),
          emaSlow: state.series.emaSlow.slice(),
        },
      };
    }

    const trueRange =
      state.previousClose == null
        ? high - low
        : Math.max(
            high - low,
            Math.abs(high - state.previousClose),
            Math.abs(low - state.previousClose),
          );
    state.emaFast = nextEma(state.emaFast, close, options.fastPeriod);
    state.emaSlow = nextEma(state.emaSlow, close, options.slowPeriod);
    state.atr =
      state.atr == null
        ? trueRange
        : state.atr + (trueRange - state.atr) / options.atrPeriod;
    state.previousClose = close;
    state.count += 1;

    pushBounded(state.slowHistory, state.emaSlow, slowHistoryLimit);
    pushBounded(state.candles, candle, candleLimit);
    pushBounded(
      state.series.emaFast,
      { timestamp: candle.timestamp, value: state.emaFast },
      options.maxFigurePoints,
    );
    pushBounded(
      state.series.emaSlow,
      { timestamp: candle.timestamp, value: state.emaSlow },
      options.maxFigurePoints,
    );

    const atr = Math.max(state.atr, Number.EPSILON);
    const atrPct = close > 0 ? (atr / close) * 100 : Number.POSITIVE_INFINITY;
    const slopeReference =
      state.slowHistory.length > options.slopeBars
        ? state.slowHistory[state.slowHistory.length - 1 - options.slopeBars]
        : state.emaSlow;
    const slowSlopeAtr = (state.emaSlow - slopeReference) / atr;
    const trendStrengthAtr = Math.abs(state.emaFast - state.emaSlow) / atr;
    const candleRangeAtr = (high - low) / atr;
    const warmedUp =
      state.count >= Math.max(options.slowPeriod, options.atrPeriod) &&
      state.slowHistory.length > options.slopeBars;
    const volatilityAccepted =
      atrPct >= options.minAtrPct &&
      (options.maxAtrPct === 0 || atrPct <= options.maxAtrPct);
    const strengthAccepted =
      trendStrengthAtr >= options.minTrendStrengthAtr &&
      (options.maxTrendStrengthAtr === 0 ||
        trendStrengthAtr <= options.maxTrendStrengthAtr);
    const volatilityShock = candleRangeAtr > options.maxCandleRangeAtr;

    let regimeDirection: Direction | null = null;
    if (
      warmedUp &&
      volatilityAccepted &&
      strengthAccepted &&
      !volatilityShock
    ) {
      if (
        state.emaFast > state.emaSlow &&
        slowSlopeAtr >= options.minSlowSlopeAtr &&
        close >= state.emaSlow - atr * options.maxPullbackBeyondSlowAtr
      ) {
        regimeDirection = 'LONG';
      } else if (
        state.emaFast < state.emaSlow &&
        slowSlopeAtr <= -options.minSlowSlopeAtr &&
        close <= state.emaSlow + atr * options.maxPullbackBeyondSlowAtr
      ) {
        regimeDirection = 'SHORT';
      }
    }

    const longRecovery =
      regimeDirection === 'LONG' &&
      low <= state.emaFast &&
      close >= state.emaFast &&
      close > open;
    const shortRecovery =
      regimeDirection === 'SHORT' &&
      high >= state.emaFast &&
      close <= state.emaFast &&
      close < open;
    const entryDirection = longRecovery
      ? 'LONG'
      : shortRecovery
        ? 'SHORT'
        : null;
    const minStepDistance = close * (options.minStepPct / 100);
    const stepDistance = Math.max(atr * options.stepAtrMult, minStepDistance);
    const stopDistance = Math.max(
      atr * options.stopAtrMult,
      stepDistance * (options.maxLevels + 1),
    );
    const takeProfitDistance = stepDistance * options.takeProfitStepMult;
    const recentHigh = Math.max(...state.candles.map((item) => item.high));
    const recentLow = Math.min(...state.candles.map((item) => item.low));

    state.snapshot = {
      timestamp: candle.timestamp,
      close,
      emaFast: state.emaFast,
      emaSlow: state.emaSlow,
      atr,
      atrPct,
      slowSlopeAtr,
      trendStrengthAtr,
      candleRangeAtr,
      recentHigh,
      recentLow,
      regimeDirection,
      entryDirection,
      stepDistance,
      stopDistance,
      takeProfitDistance,
      volatilityShock,
    };

    return {
      snapshot: state.snapshot,
      series: {
        emaFast: state.series.emaFast.slice(),
        emaSlow: state.series.emaSlow.slice(),
      },
    };
  };

  for (const candle of initialCandles) {
    apply(candle);
  }

  return {
    next: apply,
    getState: (): GridRuntimeState => ({
      snapshot: state.snapshot,
      series: {
        emaFast: state.series.emaFast.slice(),
        emaSlow: state.series.emaSlow.slice(),
      },
    }),
  };
};
