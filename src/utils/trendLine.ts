import { KLineData } from 'klinecharts';
import { TrendLine, TrendLineOptions } from '@types';
import { TRENDLINE_DEFAULTS } from '@constants';
import { toMs } from '@utils/timestamp';

/* ============================ Helpers ============================= */

const toleranceAt = (lineY: number, epsilonPct: number) =>
  Math.max(0, Math.abs(lineY) * epsilonPct);

const getBodyLow = (candle: KLineData) => Math.min(candle.open, candle.close);
const getBodyHigh = (candle: KLineData) => Math.max(candle.open, candle.close);

type Point = { x: number; y: number; t: number };

/* ====================== Fast precomputation ======================= */

const buildScalarArrays = (data: KLineData[]) => {
  const length = data.length;

  const timestampsMs: number[] = new Array(length);
  const openSeries: number[] = new Array(length);
  const closeSeries: number[] = new Array(length);
  const lowSeries: number[] = new Array(length);
  const highSeries: number[] = new Array(length);
  const bodyLowSeries: number[] = new Array(length);
  const bodyHighSeries: number[] = new Array(length);

  for (let index = 0; index < length; index++) {
    const candle = data[index];
    const ts = toMs(candle.timestamp);

    timestampsMs[index] = ts;
    openSeries[index] = candle.open;
    closeSeries[index] = candle.close;
    lowSeries[index] = candle.low;
    highSeries[index] = candle.high;
    bodyLowSeries[index] = getBodyLow(candle);
    bodyHighSeries[index] = getBodyHigh(candle);
  }

  return {
    timestampsMs,
    openSeries,
    closeSeries,
    lowSeries,
    highSeries,
    bodyLowSeries,
    bodyHighSeries,
  };
};

/* ========== Sliding Window Extrema (O(N)) aligned to window center ========== */

const computeEndAlignedWindowExtrema = (params: {
  values: number[];
  windowSize: number;
  findMin: boolean;
}): number[] => {
  const { values, windowSize, findMin } = params;
  const length = values.length;
  const result: number[] = new Array(length).fill(Number.NaN);
  if (windowSize <= 0 || windowSize > length) return result;

  const deque: number[] = [];
  const isBetter = findMin
    ? (a: number, b: number) => a <= b
    : (a: number, b: number) => a >= b;

  for (let endIndex = 0; endIndex < length; endIndex++) {
    while (
      deque.length &&
      !isBetter(values[deque[deque.length - 1]], values[endIndex])
    ) {
      deque.pop();
    }
    deque.push(endIndex);

    const startIndex = endIndex - windowSize + 1;
    while (deque.length && deque[0] < startIndex) deque.shift();

    if (startIndex >= 0) {
      result[endIndex] = values[deque[0]];
    }
  }

  return result;
};

const computeCenterWindowExtrema = (params: {
  values: number[];
  range: number;
  findMin: boolean;
}): number[] => {
  const { values, range, findMin } = params;
  const length = values.length;
  const windowSize = 2 * range + 1;
  const endAligned = computeEndAlignedWindowExtrema({
    values,
    windowSize,
    findMin,
  });
  const centerExtrema: number[] = new Array(length).fill(Number.NaN);

  for (
    let centerIndex = range;
    centerIndex <= length - range - 1;
    centerIndex++
  ) {
    const endIndex = centerIndex + range;
    centerExtrema[centerIndex] = endAligned[endIndex];
  }
  return centerExtrema;
};

/* ====================== Pipeline (pure functions) ===================== */

const collectRawExtrema = (params: {
  bodySeries: number[];
  timestampsMs: number[];
  range: number;
  mode: TrendLine['mode'];
}): Point[] => {
  const { bodySeries, timestampsMs, range, mode } = params;
  const findMin = mode === 'lows';
  const centerExtrema = computeCenterWindowExtrema({
    values: bodySeries,
    range,
    findMin,
  });

  const result: Point[] = [];
  for (let index = range; index <= bodySeries.length - range - 1; index++) {
    const level = centerExtrema[index];
    if (!Number.isNaN(level) && bodySeries[index] === level) {
      result.push({ x: index, y: bodySeries[index], t: timestampsMs[index] });
    }
  }
  return result;
};

const clusterExtrema = (params: {
  rawExtrema: Point[];
  mode: TrendLine['mode'];
  minDistance: number;
}): Point[] => {
  const { rawExtrema, mode, minDistance } = params;

  if (rawExtrema.length === 0) return [];

  const clustered: Point[] = [];
  let clusterStart = 0;

  while (clusterStart < rawExtrema.length) {
    let clusterEnd = clusterStart;

    while (
      clusterEnd + 1 < rawExtrema.length &&
      rawExtrema[clusterEnd + 1].x - rawExtrema[clusterEnd].x < minDistance
    ) {
      clusterEnd++;
    }

    let best = rawExtrema[clusterStart];
    for (let i = clusterStart + 1; i <= clusterEnd; i++) {
      const candidate = rawExtrema[i];
      const better =
        mode === 'lows' ? candidate.y < best.y : candidate.y > best.y;
      if (better) best = candidate;
    }
    clustered.push(best);

    clusterStart = clusterEnd + 1;
  }

  return clustered;
};

const isStrongFirstAnchor = (params: {
  lowSeries: number[];
  highSeries: number[];
  index: number;
  mode: TrendLine['mode'];
  firstRange: number;
}): boolean => {
  const { lowSeries, highSeries, index, mode, firstRange } = params;

  const startIndex = Math.max(0, index - firstRange);
  const endIndex = Math.min(lowSeries.length - 1, index + firstRange);

  if (mode === 'lows') {
    let windowMin = Number.POSITIVE_INFINITY;
    for (let i = startIndex; i <= endIndex; i++) {
      if (lowSeries[i] < windowMin) windowMin = lowSeries[i];
    }
    return lowSeries[index] === windowMin;
  } else {
    let windowMax = Number.NEGATIVE_INFINITY;
    for (let i = startIndex; i <= endIndex; i++) {
      if (highSeries[i] > windowMax) windowMax = highSeries[i];
    }
    return highSeries[index] === windowMax;
  }
};

const buildLineEvaluator = (params: {
  t1: number;
  y1: number;
  t2: number;
  y2: number;
}) => {
  const { t1, y1, t2, y2 } = params;
  const deltaTime = t2 - t1;
  if (deltaTime === 0) {
    const constantY = y1;
    return (_t: number) => constantY;
  }
  const slope = (y2 - y1) / deltaTime;
  return (timeMs: number) => y1 + slope * (timeMs - t1);
};

/* ====================== Touch / Breach checks ===================== */

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

const hasTooLargeTouchGaps = (touchIndices: number[], maxTouchGap: number) => {
  if (!Number.isFinite(maxTouchGap) || maxTouchGap <= 0) return false;
  if (touchIndices.length < 2) return true;

  for (let i = 1; i < touchIndices.length; i++) {
    if (touchIndices[i] - touchIndices[i - 1] > maxTouchGap) return true;
  }
  return false;
};

const hasWickBreachOnSegment = (params: {
  lowSeries: number[];
  highSeries: number[];
  timestampsMs: number[];
  startIndex: number;
  endIndex: number;
  evaluateY: (t: number) => number;
  epsilon: number;
  mode: TrendLine['mode'];
}): boolean => {
  const {
    lowSeries,
    highSeries,
    timestampsMs,
    startIndex,
    endIndex,
    evaluateY,
    epsilon,
    mode,
  } = params;

  for (let barIndex = startIndex; barIndex <= endIndex; barIndex++) {
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

const hasCloseBreachBeforeWindow = (params: {
  closeSeries: number[];
  timestampsMs: number[];
  fromIndex: number;
  lastIndex: number;
  offset: number;
  evaluateY: (t: number) => number;
  epsilon: number;
  mode: TrendLine['mode'];
}): boolean => {
  const {
    closeSeries,
    timestampsMs,
    fromIndex,
    lastIndex,
    offset,
    evaluateY,
    epsilon,
    mode,
  } = params;

  const preCaptureEndIndex = lastIndex - Math.max(0, offset);
  if (fromIndex > preCaptureEndIndex) return false;

  for (let barIndex = fromIndex; barIndex <= preCaptureEndIndex; barIndex++) {
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

/**
 * capture-условие внутри offset:
 * Требуется, чтобы в окне offset произошёл пробой линии на величину epsilonOffset
 * по фитилю (ранний сигнал), независимо от открытия/закрытия свечи.
 *  - lows:  low <= lineY - tolOffset
 *  - highs: high >= lineY + tolOffset
 * Здесь tolOffset = |lineY| * epsilonOffset.
 */
const hasCaptureByOffsetWick = (params: {
  lowSeries: number[];
  highSeries: number[];
  timestampsMs: number[];
  rightAnchorIndex: number;
  lastIndex: number;
  offset: number;
  evaluateY: (t: number) => number;
  epsilonOffset: number;
  mode: TrendLine['mode'];
}): boolean => {
  const {
    lowSeries,
    highSeries,
    timestampsMs,
    rightAnchorIndex,
    lastIndex,
    offset,
    evaluateY,
    epsilonOffset,
    mode,
  } = params;

  if (offset <= 0) return false;

  const captureStartIndex = Math.max(
    rightAnchorIndex + 1,
    lastIndex - offset + 1,
  );
  const captureEndIndex = lastIndex;
  if (captureStartIndex > captureEndIndex) return false;

  for (
    let barIndex = captureStartIndex;
    barIndex <= captureEndIndex;
    barIndex++
  ) {
    const lineY = evaluateY(timestampsMs[barIndex]);
    const tolOffset = toleranceAt(lineY, epsilonOffset);

    if (mode === 'lows') {
      if (lowSeries[barIndex] <= lineY - tolOffset) return true;
    } else {
      if (highSeries[barIndex] >= lineY + tolOffset) return true;
    }
  }
  return false;
};

/* ============================ Core ============================= */

const findTrendlinesCore = (
  data: KLineData[],
  options: TrendLineOptions,
): TrendLine[] => {
  const {
    mode,
    maxLines = TRENDLINE_DEFAULTS.maxLines,
    range = TRENDLINE_DEFAULTS.range,
    firstRange = TRENDLINE_DEFAULTS.firstRange,
    epsilon = TRENDLINE_DEFAULTS.epsilon,
    epsilonOffset = TRENDLINE_DEFAULTS.epsilonOffset,
    minTouches = TRENDLINE_DEFAULTS.minTouches,
    minDistance = TRENDLINE_DEFAULTS.minDistance,
    minTouchGap = TRENDLINE_DEFAULTS.minTouchGap,
    maxTouchGap = TRENDLINE_DEFAULTS.maxTouchGap,
    offset = TRENDLINE_DEFAULTS.offset,
    capture = TRENDLINE_DEFAULTS.capture,
    bestLines = TRENDLINE_DEFAULTS.bestLines,
    maxDistance = TRENDLINE_DEFAULTS.maxDistance,
  } = options;

  if (!data?.length) return [];

  const { timestampsMs, closeSeries, lowSeries, highSeries } =
    buildScalarArrays(data);

  const shadowSeriesForExtrema = mode === 'lows' ? lowSeries : highSeries;
  const shadowSeriesForTouches = shadowSeriesForExtrema;

  const rawExtrema = collectRawExtrema({
    bodySeries: shadowSeriesForExtrema,
    timestampsMs,
    range,
    mode,
  });
  if (rawExtrema.length < minTouches) return [];

  const anchors = clusterExtrema({
    rawExtrema,
    mode,
    minDistance,
  });
  if (anchors.length < minTouches) return [];

  const lastBarIndex = data.length - 1;
  const lastTimestampMs = timestampsMs[lastBarIndex];

  type Candidate = {
    firstIndex: number;
    lastIndex: number;
    leftAnchor: Point;
    rightAnchor: Point;
    touchIndices: number[];
    distance: number;
  };

  const candidates: Candidate[] = [];

  for (let r = anchors.length - 1; r >= 0; r--) {
    const rightAnchor = anchors[r];

    for (let l = r - 1; l >= 0; l--) {
      if (candidates.length >= maxLines) break;

      const leftAnchor = anchors[l];
      if (rightAnchor.x === leftAnchor.x) continue;

      const firstIndex = leftAnchor.x;
      const lastIndex = rightAnchor.x;
      const distance = lastIndex - firstIndex;

      if (distance < minDistance) continue;
      if (distance > maxDistance) continue;

      if (
        !isStrongFirstAnchor({
          lowSeries,
          highSeries,
          index: firstIndex,
          mode,
          firstRange,
        })
      )
        continue;

      const slope =
        (rightAnchor.y - leftAnchor.y) / (rightAnchor.x - leftAnchor.x);

      if (mode === 'lows' && slope <= 0) continue;
      if (mode === 'highs' && slope >= 0) continue;

      const evaluateY = buildLineEvaluator({
        t1: leftAnchor.t,
        y1: leftAnchor.y,
        t2: rightAnchor.t,
        y2: rightAnchor.y,
      });

      const touches = collectTouchIndices({
        bodySeriesForTouches: shadowSeriesForTouches,
        timestampsMs,
        startIndex: firstIndex,
        endIndex: lastIndex,
        evaluateY,
        epsilon,
        minTouchGap,
      });
      if (touches.length < minTouches) continue;

      const lastTouches = touches.length > 2 ? touches.slice(-2) : touches;

      if (hasTooLargeTouchGaps([...lastTouches, lastIndex], maxTouchGap))
        continue;

      if (touches[touches.length - 1] - touches[0] < minDistance) continue;

      if (
        hasWickBreachOnSegment({
          lowSeries,
          highSeries,
          timestampsMs,
          startIndex: firstIndex,
          endIndex: lastIndex,
          evaluateY,
          epsilon,
          mode,
        })
      ) {
        continue;
      }

      if (
        hasCloseBreachBeforeWindow({
          closeSeries,
          timestampsMs,
          fromIndex: lastIndex + 1,
          lastIndex: lastBarIndex,
          offset,
          evaluateY,
          epsilon,
          mode,
        })
      ) {
        continue;
      }

      if (capture) {
        if (
          !hasCaptureByOffsetWick({
            lowSeries,
            highSeries,
            timestampsMs,
            rightAnchorIndex: lastIndex,
            lastIndex: lastBarIndex,
            offset,
            evaluateY,
            epsilonOffset,
            mode,
          })
        )
          continue;
      }

      candidates.push({
        firstIndex,
        lastIndex,
        leftAnchor,
        rightAnchor,
        distance,
        touchIndices: touches,
      });
    }

    if (candidates.length >= maxLines) break;
  }

  if (!candidates.length) return [];

  candidates.sort((a, b) => b.firstIndex - a.firstIndex);

  const effectiveBestLines = Math.max(
    1,
    Math.min(bestLines, maxLines, candidates.length),
  );

  const trendlines: TrendLine[] = [];

  for (let i = 0; i < effectiveBestLines; i++) {
    const { leftAnchor, rightAnchor, touchIndices, distance } = candidates[i];

    const evaluateY = buildLineEvaluator({
      t1: leftAnchor.t,
      y1: leftAnchor.y,
      t2: rightAnchor.t,
      y2: rightAnchor.y,
    });

    const touches = touchIndices
      .filter((idx) => idx !== leftAnchor.x && idx !== rightAnchor.x)
      .map((idx) => {
        const ts = timestampsMs[idx];
        return {
          timestamp: ts,
          value: evaluateY(ts),
        };
      });

    trendlines.push({
      id: `${mode}TrendLine-${i + 1}`,
      mode,
      distance,
      points: [
        { timestamp: leftAnchor.t, value: evaluateY(leftAnchor.t) },
        { timestamp: lastTimestampMs, value: evaluateY(lastTimestampMs) },
      ],
      touches,
    });
  }

  return trendlines;
};

/* =========================== Public API =========================== */

export const findTrendlinesByLows = (
  data: KLineData[],
  options: Omit<TrendLineOptions, 'mode'> = {},
): TrendLine[] =>
  findTrendlinesCore(data, {
    mode: 'lows',
    ...options,
  } as TrendLineOptions);

export const findTrendlinesByHighs = (
  data: KLineData[],
  options: Omit<TrendLineOptions, 'mode'> = {},
): TrendLine[] =>
  findTrendlinesCore(data, {
    mode: 'highs',
    ...options,
  } as TrendLineOptions);
