import type { Candle, Direction } from '@tradejs/types';

import type { BreakoutConfig } from './config';

export interface BreakoutEngineSignal {
  direction: Direction;
  breakoutLevel: number;
  previousClose: number;
  timestamp: number;
  close: number;
  lookback: number;
  delay: number;
}

export interface BreakoutEngineSnapshot {
  highLevel: number | null;
  lowLevel: number | null;
  atr: number | null;
  trendMoveAtr: number | null;
  rangeAtr: number | null;
  previousCandle: Candle | null;
  signal: BreakoutEngineSignal | null;
  timestamp: number;
  close: number;
}

type EngineState = {
  candles: Candle[];
  signal: BreakoutEngineSignal | null;
  snapshot: BreakoutEngineSnapshot | null;
};

const asFiniteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getConfigNumbers = (config: BreakoutConfig) => ({
  lookback: Math.max(
    2,
    Math.floor(Number(config.BREAKOUT_ENGINE_LOOKBACK ?? 20)),
  ),
  delay: Math.max(1, Math.floor(Number(config.BREAKOUT_ENGINE_DELAY ?? 1))),
  trendLookback: Math.max(
    2,
    Math.floor(Number(config.BREAKOUT_TREND_LOOKBACK ?? 20)),
  ),
});

const getAtr = (candles: Candle[]): number | null => {
  const window = candles.slice(-15);
  if (window.length < 2) return null;

  const trueRanges = window.slice(1).map((candle, index) => {
    const previousClose = Number(window[index].close);
    return Math.max(
      Number(candle.high) - Number(candle.low),
      Math.abs(Number(candle.high) - previousClose),
      Math.abs(Number(candle.low) - previousClose),
    );
  });
  const finiteRanges = trueRanges.filter((value) => Number.isFinite(value));
  return finiteRanges.length > 0
    ? finiteRanges.reduce((sum, value) => sum + value, 0) / finiteRanges.length
    : null;
};

export const createBreakoutEngine = ({
  config,
  initialCandles = [],
}: {
  config: BreakoutConfig;
  initialCandles?: Candle[];
}) => {
  const { lookback, delay, trendLookback } = getConfigNumbers(config);
  const maxCandles = Math.max(lookback + delay + 2, trendLookback + 2, 16);
  const state: EngineState = {
    candles: [],
    signal: null,
    snapshot: null,
  };

  const apply = (candle: Candle) => {
    const close = asFiniteNumber(candle.close);
    const previousCandle = state.candles[state.candles.length - 1] ?? null;
    const previousClose = asFiniteNumber(previousCandle?.close);
    const windowEnd = state.candles.length - delay + 1;
    const windowStart = windowEnd - lookback;
    const levelWindow =
      windowStart >= 0 && windowEnd > windowStart
        ? state.candles.slice(windowStart, windowEnd)
        : [];
    const highs = levelWindow
      .map((item) => asFiniteNumber(item.high))
      .filter((value): value is number => value != null);
    const lows = levelWindow
      .map((item) => asFiniteNumber(item.low))
      .filter((value): value is number => value != null);
    const highLevel = highs.length === lookback ? Math.max(...highs) : null;
    const lowLevel = lows.length === lookback ? Math.min(...lows) : null;

    state.signal = null;
    if (close != null && previousClose != null) {
      if (
        highLevel != null &&
        previousClose <= highLevel &&
        close > highLevel
      ) {
        state.signal = {
          direction: 'LONG',
          breakoutLevel: highLevel,
          previousClose,
          timestamp: candle.timestamp,
          close,
          lookback,
          delay,
        };
      } else if (
        lowLevel != null &&
        previousClose >= lowLevel &&
        close < lowLevel
      ) {
        state.signal = {
          direction: 'SHORT',
          breakoutLevel: lowLevel,
          previousClose,
          timestamp: candle.timestamp,
          close,
          lookback,
          delay,
        };
      }
    }

    const atr = getAtr([...state.candles, candle]);
    const trendStart =
      state.candles[state.candles.length - 1 - trendLookback] ?? null;
    const trendStartClose = asFiniteNumber(trendStart?.close);
    const trendMoveAtr =
      atr != null && atr > 0 && previousClose != null && trendStartClose != null
        ? (previousClose - trendStartClose) / atr
        : null;
    const rangeAtr =
      atr != null && atr > 0 && highLevel != null && lowLevel != null
        ? (highLevel - lowLevel) / atr
        : null;

    state.snapshot = {
      highLevel,
      lowLevel,
      atr,
      trendMoveAtr,
      rangeAtr,
      previousCandle,
      signal: state.signal,
      timestamp: candle.timestamp,
      close: close ?? Number(candle.close),
    };
    state.candles.push(candle);
    if (state.candles.length > maxCandles) {
      state.candles.splice(0, state.candles.length - maxCandles);
    }

    return {
      signal: state.signal,
      snapshot: state.snapshot,
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
    }),
  };
};
