import { KLineData } from 'klinecharts';
import { TrendLine, TrendLineOptions } from '@tradejs/types';
import { TRENDLINE_DEFAULTS } from '../../constants';
import { toMs } from '../timestamp';

type Point = { x: number; y: number; t: number };

export type TrendlineEngine = {
  next: (candle: KLineData) => TrendLine[];
  nextMany: (candles: KLineData[]) => TrendLine[];
  reset: () => void;
  getLines: () => TrendLine[];
};

type LineRuntime = {
  leftAnchor: Point;
  rightAnchor: Point;
  distance: number;
  evaluateY: (t: number) => number;

  touchIndices: number[];

  captureHitIndices: number[];
  invalid: boolean;
};

type PairCache = {
  distance: number;
  evaluateY: (t: number) => number;
  touchIndices: number[];
  touchCount: number;
  touchSpan: number;
  hasTouchGap: boolean;
  wickBreached: boolean;
};

const DEFAULTS = TRENDLINE_DEFAULTS;

const toleranceAt = (lineY: number, epsilonPct: number) =>
  Math.max(0, Math.abs(lineY) * epsilonPct);

type EpsilonResolver = (barIndex: number) => number;

const normalizePositiveNumber = (value: number, fallback: number) =>
  Number.isFinite(value) && value > 0 ? value : fallback;

const normalizePositiveInteger = (value: number, fallback: number) =>
  Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : fallback;

const clampEpsilon = (value: number, min: number, max: number) => {
  let nextValue = value;
  if (Number.isFinite(min) && min > 0) nextValue = Math.max(nextValue, min);
  if (Number.isFinite(max) && max > 0) nextValue = Math.min(nextValue, max);
  return nextValue;
};

const createEpsilonResolver = (params: {
  mode: TrendLineOptions['epsilonMode'];
  baseEpsilon: number;
  getAtrFraction: (barIndex: number) => number | undefined;
  atrMultiplier: number;
  min: number;
  max: number;
}): EpsilonResolver => {
  const baseEpsilon = normalizePositiveNumber(params.baseEpsilon, 0);
  if (params.mode !== 'atr') return () => baseEpsilon;

  const atrMultiplier = normalizePositiveNumber(params.atrMultiplier, 1);

  return (barIndex: number) => {
    const atrFraction = params.getAtrFraction(barIndex);
    const rawEpsilon =
      Number.isFinite(atrFraction) && Number(atrFraction) > 0
        ? Number(atrFraction) * atrMultiplier
        : baseEpsilon;

    return clampEpsilon(rawEpsilon, params.min, params.max);
  };
};

const buildLineEvaluator = (params: {
  t1: number;
  y1: number;
  t2: number;
  y2: number;
}) => {
  const { t1, y1, t2, y2 } = params;
  const deltaTime = t2 - t1;
  if (deltaTime === 0) return (_timeMs: number) => y1;
  const slope = (y2 - y1) / deltaTime;
  return (timeMs: number) => y1 + slope * (timeMs - t1);
};

const buildAlphaSeries = (params: {
  timestampsMs: number[];
  closeSeries: number[];
  evaluateY: (t: number) => number;
  window: number;
}): number[] => {
  const { timestampsMs, closeSeries, evaluateY, window } = params;
  if (!timestampsMs.length || !closeSeries.length) return [];
  const startIndex = Math.max(0, timestampsMs.length - window);
  const result: number[] = [];
  for (let i = startIndex; i < timestampsMs.length; i++) {
    const close = closeSeries[i];
    if (!Number.isFinite(close) || close == 0) {
      result.push(0);
      continue;
    }
    const lineY = evaluateY(timestampsMs[i]);
    result.push(lineY / close);
  }
  return result;
};

const hasTooLargeTouchGaps = (touchIndices: number[], maxTouchGap: number) => {
  if (!Number.isFinite(maxTouchGap) || maxTouchGap <= 0) return false;
  if (touchIndices.length < 2) return true;

  for (let index = 1; index < touchIndices.length; index++) {
    if (touchIndices[index] - touchIndices[index - 1] > maxTouchGap)
      return true;
  }
  return false;
};

const collectTouchIndices = (params: {
  bodySeriesForTouches: number[];
  timestampsMs: number[];
  startIndex: number;
  endIndex: number;
  evaluateY: (t: number) => number;
  epsilonAtIndex: EpsilonResolver;
  minTouchGap: number;
}): number[] => {
  const {
    bodySeriesForTouches,
    timestampsMs,
    startIndex,
    endIndex,
    evaluateY,
    epsilonAtIndex,
    minTouchGap,
  } = params;

  const touchIndices: number[] = [];
  let lastTouchIndex = -Infinity;

  for (let barIndex = startIndex; barIndex <= endIndex; barIndex++) {
    const lineY = evaluateY(timestampsMs[barIndex]);
    const tolerance = toleranceAt(lineY, epsilonAtIndex(barIndex));
    const bodyValue = bodySeriesForTouches[barIndex];

    if (Math.abs(bodyValue - lineY) <= tolerance) {
      if (
        touchIndices.length === 0 ||
        barIndex - lastTouchIndex >= minTouchGap
      ) {
        touchIndices.push(barIndex);
        lastTouchIndex = barIndex;
      }
    }
  }

  return touchIndices;
};

const hasCloseBreachInRange = (params: {
  mode: TrendLine['mode'];
  closeSeries: number[];
  timestampsMs: number[];
  startIndex: number;
  endIndex: number;
  evaluateY: (t: number) => number;
  epsilonAtIndex: EpsilonResolver;
}): boolean => {
  const {
    mode,
    closeSeries,
    timestampsMs,
    startIndex,
    endIndex,
    evaluateY,
    epsilonAtIndex,
  } = params;
  if (startIndex > endIndex) return false;

  for (let barIndex = startIndex; barIndex <= endIndex; barIndex++) {
    const lineY = evaluateY(timestampsMs[barIndex]);
    const tolerance = toleranceAt(lineY, epsilonAtIndex(barIndex));
    const closePrice = closeSeries[barIndex];

    if (mode === 'lows') {
      if (closePrice < lineY - tolerance) return true;
    } else {
      if (closePrice > lineY + tolerance) return true;
    }
  }

  return false;
};

/* ================= Block min/max for wick breach (two-phase) ================= */

const BLOCK_SIZE = 64;
const getBlockIndex = (barIndex: number) => Math.floor(barIndex / BLOCK_SIZE);

type BlockStats = {
  lowBlockMins: number[];
  highBlockMaxs: number[];
  epsilonBlockMins: number[];
};

const ensureBlockValue = (
  arr: number[],
  blockIndex: number,
  initial: number,
) => {
  while (arr.length <= blockIndex) arr.push(initial);
};

const updateBlockStats = (
  stats: BlockStats,
  barIndex: number,
  lowValue: number,
  highValue: number,
  epsilonValue: number,
) => {
  const blockIndex = getBlockIndex(barIndex);

  ensureBlockValue(stats.lowBlockMins, blockIndex, Number.POSITIVE_INFINITY);
  ensureBlockValue(stats.highBlockMaxs, blockIndex, Number.NEGATIVE_INFINITY);
  ensureBlockValue(
    stats.epsilonBlockMins,
    blockIndex,
    Number.POSITIVE_INFINITY,
  );

  stats.lowBlockMins[blockIndex] = Math.min(
    stats.lowBlockMins[blockIndex],
    lowValue,
  );
  stats.highBlockMaxs[blockIndex] = Math.max(
    stats.highBlockMaxs[blockIndex],
    highValue,
  );
  stats.epsilonBlockMins[blockIndex] = Math.min(
    stats.epsilonBlockMins[blockIndex],
    epsilonValue,
  );
};

const hasWickBreachOnSegmentFast = (params: {
  mode: TrendLine['mode'];
  lowSeries: number[];
  highSeries: number[];
  timestampsMs: number[];
  startIndex: number;
  endIndex: number;
  evaluateY: (t: number) => number;
  epsilonAtIndex: EpsilonResolver;
  blockStats: BlockStats;
  useDynamicEpsilon: boolean;
}): boolean => {
  const {
    mode,
    lowSeries,
    highSeries,
    timestampsMs,
    startIndex,
    endIndex,
    evaluateY,
    epsilonAtIndex,
    blockStats,
    useDynamicEpsilon,
  } = params;

  if (startIndex > endIndex) return false;

  const scanBarsPrecisely = (fromIndex: number, toIndex: number) => {
    for (let barIndex = fromIndex; barIndex <= toIndex; barIndex++) {
      const lineY = evaluateY(timestampsMs[barIndex]);
      const tolerance = toleranceAt(lineY, epsilonAtIndex(barIndex));

      if (mode === 'lows') {
        if (lowSeries[barIndex] < lineY - tolerance) return true;
      } else {
        if (highSeries[barIndex] > lineY + tolerance) return true;
      }
    }
    return false;
  };

  const startBlockIndex = getBlockIndex(startIndex);
  const endBlockIndex = getBlockIndex(endIndex);

  if (startBlockIndex === endBlockIndex)
    return scanBarsPrecisely(startIndex, endIndex);

  const firstBlockEndIndex = (startBlockIndex + 1) * BLOCK_SIZE - 1;
  if (scanBarsPrecisely(startIndex, Math.min(firstBlockEndIndex, endIndex)))
    return true;

  const lastBlockStartIndex = endBlockIndex * BLOCK_SIZE;
  if (scanBarsPrecisely(Math.max(lastBlockStartIndex, startIndex), endIndex))
    return true;

  for (
    let blockIndex = startBlockIndex + 1;
    blockIndex <= endBlockIndex - 1;
    blockIndex++
  ) {
    const blockStartIndex = blockIndex * BLOCK_SIZE;
    const blockEndIndex = blockStartIndex + BLOCK_SIZE - 1;

    const startTimestamp = timestampsMs[blockStartIndex];
    const endTimestamp = timestampsMs[blockEndIndex];

    const startLineY = evaluateY(startTimestamp);
    const endLineY = evaluateY(endTimestamp);

    // Dynamic epsilon is not linear inside the block; use a conservative bound
    // and fall back to exact scanning when the shortcut cannot prove safety.
    if (mode === 'lows') {
      let maxThresholdInBlock: number;

      if (useDynamicEpsilon) {
        const blockEpsilonMin = blockStats.epsilonBlockMins[blockIndex];
        if (
          !Number.isFinite(blockEpsilonMin) ||
          blockEpsilonMin < 0 ||
          startLineY <= 0 ||
          endLineY <= 0
        ) {
          if (scanBarsPrecisely(blockStartIndex, blockEndIndex)) return true;
          continue;
        }
        const maxLineYInBlock = Math.max(startLineY, endLineY);
        maxThresholdInBlock =
          maxLineYInBlock - toleranceAt(maxLineYInBlock, blockEpsilonMin);
      } else {
        const startThreshold =
          startLineY - toleranceAt(startLineY, epsilonAtIndex(blockStartIndex));
        const endThreshold =
          endLineY - toleranceAt(endLineY, epsilonAtIndex(blockEndIndex));
        maxThresholdInBlock = Math.max(startThreshold, endThreshold);
      }

      const blockLowMin = blockStats.lowBlockMins[blockIndex];
      if (blockLowMin >= maxThresholdInBlock) continue;

      if (scanBarsPrecisely(blockStartIndex, blockEndIndex)) return true;
    } else {
      let minThresholdInBlock: number;

      if (useDynamicEpsilon) {
        const blockEpsilonMin = blockStats.epsilonBlockMins[blockIndex];
        if (
          !Number.isFinite(blockEpsilonMin) ||
          blockEpsilonMin < 0 ||
          startLineY <= 0 ||
          endLineY <= 0
        ) {
          if (scanBarsPrecisely(blockStartIndex, blockEndIndex)) return true;
          continue;
        }
        const minLineYInBlock = Math.min(startLineY, endLineY);
        minThresholdInBlock =
          minLineYInBlock + toleranceAt(minLineYInBlock, blockEpsilonMin);
      } else {
        const startThreshold =
          startLineY + toleranceAt(startLineY, epsilonAtIndex(blockStartIndex));
        const endThreshold =
          endLineY + toleranceAt(endLineY, epsilonAtIndex(blockEndIndex));
        minThresholdInBlock = Math.min(startThreshold, endThreshold);
      }

      const blockHighMax = blockStats.highBlockMaxs[blockIndex];
      if (blockHighMax <= minThresholdInBlock) continue;

      if (scanBarsPrecisely(blockStartIndex, blockEndIndex)) return true;
    }
  }

  return false;
};

/* ================= Engine ================= */

export const createTrendlineEngine = (
  initialCandles: KLineData[],
  options: TrendLineOptions,
): TrendlineEngine => {
  const opts: Required<TrendLineOptions> = {
    mode: options.mode,
    maxLines: options.maxLines ?? DEFAULTS.maxLines,
    range: options.range ?? DEFAULTS.range,
    firstRange: options.firstRange ?? DEFAULTS.firstRange,
    epsilon: options.epsilon ?? DEFAULTS.epsilon,
    epsilonOffset: options.epsilonOffset ?? DEFAULTS.epsilonOffset,
    epsilonMode: options.epsilonMode ?? DEFAULTS.epsilonMode,
    epsilonAtrPeriod: normalizePositiveInteger(
      options.epsilonAtrPeriod ?? DEFAULTS.epsilonAtrPeriod,
      DEFAULTS.epsilonAtrPeriod,
    ),
    epsilonAtrMultiplier:
      options.epsilonAtrMultiplier ?? DEFAULTS.epsilonAtrMultiplier,
    epsilonOffsetAtrMultiplier:
      options.epsilonOffsetAtrMultiplier ?? DEFAULTS.epsilonOffsetAtrMultiplier,
    epsilonMin: options.epsilonMin ?? DEFAULTS.epsilonMin,
    epsilonMax: options.epsilonMax ?? DEFAULTS.epsilonMax,
    epsilonOffsetMin: options.epsilonOffsetMin ?? DEFAULTS.epsilonOffsetMin,
    epsilonOffsetMax: options.epsilonOffsetMax ?? DEFAULTS.epsilonOffsetMax,
    minTouches: options.minTouches ?? DEFAULTS.minTouches,
    minDistance: options.minDistance ?? DEFAULTS.minDistance,
    minTouchGap: options.minTouchGap ?? DEFAULTS.minTouchGap,
    maxTouchGap: options.maxTouchGap ?? DEFAULTS.maxTouchGap,
    offset: options.offset ?? DEFAULTS.offset,
    capture: options.capture ?? DEFAULTS.capture,
    bestLines: options.bestLines ?? DEFAULTS.bestLines,
    maxDistance: options.maxDistance ?? DEFAULTS.maxDistance,
  } as Required<TrendLineOptions>;

  let timestampsMs: number[] = [];
  let closeSeries: number[] = [];
  let lowSeries: number[] = [];
  let highSeries: number[] = [];
  let shadowSeries: number[] = [];
  let trueRangeSeries: number[] = [];
  let atrFractionSeries: number[] = [];
  let atrRollingSum = 0;

  const useDynamicEpsilon = opts.epsilonMode === 'atr';
  const epsilonAtIndex = createEpsilonResolver({
    mode: opts.epsilonMode,
    baseEpsilon: opts.epsilon,
    getAtrFraction: (barIndex) => atrFractionSeries[barIndex],
    atrMultiplier: opts.epsilonAtrMultiplier,
    min: opts.epsilonMin,
    max: opts.epsilonMax,
  });
  const epsilonOffsetAtIndex = createEpsilonResolver({
    mode: opts.epsilonMode,
    baseEpsilon: opts.epsilonOffset,
    getAtrFraction: (barIndex) => atrFractionSeries[barIndex],
    atrMultiplier: opts.epsilonOffsetAtrMultiplier,
    min: opts.epsilonOffsetMin,
    max: opts.epsilonOffsetMax,
  });

  const firstRangeWindowSize = 2 * opts.firstRange + 1;
  let lowFirstDeque: number[] = [];
  let highFirstDeque: number[] = [];
  let lowFirstCenter: number[] = [];
  let highFirstCenter: number[] = [];

  const blockStats: BlockStats = {
    lowBlockMins: [],
    highBlockMaxs: [],
    epsilonBlockMins: [],
  };

  let extremaDeque: number[] = [];
  let rawExtremaPoints: Point[] = [];

  let clusteredAnchors: Point[] = [];
  let currentClusterBest: Point | null = null;
  let lastRawExtremum: Point | null = null;

  let activeLines: LineRuntime[] = [];
  let pairCache = new Map<string, PairCache>();
  const MAX_PAIR_CACHE = 5000;

  const resetState = () => {
    timestampsMs = [];
    closeSeries = [];
    lowSeries = [];
    highSeries = [];
    shadowSeries = [];
    trueRangeSeries = [];
    atrFractionSeries = [];
    atrRollingSum = 0;

    blockStats.lowBlockMins = [];
    blockStats.highBlockMaxs = [];
    blockStats.epsilonBlockMins = [];

    extremaDeque = [];
    rawExtremaPoints = [];

    lowFirstDeque = [];
    highFirstDeque = [];
    lowFirstCenter = [];
    highFirstCenter = [];

    clusteredAnchors = [];
    currentClusterBest = null;
    lastRawExtremum = null;

    activeLines = [];
    pairCache.clear();
  };

  const updateExtremaDeque = (barIndex: number) => {
    const windowSize = 2 * opts.range + 1;
    const findMin = opts.mode === 'lows';

    const isBetter = findMin
      ? (leftValue: number, rightValue: number) => leftValue <= rightValue
      : (leftValue: number, rightValue: number) => leftValue >= rightValue;

    while (
      extremaDeque.length > 0 &&
      !isBetter(
        shadowSeries[extremaDeque[extremaDeque.length - 1]],
        shadowSeries[barIndex],
      )
    ) {
      extremaDeque.pop();
    }

    extremaDeque.push(barIndex);

    const startIndex = barIndex - windowSize + 1;
    while (extremaDeque.length > 0 && extremaDeque[0] < startIndex) {
      extremaDeque.shift();
    }
  };

  const isStrongFirstAnchorFast = (anchorIndex: number) => {
    const lastBarIndex = lowSeries.length - 1;
    const startIndex = Math.max(0, anchorIndex - opts.firstRange);
    const endIndex = Math.min(lastBarIndex, anchorIndex + opts.firstRange);
    const canUseCenter =
      anchorIndex - opts.firstRange >= 0 &&
      anchorIndex + opts.firstRange <= lastBarIndex;

    if (opts.mode === 'lows') {
      if (canUseCenter && Number.isFinite(lowFirstCenter[anchorIndex])) {
        return lowSeries[anchorIndex] === lowFirstCenter[anchorIndex];
      }
      let windowMin = Number.POSITIVE_INFINITY;
      for (let i = startIndex; i <= endIndex; i++) {
        if (lowSeries[i] < windowMin) windowMin = lowSeries[i];
      }
      return lowSeries[anchorIndex] === windowMin;
    }

    if (canUseCenter && Number.isFinite(highFirstCenter[anchorIndex])) {
      return highSeries[anchorIndex] === highFirstCenter[anchorIndex];
    }
    let windowMax = Number.NEGATIVE_INFINITY;
    for (let i = startIndex; i <= endIndex; i++) {
      if (highSeries[i] > windowMax) windowMax = highSeries[i];
    }
    return highSeries[anchorIndex] === windowMax;
  };

  const updateFirstRangeExtrema = (barIndex: number) => {
    if (firstRangeWindowSize <= 1) return;

    while (
      lowFirstDeque.length > 0 &&
      lowSeries[lowFirstDeque[lowFirstDeque.length - 1]] >= lowSeries[barIndex]
    ) {
      lowFirstDeque.pop();
    }
    lowFirstDeque.push(barIndex);

    while (
      highFirstDeque.length > 0 &&
      highSeries[highFirstDeque[highFirstDeque.length - 1]] <=
        highSeries[barIndex]
    ) {
      highFirstDeque.pop();
    }
    highFirstDeque.push(barIndex);

    const startIndex = barIndex - firstRangeWindowSize + 1;
    while (lowFirstDeque.length > 0 && lowFirstDeque[0] < startIndex) {
      lowFirstDeque.shift();
    }
    while (highFirstDeque.length > 0 && highFirstDeque[0] < startIndex) {
      highFirstDeque.shift();
    }

    if (startIndex >= 0) {
      const centerIndex = barIndex - opts.firstRange;
      lowFirstCenter[centerIndex] = lowSeries[lowFirstDeque[0]];
      highFirstCenter[centerIndex] = highSeries[highFirstDeque[0]];
    }
  };

  const getPairCache = (leftAnchor: Point, rightAnchor: Point): PairCache => {
    const key = `${leftAnchor.x}|${rightAnchor.x}`;
    const cached = pairCache.get(key);
    if (cached) return cached;

    const evaluateY = buildLineEvaluator({
      t1: leftAnchor.t,
      y1: leftAnchor.y,
      t2: rightAnchor.t,
      y2: rightAnchor.y,
    });

    const touchIndices = collectTouchIndices({
      bodySeriesForTouches: shadowSeries,
      timestampsMs,
      startIndex: leftAnchor.x,
      endIndex: rightAnchor.x,
      evaluateY,
      epsilonAtIndex,
      minTouchGap: opts.minTouchGap,
    });

    const touchCount = touchIndices.length;
    const touchSpan =
      touchCount > 1 ? touchIndices[touchCount - 1] - touchIndices[0] : 0;

    const lastTouches = touchCount > 2 ? touchIndices.slice(-2) : touchIndices;
    const hasTouchGap = hasTooLargeTouchGaps(
      [...lastTouches, rightAnchor.x],
      opts.maxTouchGap,
    );

    const wickBreached = hasWickBreachOnSegmentFast({
      mode: opts.mode,
      lowSeries,
      highSeries,
      timestampsMs,
      startIndex: leftAnchor.x,
      endIndex: rightAnchor.x,
      evaluateY,
      epsilonAtIndex,
      blockStats,
      useDynamicEpsilon,
    });

    const entry: PairCache = {
      distance: rightAnchor.x - leftAnchor.x,
      evaluateY,
      touchIndices,
      touchCount,
      touchSpan,
      hasTouchGap,
      wickBreached,
    };

    if (pairCache.size > MAX_PAIR_CACHE) {
      pairCache.clear();
    }
    pairCache.set(key, entry);
    return entry;
  };

  const rebuildCandidatesLikeBatch = () => {
    const anchors =
      currentClusterBest != null
        ? [...clusteredAnchors, currentClusterBest]
        : clusteredAnchors;
    const anchorsLength = anchors.length;
    const lastBarIndex = timestampsMs.length - 1;

    if (lastBarIndex < 0) {
      activeLines = [];
      return;
    }

    if (
      rawExtremaPoints.length < opts.minTouches ||
      anchorsLength < opts.minTouches
    ) {
      activeLines = [];
      return;
    }

    const candidates: LineRuntime[] = [];
    const anchorXs = anchors.map((pt) => pt.x);

    const lowerBound = (arr: number[], value: number) => {
      let left = 0;
      let right = arr.length;
      while (left < right) {
        const mid = (left + right) >> 1;
        if (arr[mid] < value) left = mid + 1;
        else right = mid;
      }
      return left;
    };

    const upperBound = (arr: number[], value: number) => {
      let left = 0;
      let right = arr.length;
      while (left < right) {
        const mid = (left + right) >> 1;
        if (arr[mid] <= value) left = mid + 1;
        else right = mid;
      }
      return left - 1;
    };

    for (
      let rightAnchorIndex = anchorsLength - 1;
      rightAnchorIndex >= 0;
      rightAnchorIndex--
    ) {
      const rightAnchor = anchors[rightAnchorIndex];
      const rightX = rightAnchor.x;
      const leftMinX = rightX - opts.maxDistance;
      const leftMaxX = rightX - opts.minDistance;

      let leftStart = lowerBound(anchorXs, leftMinX);
      let leftEnd = upperBound(anchorXs, leftMaxX);

      if (leftEnd >= rightAnchorIndex) leftEnd = rightAnchorIndex - 1;
      if (leftStart > leftEnd) continue;

      for (
        let leftAnchorIndex = leftEnd;
        leftAnchorIndex >= leftStart;
        leftAnchorIndex--
      ) {
        if (candidates.length >= opts.maxLines) break;

        const leftAnchor = anchors[leftAnchorIndex];
        const distance = rightAnchor.x - leftAnchor.x;

        if (distance < opts.minDistance) continue;
        if (distance > opts.maxDistance) break;

        if (!isStrongFirstAnchorFast(leftAnchor.x)) continue;

        const slope =
          (rightAnchor.y - leftAnchor.y) / (rightAnchor.x - leftAnchor.x);
        if (opts.mode === 'lows' && slope <= 0) continue;
        if (opts.mode === 'highs' && slope >= 0) continue;

        const cached = getPairCache(leftAnchor, rightAnchor);

        if (cached.touchCount < opts.minTouches) continue;
        if (cached.hasTouchGap) continue;
        if (cached.touchSpan < opts.minDistance) continue;
        if (cached.wickBreached) continue;

        const closeBreachEndIndex = lastBarIndex - Math.max(0, opts.offset);
        const closeBreachStartIndex = rightAnchor.x + 1;

        if (closeBreachStartIndex <= closeBreachEndIndex) {
          const closeBreached = hasCloseBreachInRange({
            mode: opts.mode,
            closeSeries,
            timestampsMs,
            startIndex: closeBreachStartIndex,
            endIndex: closeBreachEndIndex,
            evaluateY: cached.evaluateY,
            epsilonAtIndex,
          });

          if (closeBreached) continue;
        }

        const captureHitIndices: number[] = [];

        if (opts.capture) {
          const captureStartIndex = Math.max(
            rightAnchor.x + 1,
            lastBarIndex - opts.offset + 1,
          );
          const captureEndIndex = lastBarIndex;

          for (
            let barIndex = captureStartIndex;
            barIndex <= captureEndIndex;
            barIndex++
          ) {
            const lineY = cached.evaluateY(timestampsMs[barIndex]);
            const offsetTolerance = toleranceAt(
              lineY,
              epsilonOffsetAtIndex(barIndex),
            );

            const hit =
              opts.mode === 'lows'
                ? lowSeries[barIndex] <= lineY - offsetTolerance
                : highSeries[barIndex] >= lineY + offsetTolerance;

            if (hit) captureHitIndices.push(barIndex);
          }
        }

        const runtime: LineRuntime = {
          leftAnchor,
          rightAnchor,
          distance: cached.distance,
          evaluateY: cached.evaluateY,
          touchIndices: cached.touchIndices,
          captureHitIndices,
          invalid: false,
        };

        candidates.push(runtime);
      }

      if (candidates.length >= opts.maxLines) break;
    }

    activeLines = candidates;
  };

  const maybeFinalizeClusterAndRebuild = (rawPoint: Point) => {
    if (!currentClusterBest) {
      currentClusterBest = rawPoint;
      lastRawExtremum = rawPoint;
      rebuildCandidatesLikeBatch();
      return;
    }

    if (rawPoint.x - lastRawExtremum!.x < opts.minDistance) {
      const better =
        opts.mode === 'lows'
          ? rawPoint.y < currentClusterBest.y
          : rawPoint.y > currentClusterBest.y;

      if (better) {
        currentClusterBest = rawPoint;
        rebuildCandidatesLikeBatch();
      }
      lastRawExtremum = rawPoint;
      return;
    }

    clusteredAnchors.push(currentClusterBest);
    currentClusterBest = rawPoint;
    lastRawExtremum = rawPoint;

    rebuildCandidatesLikeBatch();
  };

  const maybeAddRawExtremum = (endIndex: number) => {
    const range = opts.range;
    if (endIndex < 2 * range) return;

    const centerIndex = endIndex - range;
    const extremaValue = shadowSeries[extremaDeque[0]];

    if (shadowSeries[centerIndex] !== extremaValue) return;

    const rawPoint: Point = {
      x: centerIndex,
      y: shadowSeries[centerIndex],
      t: timestampsMs[centerIndex],
    };

    rawExtremaPoints.push(rawPoint);
    maybeFinalizeClusterAndRebuild(rawPoint);
  };

  const updateCloseBreachDeferred = (
    line: LineRuntime,
    lastBarIndex: number,
  ) => {
    if (line.invalid) return;
    if (opts.offset <= 0) return;

    const checkIndex = lastBarIndex - opts.offset;
    if (checkIndex <= line.rightAnchor.x) return;
    if (checkIndex < 0 || checkIndex >= timestampsMs.length) return;

    const timestamp = timestampsMs[checkIndex];
    const lineY = line.evaluateY(timestamp);
    const tolerance = toleranceAt(lineY, epsilonAtIndex(checkIndex));
    const closePrice = closeSeries[checkIndex];

    if (opts.mode === 'lows') {
      if (closePrice < lineY - tolerance) line.invalid = true;
    } else {
      if (closePrice > lineY + tolerance) line.invalid = true;
    }
  };

  const updateCaptureSlidingWindow = (
    line: LineRuntime,
    lastBarIndex: number,
  ) => {
    if (line.invalid) return;
    if (!opts.capture) return;
    if (opts.offset <= 0) return;

    const windowStartIndex = Math.max(
      line.rightAnchor.x + 1,
      lastBarIndex - opts.offset + 1,
    );

    if (lastBarIndex >= windowStartIndex) {
      const timestamp = timestampsMs[lastBarIndex];
      const lineY = line.evaluateY(timestamp);
      const offsetTolerance = toleranceAt(
        lineY,
        epsilonOffsetAtIndex(lastBarIndex),
      );

      const hit =
        opts.mode === 'lows'
          ? lowSeries[lastBarIndex] <= lineY - offsetTolerance
          : highSeries[lastBarIndex] >= lineY + offsetTolerance;

      if (hit) line.captureHitIndices.push(lastBarIndex);
    }

    while (
      line.captureHitIndices.length > 0 &&
      line.captureHitIndices[0] < windowStartIndex
    ) {
      line.captureHitIndices.shift();
    }

    if (line.captureHitIndices.length === 0) {
      return;
    }
  };

  const gcInvalidLines = () => {
    activeLines = activeLines.filter((line) => !line.invalid);
  };

  const buildResult = (): TrendLine[] => {
    if (!timestampsMs.length) return [];

    const lastBarIndex = timestampsMs.length - 1;
    const lastTimestamp = timestampsMs[lastBarIndex];

    const filtered = activeLines.filter((line) => {
      if (line.invalid) return false;
      if (line.touchIndices.length < opts.minTouches) return false;

      const touchSpan =
        line.touchIndices[line.touchIndices.length - 1] - line.touchIndices[0];
      if (touchSpan < opts.minDistance) return false;

      const lastTouches =
        line.touchIndices.length > 2
          ? line.touchIndices.slice(-2)
          : line.touchIndices;
      if (
        hasTooLargeTouchGaps(
          [...lastTouches, line.rightAnchor.x],
          opts.maxTouchGap,
        )
      )
        return false;

      if (opts.capture) {
        const windowStartIndex = Math.max(
          line.rightAnchor.x + 1,
          lastBarIndex - opts.offset + 1,
        );
        while (
          line.captureHitIndices.length > 0 &&
          line.captureHitIndices[0] < windowStartIndex
        ) {
          line.captureHitIndices.shift();
        }
        if (line.captureHitIndices.length === 0) return false;
      }

      return true;
    });

    filtered.sort((a, b) => b.leftAnchor.x - a.leftAnchor.x);

    const takeCount = Math.max(
      1,
      Math.min(opts.bestLines, opts.maxLines, filtered.length),
    );
    const best = filtered.slice(0, takeCount);

    return best.map((line, index) => ({
      id: `${opts.mode}TrendLine-${index + 1}`,
      mode: opts.mode,
      distance: line.distance,
      points: [
        {
          timestamp: line.leftAnchor.t,
          value: line.evaluateY(line.leftAnchor.t),
        },
        { timestamp: lastTimestamp, value: line.evaluateY(lastTimestamp) },
      ],
      touches: line.touchIndices
        .filter(
          (barIndex) =>
            barIndex !== line.leftAnchor.x && barIndex !== line.rightAnchor.x,
        )
        .map((barIndex) => {
          const timestamp = timestampsMs[barIndex];
          return { timestamp, value: line.evaluateY(timestamp) };
        }),
      alpha: buildAlphaSeries({
        timestampsMs,
        closeSeries,
        evaluateY: line.evaluateY,
        window: 10,
      }),
    }));
  };

  const appendCandle = (candle: KLineData) => {
    const barIndex = timestampsMs.length;

    const timestampMs = toMs(candle.timestamp);
    timestampsMs.push(timestampMs);

    closeSeries.push(candle.close);
    lowSeries.push(candle.low);
    highSeries.push(candle.high);

    const shadowValue = opts.mode === 'lows' ? candle.low : candle.high;
    shadowSeries.push(shadowValue);

    const previousClose =
      barIndex > 0 ? closeSeries[barIndex - 1] : candle.close;
    const trueRange = Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
    trueRangeSeries.push(trueRange);
    atrRollingSum += trueRange;
    if (trueRangeSeries.length > opts.epsilonAtrPeriod) {
      atrRollingSum -=
        trueRangeSeries[trueRangeSeries.length - opts.epsilonAtrPeriod - 1];
    }

    const atrWindowSize = Math.min(
      opts.epsilonAtrPeriod,
      trueRangeSeries.length,
    );
    const atrValue = atrWindowSize > 0 ? atrRollingSum / atrWindowSize : 0;
    atrFractionSeries.push(
      Number.isFinite(atrValue) && candle.close > 0
        ? atrValue / candle.close
        : 0,
    );

    updateBlockStats(
      blockStats,
      barIndex,
      candle.low,
      candle.high,
      epsilonAtIndex(barIndex),
    );

    updateFirstRangeExtrema(barIndex);
    updateExtremaDeque(barIndex);
    maybeAddRawExtremum(barIndex);

    let invalidatedByOffsetLogic = false;

    for (const line of activeLines) {
      const wasInvalid = line.invalid;

      updateCloseBreachDeferred(line, barIndex);
      updateCaptureSlidingWindow(line, barIndex);

      if (!wasInvalid && line.invalid) invalidatedByOffsetLogic = true;
    }

    gcInvalidLines();

    if (invalidatedByOffsetLogic) {
      rebuildCandidatesLikeBatch();
    }
  };

  const next = (candle: KLineData) => {
    appendCandle(candle);
    let result = buildResult();
    if (opts.capture && result.length === 0 && rawExtremaPoints.length) {
      rebuildCandidatesLikeBatch();
      result = buildResult();
    }
    return result;
  };

  const nextMany = (candles: KLineData[]) => {
    for (const candle of candles) {
      appendCandle(candle);
    }

    let result = buildResult();
    if (opts.capture && result.length === 0 && rawExtremaPoints.length) {
      rebuildCandidatesLikeBatch();
      result = buildResult();
    }

    return result;
  };

  const getLines = () => buildResult();

  const reset = () => {
    resetState();
    if (initialCandles?.length) nextMany(initialCandles);
  };

  resetState();
  if (initialCandles?.length) nextMany(initialCandles);

  return { next, nextMany, reset, getLines };
};
