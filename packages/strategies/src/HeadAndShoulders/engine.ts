import { Candle, Direction } from '@tradejs/types';
import { HeadAndShouldersConfig, HeadAndShouldersEntryMode } from './config';

export type HeadAndShouldersPatternKind =
  | 'head_and_shoulders'
  | 'inverse_head_and_shoulders';
export type HeadAndShouldersEntryStage =
  | 'breakout'
  | 'close_accepted'
  | 'retest_held';

export interface HeadAndShouldersPivot {
  timestamp: number;
  index: number;
  value: number;
  kind: 'high' | 'low';
  atr?: number | null;
  priorMoveAtr?: number | null;
}

export interface HeadAndShouldersPattern {
  setupId: string;
  kind: HeadAndShouldersPatternKind;
  direction: Direction;
  entryMode: HeadAndShouldersEntryMode;
  entryStage: HeadAndShouldersEntryStage;
  pivots: [
    HeadAndShouldersPivot,
    HeadAndShouldersPivot,
    HeadAndShouldersPivot,
    HeadAndShouldersPivot,
    HeadAndShouldersPivot,
  ];
  neckline: number;
  necklineSlopePerBar: number;
  targetPrice: number;
  stopLossPrice: number;
  headHeight: number;
  headHeightPct: number;
  headHeightAtr: number;
  shoulderDifferencePct: number;
  leftHeadProminenceRatio: number;
  rightHeadProminenceRatio: number;
  patternDurationBars: number;
  patternSymmetryRatio: number;
  patternAgeBars: number;
  necklineSlopeRatio: number;
  priorMoveAtr: number | null;
  breakoutDistancePct: number;
  breakoutDistanceAtr: number;
  breakoutDistanceHeightRatio: number;
  breakoutDelayBars: number;
  breakoutCrossedOnSignalBar: boolean;
  breakoutTimestamp: number;
  confirmationBars: number;
  confirmationBodyAtr: number | null;
  confirmationCloseLocation: number | null;
  confirmationVolumeRel: number | null;
  timestamp: number;
  close: number;
}

export interface HeadAndShouldersPendingSetup {
  setupId: string;
  mode: Exclude<HeadAndShouldersEntryMode, 'breakout'>;
  stage: 'neckline_crossed' | 'retest_pending';
  breakoutIndex: number;
  pattern: HeadAndShouldersPattern;
}

export interface HeadAndShouldersRuntimeState {
  pattern: HeadAndShouldersPattern | null;
  pending: HeadAndShouldersPendingSetup | null;
  pivots: HeadAndShouldersPivot[];
}

interface EngineState {
  candles: Candle[];
  candleStartIndex: number;
  currentIndex: number;
  pivots: HeadAndShouldersPivot[];
  pattern: HeadAndShouldersPattern | null;
  pending: HeadAndShouldersPendingSetup | null;
  consumedSetupIds: string[];
  lastTimestamp: number | null;
}

const asNumber = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const clampNumber = ({
  value,
  fallback,
  min,
  max,
}: {
  value: unknown;
  fallback: number;
  min: number;
  max?: number;
}) => {
  const numeric = Number(value);
  const resolved = Number.isFinite(numeric) ? numeric : fallback;
  return Math.min(max ?? Infinity, Math.max(min, resolved));
};

const getConfigNumbers = (config: HeadAndShouldersConfig) => ({
  pivotLookback: Math.max(
    1,
    Math.floor(Number(config.HEADSHOULDERS_PIVOT_LOOKBACK ?? 3)),
  ),
  shoulderTolerancePct: clampNumber({
    value: config.HEADSHOULDERS_SHOULDER_TOLERANCE_PCT,
    fallback: 20,
    min: 0,
  }),
  minHeadProminenceRatio: clampNumber({
    value: config.HEADSHOULDERS_MIN_HEAD_PROMINENCE_RATIO,
    fallback: 0.2,
    min: 0,
  }),
  targetHeightPct: clampNumber({
    value: config.HEADSHOULDERS_TARGET_HEIGHT_PCT,
    fallback: 100,
    min: 0,
  }),
  stopBufferHeightPct: clampNumber({
    value: config.HEADSHOULDERS_STOP_BUFFER_HEIGHT_PCT,
    fallback: 5,
    min: 0,
  }),
  minHeadHeightPct: clampNumber({
    value: config.HEADSHOULDERS_MIN_HEAD_HEIGHT_PCT,
    fallback: 0.8,
    min: 0,
  }),
  minHeadHeightAtr: clampNumber({
    value: config.HEADSHOULDERS_MIN_HEAD_HEIGHT_ATR,
    fallback: 2,
    min: 0,
  }),
  atrPeriod: Math.max(
    2,
    Math.floor(Number(config.HEADSHOULDERS_ATR_PERIOD ?? 14)),
  ),
  minPatternBars: Math.max(
    4,
    Math.floor(Number(config.HEADSHOULDERS_MIN_PATTERN_BARS ?? 8)),
  ),
  maxPatternBars: Math.max(
    4,
    Math.floor(Number(config.HEADSHOULDERS_MAX_PATTERN_BARS ?? 180)),
  ),
  minPatternSymmetryRatio: clampNumber({
    value: config.HEADSHOULDERS_MIN_PATTERN_SYMMETRY_RATIO,
    fallback: 0.25,
    min: 0,
    max: 1,
  }),
  maxNecklineSlopeRatio: clampNumber({
    value: config.HEADSHOULDERS_MAX_NECKLINE_SLOPE_RATIO,
    fallback: 0.5,
    min: 0,
  }),
  maxPatternAgeBars: Math.max(
    4,
    Math.floor(Number(config.HEADSHOULDERS_MAX_PATTERN_AGE_BARS ?? 220)),
  ),
  priorTrendLookback: Math.max(
    1,
    Math.floor(Number(config.HEADSHOULDERS_PRIOR_TREND_LOOKBACK ?? 80)),
  ),
  maxPriorMoveAtr: clampNumber({
    value: config.HEADSHOULDERS_MAX_PRIOR_MOVE_ATR,
    fallback: 0,
    min: 0,
  }),
  minBreakoutDistanceAtr: clampNumber({
    value: config.HEADSHOULDERS_MIN_BREAKOUT_DISTANCE_ATR,
    fallback: 0.05,
    min: 0,
  }),
  maxBreakoutDistanceHeightRatio: clampNumber({
    value: config.HEADSHOULDERS_MAX_BREAKOUT_DISTANCE_HEIGHT_RATIO,
    fallback: 0.35,
    min: 0,
  }),
  maxBreakoutDistancePct: clampNumber({
    value: config.HEADSHOULDERS_MAX_BREAKOUT_DISTANCE_PCT,
    fallback: 0.8,
    min: 0,
  }),
  maxBreakoutDelayBars: Math.max(
    0,
    Math.floor(Number(config.HEADSHOULDERS_MAX_BREAKOUT_DELAY_BARS ?? 0)),
  ),
  requireBreakoutCross: Boolean(config.HEADSHOULDERS_REQUIRE_BREAKOUT_CROSS),
  entryMode: config.HEADSHOULDERS_ENTRY_MODE ?? 'close_acceptance',
  confirmationMaxBars: Math.max(
    1,
    Math.floor(Number(config.HEADSHOULDERS_CONFIRMATION_MAX_BARS ?? 2)),
  ),
  minConfirmationBodyAtr: clampNumber({
    value: config.HEADSHOULDERS_MIN_CONFIRMATION_BODY_ATR,
    fallback: 0,
    min: 0,
  }),
  maxConfirmationCloseLocation: clampNumber({
    value: config.HEADSHOULDERS_MAX_CONFIRMATION_CLOSE_LOCATION,
    fallback: 1,
    min: 0,
    max: 1,
  }),
  confirmationVolumePeriod: Math.max(
    2,
    Math.floor(Number(config.HEADSHOULDERS_CONFIRMATION_VOLUME_PERIOD ?? 20)),
  ),
  minConfirmationVolumeRel: clampNumber({
    value: config.HEADSHOULDERS_MIN_CONFIRMATION_VOLUME_REL,
    fallback: 0,
    min: 0,
  }),
  retestMaxBars: Math.max(
    1,
    Math.floor(Number(config.HEADSHOULDERS_RETEST_MAX_BARS ?? 4)),
  ),
  retestToleranceAtr: clampNumber({
    value: config.HEADSHOULDERS_RETEST_TOLERANCE_ATR,
    fallback: 0.25,
    min: 0,
  }),
});

const calculateAtr = (candles: Candle[], period: number): number | null => {
  const relevant = candles.slice(-(period + 1));
  if (relevant.length < 2) return null;

  const trueRanges: number[] = [];
  for (let index = 1; index < relevant.length; index += 1) {
    const candle = relevant[index];
    const previous = relevant[index - 1];
    const high = asNumber(candle?.high);
    const low = asNumber(candle?.low);
    const previousClose = asNumber(previous?.close);
    if (high == null || low == null || previousClose == null) continue;
    trueRanges.push(
      Math.max(
        high - low,
        Math.abs(high - previousClose),
        Math.abs(low - previousClose),
      ),
    );
  }

  if (trueRanges.length === 0) return null;
  return trueRanges.reduce((sum, value) => sum + value, 0) / trueRanges.length;
};

const pushBoundedCandle = (
  state: Pick<EngineState, 'candles' | 'candleStartIndex' | 'currentIndex'>,
  candle: Candle,
  maxCandles: number,
) => {
  state.currentIndex += 1;
  state.candles.push(candle);
  if (state.candles.length > maxCandles) {
    const overflow = state.candles.length - maxCandles;
    state.candles.splice(0, overflow);
    state.candleStartIndex += overflow;
  }
  return state.currentIndex;
};

const getBufferedCandle = (
  state: Pick<EngineState, 'candles' | 'candleStartIndex'>,
  absoluteIndex: number,
) => state.candles[absoluteIndex - state.candleStartIndex] ?? null;

const calculateAtrAt = ({
  state,
  absoluteIndex,
  period,
}: {
  state: Pick<EngineState, 'candles' | 'candleStartIndex'>;
  absoluteIndex: number;
  period: number;
}): number | null => {
  const trueRanges: number[] = [];
  for (
    let index = absoluteIndex - period + 1;
    index <= absoluteIndex;
    index += 1
  ) {
    const candle = getBufferedCandle(state, index);
    const previous = getBufferedCandle(state, index - 1);
    const high = asNumber(candle?.high);
    const low = asNumber(candle?.low);
    const previousClose = asNumber(previous?.close);
    if (high == null || low == null || previousClose == null) continue;
    trueRanges.push(
      Math.max(
        high - low,
        Math.abs(high - previousClose),
        Math.abs(low - previousClose),
      ),
    );
  }

  if (trueRanges.length === 0) return null;
  return trueRanges.reduce((sum, value) => sum + value, 0) / trueRanges.length;
};

const resolveConfirmedPivot = ({
  state,
  candidateIndex,
  lookback,
  atrPeriod,
  priorTrendLookback,
}: {
  state: Pick<EngineState, 'candles' | 'candleStartIndex'>;
  candidateIndex: number;
  lookback: number;
  atrPeriod: number;
  priorTrendLookback: number;
}): HeadAndShouldersPivot | null => {
  const candidate = getBufferedCandle(state, candidateIndex);
  const high = asNumber(candidate?.high);
  const low = asNumber(candidate?.low);
  if (!candidate || high == null || low == null) return null;

  const window: Candle[] = [];
  for (
    let index = candidateIndex - lookback;
    index <= candidateIndex + lookback;
    index += 1
  ) {
    const candle = getBufferedCandle(state, index);
    if (!candle) return null;
    window.push(candle);
  }

  const otherCandles = window.filter((_, index) => index !== lookback);
  const isHigh =
    otherCandles.every((candle) => high >= Number(candle.high)) &&
    otherCandles.some((candle) => high > Number(candle.high));
  const isLow =
    otherCandles.every((candle) => low <= Number(candle.low)) &&
    otherCandles.some((candle) => low < Number(candle.low));
  if (isHigh === isLow) return null;

  const atr = calculateAtrAt({
    state,
    absoluteIndex: candidateIndex,
    period: atrPeriod,
  });
  const priorClose = asNumber(
    getBufferedCandle(state, candidateIndex - priorTrendLookback)?.close,
  );
  const priorMove =
    priorClose == null ? null : isHigh ? high - priorClose : priorClose - low;

  return {
    timestamp: candidate.timestamp,
    index: candidateIndex,
    value: isHigh ? high : low,
    kind: isHigh ? 'high' : 'low',
    atr,
    priorMoveAtr:
      priorMove != null && atr != null && atr > 0 ? priorMove / atr : null,
  };
};

const recordPivot = (
  state: Pick<EngineState, 'pivots'>,
  pivot: HeadAndShouldersPivot | null,
) => {
  if (!pivot) return;
  const latest = state.pivots[state.pivots.length - 1];
  if (!latest || latest.kind !== pivot.kind) {
    state.pivots.push(pivot);
    if (state.pivots.length > 20) state.pivots.shift();
    return;
  }

  const isMoreExtreme =
    pivot.kind === 'high'
      ? pivot.value >= latest.value
      : pivot.value <= latest.value;
  if (isMoreExtreme) state.pivots[state.pivots.length - 1] = pivot;
};

const lineValueAt = ({
  left,
  right,
  index,
}: {
  left: HeadAndShouldersPivot;
  right: HeadAndShouldersPivot;
  index: number;
}) => {
  const duration = right.index - left.index;
  if (duration <= 0) return left.value;
  return (
    left.value + ((right.value - left.value) / duration) * (index - left.index)
  );
};

const clonePattern = (
  pattern: HeadAndShouldersPattern | null,
): HeadAndShouldersPattern | null =>
  pattern ? { ...pattern, pivots: [...pattern.pivots] } : null;

const clonePending = (
  pending: HeadAndShouldersPendingSetup | null,
): HeadAndShouldersPendingSetup | null =>
  pending
    ? {
        ...pending,
        pattern: clonePattern(pending.pattern) as HeadAndShouldersPattern,
      }
    : null;

const rememberConsumed = (state: EngineState, setupId: string) => {
  if (state.consumedSetupIds.includes(setupId)) return;
  state.consumedSetupIds.push(setupId);
  if (state.consumedSetupIds.length > 64) state.consumedSetupIds.shift();
};

const isBeyondNeckline = (
  direction: Direction,
  close: number,
  neckline: number,
  minimumDistance: number,
) =>
  direction === 'LONG'
    ? close >= neckline + minimumDistance
    : close <= neckline - minimumDistance;

const buildBreakoutPattern = ({
  state,
  candle,
  prevClose,
  atr,
  direction,
  options,
}: {
  state: EngineState;
  candle: Candle;
  prevClose: number | null;
  atr: number | null;
  direction: Direction;
  options: ReturnType<typeof getConfigNumbers>;
}): HeadAndShouldersPattern | null => {
  if (state.pivots.length < 5) return null;
  const pivots = state.pivots.slice(-5) as HeadAndShouldersPattern['pivots'];
  const [leftShoulder, leftNeck, head, rightNeck, rightShoulder] = pivots;
  const expectedKinds =
    direction === 'SHORT'
      ? (['high', 'low', 'high', 'low', 'high'] as const)
      : (['low', 'high', 'low', 'high', 'low'] as const);
  if (pivots.some((pivot, index) => pivot.kind !== expectedKinds[index])) {
    return null;
  }

  const close = asNumber(candle.close);
  if (close == null) return null;
  const necklineAtHead = lineValueAt({
    left: leftNeck,
    right: rightNeck,
    index: head.index,
  });
  const directionMultiplier = direction === 'LONG' ? 1 : -1;
  const headHeight =
    direction === 'LONG'
      ? necklineAtHead - head.value
      : head.value - necklineAtHead;
  if (headHeight <= 0) return null;

  const headHeightPct =
    necklineAtHead !== 0 ? (headHeight / Math.abs(necklineAtHead)) * 100 : 0;
  const headHeightAtr = atr != null && atr > 0 ? headHeight / atr : 0;
  const leftHeadProminence =
    direction === 'LONG'
      ? leftShoulder.value - head.value
      : head.value - leftShoulder.value;
  const rightHeadProminence =
    direction === 'LONG'
      ? rightShoulder.value - head.value
      : head.value - rightShoulder.value;
  const leftHeadProminenceRatio = leftHeadProminence / headHeight;
  const rightHeadProminenceRatio = rightHeadProminence / headHeight;
  const shoulderDifferencePct =
    (Math.abs(leftShoulder.value - rightShoulder.value) / headHeight) * 100;
  if (
    headHeightPct < options.minHeadHeightPct ||
    headHeightAtr < options.minHeadHeightAtr ||
    leftHeadProminenceRatio < options.minHeadProminenceRatio ||
    rightHeadProminenceRatio < options.minHeadProminenceRatio ||
    shoulderDifferencePct > options.shoulderTolerancePct
  ) {
    return null;
  }

  const leftShoulderNeckline = lineValueAt({
    left: leftNeck,
    right: rightNeck,
    index: leftShoulder.index,
  });
  const rightShoulderNeckline = lineValueAt({
    left: leftNeck,
    right: rightNeck,
    index: rightShoulder.index,
  });
  const shouldersRemainOnPatternSide =
    direction === 'LONG'
      ? leftShoulder.value < leftShoulderNeckline &&
        rightShoulder.value < rightShoulderNeckline
      : leftShoulder.value > leftShoulderNeckline &&
        rightShoulder.value > rightShoulderNeckline;
  if (!shouldersRemainOnPatternSide) return null;

  const patternDurationBars = rightShoulder.index - leftShoulder.index;
  const leftHalfBars = head.index - leftShoulder.index;
  const rightHalfBars = rightShoulder.index - head.index;
  const patternSymmetryRatio =
    Math.max(leftHalfBars, rightHalfBars) > 0
      ? Math.min(leftHalfBars, rightHalfBars) /
        Math.max(leftHalfBars, rightHalfBars)
      : 0;
  const patternAgeBars = state.currentIndex - leftShoulder.index;
  const breakoutDelayBars = state.currentIndex - rightShoulder.index;
  const necklineSlopePerBar =
    (rightNeck.value - leftNeck.value) / (rightNeck.index - leftNeck.index);
  const necklineSlopeRatio =
    Math.abs(rightNeck.value - leftNeck.value) / headHeight;
  const priorMoveAtr = leftShoulder.priorMoveAtr ?? null;
  if (
    patternDurationBars < options.minPatternBars ||
    patternDurationBars > options.maxPatternBars ||
    patternSymmetryRatio < options.minPatternSymmetryRatio ||
    necklineSlopeRatio > options.maxNecklineSlopeRatio ||
    patternAgeBars > options.maxPatternAgeBars ||
    (options.maxBreakoutDelayBars > 0 &&
      breakoutDelayBars > options.maxBreakoutDelayBars) ||
    (options.maxPriorMoveAtr > 0 &&
      (priorMoveAtr == null || priorMoveAtr > options.maxPriorMoveAtr))
  ) {
    return null;
  }

  const neckline = lineValueAt({
    left: leftNeck,
    right: rightNeck,
    index: state.currentIndex,
  });
  const breakoutDistance = Math.abs(close - neckline);
  const breakoutDistancePct =
    neckline !== 0 ? (breakoutDistance / Math.abs(neckline)) * 100 : 0;
  const breakoutDistanceAtr =
    atr != null && atr > 0 ? breakoutDistance / atr : 0;
  const breakoutDistanceHeightRatio = breakoutDistance / headHeight;
  if (
    !isBeyondNeckline(direction, close, neckline, 0) ||
    breakoutDistanceAtr < options.minBreakoutDistanceAtr ||
    (options.maxBreakoutDistanceHeightRatio > 0 &&
      breakoutDistanceHeightRatio > options.maxBreakoutDistanceHeightRatio) ||
    (options.maxBreakoutDistancePct > 0 &&
      breakoutDistancePct > options.maxBreakoutDistancePct)
  ) {
    return null;
  }

  const previousNeckline = lineValueAt({
    left: leftNeck,
    right: rightNeck,
    index: state.currentIndex - 1,
  });
  const breakoutCrossedOnSignalBar =
    prevClose != null &&
    (direction === 'LONG'
      ? prevClose <= previousNeckline && close > neckline
      : prevClose >= previousNeckline && close < neckline);
  if (options.requireBreakoutCross && !breakoutCrossedOnSignalBar) return null;

  const kind: HeadAndShouldersPatternKind =
    direction === 'LONG' ? 'inverse_head_and_shoulders' : 'head_and_shoulders';
  const setupId = `${kind}:${pivots.map((pivot) => pivot.timestamp).join(':')}`;
  if (state.consumedSetupIds.includes(setupId)) return null;

  return {
    setupId,
    kind,
    direction,
    entryMode: options.entryMode,
    entryStage: 'breakout',
    pivots,
    neckline,
    necklineSlopePerBar,
    targetPrice:
      neckline +
      directionMultiplier * headHeight * (options.targetHeightPct / 100),
    stopLossPrice:
      head.value -
      directionMultiplier * headHeight * (options.stopBufferHeightPct / 100),
    headHeight,
    headHeightPct,
    headHeightAtr,
    shoulderDifferencePct,
    leftHeadProminenceRatio,
    rightHeadProminenceRatio,
    patternDurationBars,
    patternSymmetryRatio,
    patternAgeBars,
    necklineSlopeRatio,
    priorMoveAtr,
    breakoutDistancePct,
    breakoutDistanceAtr,
    breakoutDistanceHeightRatio,
    breakoutDelayBars,
    breakoutCrossedOnSignalBar,
    breakoutTimestamp: candle.timestamp,
    confirmationBars: 0,
    confirmationBodyAtr: null,
    confirmationCloseLocation: null,
    confirmationVolumeRel: null,
    timestamp: candle.timestamp,
    close,
  };
};

const getPatternNecklineAt = (
  pattern: HeadAndShouldersPattern,
  index: number,
) => {
  const leftNeck = pattern.pivots[1];
  return (
    leftNeck.value + pattern.necklineSlopePerBar * (index - leftNeck.index)
  );
};

const resolvePending = ({
  state,
  candle,
  atr,
  options,
}: {
  state: EngineState;
  candle: Candle;
  atr: number | null;
  options: ReturnType<typeof getConfigNumbers>;
}): HeadAndShouldersPattern | null => {
  const pending = state.pending;
  if (!pending) return null;
  const confirmationBars = state.currentIndex - pending.breakoutIndex;
  if (confirmationBars < 1) return null;

  const close = asNumber(candle.close);
  const open = asNumber(candle.open);
  const high = asNumber(candle.high);
  const low = asNumber(candle.low);
  if (close == null || open == null || high == null || low == null) return null;

  const pattern = pending.pattern;
  const invalidated =
    pattern.direction === 'LONG'
      ? low <= pattern.stopLossPrice
      : high >= pattern.stopLossPrice;
  const maxBars =
    pending.mode === 'retest'
      ? options.retestMaxBars
      : options.confirmationMaxBars;
  if (invalidated || confirmationBars > maxBars) {
    rememberConsumed(state, pending.setupId);
    state.pending = null;
    return null;
  }

  const neckline = getPatternNecklineAt(pattern, state.currentIndex);
  const effectiveAtr = atr != null && atr > 0 ? atr : pattern.headHeight;
  const minimumDistance = effectiveAtr * options.minBreakoutDistanceAtr;
  const closeAccepted = isBeyondNeckline(
    pattern.direction,
    close,
    neckline,
    minimumDistance,
  );
  const confirmationBody =
    pattern.direction === 'LONG' ? close - open : open - close;
  const confirmationBodyAtr =
    effectiveAtr > 0 ? confirmationBody / effectiveAtr : 0;
  const candleRange = high - low;
  const confirmationCloseLocation =
    candleRange > 0
      ? pattern.direction === 'LONG'
        ? (high - close) / candleRange
        : (close - low) / candleRange
      : 1;
  const priorVolumeCandles = state.candles.slice(
    -(options.confirmationVolumePeriod + 1),
    -1,
  );
  const priorVolumes = priorVolumeCandles
    .map((item) => asNumber(item.volume))
    .filter((value): value is number => value != null && value >= 0);
  const averagePriorVolume =
    priorVolumes.length > 0
      ? priorVolumes.reduce((sum, value) => sum + value, 0) /
        priorVolumes.length
      : null;
  const currentVolume = asNumber(candle.volume);
  const confirmationVolumeRel =
    currentVolume != null &&
    averagePriorVolume != null &&
    averagePriorVolume > 0
      ? currentVolume / averagePriorVolume
      : null;
  const confirmationQualityAccepted =
    (options.minConfirmationBodyAtr <= 0 ||
      confirmationBodyAtr >= options.minConfirmationBodyAtr) &&
    confirmationCloseLocation <= options.maxConfirmationCloseLocation &&
    (options.minConfirmationVolumeRel <= 0 ||
      (confirmationVolumeRel != null &&
        confirmationVolumeRel >= options.minConfirmationVolumeRel));
  let entryStage: HeadAndShouldersEntryStage | null = null;

  if (pending.mode === 'close_acceptance') {
    if (closeAccepted && confirmationQualityAccepted) {
      entryStage = 'close_accepted';
    }
  } else {
    const tolerance = effectiveAtr * options.retestToleranceAtr;
    const touched =
      pattern.direction === 'LONG'
        ? low <= neckline + tolerance && low >= neckline - tolerance
        : high >= neckline - tolerance && high <= neckline + tolerance;
    if (touched && closeAccepted && confirmationQualityAccepted) {
      entryStage = 'retest_held';
    }
  }

  if (!entryStage) return null;
  rememberConsumed(state, pending.setupId);
  state.pending = null;
  return {
    ...pattern,
    entryStage,
    neckline,
    confirmationBars,
    confirmationBodyAtr,
    confirmationCloseLocation,
    confirmationVolumeRel,
    timestamp: candle.timestamp,
    close,
  };
};

export const buildHeadAndShouldersSignalContext = (
  pattern: HeadAndShouldersPattern,
) => ({
  setupId: pattern.setupId,
  patternKind: pattern.kind,
  signalDirection: pattern.direction,
  entryMode: pattern.entryMode,
  entryStage: pattern.entryStage,
  neckline: pattern.neckline,
  necklineSlopePerBar: pattern.necklineSlopePerBar,
  targetPrice: pattern.targetPrice,
  stopLossPrice: pattern.stopLossPrice,
  headHeight: pattern.headHeight,
  headHeightPct: pattern.headHeightPct,
  headHeightAtr: pattern.headHeightAtr,
  shoulderDifferencePct: pattern.shoulderDifferencePct,
  leftHeadProminenceRatio: pattern.leftHeadProminenceRatio,
  rightHeadProminenceRatio: pattern.rightHeadProminenceRatio,
  patternDurationBars: pattern.patternDurationBars,
  patternSymmetryRatio: pattern.patternSymmetryRatio,
  patternAgeBars: pattern.patternAgeBars,
  necklineSlopeRatio: pattern.necklineSlopeRatio,
  priorMoveAtr: pattern.priorMoveAtr,
  breakoutDistancePct: pattern.breakoutDistancePct,
  breakoutDistanceAtr: pattern.breakoutDistanceAtr,
  breakoutDistanceHeightRatio: pattern.breakoutDistanceHeightRatio,
  breakoutDelayBars: pattern.breakoutDelayBars,
  breakoutCrossedOnSignalBar: pattern.breakoutCrossedOnSignalBar,
  breakoutTimestamp: pattern.breakoutTimestamp,
  confirmationBars: pattern.confirmationBars,
  confirmationBodyAtr: pattern.confirmationBodyAtr,
  confirmationCloseLocation: pattern.confirmationCloseLocation,
  confirmationVolumeRel: pattern.confirmationVolumeRel,
  currentPrice: pattern.close,
  pivots: pattern.pivots.map(({ timestamp, value, kind }) => ({
    timestamp,
    value,
    kind,
  })),
});

export type HeadAndShouldersSignalContext = ReturnType<
  typeof buildHeadAndShouldersSignalContext
>;

export const createHeadAndShouldersEngine = ({
  config,
  initialCandles = [],
}: {
  config: HeadAndShouldersConfig;
  initialCandles?: Candle[];
}): {
  next: (candle: Candle) => HeadAndShouldersRuntimeState;
  getState: () => HeadAndShouldersRuntimeState;
} => {
  const options = getConfigNumbers(config);
  const state: EngineState = {
    candles: [],
    candleStartIndex: 0,
    currentIndex: -1,
    pivots: [],
    pattern: null,
    pending: null,
    consumedSetupIds: [],
    lastTimestamp: null,
  };

  const snapshot = (): HeadAndShouldersRuntimeState => ({
    pattern: clonePattern(state.pattern),
    pending: clonePending(state.pending),
    pivots: state.pivots.map((pivot) => ({ ...pivot })),
  });

  const apply = (candle: Candle): HeadAndShouldersRuntimeState => {
    if (state.lastTimestamp === candle.timestamp) return snapshot();
    state.lastTimestamp = candle.timestamp;
    state.pattern = null;

    const previous = state.candles[state.candles.length - 1];
    const prevClose = previous ? asNumber(previous.close) : null;
    const maxCandles = Math.max(
      options.pivotLookback * 2 + 1,
      options.atrPeriod + 1,
      options.priorTrendLookback + options.pivotLookback + 1,
      options.confirmationVolumePeriod + 1,
    );
    const currentIndex = pushBoundedCandle(state, candle, maxCandles);
    const atr = calculateAtr(state.candles, options.atrPeriod);
    const pendingPattern = resolvePending({ state, candle, atr, options });

    recordPivot(
      state,
      resolveConfirmedPivot({
        state,
        candidateIndex: currentIndex - options.pivotLookback,
        lookback: options.pivotLookback,
        atrPeriod: options.atrPeriod,
        priorTrendLookback: options.priorTrendLookback,
      }),
    );

    if (pendingPattern) {
      state.pattern = pendingPattern;
      return snapshot();
    }
    if (state.pending) return snapshot();

    const breakout =
      buildBreakoutPattern({
        state,
        candle,
        prevClose,
        atr,
        direction: 'SHORT',
        options,
      }) ??
      buildBreakoutPattern({
        state,
        candle,
        prevClose,
        atr,
        direction: 'LONG',
        options,
      });
    if (!breakout) return snapshot();

    if (options.entryMode === 'breakout') {
      rememberConsumed(state, breakout.setupId);
      state.pattern = breakout;
      return snapshot();
    }

    state.pending = {
      setupId: breakout.setupId,
      mode: options.entryMode,
      stage:
        options.entryMode === 'retest' ? 'retest_pending' : 'neckline_crossed',
      breakoutIndex: currentIndex,
      pattern: breakout,
    };
    return snapshot();
  };

  for (const candle of initialCandles) apply(candle);

  return { next: apply, getState: snapshot };
};
