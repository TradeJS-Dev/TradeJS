import { KLineData } from 'klinecharts';
import { TrendLine, TrendLineOptions } from '@types';
import { toMs } from '@utils/timestamp';

/* ============================ Helpers ============================= */

const toleranceAt = (lineY: number, epsilonPct: number) =>
  Math.max(0, Math.abs(lineY) * epsilonPct);

type Point = { x: number; y: number; t: number };

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

const hasTooLargeTouchGaps = (touchIndices: number[], maxTouchGap: number) => {
  if (!Number.isFinite(maxTouchGap) || maxTouchGap <= 0) return false;
  if (touchIndices.length < 2) return true;

  for (let i = 1; i < touchIndices.length; i++) {
    if (touchIndices[i] - touchIndices[i - 1] > maxTouchGap) return true;
  }
  return false;
};

/* ====================== Engine types ======================= */

type LineRuntime = {
  left: Point;
  right: Point; // фиксированный right anchor (как в батче)
  distance: number;

  evalY: (t: number) => number;

  // touches только внутри [left..right]
  touches: number[];
  lastTouchIndex: number;

  invalid: boolean;
  wickBreached: boolean; // breach внутри [left..right]
  closeBreached: boolean; // deferred breach ДО окна offset (как в батче)
  captureHit: boolean;

  // для GC/скоринга
  createdAtBar: number;
};

export type TrendlineEngine = {
  next: (candle: KLineData) => TrendLine[];
  nextMany: (candles: KLineData[]) => TrendLine[];
  reset: () => void;
  getLines: () => TrendLine[]; // текущие bestLines без добавления свечи
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

  // series
  let timestampsMs: number[] = [];
  let closeSeries: number[] = [];
  let lowSeries: number[] = [];
  let highSeries: number[] = [];
  let shadowSeries: number[] = []; // low/high

  // extrema stream
  let deque: number[] = [];
  let rawExtrema: Point[] = [];

  // clustering
  let anchors: Point[] = [];
  let clusterBest: Point | null = null;
  let lastRaw: Point | null = null;

  // active lines (кандидаты)
  let active: LineRuntime[] = [];

  const reset = () => {
    timestampsMs = [];
    closeSeries = [];
    lowSeries = [];
    highSeries = [];
    shadowSeries = [];

    deque = [];
    rawExtrema = [];

    anchors = [];
    clusterBest = null;
    lastRaw = null;

    active = [];
  };

  const updateDeque = (i: number) => {
    const windowSize = 2 * opts.range + 1;
    const findMin = opts.mode === 'lows';

    const isBetter = findMin
      ? (a: number, b: number) => a <= b
      : (a: number, b: number) => a >= b;

    while (
      deque.length &&
      !isBetter(shadowSeries[deque[deque.length - 1]], shadowSeries[i])
    ) {
      deque.pop();
    }
    deque.push(i);

    const startIndex = i - windowSize + 1;
    while (deque.length && deque[0] < startIndex) deque.shift();
  };

  // bootstrap touches + wick breach exactly on [left..right]
  const seedLineFromHistory = (line: LineRuntime) => {
    const start = line.left.x;
    const end = line.right.x;

    for (let barIndex = start; barIndex <= end; barIndex++) {
      const ts = timestampsMs[barIndex];
      const lineY = line.evalY(ts);

      // touch (как collectTouchIndices, но ограничено сегментом)
      const tolTouch = toleranceAt(lineY, opts.epsilon);
      const bodyValue = shadowSeries[barIndex];

      if (Math.abs(bodyValue - lineY) <= tolTouch) {
        if (
          line.touches.length === 0 ||
          barIndex - line.lastTouchIndex >= opts.minTouchGap
        ) {
          line.touches.push(barIndex);
          line.lastTouchIndex = barIndex;

          // maxTouchGap в онлайне делаем мягко: только соседние
          if (line.touches.length >= 2) {
            const a = line.touches[line.touches.length - 2];
            const b = line.touches[line.touches.length - 1];
            if (b - a > opts.maxTouchGap) {
              line.invalid = true;
              return;
            }
          }
        }
      }

      // wick breach (как hasWickBreachOnSegment)
      const tolWick = toleranceAt(lineY, opts.epsilon);
      if (opts.mode === 'lows') {
        if (lowSeries[barIndex] < lineY - tolWick) {
          line.wickBreached = true;
          line.invalid = true;
          return;
        }
      } else {
        if (highSeries[barIndex] > lineY + tolWick) {
          line.wickBreached = true;
          line.invalid = true;
          return;
        }
      }
    }
  };

  const onNewAnchor = (rightAnchor: Point) => {
    // создаём кандидаты только при появлении нового anchor (правого)
    for (let idx = anchors.length - 1; idx >= 0; idx--) {
      const leftAnchor = anchors[idx];
      const distance = rightAnchor.x - leftAnchor.x;

      if (distance < opts.minDistance) continue;
      if (distance > opts.maxDistance) continue;

      if (
        !isStrongFirstAnchor({
          lowSeries,
          highSeries,
          index: leftAnchor.x,
          mode: opts.mode,
          firstRange: opts.firstRange,
        })
      )
        continue;

      const slope =
        (rightAnchor.y - leftAnchor.y) / (rightAnchor.x - leftAnchor.x);
      if (opts.mode === 'lows' && slope <= 0) continue;
      if (opts.mode === 'highs' && slope >= 0) continue;

      const evalY = buildLineEvaluator({
        t1: leftAnchor.t,
        y1: leftAnchor.y,
        t2: rightAnchor.t,
        y2: rightAnchor.y,
      });

      const line: LineRuntime = {
        left: leftAnchor,
        right: rightAnchor,
        distance,
        evalY,

        touches: [],
        lastTouchIndex: -Infinity,

        invalid: false,
        wickBreached: false,
        closeBreached: false,
        captureHit: false,

        createdAtBar: rightAnchor.x,
      };

      // ВАЖНО: догоняем историю ровно по батч-логике
      seedLineFromHistory(line);
      if (line.invalid) continue;

      // ВАЖНО: в батче сразу отсекается touches.length < minTouches
      if (line.touches.length < opts.minTouches) continue;

      // и условие touches span
      if (
        line.touches[line.touches.length - 1] - line.touches[0] <
        opts.minDistance
      )
        continue;

      // и проверка maxTouchGap только на lastTouches + rightIndex (как в батче)
      const lastTouches =
        line.touches.length > 2 ? line.touches.slice(-2) : line.touches;
      if (
        hasTooLargeTouchGaps([...lastTouches, line.right.x], opts.maxTouchGap)
      )
        continue;

      active.push(line);

      if (active.length >= opts.maxLines) break;
    }
  };

  const onNewRawExtremum = (p: Point) => {
    if (!clusterBest) {
      clusterBest = p;
      lastRaw = p;
      return;
    }

    if (p.x - lastRaw!.x < opts.minDistance) {
      const better =
        opts.mode === 'lows' ? p.y < clusterBest.y : p.y > clusterBest.y;
      if (better) clusterBest = p;
      lastRaw = p;
      return;
    }

    // фиксируем прошлый кластер -> anchor
    anchors.push(clusterBest);
    const newAnchor = clusterBest;

    // новый кластер
    clusterBest = p;
    lastRaw = p;

    // создаём кандидатов от newAnchor как right
    onNewAnchor(newAnchor);

    gc();
  };

  const maybeAddRawExtremum = (endIndex: number) => {
    const r = opts.range;
    if (endIndex < 2 * r) return;

    const centerIndex = endIndex - r;
    const extremaValue = shadowSeries[deque[0]];

    if (shadowSeries[centerIndex] !== extremaValue) return;

    const point: Point = {
      x: centerIndex,
      y: shadowSeries[centerIndex],
      t: timestampsMs[centerIndex],
    };
    rawExtrema.push(point);
    onNewRawExtremum(point);
  };

  // deferred close breach: проверяем индекс, который вышел из offset-окна
  const updateCloseBreachDeferred = (
    line: LineRuntime,
    lastBarIndex: number,
  ) => {
    if (line.invalid) return;
    if (opts.offset <= 0) return;

    const checkIndex = lastBarIndex - opts.offset;

    // батч: fromIndex = right+1, preCaptureEnd = lastBar-offset
    // значит проверять нужно только если checkIndex ∈ [right+1 .. lastBar-offset]
    // но lastBar-offset == checkIndex, так что проверяем именно checkIndex, если он >= right+1
    if (checkIndex <= line.right.x) return;

    const ts = timestampsMs[checkIndex];
    const lineY = line.evalY(ts);
    const tol = toleranceAt(lineY, opts.epsilon);
    const closePrice = closeSeries[checkIndex];

    if (opts.mode === 'lows') {
      if (closePrice < lineY - tol) {
        line.closeBreached = true;
        line.invalid = true;
      }
    } else {
      if (closePrice > lineY + tol) {
        line.closeBreached = true;
        line.invalid = true;
      }
    }
  };

  const updateCaptureOnBar = (line: LineRuntime, barIndex: number) => {
    if (line.invalid) return;
    if (!opts.capture) return;
    if (opts.offset <= 0) return;

    // captureStart = max(right+1, lastBar-offset+1)
    const captureStart = Math.max(line.right.x + 1, barIndex - opts.offset + 1);
    if (barIndex < captureStart) return;

    const ts = timestampsMs[barIndex];
    const lineY = line.evalY(ts);
    const tolOff = toleranceAt(lineY, opts.epsilonOffset);

    if (opts.mode === 'lows') {
      if (lowSeries[barIndex] <= lineY - tolOff) line.captureHit = true;
    } else {
      if (highSeries[barIndex] >= lineY + tolOff) line.captureHit = true;
    }
  };

  const gc = () => {
    active = active.filter((l) => !l.invalid);

    // ограничим число активных линий жёстко
    const HARD_LIMIT = Math.max(opts.maxLines * 10, 200);
    if (active.length > HARD_LIMIT) {
      active.sort((a, b) => {
        // больше touches, свежее left, больше distance
        if (b.touches.length !== a.touches.length)
          return b.touches.length - a.touches.length;
        if (b.left.x !== a.left.x) return b.left.x - a.left.x;
        return b.distance - a.distance;
      });
      active = active.slice(0, HARD_LIMIT);
    }

    const ANCHOR_LIMIT = 5000;
    if (anchors.length > ANCHOR_LIMIT) anchors = anchors.slice(-ANCHOR_LIMIT);
  };

  const buildResult = (): TrendLine[] => {
    if (!timestampsMs.length) return [];

    const lastBarIndex = timestampsMs.length - 1;
    const lastTs = timestampsMs[lastBarIndex];

    // батч-фильтры на активных линиях
    const filtered = active.filter((l) => {
      if (l.touches.length < opts.minTouches) return false;
      if (l.touches[l.touches.length - 1] - l.touches[0] < opts.minDistance)
        return false;

      const lastTouches =
        l.touches.length > 2 ? l.touches.slice(-2) : l.touches;
      if (hasTooLargeTouchGaps([...lastTouches, l.right.x], opts.maxTouchGap))
        return false;

      if (opts.capture && !l.captureHit) return false;

      return true;
    });

    // аналог candidates.sort by firstIndex desc
    filtered.sort((a, b) => b.left.x - a.left.x);

    const take = Math.max(
      1,
      Math.min(opts.bestLines, opts.maxLines, filtered.length),
    );
    const best = filtered.slice(0, take);

    return best.map((l, idx) => ({
      id: `${opts.mode}TrendLine-${idx + 1}`,
      mode: opts.mode,
      distance: l.distance,
      points: [
        { timestamp: l.left.t, value: l.evalY(l.left.t) },
        { timestamp: lastTs, value: l.evalY(lastTs) },
      ],
      touches: l.touches
        .filter((i) => i !== l.left.x && i !== l.right.x)
        .map((i) => {
          const ts = timestampsMs[i];
          return { timestamp: ts, value: l.evalY(ts) };
        }),
    }));
  };

  const next = (candle: KLineData) => {
    const i = timestampsMs.length;

    const ts = toMs(candle.timestamp);
    timestampsMs.push(ts);
    closeSeries.push(candle.close);
    lowSeries.push(candle.low);
    highSeries.push(candle.high);

    const shadowVal = opts.mode === 'lows' ? candle.low : candle.high;
    shadowSeries.push(shadowVal);

    updateDeque(i);
    maybeAddRawExtremum(i);

    // обновления, зависящие от “текущего lastBar”
    // (touches/wick breach НЕ обновляем — они только на [left..right] и уже посчитаны при создании)
    for (const line of active) {
      updateCaptureOnBar(line, i);
      updateCloseBreachDeferred(line, i);
    }

    gc();
    return buildResult();
  };

  const nextMany = (candles: KLineData[]) => {
    let res: TrendLine[] = [];
    for (const c of candles) res = next(c);
    return res;
  };

  const getLines = () => buildResult();

  // ---- init with initialCandles
  reset();
  if (initialCandles?.length) nextMany(initialCandles);

  return {
    next,
    nextMany,
    reset: () => {
      reset();
      nextMany(initialCandles ?? []);
    },
    getLines,
  };
};
