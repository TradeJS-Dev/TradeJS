import type { Candle, Direction } from '@tradejs/types';

import type { BreakoutConfig, BreakoutEntryMode } from './config';
import { resolveDirectionalConfigNumber } from '@tradejs/strategy-kit/config';

export interface BreakoutEngineSignal {
  direction: Direction;
  breakoutLevel: number;
  previousClose: number;
  timestamp: number;
  close: number;
  lookback: number;
  delay: number;
  entryMode: BreakoutEntryMode;
  breakoutTimestamp: number;
  ageBars: number;
}

export interface BreakoutPendingSignal {
  direction: Direction;
  breakoutLevel: number;
  breakoutTimestamp: number;
  breakoutClose: number;
  previousClose: number;
  ageBars: number;
}

export interface BreakoutEngineSnapshot {
  highLevel: number | null;
  lowLevel: number | null;
  atr: number | null;
  trendMoveAtr: number | null;
  rangeAtr: number | null;
  previousCandle: Candle | null;
  signal: BreakoutEngineSignal | null;
  pending: BreakoutPendingSignal | null;
  timestamp: number;
  close: number;
}

type EngineState = {
  candles: Candle[];
  signal: BreakoutEngineSignal | null;
  pending: BreakoutPendingSignal | null;
  snapshot: BreakoutEngineSnapshot | null;
};

const asFiniteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getConfigNumbers = (config: BreakoutConfig) => {
  const configuredEntryMode = String(config.BREAKOUT_ENTRY_MODE ?? 'breakout');
  const entryMode: BreakoutEntryMode =
    configuredEntryMode === 'confirmation' || configuredEntryMode === 'retest'
      ? configuredEntryMode
      : 'breakout';

  return {
    lookback: Math.max(
      2,
      Math.floor(Number(config.BREAKOUT_ENGINE_LOOKBACK ?? 20)),
    ),
    delay: Math.max(1, Math.floor(Number(config.BREAKOUT_ENGINE_DELAY ?? 1))),
    trendLookback: Math.max(
      2,
      Math.floor(Number(config.BREAKOUT_TREND_LOOKBACK ?? 20)),
    ),
    entryMode,
    confirmationBars: Math.max(
      1,
      Math.floor(Number(config.BREAKOUT_CONFIRMATION_BARS ?? 1)),
    ),
    retestMaxBars: Math.max(
      1,
      Math.floor(Number(config.BREAKOUT_RETEST_MAX_BARS ?? 8)),
    ),
    retestToleranceAtrLong: Math.max(
      0,
      resolveDirectionalConfigNumber({
        config,
        key: 'BREAKOUT_RETEST_TOLERANCE_ATR',
        direction: 'LONG',
        fallback: 0.25,
      }),
    ),
    retestToleranceAtrShort: Math.max(
      0,
      resolveDirectionalConfigNumber({
        config,
        key: 'BREAKOUT_RETEST_TOLERANCE_ATR',
        direction: 'SHORT',
        fallback: 0.25,
      }),
    ),
  };
};

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
  const {
    lookback,
    delay,
    trendLookback,
    entryMode,
    confirmationBars,
    retestMaxBars,
    retestToleranceAtrLong,
    retestToleranceAtrShort,
  } = getConfigNumbers(config);
  const maxCandles = Math.max(lookback + delay + 2, trendLookback + 2, 16);
  const state: EngineState = {
    candles: [],
    signal: null,
    pending: null,
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

    const freshBreakout = (() => {
      if (close == null || previousClose == null) return null;
      if (
        highLevel != null &&
        previousClose <= highLevel &&
        close > highLevel
      ) {
        return {
          direction: 'LONG' as const,
          breakoutLevel: highLevel,
          previousClose,
          breakoutTimestamp: candle.timestamp,
          breakoutClose: close,
          ageBars: 0,
        };
      }
      if (lowLevel != null && previousClose >= lowLevel && close < lowLevel) {
        return {
          direction: 'SHORT' as const,
          breakoutLevel: lowLevel,
          previousClose,
          breakoutTimestamp: candle.timestamp,
          breakoutClose: close,
          ageBars: 0,
        };
      }
      return null;
    })();

    const atr = getAtr([...state.candles, candle]);
    state.signal = null;
    if (entryMode === 'breakout' && freshBreakout && close != null) {
      state.signal = {
        direction: freshBreakout.direction,
        breakoutLevel: freshBreakout.breakoutLevel,
        previousClose: freshBreakout.previousClose,
        timestamp: candle.timestamp,
        close,
        lookback,
        delay,
        entryMode,
        breakoutTimestamp: freshBreakout.breakoutTimestamp,
        ageBars: 0,
      };
    } else if (entryMode !== 'breakout' && state.pending && close != null) {
      const pending = {
        ...state.pending,
        ageBars: state.pending.ageBars + 1,
      };
      state.pending = pending;
      const isLong = pending.direction === 'LONG';
      const accepted = isLong
        ? close > pending.breakoutLevel
        : close < pending.breakoutLevel;
      const maxPendingBars =
        entryMode === 'confirmation' ? confirmationBars : retestMaxBars;
      const expired = pending.ageBars > maxPendingBars;
      const retestPrice = asFiniteNumber(isLong ? candle.low : candle.high);
      const retestDistanceAtr =
        retestPrice != null && atr != null && atr > 0
          ? Math.abs(retestPrice - pending.breakoutLevel) / atr
          : null;
      const confirmed =
        entryMode === 'confirmation' &&
        pending.ageBars >= confirmationBars &&
        accepted;
      const retested =
        entryMode === 'retest' &&
        accepted &&
        retestDistanceAtr != null &&
        retestDistanceAtr <=
          (isLong ? retestToleranceAtrLong : retestToleranceAtrShort);

      if (!accepted || expired) {
        state.pending = null;
      } else if (confirmed || retested) {
        state.signal = {
          direction: pending.direction,
          breakoutLevel: pending.breakoutLevel,
          previousClose: pending.previousClose,
          timestamp: candle.timestamp,
          close,
          lookback,
          delay,
          entryMode,
          breakoutTimestamp: pending.breakoutTimestamp,
          ageBars: pending.ageBars,
        };
        state.pending = null;
      }
    }

    if (
      entryMode !== 'breakout' &&
      state.pending == null &&
      state.signal == null &&
      freshBreakout
    ) {
      state.pending = freshBreakout;
    }

    /*
     * Immediate breakouts are emitted only on the transition bar. Delayed
     * modes keep one pending setup and either confirm it causally or discard
     * it after invalidation/expiry.
     */
    if (entryMode === 'breakout') {
      state.pending = null;
    }
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
      pending: state.pending,
      timestamp: candle.timestamp,
      close: close ?? Number(candle.close),
    };
    state.candles.push(candle);
    if (state.candles.length > maxCandles) {
      state.candles.splice(0, state.candles.length - maxCandles);
    }

    return {
      signal: state.signal,
      pending: state.pending,
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
