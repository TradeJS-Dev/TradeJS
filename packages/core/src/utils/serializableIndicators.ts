type RollingWindowState = {
  period: number;
  values: number[];
  sum: number;
};

const createRollingWindowState = (
  period: number,
  state?: Partial<RollingWindowState>,
): RollingWindowState => ({
  period: Math.max(1, Math.floor(period)),
  values: [...(state?.values ?? [])],
  sum:
    typeof state?.sum === 'number'
      ? state.sum
      : (state?.values ?? []).reduce((acc, value) => acc + value, 0),
});

const pushRollingWindow = (state: RollingWindowState, value: number) => {
  state.values.push(value);
  state.sum += value;
  if (state.values.length > state.period) {
    state.sum -= state.values.shift() ?? 0;
  }
};

export type SerializableSmaState = RollingWindowState;

export const createSerializableSma = (
  period: number,
  state?: Partial<SerializableSmaState>,
) => {
  const runtime = createRollingWindowState(period, state);

  return {
    nextValue: (value: number) => {
      pushRollingWindow(runtime, value);
      if (runtime.values.length < runtime.period) {
        return undefined;
      }
      return runtime.sum / runtime.period;
    },
    snapshot: (): SerializableSmaState => ({
      period: runtime.period,
      values: [...runtime.values],
      sum: runtime.sum,
    }),
  };
};

export type SerializableEmaState = {
  period: number;
  exponent: number;
  current: number | null;
  seedSma: SerializableSmaState;
};

const createSerializableGenericEma = ({
  period,
  exponent,
  state,
}: {
  period: number;
  exponent: number;
  state?: Partial<SerializableEmaState>;
}) => {
  const safePeriod = Math.max(1, Math.floor(period));
  const seedSma = createSerializableSma(safePeriod, state?.seedSma);
  let current =
    typeof state?.current === 'number' && Number.isFinite(state.current)
      ? state.current
      : null;

  return {
    nextValue: (value: number) => {
      if (current == null) {
        const seed = seedSma.nextValue(value);
        if (seed === undefined) {
          return undefined;
        }
        current = seed;
        return current;
      }

      current = (value - current) * exponent + current;
      return current;
    },
    snapshot: (): SerializableEmaState => ({
      period: safePeriod,
      exponent,
      current,
      seedSma: seedSma.snapshot(),
    }),
  };
};

export const createSerializableEma = (
  period: number,
  state?: Partial<SerializableEmaState>,
) =>
  createSerializableGenericEma({
    period,
    exponent: 2 / (Math.max(1, Math.floor(period)) + 1),
    state,
  });

export const createSerializableWema = (
  period: number,
  state?: Partial<SerializableEmaState>,
) =>
  createSerializableGenericEma({
    period,
    exponent: 1 / Math.max(1, Math.floor(period)),
    state,
  });

export type SerializableObvState = {
  current: number;
  lastClose: number | null;
};

export const createSerializableObv = (
  state?: Partial<SerializableObvState>,
) => {
  let current =
    typeof state?.current === 'number' && Number.isFinite(state.current)
      ? state.current
      : 0;
  let lastClose =
    typeof state?.lastClose === 'number' && Number.isFinite(state.lastClose)
      ? state.lastClose
      : null;

  return {
    nextValue: (params: { close: number; volume: number }) => {
      if (lastClose == null) {
        lastClose = params.close;
        return undefined;
      }

      if (lastClose < params.close) {
        current += params.volume;
      } else if (params.close < lastClose) {
        current -= params.volume;
      }
      lastClose = params.close;
      return current;
    },
    snapshot: (): SerializableObvState => ({
      current,
      lastClose,
    }),
  };
};

export type SerializableAtrState = {
  period: number;
  prevClose: number | null;
  wema: SerializableEmaState;
};

export const createSerializableAtr = (
  period: number,
  state?: Partial<SerializableAtrState>,
) => {
  const safePeriod = Math.max(1, Math.floor(period));
  let prevClose =
    typeof state?.prevClose === 'number' && Number.isFinite(state.prevClose)
      ? state.prevClose
      : null;
  const wema = createSerializableWema(safePeriod, state?.wema);

  return {
    nextValue: (candle: { high: number; low: number; close: number }) => {
      if (prevClose == null) {
        prevClose = candle.close;
        return undefined;
      }

      const tr = Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - prevClose),
        Math.abs(candle.low - prevClose),
      );
      prevClose = candle.close;
      return wema.nextValue(tr);
    },
    snapshot: (): SerializableAtrState => ({
      period: safePeriod,
      prevClose,
      wema: wema.snapshot(),
    }),
  };
};

export type SerializableRsiState = {
  period: number;
  previousValue: number | null;
  gains: number[];
  losses: number[];
  avgGain: number;
  avgLoss: number;
  initialized: boolean;
};

export const createSerializableRsi = (
  period: number,
  state?: Partial<SerializableRsiState>,
) => {
  const safePeriod = Math.max(1, Math.floor(period));
  let previousValue =
    typeof state?.previousValue === 'number' &&
    Number.isFinite(state.previousValue)
      ? state.previousValue
      : null;
  const gains = [...(state?.gains ?? [])];
  const losses = [...(state?.losses ?? [])];
  let avgGain =
    typeof state?.avgGain === 'number' && Number.isFinite(state.avgGain)
      ? state.avgGain
      : 0;
  let avgLoss =
    typeof state?.avgLoss === 'number' && Number.isFinite(state.avgLoss)
      ? state.avgLoss
      : 0;
  let initialized = Boolean(state?.initialized ?? false);

  const calculateValue = () => {
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    return parseFloat((100 - 100 / (1 + rs)).toFixed(2));
  };

  return {
    nextValue: (value: number) => {
      if (previousValue == null) {
        previousValue = value;
        return undefined;
      }

      const difference = value - previousValue;
      previousValue = value;
      const gain = difference > 0 ? difference : 0;
      const loss = difference < 0 ? Math.abs(difference) : 0;

      if (!initialized) {
        gains.push(gain);
        losses.push(loss);
        if (gains.length < safePeriod) {
          return undefined;
        }

        avgGain = gains.reduce((sum, item) => sum + item, 0) / safePeriod;
        avgLoss = losses.reduce((sum, item) => sum + item, 0) / safePeriod;
        initialized = true;
        return calculateValue();
      }

      avgGain = (avgGain * (safePeriod - 1) + gain) / safePeriod;
      avgLoss = (avgLoss * (safePeriod - 1) + loss) / safePeriod;
      return calculateValue();
    },
    snapshot: (): SerializableRsiState => ({
      period: safePeriod,
      previousValue,
      gains: initialized ? [] : [...gains],
      losses: initialized ? [] : [...losses],
      avgGain,
      avgLoss,
      initialized,
    }),
  };
};

export type SerializableAdxOutput = {
  adx: number;
  pdi: number;
  mdi: number;
};

export type SerializableAdxState = {
  period: number;
  smoothingPeriod: number;
  previousHigh: number | null;
  previousLow: number | null;
  previousClose: number | null;
  plusDMValues: number[];
  minusDMValues: number[];
  trValues: number[];
  smoothedPlusDM: number | null;
  smoothedMinusDM: number | null;
  smoothedTR: number | null;
  smaSum: number;
  smaCount: number;
  adxEMA: number | null;
};

export const createSerializableAdx = (
  period: number,
  state?: Partial<SerializableAdxState>,
  smoothingPeriod = period,
) => {
  const safePeriod = Math.max(1, Math.floor(period));
  const safeSmoothingPeriod = Math.max(1, Math.floor(smoothingPeriod));
  const exponent = 1 / safeSmoothingPeriod;
  let previousHigh =
    typeof state?.previousHigh === 'number' &&
    Number.isFinite(state.previousHigh)
      ? state.previousHigh
      : null;
  let previousLow =
    typeof state?.previousLow === 'number' && Number.isFinite(state.previousLow)
      ? state.previousLow
      : null;
  let previousClose =
    typeof state?.previousClose === 'number' &&
    Number.isFinite(state.previousClose)
      ? state.previousClose
      : null;
  const plusDMValues = [...(state?.plusDMValues ?? [])];
  const minusDMValues = [...(state?.minusDMValues ?? [])];
  const trValues = [...(state?.trValues ?? [])];
  let smoothedPlusDM =
    typeof state?.smoothedPlusDM === 'number' &&
    Number.isFinite(state.smoothedPlusDM)
      ? state.smoothedPlusDM
      : null;
  let smoothedMinusDM =
    typeof state?.smoothedMinusDM === 'number' &&
    Number.isFinite(state.smoothedMinusDM)
      ? state.smoothedMinusDM
      : null;
  let smoothedTR =
    typeof state?.smoothedTR === 'number' && Number.isFinite(state.smoothedTR)
      ? state.smoothedTR
      : null;
  let smaSum =
    typeof state?.smaSum === 'number' && Number.isFinite(state.smaSum)
      ? state.smaSum
      : 0;
  let smaCount =
    typeof state?.smaCount === 'number' && Number.isFinite(state.smaCount)
      ? state.smaCount
      : 0;
  let adxEMA =
    typeof state?.adxEMA === 'number' && Number.isFinite(state.adxEMA)
      ? state.adxEMA
      : null;

  return {
    nextValue: ({
      high,
      low,
      close,
    }: {
      high: number;
      low: number;
      close: number;
    }): SerializableAdxOutput | undefined => {
      if (
        previousHigh == null ||
        previousLow == null ||
        previousClose == null
      ) {
        previousHigh = high;
        previousLow = low;
        previousClose = close;
        return undefined;
      }

      const upMove = high - previousHigh;
      const downMove = previousLow - low;
      const plusDMValue = upMove > downMove && upMove > 0 ? upMove : 0;
      const minusDMValue = downMove > upMove && downMove > 0 ? downMove : 0;
      const highLow = high - low;
      const highPrevClose = Math.abs(high - previousClose);
      const lowPrevClose = Math.abs(low - previousClose);
      const trValue = Math.max(highLow, highPrevClose, lowPrevClose);

      previousHigh = high;
      previousLow = low;
      previousClose = close;

      if (
        smoothedPlusDM == null ||
        smoothedMinusDM == null ||
        smoothedTR == null
      ) {
        plusDMValues.push(plusDMValue);
        minusDMValues.push(minusDMValue);
        trValues.push(trValue);
        if (plusDMValues.length < safePeriod) {
          return undefined;
        }

        smoothedPlusDM = plusDMValues
          .slice(0, safePeriod)
          .reduce((sum, item) => sum + item, 0);
        smoothedMinusDM = minusDMValues
          .slice(0, safePeriod)
          .reduce((sum, item) => sum + item, 0);
        smoothedTR = trValues
          .slice(0, safePeriod)
          .reduce((sum, item) => sum + item, 0);
      } else {
        smoothedPlusDM =
          smoothedPlusDM - smoothedPlusDM / safePeriod + plusDMValue;
        smoothedMinusDM =
          smoothedMinusDM - smoothedMinusDM / safePeriod + minusDMValue;
        smoothedTR = smoothedTR - smoothedTR / safePeriod + trValue;
      }

      const plusDI = (smoothedPlusDM * 100) / smoothedTR;
      const minusDI = (smoothedMinusDM * 100) / smoothedTR;
      const diDiff = Math.abs(plusDI - minusDI);
      const diSum = plusDI + minusDI;
      const dx = diSum !== 0 ? (diDiff / diSum) * 100 : 0;

      if (adxEMA == null) {
        smaSum += dx;
        smaCount += 1;
        if (smaCount < safeSmoothingPeriod) {
          return undefined;
        }

        adxEMA = smaSum / safeSmoothingPeriod;
      } else {
        adxEMA = (dx - adxEMA) * exponent + adxEMA;
      }

      return {
        adx: adxEMA,
        pdi: plusDI,
        mdi: minusDI,
      };
    },
    snapshot: (): SerializableAdxState => ({
      period: safePeriod,
      smoothingPeriod: safeSmoothingPeriod,
      previousHigh,
      previousLow,
      previousClose,
      plusDMValues:
        smoothedPlusDM == null ? plusDMValues.slice(0, safePeriod) : [],
      minusDMValues:
        smoothedMinusDM == null ? minusDMValues.slice(0, safePeriod) : [],
      trValues: smoothedTR == null ? trValues.slice(0, safePeriod) : [],
      smoothedPlusDM,
      smoothedMinusDM,
      smoothedTR,
      smaSum,
      smaCount,
      adxEMA,
    }),
  };
};

export type SerializableSdState = {
  period: number;
  values: number[];
  sum: number;
  sumSquares: number;
};

export const createSerializableSd = (
  period: number,
  state?: Partial<SerializableSdState>,
) => {
  const safePeriod = Math.max(1, Math.floor(period));
  const values = [...(state?.values ?? [])];
  let sum =
    typeof state?.sum === 'number'
      ? state.sum
      : values.reduce((acc, value) => acc + value, 0);
  let sumSquares =
    typeof state?.sumSquares === 'number'
      ? state.sumSquares
      : values.reduce((acc, value) => acc + value * value, 0);

  return {
    nextValue: (value: number) => {
      values.push(value);
      sum += value;
      sumSquares += value * value;

      if (values.length > safePeriod) {
        const removed = values.shift() ?? 0;
        sum -= removed;
        sumSquares -= removed * removed;
      }

      if (values.length < safePeriod) {
        return undefined;
      }

      const mean = sum / safePeriod;
      const variance = Math.max(sumSquares / safePeriod - mean * mean, 0);
      return Math.sqrt(variance);
    },
    snapshot: (): SerializableSdState => ({
      period: safePeriod,
      values: [...values],
      sum,
      sumSquares,
    }),
  };
};

export type SerializableBollingerState = {
  period: number;
  stdDev: number;
  sma: SerializableSmaState;
  sd: SerializableSdState;
};

export const createSerializableBollinger = (
  period: number,
  stdDev: number,
  state?: Partial<SerializableBollingerState>,
) => {
  const sma = createSerializableSma(period, state?.sma);
  const sd = createSerializableSd(period, state?.sd);
  const safeStdDev =
    typeof stdDev === 'number' && Number.isFinite(stdDev) ? stdDev : 2;

  return {
    nextValue: (value: number) => {
      const middle = sma.nextValue(value);
      const deviation = sd.nextValue(value);

      if (middle === undefined || deviation === undefined) {
        return undefined;
      }

      const upper = middle + deviation * safeStdDev;
      const lower = middle - deviation * safeStdDev;

      return {
        middle,
        upper,
        lower,
        pb: (value - lower) / (upper - lower),
      };
    },
    snapshot: (): SerializableBollingerState => ({
      period: Math.max(1, Math.floor(period)),
      stdDev: safeStdDev,
      sma: sma.snapshot(),
      sd: sd.snapshot(),
    }),
  };
};

export type SerializableMacdState = {
  fastPeriod: number;
  slowPeriod: number;
  signalPeriod: number;
  fast: SerializableEmaState | SerializableSmaState;
  slow: SerializableEmaState | SerializableSmaState;
  signal: SerializableEmaState | SerializableSmaState;
  simpleOscillator: boolean;
  simpleSignal: boolean;
  index: number;
};

export const createSerializableMacd = (
  params: {
    fastPeriod: number;
    slowPeriod: number;
    signalPeriod: number;
    simpleOscillator?: boolean;
    simpleSignal?: boolean;
  },
  state?: Partial<SerializableMacdState>,
) => {
  const fastPeriod = Math.max(1, Math.floor(params.fastPeriod));
  const slowPeriod = Math.max(1, Math.floor(params.slowPeriod));
  const signalPeriod = Math.max(1, Math.floor(params.signalPeriod));
  const simpleOscillator = Boolean(params.simpleOscillator ?? false);
  const simpleSignal = Boolean(params.simpleSignal ?? false);
  const fast = simpleOscillator
    ? createSerializableSma(
        fastPeriod,
        state?.fast as Partial<SerializableSmaState> | undefined,
      )
    : createSerializableEma(
        fastPeriod,
        state?.fast as Partial<SerializableEmaState> | undefined,
      );
  const slow = simpleOscillator
    ? createSerializableSma(
        slowPeriod,
        state?.slow as Partial<SerializableSmaState> | undefined,
      )
    : createSerializableEma(
        slowPeriod,
        state?.slow as Partial<SerializableEmaState> | undefined,
      );
  const signal = simpleSignal
    ? createSerializableSma(
        signalPeriod,
        state?.signal as Partial<SerializableSmaState> | undefined,
      )
    : createSerializableEma(
        signalPeriod,
        state?.signal as Partial<SerializableEmaState> | undefined,
      );
  let index =
    typeof state?.index === 'number' && Number.isFinite(state.index)
      ? state.index
      : 0;

  return {
    nextValue: (value: number) => {
      const fastValue = fast.nextValue(value);
      const slowValue = slow.nextValue(value);
      index += 1;

      if (index < slowPeriod) {
        return undefined;
      }

      if (fastValue == null || slowValue == null) {
        return {
          MACD: undefined,
          signal: undefined,
          histogram: undefined,
        };
      }

      const macdValue = fastValue - slowValue;
      const signalValue = signal.nextValue(macdValue);
      const histogram =
        signalValue == null ? undefined : macdValue - signalValue;

      return {
        MACD: macdValue,
        signal: signalValue ?? undefined,
        histogram:
          histogram == null || Number.isNaN(histogram) ? undefined : histogram,
      };
    },
    snapshot: (): SerializableMacdState => ({
      fastPeriod,
      slowPeriod,
      signalPeriod,
      fast: fast.snapshot(),
      slow: slow.snapshot(),
      signal: signal.snapshot(),
      simpleOscillator,
      simpleSignal,
      index,
    }),
  };
};
