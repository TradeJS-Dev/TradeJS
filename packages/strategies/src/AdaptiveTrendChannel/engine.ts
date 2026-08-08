import { Candle, Direction, StrategyFigurePoint } from '@tradejs/types';
import { AdaptiveTrendChannelConfig } from './config';

export interface AdaptiveTrendChannelSnapshot {
  regime: 1 | -1;
  signalDirection: Direction | null;
  flipUp: boolean;
  flipDown: boolean;
  regHigh: number;
  regLow: number;
  regClose: number;
  upperReaction: number;
  lowerReaction: number;
  windowPeak: number;
  windowTrough: number;
  centerline: number;
  roof: number;
  floor: number;
  halfChannel: number;
  atr: number;
  breakoutDistancePct: number | null;
  breakoutDistanceAtr: number | null;
  channelWidthPct: number | null;
  timestamp: number;
  close: number;
}

export interface AdaptiveTrendChannelSignal {
  direction: Direction;
  regime: 1 | -1;
  centerline: number;
  roof: number;
  floor: number;
  halfChannel: number;
  atr: number;
  breakoutDistancePct: number;
  breakoutDistanceAtr: number;
  channelWidthPct: number;
  timestamp: number;
  close: number;
}

export interface AdaptiveTrendChannelFigureSeries {
  centerline: StrategyFigurePoint[];
  roof: StrategyFigurePoint[];
  floor: StrategyFigurePoint[];
}

export interface AdaptiveTrendChannelRuntimeState {
  signal: AdaptiveTrendChannelSignal | null;
  snapshot: AdaptiveTrendChannelSnapshot | null;
  series: AdaptiveTrendChannelFigureSeries;
}

type AtrState = {
  value: number | null;
  count: number;
};

type EngineState = {
  barsSeen: number;
  atrState: AtrState;
  prevClose: number | null;
  regime: 1 | -1 | null;
  centerline: number | null;
  bullSupportTrail: number | null;
  bearResistanceTrail: number | null;
  prevRegimeValue: number | null;
  signal: AdaptiveTrendChannelSignal | null;
  snapshot: AdaptiveTrendChannelSnapshot | null;
  series: AdaptiveTrendChannelFigureSeries;
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

const pushBoundedNumber = (
  series: number[],
  value: number,
  maxPoints: number,
) => {
  series.push(value);
  if (series.length > maxPoints) {
    series.splice(0, series.length - maxPoints);
  }
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

const getConfigNumbers = (config: AdaptiveTrendChannelConfig) => ({
  regressionBars: Math.max(
    1,
    Math.floor(config.ADAPTIVE_TREND_CHANNEL_REGRESSION_BARS ?? 7),
  ),
  envelopeBars: Math.max(
    1,
    Math.floor(config.ADAPTIVE_TREND_CHANNEL_ENVELOPE_BARS ?? 2),
  ),
  atrStretch: clampPositive(config.ADAPTIVE_TREND_CHANNEL_ATR_STRETCH, 2),
  volatilityLookback: Math.max(
    1,
    Math.floor(config.ADAPTIVE_TREND_CHANNEL_VOLATILITY_LOOKBACK ?? 100),
  ),
  maxFigurePoints: Math.max(
    20,
    Math.floor(config.ADAPTIVE_TREND_CHANNEL_MAX_FIGURE_POINTS ?? 180),
  ),
});

const linearRegressionNow = (values: number[], length: number) => {
  if (values.length < length) {
    return null;
  }
  const window = values.slice(values.length - length);
  const n = window.length;
  const xMean = (n - 1) / 2;
  const yMean = window.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < n; index += 1) {
    const xDelta = index - xMean;
    numerator += xDelta * (window[index] - yMean);
    denominator += xDelta * xDelta;
  }
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = yMean - slope * xMean;
  return intercept + slope * (n - 1);
};

const average = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

export const buildAdaptiveTrendChannelSignalContext = (
  signal: AdaptiveTrendChannelSignal,
) => ({
  signalDirection: signal.direction,
  regime: signal.regime,
  centerline: signal.centerline,
  roof: signal.roof,
  floor: signal.floor,
  halfChannel: signal.halfChannel,
  atr: signal.atr,
  breakoutDistancePct: signal.breakoutDistancePct,
  breakoutDistanceAtr: signal.breakoutDistanceAtr,
  channelWidthPct: signal.channelWidthPct,
  currentPrice: signal.close,
});

export type AdaptiveTrendChannelSignalContext = ReturnType<
  typeof buildAdaptiveTrendChannelSignalContext
>;

export const createAdaptiveTrendChannelEngine = ({
  config,
  initialCandles = [],
}: {
  config: AdaptiveTrendChannelConfig;
  initialCandles?: Candle[];
}): {
  next: (candle: Candle) => AdaptiveTrendChannelRuntimeState;
  getState: () => AdaptiveTrendChannelRuntimeState;
} => {
  const {
    regressionBars,
    envelopeBars,
    atrStretch,
    volatilityLookback,
    maxFigurePoints,
  } = getConfigNumbers(config);
  const state: EngineState = {
    barsSeen: 0,
    atrState: { value: null, count: 0 },
    prevClose: null,
    regime: null,
    centerline: null,
    bullSupportTrail: null,
    bearResistanceTrail: null,
    prevRegimeValue: null,
    signal: null,
    snapshot: null,
    series: {
      centerline: [],
      roof: [],
      floor: [],
    },
  };
  const highSeries: number[] = [];
  const lowSeries: number[] = [];
  const closeSeries: number[] = [];
  const regHighSeries: number[] = [];
  const regLowSeries: number[] = [];
  const regCloseSeries: number[] = [];
  const regressionSourceLimit = regressionBars;
  const regressionOutputLimit = Math.max(envelopeBars + 1, 2);

  const apply = (candle: Candle): AdaptiveTrendChannelRuntimeState => {
    state.signal = null;
    const close = Number(candle.close);
    const tr = calculateTrueRange(candle, state.prevClose);
    state.atrState = updateAtrState({
      atrState: state.atrState,
      tr,
      period: volatilityLookback,
    });
    state.prevClose = close;
    state.barsSeen += 1;
    pushBoundedNumber(highSeries, Number(candle.high), regressionSourceLimit);
    pushBoundedNumber(lowSeries, Number(candle.low), regressionSourceLimit);
    pushBoundedNumber(closeSeries, close, regressionSourceLimit);
    const currentIndex = state.barsSeen - 1;
    const historyReady = currentIndex > regressionBars;
    const regHigh = linearRegressionNow(highSeries, regressionBars);
    const regLow = linearRegressionNow(lowSeries, regressionBars);
    const regClose = linearRegressionNow(closeSeries, regressionBars);

    if (regHigh == null || regLow == null || regClose == null) {
      return {
        signal: state.signal,
        snapshot: state.snapshot,
        series: state.series,
      };
    }

    pushBoundedNumber(regHighSeries, regHigh, regressionOutputLimit);
    pushBoundedNumber(regLowSeries, regLow, regressionOutputLimit);
    pushBoundedNumber(regCloseSeries, regClose, regressionOutputLimit);
    const highWindow = regHighSeries.slice(
      Math.max(0, regHighSeries.length - envelopeBars),
    );
    const lowWindow = regLowSeries.slice(
      Math.max(0, regLowSeries.length - envelopeBars),
    );
    if (highWindow.length < envelopeBars || lowWindow.length < envelopeBars) {
      return {
        signal: state.signal,
        snapshot: state.snapshot,
        series: state.series,
      };
    }

    const upperReaction = average(highWindow);
    const lowerReaction = average(lowWindow);
    const windowPeak = Math.max(...highWindow);
    const windowTrough = Math.min(...lowWindow);
    const prevRegimeValue = state.regime ?? 0;
    let bearishFlip = false;
    let bullishFlip = false;

    if (state.regime == null && historyReady) {
      state.regime = 1;
      state.centerline = windowTrough;
      state.bullSupportTrail = Number(candle.low);
      state.bearResistanceTrail = Number(candle.high);
    } else if (state.regime === 1) {
      state.bullSupportTrail = Math.max(
        state.bullSupportTrail ?? windowTrough,
        windowTrough,
      );
      bearishFlip =
        upperReaction < state.bullSupportTrail &&
        regClose < (regLowSeries[regLowSeries.length - 2] ?? regLow);
      if (bearishFlip) {
        state.regime = -1;
        state.centerline = windowPeak;
        state.bearResistanceTrail = regHigh;
      }
    } else if (state.regime === -1) {
      state.bearResistanceTrail = Math.min(
        state.bearResistanceTrail ?? windowPeak,
        windowPeak,
      );
      bullishFlip =
        lowerReaction > state.bearResistanceTrail &&
        regClose > (regHighSeries[regHighSeries.length - 2] ?? regHigh);
      if (bullishFlip) {
        state.regime = 1;
        state.centerline = windowTrough;
        state.bullSupportTrail = regLow;
      }
    }

    if (state.regime === 1) {
      state.centerline = Math.max(
        state.centerline ?? windowTrough,
        windowTrough,
      );
    } else if (state.regime === -1) {
      state.centerline = Math.min(state.centerline ?? windowPeak, windowPeak);
    }

    if (state.regime == null || state.centerline == null) {
      return {
        signal: state.signal,
        snapshot: state.snapshot,
        series: state.series,
      };
    }

    const atr = state.atrState.value ?? 0;
    const halfChannel = atrStretch * atr * 0.5;
    const roof = state.centerline + halfChannel;
    const floor = state.centerline - halfChannel;
    const flipUp = prevRegimeValue < 0 && state.regime > 0;
    const flipDown = prevRegimeValue > 0 && state.regime < 0;
    const channelWidthPct =
      state.centerline !== 0
        ? ((roof - floor) / Math.abs(state.centerline)) * 100
        : null;
    const breakoutDistancePct =
      state.centerline !== 0
        ? state.regime === 1
          ? ((close - state.centerline) / Math.abs(state.centerline)) * 100
          : ((state.centerline - close) / Math.abs(state.centerline)) * 100
        : null;
    const breakoutDistanceAtr =
      atr > 0 ? Math.abs(close - state.centerline) / atr : null;

    pushBoundedPoint(
      state.series.centerline,
      { timestamp: candle.timestamp, value: state.centerline },
      maxFigurePoints,
    );
    pushBoundedPoint(
      state.series.roof,
      { timestamp: candle.timestamp, value: roof },
      maxFigurePoints,
    );
    pushBoundedPoint(
      state.series.floor,
      { timestamp: candle.timestamp, value: floor },
      maxFigurePoints,
    );

    if (
      (flipUp || flipDown) &&
      breakoutDistancePct != null &&
      breakoutDistanceAtr != null &&
      channelWidthPct != null
    ) {
      state.signal = {
        direction: flipUp ? 'LONG' : 'SHORT',
        regime: state.regime,
        centerline: state.centerline,
        roof,
        floor,
        halfChannel,
        atr,
        breakoutDistancePct,
        breakoutDistanceAtr,
        channelWidthPct,
        timestamp: candle.timestamp,
        close,
      };
    }

    state.snapshot = {
      regime: state.regime,
      signalDirection: state.signal?.direction ?? null,
      flipUp,
      flipDown,
      regHigh,
      regLow,
      regClose,
      upperReaction,
      lowerReaction,
      windowPeak,
      windowTrough,
      centerline: state.centerline,
      roof,
      floor,
      halfChannel,
      atr,
      breakoutDistancePct,
      breakoutDistanceAtr,
      channelWidthPct,
      timestamp: candle.timestamp,
      close,
    };
    state.prevRegimeValue = state.regime;

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
