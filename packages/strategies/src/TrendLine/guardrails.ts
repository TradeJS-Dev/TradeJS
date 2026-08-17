import {
  getSignalAtrPct,
  getSignalBtcMaFast,
  getSignalBtcMaSlow,
  getSignalVolumeRel20,
} from '@tradejs/strategy-kit/context';
import {
  buildTrendLineEvaluator,
  getBias,
  getSpreadPct,
  getTrendLineFromPayload,
  toFiniteNumberOrNull,
  type SignalDirection,
} from './family';

const TRENDLINE_CLEAR_BREAK_PCT = 0.35;
const TRENDLINE_TIMING_WINDOW = 6;
const WEAK_CLEAN_BREAK_ATR_RATIO_MAX = 0.45;
const COMPRESSED_CLEAN_BREAK_ATR_RATIO_MAX = 0.6;
const COMPRESSED_CLEAN_BREAK_DISTANCE_MAX = 120;
const COMPRESSED_CLEAN_BREAK_TOUCHES_MIN = 5;
const WEAK_LONG_FAR_BREAK_ATR_RATIO_MAX = 0.6;
const WEAK_LONG_FAR_BREAK_DISTANCE_MIN = 1000;
const WEAK_LONG_FAR_BREAK_BTC_SPREAD_MAX = 0.35;

type TrendlineTimingCandle = {
  timestamp?: unknown;
  close?: unknown;
  high?: unknown;
  low?: unknown;
};

type TimingStage =
  | 'ready_breakout'
  | 'ready_follow_through'
  | 'ready_retest'
  | 'wait_retest'
  | 'wait_retest_confirmation'
  | 'stale_breakout'
  | 'unknown';

const getFiniteTailNumbers = (value: unknown, count: number) => {
  if (!Array.isArray(value) || count <= 0) {
    return [] as Array<number | null>;
  }

  const tail = value.slice(-count);
  return tail.map((item) => toFiniteNumberOrNull(item));
};

const getBreakoutSide = ({
  direction,
  priceVsLinePct,
}: {
  direction: SignalDirection | null;
  priceVsLinePct: number | null;
}) => {
  if (direction == null || priceVsLinePct == null) {
    return null;
  }

  return direction === 'SHORT' ? priceVsLinePct < 0 : priceVsLinePct > 0;
};

const getClearBreakAtPct = ({
  direction,
  priceVsLinePct,
}: {
  direction: SignalDirection | null;
  priceVsLinePct: number | null;
}) => {
  if (direction == null || priceVsLinePct == null) {
    return null;
  }

  return direction === 'SHORT'
    ? priceVsLinePct <= -TRENDLINE_CLEAR_BREAK_PCT
    : priceVsLinePct >= TRENDLINE_CLEAR_BREAK_PCT;
};

const getLineSlopeDirection = (value: number | null) => {
  if (value == null) {
    return null;
  }
  if (value > 0) {
    return 'rising';
  }
  if (value < 0) {
    return 'falling';
  }
  return 'flat';
};

type StructuralTrendLineSignal = {
  direction?: unknown;
  prices?: { currentPrice?: unknown };
  indicators?: Record<string, unknown>;
  additionalIndicators?: Record<string, unknown>;
  figures?: Record<string, unknown>;
};

export const buildTrendlineStructuralContext = (
  signal: StructuralTrendLineSignal,
) => {
  const trendLine = getTrendLineFromPayload(signal);
  const currentPrice = toFiniteNumberOrNull(signal.prices?.currentPrice);
  const signalDirection: SignalDirection | null =
    signal.direction === 'LONG' || signal.direction === 'SHORT'
      ? signal.direction
      : null;
  const points = Array.isArray(trendLine?.points) ? trendLine.points : [];
  const latestPoint = points.length ? points[points.length - 1] : null;
  const currentLinePrice = toFiniteNumberOrNull(
    latestPoint && typeof latestPoint === 'object'
      ? (latestPoint as { value?: unknown }).value
      : null,
  );
  const priceVsLinePct =
    currentPrice != null && currentLinePrice != null && currentLinePrice !== 0
      ? ((currentPrice - currentLinePrice) / currentLinePrice) * 100
      : null;
  const priceVsLineSide =
    priceVsLinePct == null
      ? null
      : priceVsLinePct > 0
        ? 'above'
        : priceVsLinePct < 0
          ? 'below'
          : 'at';
  const priceVsLinePctAbs =
    priceVsLinePct == null ? null : Math.abs(priceVsLinePct);
  const touchesTotal = toFiniteNumberOrNull(
    signal.additionalIndicators?.touches,
  );
  const distance = toFiniteNumberOrNull(signal.additionalIndicators?.distance);
  const touches =
    touchesTotal != null
      ? touchesTotal
      : Array.isArray(trendLine?.touches)
        ? trendLine.touches.length
        : null;
  const atrPct = getSignalAtrPct(signal);
  const volumeRel20 = getSignalVolumeRel20(signal);
  const btcMaFast = getSignalBtcMaFast(signal);
  const btcMaSlow = getSignalBtcMaSlow(signal);
  const btcMaBias = getBias(btcMaFast, btcMaSlow);
  const btcMaSpreadPct = getSpreadPct(btcMaFast, btcMaSlow);
  const btcBiasAligned =
    signalDirection == null || btcMaBias == null
      ? null
      : signalDirection === 'SHORT'
        ? btcMaBias === 'bearish'
        : btcMaBias === 'bullish';
  const clearBreak = getClearBreakAtPct({
    direction: signalDirection,
    priceVsLinePct,
  });
  const nearLineNoise =
    priceVsLinePctAbs == null
      ? null
      : priceVsLinePctAbs < TRENDLINE_CLEAR_BREAK_PCT;
  const breakVsAtrRatio =
    priceVsLinePctAbs != null && atrPct != null && atrPct > 0
      ? priceVsLinePctAbs / atrPct
      : null;
  const weakCleanBreak =
    clearBreak === true &&
    nearLineNoise === false &&
    breakVsAtrRatio != null &&
    breakVsAtrRatio < WEAK_CLEAN_BREAK_ATR_RATIO_MAX;
  const compressedCleanBreak =
    clearBreak === true &&
    nearLineNoise === false &&
    breakVsAtrRatio != null &&
    breakVsAtrRatio < COMPRESSED_CLEAN_BREAK_ATR_RATIO_MAX &&
    (touches ?? 0) >= COMPRESSED_CLEAN_BREAK_TOUCHES_MIN &&
    distance != null &&
    distance < COMPRESSED_CLEAN_BREAK_DISTANCE_MAX;
  const weakLongFarBreak =
    signalDirection === 'LONG' &&
    trendLine?.mode === 'highs' &&
    clearBreak === true &&
    nearLineNoise === false &&
    breakVsAtrRatio != null &&
    breakVsAtrRatio < WEAK_LONG_FAR_BREAK_ATR_RATIO_MAX &&
    distance != null &&
    distance > WEAK_LONG_FAR_BREAK_DISTANCE_MIN &&
    btcBiasAligned === true &&
    btcMaSpreadPct != null &&
    btcMaSpreadPct < WEAK_LONG_FAR_BREAK_BTC_SPREAD_MAX;

  const structuralHardBlockReasons: string[] = [];
  if (clearBreak === false) {
    structuralHardBlockReasons.push('no_clear_break');
  }
  if (nearLineNoise === true) {
    structuralHardBlockReasons.push('near_line_noise');
  }
  if (weakCleanBreak) {
    structuralHardBlockReasons.push('weak_clean_break');
  }
  if (compressedCleanBreak) {
    structuralHardBlockReasons.push('compressed_clean_break');
  }
  if (weakLongFarBreak) {
    structuralHardBlockReasons.push('weak_long_far_break');
  }

  return {
    signalDirection,
    mode: typeof trendLine?.mode === 'string' ? trendLine.mode : null,
    touches,
    distance,
    currentLinePrice,
    currentPrice,
    priceVsLinePct,
    priceVsLineSide,
    priceVsLinePctAbs,
    clearBreak,
    nearLineNoise,
    atrPct,
    volumeRel20,
    breakVsAtrRatio,
    btcMaFast,
    btcMaSlow,
    btcMaBias,
    btcMaSpreadPct,
    btcBiasAligned,
    weakCleanBreak,
    compressedCleanBreak,
    weakLongFarBreak,
    structuralHardBlockReasons,
  };
};

export const buildTrendlineTimingContext = ({
  signal,
  candles,
  structuralContext,
}: {
  signal: StructuralTrendLineSignal;
  candles?: TrendlineTimingCandle[];
  structuralContext?: ReturnType<typeof buildTrendlineStructuralContext>;
}) => {
  const structural =
    structuralContext ?? buildTrendlineStructuralContext(signal);
  const trendLine = getTrendLineFromPayload(signal);
  const evaluator = buildTrendLineEvaluator(trendLine);
  const timingCandles = Array.isArray(candles)
    ? candles.slice(-TRENDLINE_TIMING_WINDOW)
    : [];
  const sortedCandles = [...timingCandles].sort(
    (left, right) =>
      Number(left?.timestamp ?? 0) - Number(right?.timestamp ?? 0),
  );

  const atrTail = getFiniteTailNumbers(
    signal.indicators?.atrPct,
    sortedCandles.length,
  );
  const atrValues = Array.from({ length: sortedCandles.length }, (_, index) => {
    const offset = index - (sortedCandles.length - atrTail.length);
    return offset >= 0 ? atrTail[offset] : null;
  });

  const recentSamples = evaluator
    ? sortedCandles
        .map((candle, index) => {
          const timestamp = toFiniteNumberOrNull(candle.timestamp);
          const close = toFiniteNumberOrNull(candle.close);
          const high = toFiniteNumberOrNull(candle.high);
          const low = toFiniteNumberOrNull(candle.low);
          if (
            timestamp == null ||
            close == null ||
            high == null ||
            low == null
          ) {
            return null;
          }

          const linePrice = evaluator.evaluate(timestamp);
          const priceVsLinePct =
            linePrice !== 0 ? ((close - linePrice) / linePrice) * 100 : null;
          const priceVsLinePctAbs =
            priceVsLinePct == null ? null : Math.abs(priceVsLinePct);
          const breakoutSideClose = getBreakoutSide({
            direction: structural.signalDirection,
            priceVsLinePct,
          });
          const clearBreakClose = getClearBreakAtPct({
            direction: structural.signalDirection,
            priceVsLinePct,
          });
          const nearLineClose =
            priceVsLinePctAbs == null
              ? null
              : priceVsLinePctAbs < TRENDLINE_CLEAR_BREAK_PCT;
          const lineTouched = low <= linePrice && high >= linePrice;
          const distanceAtrRatio =
            priceVsLinePctAbs != null &&
            atrValues[index] != null &&
            atrValues[index]! > 0
              ? priceVsLinePctAbs / atrValues[index]!
              : null;

          return {
            timestamp,
            linePrice,
            priceVsLinePct,
            priceVsLinePctAbs,
            breakoutSideClose,
            clearBreakClose,
            nearLineClose,
            lineTouched,
            distanceAtrRatio,
          };
        })
        .filter(Boolean)
    : [];

  const lastSample =
    recentSamples.length > 0 ? recentSamples[recentSamples.length - 1] : null;
  const prevSample =
    recentSamples.length > 1 ? recentSamples[recentSamples.length - 2] : null;
  const prevPrevSample =
    recentSamples.length > 2 ? recentSamples[recentSamples.length - 3] : null;

  let latestLineCrossIndex: number | null = null;
  let latestClearBreakIndex: number | null = null;

  for (let index = 0; index < recentSamples.length; index += 1) {
    const sample = recentSamples[index]!;
    const prev = index > 0 ? recentSamples[index - 1]! : null;

    if (
      sample.breakoutSideClose === true &&
      (prev == null || prev.breakoutSideClose !== true)
    ) {
      latestLineCrossIndex = index;
    }

    if (
      sample.clearBreakClose === true &&
      (prev == null || prev.clearBreakClose !== true)
    ) {
      latestClearBreakIndex = index;
    }
  }

  let latestRetestIndex: number | null = null;
  if (latestLineCrossIndex != null) {
    for (
      let index = latestLineCrossIndex + 1;
      index < recentSamples.length - 1;
      index += 1
    ) {
      const sample = recentSamples[index]!;
      if (sample.lineTouched || sample.nearLineClose === true) {
        latestRetestIndex = index;
      }
    }
  }

  const currentIndex = recentSamples.length - 1;
  const barsSinceLineCross =
    latestLineCrossIndex != null ? currentIndex - latestLineCrossIndex : null;
  const barsSinceClearBreak =
    latestClearBreakIndex != null ? currentIndex - latestClearBreakIndex : null;
  const barsSinceRetest =
    latestRetestIndex != null ? currentIndex - latestRetestIndex : null;
  const retestHappened = latestRetestIndex != null;
  const retestConfirmed =
    retestHappened === true &&
    barsSinceRetest != null &&
    barsSinceRetest > 0 &&
    lastSample?.clearBreakClose === true;
  const breakoutFresh =
    barsSinceLineCross != null &&
    barsSinceLineCross >= 0 &&
    barsSinceLineCross <= 1;
  const staleBreakout =
    lastSample?.clearBreakClose === true &&
    barsSinceLineCross != null &&
    barsSinceLineCross > 1 &&
    retestConfirmed !== true;
  const currentDistanceAtrRatio = lastSample?.distanceAtrRatio ?? null;
  const previousDistanceAtrRatio = prevSample?.distanceAtrRatio ?? null;
  const distanceAtrVelocity =
    currentDistanceAtrRatio != null && previousDistanceAtrRatio != null
      ? currentDistanceAtrRatio - previousDistanceAtrRatio
      : null;
  const distanceAtrAcceleration =
    currentDistanceAtrRatio != null &&
    previousDistanceAtrRatio != null &&
    prevPrevSample?.distanceAtrRatio != null
      ? currentDistanceAtrRatio -
        2 * previousDistanceAtrRatio +
        prevPrevSample.distanceAtrRatio
      : null;
  const distanceAtrRecent = recentSamples
    .map((sample) => sample!.distanceAtrRatio)
    .filter((value): value is number => value != null);
  const maxDistanceAtrRatioRecent =
    distanceAtrRecent.length > 0 ? Math.max(...distanceAtrRecent) : null;
  const minDistanceAtrRatioRecent =
    distanceAtrRecent.length > 0 ? Math.min(...distanceAtrRecent) : null;

  const firstPoint = evaluator?.firstPoint ?? null;
  const lastPoint = evaluator?.lastPoint ?? null;
  const intervalMs =
    sortedCandles.length > 1
      ? toFiniteNumberOrNull(
          sortedCandles[sortedCandles.length - 1]!.timestamp,
        )! -
        toFiniteNumberOrNull(
          sortedCandles[sortedCandles.length - 2]!.timestamp,
        )!
      : null;
  const lineBarsSpan =
    firstPoint != null &&
    lastPoint != null &&
    intervalMs != null &&
    intervalMs > 0
      ? Math.max(
          1,
          Math.round((lastPoint.timestamp - firstPoint.timestamp) / intervalMs),
        )
      : null;
  const lineSlopePct =
    firstPoint != null && lastPoint != null && firstPoint.value !== 0
      ? ((lastPoint.value - firstPoint.value) / firstPoint.value) * 100
      : null;
  const lineSlopePctPerBar =
    lineSlopePct != null && lineBarsSpan != null && lineBarsSpan > 0
      ? lineSlopePct / lineBarsSpan
      : null;
  const lineSlopeDirection = getLineSlopeDirection(lineSlopePctPerBar);
  const lineSlopeAligned =
    lineSlopeDirection == null || structural.mode == null
      ? null
      : structural.mode === 'lows'
        ? lineSlopeDirection === 'rising'
        : structural.mode === 'highs'
          ? lineSlopeDirection === 'falling'
          : null;

  let entryTiming: TimingStage = 'unknown';
  if (lastSample?.clearBreakClose === true) {
    if (retestConfirmed) {
      entryTiming = 'ready_retest';
    } else if (barsSinceLineCross === 0) {
      entryTiming = 'ready_breakout';
    } else if (
      barsSinceLineCross === 1 &&
      (distanceAtrVelocity == null || distanceAtrVelocity >= 0)
    ) {
      entryTiming = 'ready_follow_through';
    } else if (retestHappened) {
      entryTiming = 'wait_retest_confirmation';
    } else if (staleBreakout) {
      entryTiming = 'stale_breakout';
    } else {
      entryTiming = 'wait_retest';
    }
  }

  return {
    lineCrossDetected: latestLineCrossIndex != null,
    clearBreakDetected: latestClearBreakIndex != null,
    barsSinceLineCross,
    barsSinceClearBreak,
    barsSinceRetest,
    breakoutFresh,
    retestHappened,
    retestConfirmed,
    staleBreakout,
    entryTiming,
    entryReadyNow:
      entryTiming === 'ready_breakout' ||
      entryTiming === 'ready_follow_through' ||
      entryTiming === 'ready_retest',
    lineSlopePct,
    lineSlopePctPerBar,
    lineSlopeDirection,
    lineSlopeAligned,
    currentDistanceAtrRatio,
    previousDistanceAtrRatio,
    distanceAtrVelocity,
    distanceAtrAcceleration,
    maxDistanceAtrRatioRecent,
    minDistanceAtrRatioRecent,
  };
};
