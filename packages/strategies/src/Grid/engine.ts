import { Candle, Direction, StrategyFigurePoint } from '@tradejs/types';
import { GridConfig, GridEntryMode } from './config';
import {
  buildGridRangeGeometryKey,
  createGridRangeGeometryEngine,
  getGridRangeGeometryOptions,
  GridRangeGeometry,
} from './rangeGeometry';

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
  entryMode: GridEntryMode;
  entryStage: 'pullback_recovery' | 'breakout_retest_held' | null;
  setupId: string | null;
  breakoutLevel: number | null;
  breakoutAgeBars: number | null;
  breakoutRetestCloseDistanceAtr: number | null;
  stepDistance: number;
  stopDistance: number;
  takeProfitDistance: number;
  volatilityShock: boolean;
  rangeGeometry: GridRangeGeometry;
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
  breakoutPending: GridBreakoutPending | null;
  consumedSetupIds: Set<string>;
  lastTimestamp: number | null;
};

type GridBreakoutPending = {
  setupId: string;
  direction: Direction;
  level: number;
  breakoutIndex: number;
  breakoutTimestamp: number;
  acceptedAtIndex: number | null;
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
  entryMode: config.GRID_ENTRY_MODE ?? 'pullback_recovery',
  breakoutLookbackBars: positiveInteger(config.GRID_BREAKOUT_LOOKBACK_BARS, 20),
  breakoutMinDistanceAtr: Math.max(
    0,
    finite(config.GRID_BREAKOUT_MIN_DISTANCE_ATR, 0.1),
  ),
  breakoutAcceptanceBars: positiveInteger(
    config.GRID_BREAKOUT_ACCEPTANCE_BARS,
    1,
  ),
  breakoutRetestMaxBars: positiveInteger(
    config.GRID_BREAKOUT_RETEST_MAX_BARS,
    4,
  ),
  breakoutRetestToleranceAtr: Math.max(
    0,
    finite(config.GRID_BREAKOUT_RETEST_TOLERANCE_ATR, 0.3),
  ),
  breakoutRetestMaxCloseDistanceAtr: Math.max(
    0,
    finite(config.GRID_BREAKOUT_RETEST_MAX_CLOSE_DISTANCE_ATR, 0),
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
  JSON.stringify({
    detector: getConfig(config),
    rangeGeometry: buildGridRangeGeometryKey(config),
  });

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
  grossRiskRatio,
  netRiskRatio,
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
  grossRiskRatio?: number;
  netRiskRatio?: number;
}) => ({
  action,
  level,
  levelsFilled,
  positionQty,
  projectedQty,
  projectedAveragePrice,
  stopLossPrice,
  takeProfitPrice,
  grossRiskRatio: grossRiskRatio ?? null,
  netRiskRatio: netRiskRatio ?? null,
  timestamp: snapshot.timestamp,
  currentPrice: snapshot.close,
  regimeDirection: snapshot.regimeDirection,
  entryDirection: snapshot.entryDirection,
  entryMode: snapshot.entryMode,
  entryStage: snapshot.entryStage,
  setupId: snapshot.setupId,
  breakoutLevel: snapshot.breakoutLevel,
  breakoutAgeBars: snapshot.breakoutAgeBars,
  breakoutRetestCloseDistanceAtr: snapshot.breakoutRetestCloseDistanceAtr,
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
  rangeGeometry: snapshot.rangeGeometry,
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
  const rangeGeometryEngine = createGridRangeGeometryEngine({
    options: getGridRangeGeometryOptions(config),
  });
  const candleLimit = Math.max(
    options.slowPeriod,
    options.atrPeriod,
    options.breakoutLookbackBars + 1,
    20,
  );
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
    breakoutPending: null,
    consumedSetupIds: new Set(),
    lastTimestamp: null,
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
    if (state.lastTimestamp === candle.timestamp) {
      return {
        snapshot: state.snapshot,
        series: {
          emaFast: state.series.emaFast.slice(),
          emaSlow: state.series.emaSlow.slice(),
        },
      };
    }
    state.lastTimestamp = candle.timestamp;

    const previousClose = state.previousClose;
    const breakoutReferenceCandles = state.candles.slice(
      -options.breakoutLookbackBars,
    );
    const priorHigh =
      breakoutReferenceCandles.length > 0
        ? Math.max(...breakoutReferenceCandles.map((item) => Number(item.high)))
        : null;
    const priorLow =
      breakoutReferenceCandles.length > 0
        ? Math.min(...breakoutReferenceCandles.map((item) => Number(item.low)))
        : null;

    const trueRange =
      previousClose == null
        ? high - low
        : Math.max(
            high - low,
            Math.abs(high - previousClose),
            Math.abs(low - previousClose),
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
    let entryDirection: Direction | null = null;
    let entryStage: GridSnapshot['entryStage'] = null;
    let setupId: string | null = null;
    let breakoutLevel: number | null = null;
    let breakoutAgeBars: number | null = null;
    let breakoutRetestCloseDistanceAtr: number | null = null;

    if (options.entryMode === 'pullback_recovery') {
      entryDirection = longRecovery ? 'LONG' : shortRecovery ? 'SHORT' : null;
      entryStage = entryDirection ? 'pullback_recovery' : null;
    } else {
      const currentIndex = state.count - 1;
      const tolerance = atr * options.breakoutRetestToleranceAtr;
      let completedSetupOnCurrentBar = false;
      const pending = state.breakoutPending;
      if (pending) {
        const age = currentIndex - pending.breakoutIndex;
        setupId = pending.setupId;
        breakoutLevel = pending.level;
        breakoutAgeBars = age;
        const regimeInvalid = regimeDirection !== pending.direction;
        const closeInvalid =
          pending.direction === 'LONG'
            ? close < pending.level - tolerance
            : close > pending.level + tolerance;
        const expired =
          age > options.breakoutAcceptanceBars + options.breakoutRetestMaxBars;

        if (regimeInvalid || closeInvalid || expired) {
          state.consumedSetupIds.add(pending.setupId);
          state.breakoutPending = null;
        } else if (pending.acceptedAtIndex == null) {
          const accepted =
            age >= options.breakoutAcceptanceBars &&
            (pending.direction === 'LONG'
              ? close > pending.level
              : close < pending.level);
          if (accepted) pending.acceptedAtIndex = currentIndex;
        } else if (currentIndex > pending.acceptedAtIndex) {
          const closeDistanceAtr =
            pending.direction === 'LONG'
              ? (close - pending.level) / atr
              : (pending.level - close) / atr;
          const touchedAndHeld =
            pending.direction === 'LONG'
              ? low <= pending.level + tolerance &&
                low >= pending.level - tolerance &&
                close >= pending.level
              : high >= pending.level - tolerance &&
                high <= pending.level + tolerance &&
                close <= pending.level;
          const closeDistanceAccepted =
            options.breakoutRetestMaxCloseDistanceAtr === 0 ||
            closeDistanceAtr <= options.breakoutRetestMaxCloseDistanceAtr;
          if (touchedAndHeld && closeDistanceAccepted) {
            entryDirection = pending.direction;
            entryStage = 'breakout_retest_held';
            breakoutRetestCloseDistanceAtr = closeDistanceAtr;
            state.consumedSetupIds.add(pending.setupId);
            state.breakoutPending = null;
            completedSetupOnCurrentBar = true;
          }
        }
      }

      if (!state.breakoutPending && !completedSetupOnCurrentBar) {
        const minimumDistance = atr * options.breakoutMinDistanceAtr;
        const longBreakout =
          regimeDirection === 'LONG' &&
          priorHigh != null &&
          previousClose != null &&
          previousClose <= priorHigh &&
          close >= priorHigh + minimumDistance;
        const shortBreakout =
          regimeDirection === 'SHORT' &&
          priorLow != null &&
          previousClose != null &&
          previousClose >= priorLow &&
          close <= priorLow - minimumDistance;
        const direction: Direction | null = longBreakout
          ? 'LONG'
          : shortBreakout
            ? 'SHORT'
            : null;
        const level = direction === 'LONG' ? priorHigh : priorLow;
        if (direction && level != null) {
          const nextSetupId = `grid-breakout:${direction}:${candle.timestamp}:${level.toFixed(8)}`;
          if (!state.consumedSetupIds.has(nextSetupId)) {
            state.breakoutPending = {
              setupId: nextSetupId,
              direction,
              level,
              breakoutIndex: currentIndex,
              breakoutTimestamp: candle.timestamp,
              acceptedAtIndex: null,
            };
            setupId = nextSetupId;
            breakoutLevel = level;
            breakoutAgeBars = 0;
          }
        }
      }
    }
    const minStepDistance = close * (options.minStepPct / 100);
    const stepDistance = Math.max(atr * options.stepAtrMult, minStepDistance);
    const stopDistance = Math.max(
      atr * options.stopAtrMult,
      stepDistance * (options.maxLevels + 1),
    );
    const takeProfitDistance = stepDistance * options.takeProfitStepMult;
    const recentHigh = Math.max(...state.candles.map((item) => item.high));
    const recentLow = Math.min(...state.candles.map((item) => item.low));
    const rangeGeometry = rangeGeometryEngine.next(candle, atr);

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
      entryMode: options.entryMode,
      entryStage,
      setupId,
      breakoutLevel,
      breakoutAgeBars,
      breakoutRetestCloseDistanceAtr,
      stepDistance,
      stopDistance,
      takeProfitDistance,
      volatilityShock,
      rangeGeometry,
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
