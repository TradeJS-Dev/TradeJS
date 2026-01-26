import { KLineData } from 'klinecharts';
import { TrendLine, TrendLineOptions } from '@types';
import { toMs } from '@utils/timestamp';

type Point = { x: number; y: number; t: number };

type LineRuntime = {
  leftAnchor: Point;
  rightAnchor: Point;
  distance: number;
  evaluateY: (t: number) => number;
  touchIndices: number[];
  captureHit: boolean;
  invalid: boolean;
};

export type TrendlineEngine = {
  next: (candle: KLineData) => TrendLine[];
  nextMany: (candles: KLineData[]) => TrendLine[];
  reset: () => void;
  getLines: () => TrendLine[];
};

const DEFAULTS = {
  maxLines: 20,
  range: 15,
  firstRange: 80,
  epsilon: 0.003,
  epsilonOffset: 0.005,
  minTouches: 4,
  minDistance: 50,
  minTouchGap: 15,
  maxTouchGap: 60,
  offset: 1000,
  capture: false,
  bestLines: 4,
  maxDistance: 2000,
};

const toleranceAt = (lineY: number, epsilonPct: number) =>
  Math.max(0, Math.abs(lineY) * epsilonPct);

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
  epsilon: number;
  minTouchGap: number;
}): number[] => {
  const {
    bodySeriesForTouches,
    timestampsMs,
    startIndex,
    endIndex,
    evaluateY,
    epsilon,
    minTouchGap,
  } = params;

  const touchIndices: number[] = [];
  let lastTouchIndex = -Infinity;

  for (let barIndex = startIndex; barIndex <= endIndex; barIndex++) {
    const lineY = evaluateY(timestampsMs[barIndex]);
    const tolerance = toleranceAt(lineY, epsilon);
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
  epsilon: number;
}): boolean => {
  const {
    mode,
    closeSeries,
    timestampsMs,
    startIndex,
    endIndex,
    evaluateY,
    epsilon,
  } = params;
  if (startIndex > endIndex) return false;

  for (let barIndex = startIndex; barIndex <= endIndex; barIndex++) {
    const lineY = evaluateY(timestampsMs[barIndex]);
    const tolerance = toleranceAt(lineY, epsilon);
    const closePrice = closeSeries[barIndex];

    if (mode === 'lows') {
      if (closePrice < lineY - tolerance) return true;
    } else {
      if (closePrice > lineY + tolerance) return true;
    }
  }

  return false;
};

const hasCaptureInRange = (params: {
  mode: TrendLine['mode'];
  lowSeries: number[];
  highSeries: number[];
  timestampsMs: number[];
  startIndex: number;
  endIndex: number;
  evaluateY: (t: number) => number;
  epsilonOffset: number;
}): boolean => {
  const {
    mode,
    lowSeries,
    highSeries,
    timestampsMs,
    startIndex,
    endIndex,
    evaluateY,
    epsilonOffset,
  } = params;

  if (startIndex > endIndex) return false;

  for (let barIndex = startIndex; barIndex <= endIndex; barIndex++) {
    const lineY = evaluateY(timestampsMs[barIndex]);
    const offsetTolerance = toleranceAt(lineY, epsilonOffset);

    if (mode === 'lows') {
      if (lowSeries[barIndex] <= lineY - offsetTolerance) return true;
    } else {
      if (highSeries[barIndex] >= lineY + offsetTolerance) return true;
    }
  }

  return false;
};

/* ================= Segment Trees for O(logN) range queries ================= */

class SegmentTreeMin {
  private sizePowerOfTwo = 1;
  private tree: number[] = [Number.POSITIVE_INFINITY];
  private length = 0;

  public clear() {
    this.sizePowerOfTwo = 1;
    this.tree = [Number.POSITIVE_INFINITY];
    this.length = 0;
  }

  public append(value: number) {
    this.length += 1;
    while (this.sizePowerOfTwo < this.length) this.grow();
    this.tree[this.sizePowerOfTwo + this.length - 1] = value;
    this.rebuildUpFromLeaf(this.sizePowerOfTwo + this.length - 1);
  }

  public query(startIndex: number, endIndex: number) {
    if (this.length === 0) return Number.NaN;

    const left = Math.max(0, Math.min(startIndex, this.length - 1));
    const right = Math.max(0, Math.min(endIndex, this.length - 1));
    if (left > right) return Number.NaN;

    let leftPointer = this.sizePowerOfTwo + left;
    let rightPointer = this.sizePowerOfTwo + right;

    let result = Number.POSITIVE_INFINITY;

    while (leftPointer <= rightPointer) {
      if ((leftPointer & 1) === 1)
        result = Math.min(result, this.tree[leftPointer++]);
      if ((rightPointer & 1) === 0)
        result = Math.min(result, this.tree[rightPointer--]);
      leftPointer >>= 1;
      rightPointer >>= 1;
    }

    return result;
  }

  private grow() {
    const oldSize = this.sizePowerOfTwo;
    const newSize = oldSize * 2;
    const newTree = new Array(newSize * 2).fill(Number.POSITIVE_INFINITY);

    for (let index = 0; index < oldSize * 2; index++) {
      newTree[index] = this.tree[index] ?? Number.POSITIVE_INFINITY;
    }

    this.sizePowerOfTwo = newSize;
    this.tree = newTree;

    for (let nodeIndex = this.sizePowerOfTwo - 1; nodeIndex >= 1; nodeIndex--) {
      this.tree[nodeIndex] = Math.min(
        this.tree[nodeIndex * 2],
        this.tree[nodeIndex * 2 + 1],
      );
    }
  }

  private rebuildUpFromLeaf(leafIndex: number) {
    let nodeIndex = leafIndex >> 1;
    while (nodeIndex >= 1) {
      this.tree[nodeIndex] = Math.min(
        this.tree[nodeIndex * 2],
        this.tree[nodeIndex * 2 + 1],
      );
      nodeIndex >>= 1;
    }
  }
}

class SegmentTreeMax {
  private sizePowerOfTwo = 1;
  private tree: number[] = [Number.NEGATIVE_INFINITY];
  private length = 0;

  public clear() {
    this.sizePowerOfTwo = 1;
    this.tree = [Number.NEGATIVE_INFINITY];
    this.length = 0;
  }

  public append(value: number) {
    this.length += 1;
    while (this.sizePowerOfTwo < this.length) this.grow();
    this.tree[this.sizePowerOfTwo + this.length - 1] = value;
    this.rebuildUpFromLeaf(this.sizePowerOfTwo + this.length - 1);
  }

  public query(startIndex: number, endIndex: number) {
    if (this.length === 0) return Number.NaN;

    const left = Math.max(0, Math.min(startIndex, this.length - 1));
    const right = Math.max(0, Math.min(endIndex, this.length - 1));
    if (left > right) return Number.NaN;

    let leftPointer = this.sizePowerOfTwo + left;
    let rightPointer = this.sizePowerOfTwo + right;

    let result = Number.NEGATIVE_INFINITY;

    while (leftPointer <= rightPointer) {
      if ((leftPointer & 1) === 1)
        result = Math.max(result, this.tree[leftPointer++]);
      if ((rightPointer & 1) === 0)
        result = Math.max(result, this.tree[rightPointer--]);
      leftPointer >>= 1;
      rightPointer >>= 1;
    }

    return result;
  }

  private grow() {
    const oldSize = this.sizePowerOfTwo;
    const newSize = oldSize * 2;
    const newTree = new Array(newSize * 2).fill(Number.NEGATIVE_INFINITY);

    for (let index = 0; index < oldSize * 2; index++) {
      newTree[index] = this.tree[index] ?? Number.NEGATIVE_INFINITY;
    }

    this.sizePowerOfTwo = newSize;
    this.tree = newTree;

    for (let nodeIndex = this.sizePowerOfTwo - 1; nodeIndex >= 1; nodeIndex--) {
      this.tree[nodeIndex] = Math.max(
        this.tree[nodeIndex * 2],
        this.tree[nodeIndex * 2 + 1],
      );
    }
  }

  private rebuildUpFromLeaf(leafIndex: number) {
    let nodeIndex = leafIndex >> 1;
    while (nodeIndex >= 1) {
      this.tree[nodeIndex] = Math.max(
        this.tree[nodeIndex * 2],
        this.tree[nodeIndex * 2 + 1],
      );
      nodeIndex >>= 1;
    }
  }
}

/* ================= Block min/max for wick breach (two-phase) ================= */

const BLOCK_SIZE = 64;

const getBlockIndex = (barIndex: number) => Math.floor(barIndex / BLOCK_SIZE);

type BlockStats = {
  lowBlockMins: number[];
  highBlockMaxs: number[];
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
) => {
  const blockIndex = getBlockIndex(barIndex);

  ensureBlockValue(stats.lowBlockMins, blockIndex, Number.POSITIVE_INFINITY);
  ensureBlockValue(stats.highBlockMaxs, blockIndex, Number.NEGATIVE_INFINITY);

  stats.lowBlockMins[blockIndex] = Math.min(
    stats.lowBlockMins[blockIndex],
    lowValue,
  );
  stats.highBlockMaxs[blockIndex] = Math.max(
    stats.highBlockMaxs[blockIndex],
    highValue,
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
  epsilon: number;
  blockStats: BlockStats;
}): boolean => {
  const {
    mode,
    lowSeries,
    highSeries,
    timestampsMs,
    startIndex,
    endIndex,
    evaluateY,
    epsilon,
    blockStats,
  } = params;

  if (startIndex > endIndex) return false;

  const scanBarsPrecisely = (fromIndex: number, toIndex: number) => {
    for (let barIndex = fromIndex; barIndex <= toIndex; barIndex++) {
      const lineY = evaluateY(timestampsMs[barIndex]);
      const tolerance = toleranceAt(lineY, epsilon);

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

  if (startBlockIndex === endBlockIndex) {
    return scanBarsPrecisely(startIndex, endIndex);
  }

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

    const blockStartTime = timestampsMs[blockStartIndex];
    const blockEndTime = timestampsMs[blockEndIndex];

    const thresholdAtStart =
      mode === 'lows'
        ? evaluateY(blockStartTime) -
          toleranceAt(evaluateY(blockStartTime), epsilon)
        : evaluateY(blockStartTime) +
          toleranceAt(evaluateY(blockStartTime), epsilon);

    const thresholdAtEnd =
      mode === 'lows'
        ? evaluateY(blockEndTime) -
          toleranceAt(evaluateY(blockEndTime), epsilon)
        : evaluateY(blockEndTime) +
          toleranceAt(evaluateY(blockEndTime), epsilon);

    if (mode === 'lows') {
      const maxThresholdInBlock = Math.max(thresholdAtStart, thresholdAtEnd);
      const blockLowMin = blockStats.lowBlockMins[blockIndex];
      if (blockLowMin >= maxThresholdInBlock) continue;
      if (scanBarsPrecisely(blockStartIndex, blockEndIndex)) return true;
    } else {
      const minThresholdInBlock = Math.min(thresholdAtStart, thresholdAtEnd);
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

  const lowMinTree = new SegmentTreeMin();
  const highMaxTree = new SegmentTreeMax();

  const blockStats: BlockStats = { lowBlockMins: [], highBlockMaxs: [] };

  let extremaDeque: number[] = [];
  let rawExtremaPoints: Point[] = [];

  let clusteredAnchors: Point[] = [];
  let currentClusterBest: Point | null = null;
  let lastRawExtremum: Point | null = null;

  let activeLines: LineRuntime[] = [];

  const resetState = () => {
    timestampsMs = [];
    closeSeries = [];
    lowSeries = [];
    highSeries = [];
    shadowSeries = [];

    lowMinTree.clear();
    highMaxTree.clear();

    blockStats.lowBlockMins = [];
    blockStats.highBlockMaxs = [];

    extremaDeque = [];
    rawExtremaPoints = [];

    clusteredAnchors = [];
    currentClusterBest = null;
    lastRawExtremum = null;

    activeLines = [];
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
    const startIndex = Math.max(0, anchorIndex - opts.firstRange);
    const endIndex = Math.min(
      lowSeries.length - 1,
      anchorIndex + opts.firstRange,
    );

    if (opts.mode === 'lows') {
      const windowMin = lowMinTree.query(startIndex, endIndex);
      return lowSeries[anchorIndex] === windowMin;
    }

    const windowMax = highMaxTree.query(startIndex, endIndex);
    return highSeries[anchorIndex] === windowMax;
  };

  const buildAllAnchorsIncludingOpenCluster = (): Point[] => {
    if (!currentClusterBest) return [...clusteredAnchors];
    return [...clusteredAnchors, currentClusterBest];
  };

  const seedLineBatchExact = (line: LineRuntime, lastBarIndex: number) => {
    const leftIndex = line.leftAnchor.x;
    const rightIndex = line.rightAnchor.x;

    const touchIndices = collectTouchIndices({
      bodySeriesForTouches: shadowSeries,
      timestampsMs,
      startIndex: leftIndex,
      endIndex: rightIndex,
      evaluateY: line.evaluateY,
      epsilon: opts.epsilon,
      minTouchGap: opts.minTouchGap,
    });

    if (touchIndices.length < opts.minTouches) {
      line.invalid = true;
      return;
    }

    const lastTouches =
      touchIndices.length > 2 ? touchIndices.slice(-2) : touchIndices;
    if (hasTooLargeTouchGaps([...lastTouches, rightIndex], opts.maxTouchGap)) {
      line.invalid = true;
      return;
    }

    if (
      touchIndices[touchIndices.length - 1] - touchIndices[0] <
      opts.minDistance
    ) {
      line.invalid = true;
      return;
    }

    const wickBreached = hasWickBreachOnSegmentFast({
      mode: opts.mode,
      lowSeries,
      highSeries,
      timestampsMs,
      startIndex: leftIndex,
      endIndex: rightIndex,
      evaluateY: line.evaluateY,
      epsilon: opts.epsilon,
      blockStats,
    });

    if (wickBreached) {
      line.invalid = true;
      return;
    }

    const closeBreachEndIndex = lastBarIndex - Math.max(0, opts.offset);
    const closeBreachStartIndex = rightIndex + 1;

    if (closeBreachStartIndex <= closeBreachEndIndex) {
      const closeBreached = hasCloseBreachInRange({
        mode: opts.mode,
        closeSeries,
        timestampsMs,
        startIndex: closeBreachStartIndex,
        endIndex: closeBreachEndIndex,
        evaluateY: line.evaluateY,
        epsilon: opts.epsilon,
      });

      if (closeBreached) {
        line.invalid = true;
        return;
      }
    }

    if (opts.capture) {
      const captureStartIndex = Math.max(
        rightIndex + 1,
        lastBarIndex - opts.offset + 1,
      );
      const captureEndIndex = lastBarIndex;

      const captureHit = hasCaptureInRange({
        mode: opts.mode,
        lowSeries,
        highSeries,
        timestampsMs,
        startIndex: captureStartIndex,
        endIndex: captureEndIndex,
        evaluateY: line.evaluateY,
        epsilonOffset: opts.epsilonOffset,
      });

      if (!captureHit) {
        line.invalid = true;
        return;
      }

      line.captureHit = true;
    }

    line.touchIndices = touchIndices;
  };

  const rebuildCandidatesLikeBatch = () => {
    const allAnchors = buildAllAnchorsIncludingOpenCluster();
    const lastBarIndex = timestampsMs.length - 1;

    if (lastBarIndex < 0) {
      activeLines = [];
      return;
    }

    if (
      rawExtremaPoints.length < opts.minTouches ||
      allAnchors.length < opts.minTouches
    ) {
      activeLines = [];
      return;
    }

    const candidates: LineRuntime[] = [];

    for (
      let rightAnchorIndex = allAnchors.length - 1;
      rightAnchorIndex >= 0;
      rightAnchorIndex--
    ) {
      const rightAnchor = allAnchors[rightAnchorIndex];

      for (
        let leftAnchorIndex = rightAnchorIndex - 1;
        leftAnchorIndex >= 0;
        leftAnchorIndex--
      ) {
        if (candidates.length >= opts.maxLines) break;

        const leftAnchor = allAnchors[leftAnchorIndex];
        const distance = rightAnchor.x - leftAnchor.x;

        if (distance < opts.minDistance) continue;
        if (distance > opts.maxDistance) continue;

        if (!isStrongFirstAnchorFast(leftAnchor.x)) continue;

        const slope =
          (rightAnchor.y - leftAnchor.y) / (rightAnchor.x - leftAnchor.x);

        if (opts.mode === 'lows' && slope <= 0) continue;
        if (opts.mode === 'highs' && slope >= 0) continue;

        const evaluateY = buildLineEvaluator({
          t1: leftAnchor.t,
          y1: leftAnchor.y,
          t2: rightAnchor.t,
          y2: rightAnchor.y,
        });

        const runtime: LineRuntime = {
          leftAnchor,
          rightAnchor,
          distance,
          evaluateY,
          touchIndices: [],
          captureHit: false,
          invalid: false,
        };

        seedLineBatchExact(runtime, lastBarIndex);
        if (!runtime.invalid) candidates.push(runtime);
      }

      if (candidates.length >= opts.maxLines) break;
    }

    activeLines = candidates;
  };

  const maybeFinalizeClusterAndRebuild = (rawPoint: Point) => {
    if (!currentClusterBest) {
      currentClusterBest = rawPoint;
      lastRawExtremum = rawPoint;
      return;
    }

    if (rawPoint.x - lastRawExtremum!.x < opts.minDistance) {
      const isBetter =
        opts.mode === 'lows'
          ? rawPoint.y < currentClusterBest.y
          : rawPoint.y > currentClusterBest.y;

      if (isBetter) currentClusterBest = rawPoint;
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

  const buildResult = (): TrendLine[] => {
    if (!timestampsMs.length) return [];

    const lastBarIndex = timestampsMs.length - 1;
    const lastTimestamp = timestampsMs[lastBarIndex];

    const filtered = activeLines.filter((line) => {
      if (line.invalid) return false;
      if (line.touchIndices.length < opts.minTouches) return false;

      const span =
        line.touchIndices[line.touchIndices.length - 1] - line.touchIndices[0];
      if (span < opts.minDistance) return false;

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

      if (opts.capture && !line.captureHit) return false;

      return true;
    });

    filtered.sort(
      (leftLine, rightLine) => rightLine.leftAnchor.x - leftLine.leftAnchor.x,
    );

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

    lowMinTree.append(candle.low);
    highMaxTree.append(candle.high);

    updateBlockStats(blockStats, barIndex, candle.low, candle.high);

    updateExtremaDeque(barIndex);
    maybeAddRawExtremum(barIndex);
  };

  const next = (candle: KLineData) => {
    appendCandle(candle);
    return buildResult();
  };

  const nextMany = (candles: KLineData[]) => {
    let result: TrendLine[] = [];
    for (const candle of candles) result = next(candle);
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
