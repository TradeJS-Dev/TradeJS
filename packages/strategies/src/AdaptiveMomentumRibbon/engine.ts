import { asPositiveInt, asPositiveNumber } from '@tradejs/core/math';
import type { Candle } from '@tradejs/types';
import type {
  AdaptiveMomentumRibbonConfig,
  AdaptiveMomentumRibbonKcMaType,
} from './config';
import { resolveDirectionalConfigNumber } from '../shared/directionalConfig';

export type AdaptiveMomentumRibbonPlotName =
  | 'signalOsc'
  | 'kcMidline'
  | 'kcUpper'
  | 'kcLower'
  | 'invalidationLevel';

export type AdaptiveMomentumRibbonPlotPoint = {
  time: number;
  value: number;
};

export type AdaptiveMomentumRibbonSnapshot = {
  entryLong: boolean;
  entryShort: boolean;
  invalidated: boolean;
  activeBuy: boolean;
  activeSell: boolean;
  signalOsc: number | null;
  kcMidline: number | null;
  kcUpper: number | null;
  kcLower: number | null;
  atrValue: number | null;
  invalidationLevel: number | null;
  lineValues: Record<string, number | null>;
};

export type AdaptiveMomentumRibbonEvaluation = {
  snapshot: AdaptiveMomentumRibbonSnapshot;
  plotSeries: Partial<
    Record<AdaptiveMomentumRibbonPlotName, AdaptiveMomentumRibbonPlotPoint[]>
  >;
};

export type AdaptiveMomentumRibbonEngine = {
  next: (candle: Candle) => AdaptiveMomentumRibbonEvaluation;
  getState: () => AdaptiveMomentumRibbonEvaluation;
};

type PendingAdaptiveMomentumRibbonSignal = {
  direction: 'LONG' | 'SHORT';
  invalidationLevel: number | null;
};

type MovingAverageState =
  | {
      type: 'SMA';
      length: number;
      window: number[];
      sum: number;
    }
  | {
      type: 'EMA';
      length: number;
      seedWindow: number[];
      value: number | null;
    }
  | {
      type: 'SMMA (RMA)';
      length: number;
      seedWindow: number[];
      value: number | null;
    }
  | {
      type: 'WMA';
      length: number;
      window: number[];
    }
  | {
      type: 'VWMA';
      length: number;
      priceWindow: number[];
      volumeWindow: number[];
      weightedSum: number;
      volumeSum: number;
    };

const PI = 3.14159265359;
const MAX_PLOT_POINTS = 240;

const toFinite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const percentileNearestRank = (
  values: number[],
  percent: number,
): number | null => {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil((percent / 100) * sorted.length) - 1),
  );

  return sorted[rank] ?? null;
};

const stdev = (values: number[]): number | null => {
  if (!values.length) {
    return null;
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;

  return Math.sqrt(variance);
};

const pushAndTrim = <T>(values: T[], value: T, limit: number) => {
  values.push(value);
  if (values.length > limit) {
    values.splice(0, values.length - limit);
  }
};

const createMovingAverageState = (
  type: AdaptiveMomentumRibbonKcMaType,
  length: number,
): MovingAverageState => {
  switch (type) {
    case 'SMA':
      return {
        type,
        length,
        window: [],
        sum: 0,
      };
    case 'EMA':
      return {
        type,
        length,
        seedWindow: [],
        value: null,
      };
    case 'SMMA (RMA)':
      return {
        type,
        length,
        seedWindow: [],
        value: null,
      };
    case 'WMA':
      return {
        type,
        length,
        window: [],
      };
    case 'VWMA':
      return {
        type,
        length,
        priceWindow: [],
        volumeWindow: [],
        weightedSum: 0,
        volumeSum: 0,
      };
  }
};

const updateMovingAverage = (
  state: MovingAverageState,
  price: number,
  volume: number,
): number | null => {
  switch (state.type) {
    case 'SMA': {
      state.window.push(price);
      state.sum += price;
      if (state.window.length > state.length) {
        state.sum -= state.window.shift() ?? 0;
      }
      if (state.window.length < state.length) {
        return null;
      }
      return state.sum / state.length;
    }

    case 'EMA': {
      if (state.value == null) {
        state.seedWindow.push(price);
        if (state.seedWindow.length < state.length) {
          return null;
        }
        if (state.seedWindow.length === state.length) {
          state.value =
            state.seedWindow.reduce((sum, item) => sum + item, 0) /
            state.length;
          return state.value;
        }
      }

      const alpha = 2 / (state.length + 1);
      state.value = price * alpha + (state.value ?? price) * (1 - alpha);
      return state.value;
    }

    case 'SMMA (RMA)': {
      if (state.value == null) {
        state.seedWindow.push(price);
        if (state.seedWindow.length < state.length) {
          return null;
        }
        if (state.seedWindow.length === state.length) {
          state.value =
            state.seedWindow.reduce((sum, item) => sum + item, 0) /
            state.length;
          return state.value;
        }
      }

      state.value =
        ((state.value ?? price) * (state.length - 1) + price) / state.length;
      return state.value;
    }

    case 'WMA': {
      state.window.push(price);
      if (state.window.length > state.length) {
        state.window.shift();
      }
      if (state.window.length < state.length) {
        return null;
      }

      let weightedSum = 0;
      let weightSum = 0;
      for (let index = 0; index < state.window.length; index += 1) {
        const weight = index + 1;
        weightedSum += state.window[index] * weight;
        weightSum += weight;
      }

      return weightSum > 0 ? weightedSum / weightSum : null;
    }

    case 'VWMA': {
      state.priceWindow.push(price);
      state.volumeWindow.push(volume);
      state.weightedSum += price * volume;
      state.volumeSum += volume;

      if (state.priceWindow.length > state.length) {
        const removedPrice = state.priceWindow.shift() ?? 0;
        const removedVolume = state.volumeWindow.shift() ?? 0;
        state.weightedSum -= removedPrice * removedVolume;
        state.volumeSum -= removedVolume;
      }

      if (state.priceWindow.length < state.length || state.volumeSum <= 0) {
        return null;
      }

      return state.weightedSum / state.volumeSum;
    }
  }
};

const createAtrState = (length: number) => ({
  length,
  previousClose: null as number | null,
  trSeedWindow: [] as number[],
  atrValue: null as number | null,
});

const updateAtr = (
  state: ReturnType<typeof createAtrState>,
  candle: Candle,
): number | null => {
  const previousClose = state.previousClose;
  const tr =
    previousClose == null
      ? candle.high - candle.low
      : Math.max(
          candle.high - candle.low,
          Math.abs(candle.high - previousClose),
          Math.abs(candle.low - previousClose),
        );

  state.previousClose = candle.close;

  if (state.atrValue == null) {
    state.trSeedWindow.push(tr);
    if (state.trSeedWindow.length < state.length) {
      return null;
    }
    if (state.trSeedWindow.length === state.length) {
      state.atrValue =
        state.trSeedWindow.reduce((sum, value) => sum + value, 0) /
        state.length;
      return state.atrValue;
    }
  }

  state.atrValue =
    ((state.atrValue ?? tr) * (state.length - 1) + tr) / state.length;
  return state.atrValue;
};

const createButterworthState = (length: number) => ({
  length,
  prev1: null as number | null,
  prev2: null as number | null,
});

const updateButterworth = (
  state: ReturnType<typeof createButterworthState>,
  source: number | null,
): number | null => {
  if (source == null) {
    return null;
  }

  const safeLength = Math.max(state.length, 1);
  const a = Math.exp((-Math.sqrt(2) * PI) / safeLength);
  const b = 2 * a * Math.cos((Math.sqrt(2) * PI) / safeLength);
  const c2 = b;
  const c3 = -(a * a);
  const c1 = 1 - c2 - c3;

  if (state.prev1 == null || state.prev2 == null) {
    state.prev1 = source;
    state.prev2 = source;
    return source;
  }

  const result = c1 * source + c2 * state.prev1 + c3 * state.prev2;
  state.prev2 = state.prev1;
  state.prev1 = result;
  return result;
};

const pushPlotPoint = (
  plotSeries: Partial<
    Record<AdaptiveMomentumRibbonPlotName, AdaptiveMomentumRibbonPlotPoint[]>
  >,
  plotName: AdaptiveMomentumRibbonPlotName,
  candle: Candle,
  value: number | null,
) => {
  if (value == null) {
    return;
  }

  const points = plotSeries[plotName] ?? [];
  points.push({
    time: candle.timestamp,
    value,
  });
  if (points.length > MAX_PLOT_POINTS) {
    points.splice(0, points.length - MAX_PLOT_POINTS);
  }
  plotSeries[plotName] = points;
};

export const evaluateAdaptiveMomentumRibbon = ({
  candles,
  config,
  linePlots,
}: {
  candles: Candle[];
  config: AdaptiveMomentumRibbonConfig;
  linePlots: string[];
}): AdaptiveMomentumRibbonEvaluation => {
  const engine = createAdaptiveMomentumRibbonEngine({
    config,
    linePlots,
  });

  for (const candle of candles) {
    engine.next(candle);
  }

  return engine.getState();
};

export const createAdaptiveMomentumRibbonEngine = ({
  config,
  linePlots,
  initialCandles = [],
}: {
  config: AdaptiveMomentumRibbonConfig;
  linePlots: string[];
  initialCandles?: Candle[];
}): AdaptiveMomentumRibbonEngine => {
  const momentumPeriod = asPositiveInt(config.AMR_MOMENTUM_PERIOD, 20);
  const smoothingLength = asPositiveInt(config.AMR_BUTTERWORTH_SMOOTHING, 3);
  const waitClose = Boolean(config.AMR_WAIT_CLOSE);
  const confirmOnNextBar = Boolean(config.AMR_CONFIRM_ON_NEXT_BAR);
  const minSignalOscAbsLong = asPositiveNumber(
    resolveDirectionalConfigNumber({
      config,
      key: 'AMR_MIN_SIGNAL_OSC_ABS',
      direction: 'LONG',
      fallback: 0.55,
    }),
    0.55,
  );
  const minSignalOscAbsShort = asPositiveNumber(
    resolveDirectionalConfigNumber({
      config,
      key: 'AMR_MIN_SIGNAL_OSC_ABS',
      direction: 'SHORT',
      fallback: 0.55,
    }),
    0.55,
  );
  const requireKcBias = Boolean(config.AMR_REQUIRE_KC_BIAS);
  const minBarsBetweenSignals = asPositiveInt(
    config.AMR_MIN_BARS_BETWEEN_SIGNALS,
    12,
  );
  const showInvalidationLevels = Boolean(config.AMR_SHOW_INVALIDATION_LEVELS);
  const showKeltnerChannel = Boolean(config.AMR_SHOW_KELTNER_CHANNEL);
  const kcLength = asPositiveInt(config.AMR_KC_LENGTH, 20);
  const kcMaType =
    config.AMR_KC_MA_TYPE === 'SMA' ||
    config.AMR_KC_MA_TYPE === 'EMA' ||
    config.AMR_KC_MA_TYPE === 'SMMA (RMA)' ||
    config.AMR_KC_MA_TYPE === 'WMA' ||
    config.AMR_KC_MA_TYPE === 'VWMA'
      ? config.AMR_KC_MA_TYPE
      : 'EMA';
  const atrLength = asPositiveInt(config.AMR_ATR_LENGTH, 14);
  const atrMultiplier = asPositiveNumber(config.AMR_ATR_MULTIPLIER, 2);

  const sourceWindow: number[] = [];
  const deviationWindow: number[] = [];
  const maState = createMovingAverageState(kcMaType, kcLength);
  const atrState = createAtrState(atrLength);
  const butterworthState = createButterworthState(smoothingLength);
  const plotSeries: Partial<
    Record<AdaptiveMomentumRibbonPlotName, AdaptiveMomentumRibbonPlotPoint[]>
  > = {};

  let previousSignalOsc: number | null = null;
  let lastAcceptedSignalIndex: number | null = null;
  let pendingSignal: PendingAdaptiveMomentumRibbonSignal | null = null;
  let invalidationLevel: number | null = null;
  let activeBuy = false;
  let activeSell = false;
  let lastSnapshot: AdaptiveMomentumRibbonSnapshot = {
    entryLong: false,
    entryShort: false,
    invalidated: false,
    activeBuy: false,
    activeSell: false,
    signalOsc: null,
    kcMidline: null,
    kcUpper: null,
    kcLower: null,
    atrValue: null,
    invalidationLevel: null,
    lineValues: Object.fromEntries(
      linePlots.map((plotName) => [plotName, null]),
    ) as Record<string, number | null>,
  };

  const candles: Candle[] = [];

  const apply = (candle: Candle): AdaptiveMomentumRibbonEvaluation => {
    const index = candles.length;
    const previousCandle = index > 0 ? candles[index - 1] : null;
    candles.push(candle);

    const kcMidline = updateMovingAverage(
      maState,
      candle.close,
      Number(candle.volume ?? 0),
    );
    const atrValue = updateAtr(atrState, candle);
    const kcUpper =
      kcMidline != null && atrValue != null
        ? kcMidline + atrMultiplier * atrValue
        : null;
    const kcLower =
      kcMidline != null && atrValue != null
        ? kcMidline - atrMultiplier * atrValue
        : null;

    const sourceCandle = waitClose ? previousCandle : candle;
    const sourceClose = sourceCandle?.close ?? null;

    let signalOsc: number | null = null;
    let entryLong = false;
    let entryShort = false;

    if (sourceClose != null) {
      pushAndTrim(sourceWindow, sourceClose, momentumPeriod);

      if (sourceWindow.length >= momentumPeriod) {
        const medianValue = percentileNearestRank(sourceWindow, 50);
        const deviation =
          medianValue != null ? sourceClose - medianValue : null;

        if (deviation != null) {
          pushAndTrim(deviationWindow, deviation, momentumPeriod);
        }

        if (deviation != null && deviationWindow.length >= momentumPeriod) {
          const absoluteDeviationWindow = deviationWindow.map((value) =>
            Math.abs(value),
          );
          const medDeviation = percentileNearestRank(
            absoluteDeviationWindow,
            50,
          );
          const scale =
            medDeviation === 0
              ? stdev(sourceWindow)
              : medDeviation != null
                ? medDeviation * 1.4826
                : null;
          const rawOsc = scale != null && scale !== 0 ? deviation / scale : 0;

          signalOsc = updateButterworth(butterworthState, rawOsc);
        }
      }
    }

    if (signalOsc != null && previousSignalOsc != null) {
      const rawEntryLong = previousSignalOsc <= 0 && signalOsc > 0;
      const rawEntryShort = previousSignalOsc >= 0 && signalOsc < 0;
      const longStrongEnough = Math.abs(signalOsc) >= minSignalOscAbsLong;
      const shortStrongEnough = Math.abs(signalOsc) >= minSignalOscAbsShort;
      const spacingOk =
        lastAcceptedSignalIndex == null ||
        index - lastAcceptedSignalIndex >= minBarsBetweenSignals;
      const longKcBiasOk =
        !requireKcBias || (kcMidline != null && candle.close > kcMidline);
      const shortKcBiasOk =
        !requireKcBias || (kcMidline != null && candle.close < kcMidline);

      if (confirmOnNextBar) {
        if (pendingSignal?.direction === 'LONG') {
          const pendingStillValid =
            pendingSignal.invalidationLevel == null ||
            candle.low >= pendingSignal.invalidationLevel;
          const confirmed =
            pendingStillValid &&
            signalOsc > 0 &&
            longStrongEnough &&
            longKcBiasOk;

          if (confirmed) {
            entryLong = true;
            invalidationLevel = pendingSignal.invalidationLevel;
            lastAcceptedSignalIndex = index;
          }

          pendingSignal = null;
        } else if (pendingSignal?.direction === 'SHORT') {
          const pendingStillValid =
            pendingSignal.invalidationLevel == null ||
            candle.high <= pendingSignal.invalidationLevel;
          const confirmed =
            pendingStillValid &&
            signalOsc < 0 &&
            shortStrongEnough &&
            shortKcBiasOk;

          if (confirmed) {
            entryShort = true;
            invalidationLevel = pendingSignal.invalidationLevel;
            lastAcceptedSignalIndex = index;
          }

          pendingSignal = null;
        }

        if (!entryLong && !entryShort && spacingOk) {
          if (
            rawEntryLong &&
            longStrongEnough &&
            longKcBiasOk &&
            sourceCandle
          ) {
            pendingSignal = {
              direction: 'LONG',
              invalidationLevel: sourceCandle.low,
            };
          } else if (
            rawEntryShort &&
            shortStrongEnough &&
            shortKcBiasOk &&
            sourceCandle
          ) {
            pendingSignal = {
              direction: 'SHORT',
              invalidationLevel: sourceCandle.high,
            };
          }
        }
      } else {
        entryLong =
          rawEntryLong && longStrongEnough && spacingOk && longKcBiasOk;
        entryShort =
          rawEntryShort && shortStrongEnough && spacingOk && shortKcBiasOk;
      }
    }

    if (signalOsc != null) {
      previousSignalOsc = signalOsc;
    }

    if (entryLong && sourceCandle) {
      if (invalidationLevel == null) {
        invalidationLevel = sourceCandle.low;
      }
      activeBuy = true;
      activeSell = false;
    }

    if (entryShort && sourceCandle) {
      if (invalidationLevel == null) {
        invalidationLevel = sourceCandle.high;
      }
      activeSell = true;
      activeBuy = false;
    }

    const checkCandle = waitClose ? previousCandle : candle;
    let invalidated = false;

    if (
      activeBuy &&
      checkCandle &&
      invalidationLevel != null &&
      checkCandle.low < invalidationLevel
    ) {
      invalidated = true;
    }

    if (
      activeSell &&
      checkCandle &&
      invalidationLevel != null &&
      checkCandle.high > invalidationLevel
    ) {
      invalidated = true;
    }

    if (invalidated) {
      activeBuy = false;
      activeSell = false;
    }

    const displayedKcMidline = showKeltnerChannel ? kcMidline : null;
    const displayedKcUpper = showKeltnerChannel ? kcUpper : null;
    const displayedKcLower = showKeltnerChannel ? kcLower : null;
    const displayedInvalidationLevel = showInvalidationLevels
      ? invalidationLevel
      : null;

    pushPlotPoint(plotSeries, 'signalOsc', candle, signalOsc);
    pushPlotPoint(plotSeries, 'kcMidline', candle, displayedKcMidline);
    pushPlotPoint(plotSeries, 'kcUpper', candle, displayedKcUpper);
    pushPlotPoint(plotSeries, 'kcLower', candle, displayedKcLower);
    pushPlotPoint(
      plotSeries,
      'invalidationLevel',
      candle,
      displayedInvalidationLevel,
    );

    const currentLineValues: Record<string, number | null> = {};
    for (const plotName of linePlots) {
      switch (plotName) {
        case 'signalOsc':
          currentLineValues[plotName] = signalOsc;
          break;
        case 'kcMidline':
          currentLineValues[plotName] = displayedKcMidline;
          break;
        case 'kcUpper':
          currentLineValues[plotName] = displayedKcUpper;
          break;
        case 'kcLower':
          currentLineValues[plotName] = displayedKcLower;
          break;
        case 'invalidationLevel':
          currentLineValues[plotName] = displayedInvalidationLevel;
          break;
        default:
          currentLineValues[plotName] = null;
          break;
      }
    }

    lastSnapshot = {
      entryLong,
      entryShort,
      invalidated,
      activeBuy,
      activeSell,
      signalOsc: toFinite(signalOsc),
      kcMidline: toFinite(displayedKcMidline),
      kcUpper: toFinite(displayedKcUpper),
      kcLower: toFinite(displayedKcLower),
      atrValue: toFinite(atrValue),
      invalidationLevel: toFinite(displayedInvalidationLevel),
      lineValues: currentLineValues,
    };

    return {
      snapshot: lastSnapshot,
      plotSeries,
    };
  };

  for (const candle of initialCandles) {
    apply(candle);
  }

  return {
    next: apply,
    getState: () => ({
      snapshot: lastSnapshot,
      plotSeries,
    }),
  };
};
