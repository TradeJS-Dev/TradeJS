import {
  getSignalAtrPct,
  getSignalBtcMaFast,
  getSignalBtcMaSlow,
  getSignalCoinMaFast,
  getSignalCoinMaSlow,
} from '@tradejs/strategy-kit/context';
import {
  buildTrendLineEvaluator,
  getBias,
  getSpreadPct,
  getTrendLineFromPayload,
  toFiniteNumberOrNull,
  type SignalDirection,
} from '../shared/trendlineGuardrails';

export {
  getBias,
  getLastFiniteNumber,
  getSpreadPct,
  getTrendLineFromPayload,
  toFiniteNumberOrNull,
} from '../shared/trendlineGuardrails';

const REVERSE_TRENDLINE_NEAR_LINE_PCT = 0.45;
const REVERSE_TRENDLINE_FAILED_BOUNCE_PCT = 0.35;
const REVERSE_TRENDLINE_TIMING_WINDOW = 6;
const MIN_REJECTION_WICK_PCT = 0.12;
const MIN_REJECTION_STRENGTH_PCT = 0.08;
const FOLLOW_THROUGH_STRENGTH_PCT = 0.18;

type ReverseTimingCandle = {
  timestamp?: unknown;
  open?: unknown;
  close?: unknown;
  high?: unknown;
  low?: unknown;
};

type TimingStage =
  | 'ready_rejection'
  | 'ready_follow_through'
  | 'wait_touch'
  | 'wait_reaction_confirmation'
  | 'stale_reaction'
  | 'unknown';

const deriveDirectionFromMode = (mode: unknown): SignalDirection | null => {
  if (mode === 'lows') {
    return 'LONG';
  }
  if (mode === 'highs') {
    return 'SHORT';
  }
  return null;
};

const getCurrentCandle = (signal: {
  additionalIndicators?: Record<string, unknown>;
}) => {
  const candle = signal.additionalIndicators?.currentCandle as
    | ReverseTimingCandle
    | undefined;
  return candle && typeof candle === 'object' ? candle : null;
};

const getLineTouched = ({
  low,
  high,
  linePrice,
}: {
  low: number | null;
  high: number | null;
  linePrice: number | null;
}) => {
  if (low == null || high == null || linePrice == null) {
    return false;
  }

  return low <= linePrice && high >= linePrice;
};

const getCloseOnBounceSide = ({
  direction,
  priceVsLinePct,
}: {
  direction: SignalDirection | null;
  priceVsLinePct: number | null;
}) => {
  if (direction == null || priceVsLinePct == null) {
    return null;
  }

  return direction === 'LONG' ? priceVsLinePct >= 0 : priceVsLinePct <= 0;
};

const getFailedBounceBreak = ({
  direction,
  priceVsLinePct,
}: {
  direction: SignalDirection | null;
  priceVsLinePct: number | null;
}) => {
  if (direction == null || priceVsLinePct == null) {
    return null;
  }

  return direction === 'LONG'
    ? priceVsLinePct <= -REVERSE_TRENDLINE_FAILED_BOUNCE_PCT
    : priceVsLinePct >= REVERSE_TRENDLINE_FAILED_BOUNCE_PCT;
};

const getBodyAligned = ({
  direction,
  open,
  close,
}: {
  direction: SignalDirection | null;
  open: number | null;
  close: number | null;
}) => {
  if (direction == null || open == null || close == null) {
    return null;
  }

  return direction === 'LONG' ? close >= open : close <= open;
};

const getRejectionWickPct = ({
  direction,
  open,
  close,
  high,
  low,
}: {
  direction: SignalDirection | null;
  open: number | null;
  close: number | null;
  high: number | null;
  low: number | null;
}) => {
  if (
    direction == null ||
    open == null ||
    close == null ||
    high == null ||
    low == null ||
    close <= 0
  ) {
    return null;
  }

  const lowerWick = Math.max(0, Math.min(open, close) - low);
  const upperWick = Math.max(0, high - Math.max(open, close));

  return direction === 'LONG'
    ? (lowerWick / close) * 100
    : (upperWick / close) * 100;
};

const getRejectionStrengthPct = ({
  direction,
  close,
  linePrice,
}: {
  direction: SignalDirection | null;
  close: number | null;
  linePrice: number | null;
}) => {
  if (
    direction == null ||
    close == null ||
    linePrice == null ||
    linePrice === 0
  ) {
    return null;
  }

  if (direction === 'LONG') {
    return close >= linePrice ? ((close - linePrice) / linePrice) * 100 : 0;
  }

  return close <= linePrice ? ((linePrice - close) / linePrice) * 100 : 0;
};

const getRejectionBar = ({
  direction,
  lineTouched,
  closeOnBounceSide,
  bodyAligned,
  rejectionWickPct,
  rejectionStrengthPct,
}: {
  direction: SignalDirection | null;
  lineTouched: boolean;
  closeOnBounceSide: boolean | null;
  bodyAligned: boolean | null;
  rejectionWickPct: number | null;
  rejectionStrengthPct: number | null;
}) => {
  if (direction == null) {
    return false;
  }

  return (
    lineTouched &&
    closeOnBounceSide === true &&
    bodyAligned === true &&
    (rejectionWickPct ?? 0) >= MIN_REJECTION_WICK_PCT &&
    (rejectionStrengthPct ?? 0) >= MIN_REJECTION_STRENGTH_PCT
  );
};

type ReverseStructuralSignal = {
  direction?: unknown;
  prices?: { currentPrice?: unknown };
  indicators?: Record<string, unknown>;
  additionalIndicators?: Record<string, unknown>;
  figures?: Record<string, unknown>;
};

export const buildReverseTrendlineStructuralContext = (
  signal: ReverseStructuralSignal,
) => {
  const trendLine = getTrendLineFromPayload(signal);
  const evaluator = buildTrendLineEvaluator(trendLine);
  const currentPrice = toFiniteNumberOrNull(signal.prices?.currentPrice);
  const currentCandle = getCurrentCandle(signal);
  const currentTimestamp = toFiniteNumberOrNull(currentCandle?.timestamp);
  const currentOpen = toFiniteNumberOrNull(currentCandle?.open);
  const currentClose =
    toFiniteNumberOrNull(currentCandle?.close) ?? currentPrice;
  const currentHigh = toFiniteNumberOrNull(currentCandle?.high);
  const currentLow = toFiniteNumberOrNull(currentCandle?.low);
  const signalDirection: SignalDirection | null =
    signal.direction === 'LONG' || signal.direction === 'SHORT'
      ? signal.direction
      : deriveDirectionFromMode(trendLine?.mode);
  const currentLinePrice =
    currentTimestamp != null && evaluator
      ? evaluator.evaluate(currentTimestamp)
      : evaluator?.lastPoint.value ?? null;
  const priceVsLinePct =
    currentClose != null && currentLinePrice != null && currentLinePrice !== 0
      ? ((currentClose - currentLinePrice) / currentLinePrice) * 100
      : null;
  const priceVsLinePctAbs =
    priceVsLinePct == null ? null : Math.abs(priceVsLinePct);
  const priceVsLineSide =
    priceVsLinePct == null
      ? null
      : priceVsLinePct > 0
        ? 'above'
        : priceVsLinePct < 0
          ? 'below'
          : 'at';
  const nearLine =
    priceVsLinePctAbs == null
      ? null
      : priceVsLinePctAbs <= REVERSE_TRENDLINE_NEAR_LINE_PCT;
  const lineTouchedNow = getLineTouched({
    low: currentLow,
    high: currentHigh,
    linePrice: currentLinePrice,
  });
  const closeOnBounceSide = getCloseOnBounceSide({
    direction: signalDirection,
    priceVsLinePct,
  });
  const failedBounceBreak = getFailedBounceBreak({
    direction: signalDirection,
    priceVsLinePct,
  });
  const bodyAligned = getBodyAligned({
    direction: signalDirection,
    open: currentOpen,
    close: currentClose,
  });
  const rejectionWickPct = getRejectionWickPct({
    direction: signalDirection,
    open: currentOpen,
    close: currentClose,
    high: currentHigh,
    low: currentLow,
  });
  const rejectionStrengthPct = getRejectionStrengthPct({
    direction: signalDirection,
    close: currentClose,
    linePrice: currentLinePrice,
  });
  const rejectionBarNow = getRejectionBar({
    direction: signalDirection,
    lineTouched: lineTouchedNow,
    closeOnBounceSide,
    bodyAligned,
    rejectionWickPct,
    rejectionStrengthPct,
  });
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
  const breakVsAtrRatio =
    rejectionStrengthPct != null && atrPct != null && atrPct > 0
      ? rejectionStrengthPct / atrPct
      : null;
  const coinMaFast = getSignalCoinMaFast(signal);
  const coinMaSlow = getSignalCoinMaSlow(signal);
  const coinMaBias = getBias(coinMaFast, coinMaSlow);
  const coinMaSpreadPct = getSpreadPct(coinMaFast, coinMaSlow);
  const coinBiasAligned =
    signalDirection == null || coinMaBias == null
      ? null
      : signalDirection === 'LONG'
        ? coinMaBias === 'bullish'
        : coinMaBias === 'bearish';
  const btcMaFast = getSignalBtcMaFast(signal);
  const btcMaSlow = getSignalBtcMaSlow(signal);
  const btcMaBias = getBias(btcMaFast, btcMaSlow);
  const btcMaSpreadPct = getSpreadPct(btcMaFast, btcMaSlow);
  const btcBiasAligned =
    signalDirection == null || btcMaBias == null
      ? null
      : signalDirection === 'LONG'
        ? btcMaBias === 'bullish'
        : btcMaBias === 'bearish';

  const structuralHardBlockReasons: string[] = [];
  if (failedBounceBreak === true) {
    structuralHardBlockReasons.push('failed_bounce_break');
  }

  return {
    signalDirection,
    mode: typeof trendLine?.mode === 'string' ? trendLine.mode : null,
    currentPrice,
    currentLinePrice,
    priceVsLinePct,
    priceVsLinePctAbs,
    priceVsLineSide,
    nearLine,
    lineTouchedNow,
    closeOnBounceSide,
    failedBounceBreak,
    bodyAligned,
    rejectionWickPct,
    rejectionStrengthPct,
    rejectionBarNow,
    touches,
    distance,
    atrPct,
    breakVsAtrRatio,
    coinMaFast,
    coinMaSlow,
    coinMaBias,
    coinMaSpreadPct,
    coinBiasAligned,
    btcMaFast,
    btcMaSlow,
    btcMaBias,
    btcMaSpreadPct,
    btcBiasAligned,
    structuralHardBlockReasons,
  };
};

export const buildReverseTrendlineTimingContext = ({
  signal,
  candles,
  structuralContext,
}: {
  signal: ReverseStructuralSignal;
  candles?: ReverseTimingCandle[];
  structuralContext?: ReturnType<typeof buildReverseTrendlineStructuralContext>;
}) => {
  const structural =
    structuralContext ?? buildReverseTrendlineStructuralContext(signal);
  const trendLine = getTrendLineFromPayload(signal);
  const evaluator = buildTrendLineEvaluator(trendLine);
  const timingCandles = Array.isArray(candles)
    ? candles.slice(-REVERSE_TRENDLINE_TIMING_WINDOW)
    : [];
  const sortedCandles = [...timingCandles].sort(
    (left, right) =>
      Number(left?.timestamp ?? 0) - Number(right?.timestamp ?? 0),
  );

  const recentSamples = evaluator
    ? sortedCandles
        .map((candle) => {
          const timestamp = toFiniteNumberOrNull(candle.timestamp);
          const open = toFiniteNumberOrNull(candle.open);
          const close = toFiniteNumberOrNull(candle.close);
          const high = toFiniteNumberOrNull(candle.high);
          const low = toFiniteNumberOrNull(candle.low);
          if (
            timestamp == null ||
            open == null ||
            close == null ||
            high == null ||
            low == null
          ) {
            return null;
          }

          const linePrice = evaluator.evaluate(timestamp);
          const priceVsLinePct =
            linePrice !== 0 ? ((close - linePrice) / linePrice) * 100 : null;
          const closeOnBounceSide = getCloseOnBounceSide({
            direction: structural.signalDirection,
            priceVsLinePct,
          });
          const failedBounceBreak = getFailedBounceBreak({
            direction: structural.signalDirection,
            priceVsLinePct,
          });
          const lineTouched = getLineTouched({
            low,
            high,
            linePrice,
          });
          const bodyAligned = getBodyAligned({
            direction: structural.signalDirection,
            open,
            close,
          });
          const rejectionWickPct = getRejectionWickPct({
            direction: structural.signalDirection,
            open,
            close,
            high,
            low,
          });
          const rejectionStrengthPct = getRejectionStrengthPct({
            direction: structural.signalDirection,
            close,
            linePrice,
          });
          const rejectionBar = getRejectionBar({
            direction: structural.signalDirection,
            lineTouched,
            closeOnBounceSide,
            bodyAligned,
            rejectionWickPct,
            rejectionStrengthPct,
          });

          return {
            timestamp,
            priceVsLinePct,
            lineTouched,
            closeOnBounceSide,
            failedBounceBreak,
            rejectionWickPct,
            rejectionStrengthPct,
            rejectionBar,
          };
        })
        .filter(Boolean)
    : [];

  const currentIndex = recentSamples.length - 1;
  const lastSample = currentIndex >= 0 ? recentSamples[currentIndex]! : null;
  const prevSample = currentIndex > 0 ? recentSamples[currentIndex - 1]! : null;

  let latestRejectionIndex: number | null = null;
  for (let index = 0; index < recentSamples.length; index += 1) {
    if (recentSamples[index]!.rejectionBar === true) {
      latestRejectionIndex = index;
    }
  }

  const barsSinceRejection =
    latestRejectionIndex != null ? currentIndex - latestRejectionIndex : null;
  const rejectionFresh =
    barsSinceRejection != null &&
    barsSinceRejection >= 0 &&
    barsSinceRejection <= 1;
  const followThroughReady =
    latestRejectionIndex != null &&
    latestRejectionIndex === currentIndex - 1 &&
    lastSample?.closeOnBounceSide === true &&
    lastSample.failedBounceBreak !== true &&
    lastSample.lineTouched === false &&
    (lastSample.rejectionStrengthPct ?? 0) >= FOLLOW_THROUGH_STRENGTH_PCT;
  const staleReaction =
    latestRejectionIndex != null &&
    barsSinceRejection != null &&
    barsSinceRejection > 1 &&
    lastSample?.failedBounceBreak !== true;

  let entryTiming: TimingStage = 'unknown';
  if (lastSample?.failedBounceBreak === true) {
    entryTiming = 'stale_reaction';
  } else if (lastSample?.rejectionBar === true) {
    entryTiming = 'ready_rejection';
  } else if (followThroughReady) {
    entryTiming = 'ready_follow_through';
  } else if (
    lastSample?.lineTouched === true &&
    lastSample.closeOnBounceSide === true &&
    !lastSample.rejectionBar
  ) {
    entryTiming = 'wait_reaction_confirmation';
  } else if (staleReaction) {
    entryTiming = 'stale_reaction';
  } else {
    entryTiming = 'wait_touch';
  }

  return {
    rejectionDetected: latestRejectionIndex != null,
    barsSinceRejection,
    rejectionFresh,
    followThroughReady,
    staleReaction,
    entryTiming,
    entryReadyNow:
      entryTiming === 'ready_rejection' ||
      entryTiming === 'ready_follow_through',
    currentRejectionStrengthPct: lastSample?.rejectionStrengthPct ?? null,
    previousRejectionStrengthPct: prevSample?.rejectionStrengthPct ?? null,
    currentRejectionWickPct: lastSample?.rejectionWickPct ?? null,
    previousRejectionWickPct: prevSample?.rejectionWickPct ?? null,
  };
};
