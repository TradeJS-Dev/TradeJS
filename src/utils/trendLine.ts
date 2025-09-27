import { KlineChartData, Candle } from '@types';

/* ========================= Types & Options ========================= */

type Mode = 'lows' | 'highs';

export type TrendLine = {
  id: string;
  points: { timestamp: number; value: number }[];
};

export interface TrendLineOptions {
  mode: Mode;
  maxLines?: number;           // ограничение перебора пар опор (кандидатов)
  range?: number;              // окно для локальных экстремумов (в барах)
  epsilon?: number;            // допуск как доля цены (0.01 = 1%)
  minTouches?: number;         // минимум касаний по телу (с учётом minTouchGap)
  minDistanceBars?: number;    // минимум баров между опорами/крайними касаниями
  firstRange?: number;         // «сила» первой опоры (окно сильного экстремума)
  offset?: number;             // размер capture-окна в конце (в барах)
  minTouchGap?: number;        // минимум баров между касаниями
  capture?: boolean;           // true: обязателен «старт за линией» в offset-окне
}

/* ============================ Helpers ============================= */

const toMs = (ts: number) => (ts < 1e12 ? ts * 1000 : ts);
const toleranceAt = (lineY: number, epsilonPct: number) =>
  Math.max(0, Math.abs(lineY) * epsilonPct);

const getBodyLow  = (c: Candle) => Math.min(c.open, c.close);
const getBodyHigh = (c: Candle) => Math.max(c.open, c.close);

type Point = { x: number; y: number; t: number };

/* ====================== Fast precomputation ======================= */

const buildScalarArrays = (data: KlineChartData) => {
  const length = data.length;

  const tsMs: number[] = new Array(length);
  const openArr: number[] = new Array(length);
  const closeArr: number[] = new Array(length);
  const lowArr: number[] = new Array(length);
  const highArr: number[] = new Array(length);
  const bodyLowArr: number[] = new Array(length);
  const bodyHighArr: number[] = new Array(length);

  for (let index = 0; index < length; index++) {
    const c = data[index];
    const ts = toMs(c.timestamp);
    const bodyLow = c.open < c.close ? c.open : c.close;
    const bodyHigh = c.open > c.close ? c.open : c.close;

    tsMs[index] = ts;
    openArr[index] = c.open;
    closeArr[index] = c.close;
    lowArr[index] = c.low;
    highArr[index] = c.high;
    bodyLowArr[index] = bodyLow;
    bodyHighArr[index] = bodyHigh;
  }

  return { tsMs, openArr, closeArr, lowArr, highArr, bodyLowArr, bodyHighArr };
};

/* ========== Sliding Window Extrema (O(N)) aligned to window center ========== */

const computeEndAlignedWindowExtrema = (
  values: number[],
  windowSize: number,
  findMin: boolean,
): number[] => {
  const length = values.length;
  const result: number[] = new Array(length).fill(Number.NaN);
  if (windowSize <= 0 || windowSize > length) return result;

  const deque: number[] = [];
  const isBetter = findMin
    ? (a: number, b: number) => a <= b
    : (a: number, b: number) => a >= b;

  for (let endIndex = 0; endIndex < length; endIndex++) {
    while (deque.length && !isBetter(values[deque[deque.length - 1]], values[endIndex])) {
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

const computeCenterWindowExtrema = (
  values: number[],
  range: number,
  findMin: boolean,
): number[] => {
  const length = values.length;
  const windowSize = 2 * range + 1;
  const endAligned = computeEndAlignedWindowExtrema(values, windowSize, findMin);
  const centerExtrema: number[] = new Array(length).fill(Number.NaN);

  for (let centerIndex = range; centerIndex <= length - range - 1; centerIndex++) {
    const endIndex = centerIndex + range;
    centerExtrema[centerIndex] = endAligned[endIndex];
  }
  return centerExtrema;
};

/* ====================== Pipeline (pure functions) ===================== */

const collectRawExtrema = (
  bodySeries: number[],
  timestampMs: number[],
  range: number,
  mode: Mode,
): Point[] => {
  const findMin = mode === 'lows';
  const centerExtrema = computeCenterWindowExtrema(bodySeries, range, findMin);

  const result: Point[] = [];
  for (let index = range; index <= bodySeries.length - range - 1; index++) {
    const level = centerExtrema[index];
    if (!Number.isNaN(level) && bodySeries[index] === level) {
      result.push({ x: index, y: bodySeries[index], t: timestampMs[index] });
    }
  }
  return result;
};

/** Кластеризация «цепочкой»: пока соседний экстремум ближе чем minDistanceBars к
 *  предыдущему в *сыром* ряду — он в том же кластере. Внутри кластера берём лучший. */
const clusterExtrema = (
  rawExtrema: Point[],
  mode: Mode,
  minDistanceBars: number,
): Point[] => {
  if (rawExtrema.length === 0) return [];

  const clustered: Point[] = [];
  let clusterStart = 0;

  while (clusterStart < rawExtrema.length) {
    let clusterEnd = clusterStart;

    // расширяем кластер по соседям (цепочкой)
    while (
      clusterEnd + 1 < rawExtrema.length &&
      rawExtrema[clusterEnd + 1].x - rawExtrema[clusterEnd].x < minDistanceBars
    ) {
      clusterEnd++;
    }

    // выбираем лучший внутри [clusterStart..clusterEnd]
    let best = rawExtrema[clusterStart];
    for (let i = clusterStart + 1; i <= clusterEnd; i++) {
      const candidate = rawExtrema[i];
      const better = mode === 'lows' ? candidate.y < best.y : candidate.y > best.y;
      if (better) best = candidate;
    }
    clustered.push(best);

    clusterStart = clusterEnd + 1;
  }

  return clustered;
};

const isStrongFirstAnchor = (
  bodyLowSeries: number[],
  bodyHighSeries: number[],
  index: number,
  mode: Mode,
  firstRange: number,
): boolean => {
  const startIndex = Math.max(0, index - firstRange);
  const endIndex = Math.min(bodyLowSeries.length - 1, index + firstRange);

  if (mode === 'lows') {
    let windowMin = Number.POSITIVE_INFINITY;
    for (let i = startIndex; i <= endIndex; i++) {
      if (bodyLowSeries[i] < windowMin) windowMin = bodyLowSeries[i];
    }
    return bodyLowSeries[index] === windowMin;
  } else {
    let windowMax = Number.NEGATIVE_INFINITY;
    for (let i = startIndex; i <= endIndex; i++) {
      if (bodyHighSeries[i] > windowMax) windowMax = bodyHighSeries[i];
    }
    return bodyHighSeries[index] === windowMax;
  }
};

const buildLineEvaluator = (
  t1: number,
  y1: number,
  t2: number,
  y2: number,
) => {
  const deltaTime = t2 - t1;
  if (deltaTime === 0) {
    const constantY = y1;
    return (_t: number) => constantY;
  }
  const slope = (y2 - y1) / deltaTime;
  return (timeMs: number) => y1 + slope * (timeMs - t1);
};

const collectTouchIndices = (
  bodySeriesForTouches: number[],
  timestampMs: number[],
  startIndex: number,
  endIndex: number,
  evaluateY: (t: number) => number,
  epsilon: number,
  minTouchGap: number,
): number[] => {
  const touchIndices: number[] = [];
  let lastTouchIndex = -Infinity;

  for (let barIndex = startIndex; barIndex <= endIndex; barIndex++) {
    const lineY = evaluateY(timestampMs[barIndex]);
    const tolerance = toleranceAt(lineY, epsilon);
    const bodyValue = bodySeriesForTouches[barIndex];

    if (Math.abs(bodyValue - lineY) <= tolerance) {
      if (touchIndices.length === 0 || barIndex - lastTouchIndex >= minTouchGap) {
        touchIndices.push(barIndex);
        lastTouchIndex = barIndex;
      }
    }
  }
  return touchIndices;
};

const hasWickBreachOnSegment = (
  lowSeries: number[],
  highSeries: number[],
  timestampMs: number[],
  startIndex: number,
  endIndex: number,
  evaluateY: (t: number) => number,
  epsilon: number,
  mode: Mode,
): boolean => {
  for (let barIndex = startIndex; barIndex <= endIndex; barIndex++) {
    const lineY = evaluateY(timestampMs[barIndex]);
    const tolerance = toleranceAt(lineY, epsilon);

    if (mode === 'lows') {
      if (lowSeries[barIndex] < lineY - tolerance) return true;
    } else {
      if (highSeries[barIndex] > lineY + tolerance) return true;
    }
  }
  return false;
};

const hasCloseBreachBeforeWindow = (
  closeSeries: number[],
  timestampMs: number[],
  fromIndex: number,    // lastAnchorIndex + 1
  lastIndex: number,
  offset: number,
  evaluateY: (t: number) => number,
  epsilon: number,
  mode: Mode,
): boolean => {
  const preCaptureEndIndex = lastIndex - Math.max(0, offset); // <-- фикс: строго ДО offset
  if (fromIndex > preCaptureEndIndex) return false;

  for (let barIndex = fromIndex; barIndex <= preCaptureEndIndex; barIndex++) {
    const lineY = evaluateY(timestampMs[barIndex]);
    const tolerance = toleranceAt(lineY, epsilon);

    if (mode === 'lows') {
      if (closeSeries[barIndex] < lineY - tolerance) return true;
    } else {
      if (closeSeries[barIndex] > lineY + tolerance) return true;
    }
  }
  return false;
};

const hasRequiredCaptureInWindow = (
  openSeries: number[],
  timestampMs: number[],
  lastAnchorIndex: number,
  lastIndex: number,
  offset: number,
  evaluateY: (t: number) => number,
  epsilon: number,
  mode: Mode,
): boolean => {
  if (offset <= 0) return false;

  const captureStartIndex = Math.max(lastAnchorIndex + 1, lastIndex - offset + 1);
  const captureEndIndex = lastIndex;
  if (captureStartIndex > captureEndIndex) return false;

  for (let barIndex = captureStartIndex; barIndex <= captureEndIndex; barIndex++) {
    const lineY = evaluateY(timestampMs[barIndex]);
    const tolerance = toleranceAt(lineY, epsilon);
    const openPrice = openSeries[barIndex];

    if (mode === 'lows') {
      if (openPrice < lineY - tolerance) return true; // свеча началась ниже
    } else {
      if (openPrice > lineY + tolerance) return true; // свеча началась выше
    }
  }
  return false;
};

/* ============================ Core ============================= */

const findTrendlinesCore = (
  data: KlineChartData,
  options: TrendLineOptions,
): TrendLine[] => {
  const {
    mode,
    maxLines = 10,
    range = 10,
    firstRange = 50,
    epsilon = 0.005,      // 0.5%
    minTouches = 3,
    minDistanceBars = 10,
    minTouchGap = 10,
    offset = 10,
    capture = false,
  } = options;

  if (!data?.length) return [];

  // Предподсчёты
  const {
    tsMs,
    openArr,
    closeArr,
    lowArr,
    highArr,
    bodyLowArr,
    bodyHighArr,
  } = buildScalarArrays(data);

  const bodySeriesForExtrema = mode === 'lows' ? bodyLowArr : bodyHighArr;
  const bodySeriesForTouches = mode === 'lows' ? bodyLowArr : bodyHighArr;

  // 1) Сырые локальные экстремумы за O(N)
  const rawExtrema = collectRawExtrema(bodySeriesForExtrema, tsMs, range, mode);
  if (rawExtrema.length < minTouches) return [];

  // 2) Разрежение (кластеризация)
  const anchors = clusterExtrema(rawExtrema, mode, minDistanceBars);
  if (anchors.length < minTouches) return [];

  const lastBarIndex = data.length - 1;
  const lastTimestampMs = tsMs[lastBarIndex];

  let bestTrendLine: TrendLine | null = null;
  let bestSpanInBars = -1;
  let validCandidatesCount = 0;

  for (let rightAnchorIdx = anchors.length - 1; rightAnchorIdx >= 0; rightAnchorIdx--) {
    const rightAnchor = anchors[rightAnchorIdx];

    // ранний отсев по достижимому максимуму
    const maxPossibleSpan = rightAnchor.x - anchors[0].x;
    if (maxPossibleSpan <= bestSpanInBars) break;

    for (let leftAnchorIdx = rightAnchorIdx - 1; leftAnchorIdx >= 0; leftAnchorIdx--) {
      if (validCandidatesCount >= maxLines) break;

      const leftAnchor = anchors[leftAnchorIdx];
      if (rightAnchor.x === leftAnchor.x || rightAnchor.t === leftAnchor.t) continue;

      const firstIndex = leftAnchor.x;
      const lastIndex = rightAnchor.x;
      const spanBarsByAnchors = lastIndex - firstIndex;
      if (spanBarsByAnchors < minDistanceBars) continue;

      if (!isStrongFirstAnchor(bodyLowArr, bodyHighArr, firstIndex, mode, firstRange)) continue;

      const slopeByIndex = (rightAnchor.y - leftAnchor.y) / (rightAnchor.x - leftAnchor.x);
      if (mode === 'lows' && slopeByIndex <= 0) continue;
      if (mode === 'highs' && slopeByIndex >= 0) continue;

      const evaluateY = buildLineEvaluator(leftAnchor.t, leftAnchor.y, rightAnchor.t, rightAnchor.y);

      const touchIndices = collectTouchIndices(
        bodySeriesForTouches,
        tsMs,
        firstIndex,
        lastIndex,
        evaluateY,
        epsilon,
        minTouchGap,
      );
      if (touchIndices.length < minTouches) continue;

      const spanBarsByTouches = touchIndices[touchIndices.length - 1] - touchIndices[0];
      if (spanBarsByTouches < minDistanceBars) continue;

      if (hasWickBreachOnSegment(lowArr, highArr, tsMs, firstIndex, lastIndex, evaluateY, epsilon, mode)) {
        continue;
      }

      const preCaptureStart = lastIndex + 1;
      if (hasCloseBreachBeforeWindow(closeArr, tsMs, preCaptureStart, lastBarIndex, offset, evaluateY, epsilon, mode)) {
        continue;
      }

      if (capture) {
        if (offset <= 0) continue;
        const captured = hasRequiredCaptureInWindow(openArr, tsMs, lastIndex, lastBarIndex, offset, evaluateY, epsilon, mode);
        if (!captured) continue;
      }

      validCandidatesCount++;

      if (spanBarsByAnchors > bestSpanInBars) {
        bestSpanInBars = spanBarsByAnchors;
        bestTrendLine = {
          id: `${mode}TrendLine-1`,
          points: [
            { timestamp: leftAnchor.t, value: evaluateY(leftAnchor.t) },
            { timestamp: lastTimestampMs, value: evaluateY(lastTimestampMs) },
          ],
        };
      }
    }

    if (validCandidatesCount >= maxLines) break; // ранний выход и из внешнего цикла
  }

  return bestTrendLine ? [bestTrendLine] : [];
};

/* =========================== Public API =========================== */

export const findTrendlinesByLows = (
  data: KlineChartData,
  options: Omit<TrendLineOptions, 'mode'> = {},
): TrendLine[] => findTrendlinesCore(data, { mode: 'lows', ...options });

export const findTrendlinesByHighs = (
  data: KlineChartData,
  options: Omit<TrendLineOptions, 'mode'> = {},
): TrendLine[] => findTrendlinesCore(data, { mode: 'highs', ...options });
