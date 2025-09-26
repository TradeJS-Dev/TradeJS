import _ from 'lodash';
import { KlineChartData, Candle } from '@types';

/* ========================= Types & Options ========================= */

type Mode = 'lows' | 'highs';

export type TrendLine = {
  id: string;
  points: { timestamp: number; value: number }[];
};

export interface TrendLineOptions {
  mode: Mode;
  maxLines?: number; // ограничение перебора пар опор (кандидатов)
  range?: number; // окно для локальных экстремумов
  epsilon?: number; // допуск как доля цены (0.01 = 1%)
  minTouches?: number; // минимум касаний по телу (с учётом minTouchGap)
  minDistanceBars?: number; // минимум баров между опорами/крайними касаниями
  firstRange?: number; // «сила» первой опоры (окно сильного экстремума)
  offset?: number; // размер capture-окна в конце
  minTouchGap?: number; // минимум баров между касаниями
  capture?: boolean; // пробой ТЕЛОМ обязателен (true) или опционален (false) в offset-окне
}

/* ============================ Helpers ============================= */

const toMs = (ts: number) => (ts < 1e12 ? ts * 1000 : ts);

const getBodyLow = (c: Candle) => Math.min(c.open, c.close);
const getBodyHigh = (c: Candle) => Math.max(c.open, c.close);
const getLow = (c: Candle) => c.low;
const getHigh = (c: Candle) => c.high;

const tolAt = (lineY: number, epsilonPct: number) =>
  Math.max(0, Math.abs(lineY) * epsilonPct);

type Point = { x: number; y: number; t: number };

const pickExtremumFn = (mode: Mode) =>
  mode === 'lows' ? getBodyLow : getBodyHigh;
const pickTouchFn = (mode: Mode) =>
  mode === 'lows' ? getBodyLow : getBodyHigh;
const pickWickFn = (mode: Mode) => (mode === 'lows' ? getLow : getHigh);

/* ====================== Pipeline (pure functions) ===================== */

/** 1) Сырые локальные экстремумы по телам в окне `range` */
const collectRawExtrema = (
  data: KlineChartData,
  mode: Mode,
  range: number,
): Point[] => {
  const pickExt = pickExtremumFn(mode);
  const out: Point[] = [];
  for (let i = range; i < data.length - range; i++) {
    const seg = data.slice(i - range, i + range + 1);
    const target =
      mode === 'lows'
        ? Math.min(...seg.map(pickExt))
        : Math.max(...seg.map(pickExt));
    if (pickExt(data[i]) === target) {
      out.push({ x: i, y: pickExt(data[i]), t: toMs(data[i].timestamp) });
    }
  }
  return out;
};

/** 2) Кластеризация экстремумов: в кластере (< minDistanceBars между соседями) оставляем «самый сильный». */
const clusterExtrema = (
  raw: Point[],
  mode: Mode,
  minDistanceBars: number,
): Point[] => {
  if (!raw.length) return [];
  const exts: Point[] = [];
  let idx = 0;
  while (idx < raw.length) {
    let cs = idx;
    let ce = idx;
    while (ce + 1 < raw.length && raw[ce + 1].x - raw[ce].x < minDistanceBars)
      ce++;
    let best = raw[cs];
    for (let k = cs + 1; k <= ce; k++) {
      const cand = raw[k];
      const better = mode === 'lows' ? cand.y < best.y : cand.y > best.y;
      if (better) best = cand;
    }
    exts.push(best);
    idx = ce + 1;
  }
  return exts;
};

/** 3) Проверка «сильной» первой опоры */
const isStrongExtremum = (
  data: KlineChartData,
  idx: number,
  mode: Mode,
  firstRange: number,
): boolean => {
  const start = Math.max(0, idx - firstRange);
  const end = Math.min(data.length - 1, idx + firstRange);
  const slice = data.slice(start, end + 1);
  if (mode === 'lows') {
    const target = Math.min(...slice.map(getBodyLow));
    return getBodyLow(data[idx]) === target;
  } else {
    const target = Math.max(...slice.map(getBodyHigh));
    return getBodyHigh(data[idx]) === target;
  }
};

/** 4) Строим модель прямой по двум точкам во времени, возвращаем y(t) */
const buildLineY = (
  t1: number,
  y1: number,
  t2: number,
  y2: number,
): ((tMs: number) => number) => {
  const dt = t2 - t1;
  if (dt === 0) {
    const y = y1;
    return () => y;
  }
  const dy = y2 - y1;
  return (tMs: number) => y1 + dy * ((tMs - t1) / dt);
};

/** 5) Посчитать касания по телу с GAP */
const collectTouchIndices = (
  data: KlineChartData,
  fromX: number,
  toX: number,
  yAt: (t: number) => number,
  epsilon: number,
  mode: Mode,
  minTouchGap: number,
): number[] => {
  const touches: number[] = [];
  const pickTouch = pickTouchFn(mode);
  let lastTouchAt = -Infinity;
  for (let k = fromX; k <= toX; k++) {
    const t = toMs(data[k].timestamp);
    const y = yAt(t);
    const tol = tolAt(y, epsilon);
    const body = pickTouch(data[k]);
    if (Math.abs(body - y) <= tol) {
      if (touches.length === 0 || k - lastTouchAt >= minTouchGap) {
        touches.push(k);
        lastTouchAt = k;
      }
    }
  }
  return touches;
};

/** 6) Проверка отсутствия пробоя фитилём на участке [fromX..toX] */
const hasWickBreachOnSegment = (
  data: KlineChartData,
  fromX: number,
  toX: number,
  yAt: (t: number) => number,
  epsilon: number,
  mode: Mode,
): boolean => {
  const pickWick = pickWickFn(mode);
  for (let k = fromX; k <= toX; k++) {
    const t = toMs(data[k].timestamp);
    const y = yAt(t);
    const tol = tolAt(y, epsilon);
    const wick = pickWick(data[k]);
    if (mode === 'lows') {
      if (wick < y - tol) return true; // вниз нельзя
    } else {
      if (wick > y + tol) return true; // вверх нельзя
    }
  }
  return false;
};

/** 7) Проверка отсутствия пробоя ТЕЛОМ до capture-окна */
const hasCloseBreachBeforeWindow = (
  data: KlineChartData,
  fromX: number, // lastX + 1
  lastIdx: number,
  offset: number,
  yAt: (t: number) => number,
  epsilon: number,
  mode: Mode,
): boolean => {
  const preCapEnd = Math.max(fromX, lastIdx - Math.max(0, offset));
  if (fromX > preCapEnd) return false;
  for (let k = fromX; k <= preCapEnd; k++) {
    const t = toMs(data[k].timestamp);
    const y = yAt(t);
    const tol = tolAt(y, epsilon);
    if (mode === 'lows') {
      if (data[k].close < y - tol) return true; // пробой телом вниз
    } else {
      if (data[k].close > y + tol) return true; // пробой телом вверх
    }
  }
  return false;
};

/** 8) Проверка ОБЯЗАТЕЛЬНОГО "capture" по ОТКРЫТИЮ свечи в offset-окне
 * lows:  open < lineY - tol  (свеча началась ниже трендовой)
 * highs: open > lineY + tol  (свеча началась выше трендовой)
 */
const hasRequiredCaptureInWindow = (
  data: KlineChartData,
  lastX: number,
  lastIdx: number,
  offset: number,
  yAt: (t: number) => number,
  epsilon: number,
  mode: Mode,
): boolean => {
  if (offset <= 0) return false;
  const capStart = Math.max(lastX + 1, lastIdx - offset + 1);
  const capEnd = lastIdx;
  if (capStart > capEnd) return false;

  for (let k = capStart; k <= capEnd; k++) {
    const t   = toMs(data[k].timestamp);
    const y   = yAt(t);
    const tol = tolAt(y, epsilon);
    const open = data[k].open;

    if (mode === 'lows') {
      if (open < y - tol) return true;   // начало ниже линии
    } else {
      if (open > y + tol) return true;   // начало выше линии
    }
  }
  return false;
};

/* ============================ Core ============================= */

const findTrendlinesCore = (
  data: KlineChartData,
  opts: TrendLineOptions,
): TrendLine[] => {
  const {
    mode,
    maxLines = 10,
    range = 10,
    firstRange = 50,
    epsilon = 0.005, // 0.5%
    minTouches = 3,
    minDistanceBars = 10,
    minTouchGap = 10,
    offset = 10,
    capture = false,
  } = opts;

  if (!data?.length) return [];

  const raw = collectRawExtrema(data, mode, range);
  if (raw.length < minTouches) return [];

  const exts = clusterExtrema(raw, mode, minDistanceBars);
  if (exts.length < minTouches) return [];

  const lastIdx = data.length - 1;
  const tEnd = toMs(data[lastIdx].timestamp);

  let best: TrendLine | null = null;
  let bestSpan = -1;
  let produced = 0;

  for (let a = exts.length - 1; a >= 0; a--) {
    for (let b = a - 1; b >= 0; b--) {
      if (produced >= maxLines) break;

      const p1 = exts[b],
        p2 = exts[a];
      if (p2.x === p1.x || p2.t === p1.t) continue;

      const firstX = p1.x,
        lastX = p2.x;
      const spanBarsExt = lastX - firstX;
      if (spanBarsExt < minDistanceBars) continue;

      if (!isStrongExtremum(data, firstX, mode, firstRange)) continue;

      const slopeIdx = (p2.y - p1.y) / (p2.x - p1.x);
      if (mode === 'lows' && slopeIdx <= 0) continue;
      if (mode === 'highs' && slopeIdx >= 0) continue;

      const yAt = buildLineY(p1.t, p1.y, p2.t, p2.y);

      const touchIdxs = collectTouchIndices(
        data,
        firstX,
        lastX,
        yAt,
        epsilon,
        mode,
        minTouchGap,
      );
      if (touchIdxs.length < minTouches) continue;

      const spanBarsTouch = touchIdxs[touchIdxs.length - 1] - touchIdxs[0];
      if (spanBarsTouch < minDistanceBars) continue;

      if (hasWickBreachOnSegment(data, firstX, lastX, yAt, epsilon, mode))
        continue;

      const preCapStart = lastX + 1;
      if (
        hasCloseBreachBeforeWindow(
          data,
          preCapStart,
          lastIdx,
          offset,
          yAt,
          epsilon,
          mode,
        )
      ) {
        continue;
      }

      if (capture) {
        if (offset <= 0) continue;
        if (
          !hasRequiredCaptureInWindow(
            data,
            lastX,
            lastIdx,
            offset,
            yAt,
            epsilon,
            mode,
          )
        ) {
          continue;
        }
      }

      produced++;

      if (spanBarsExt > bestSpan) {
        bestSpan = spanBarsExt;
        best = {
          id: `${mode}TrendLine-1`,
          points: [
            { timestamp: p1.t, value: yAt(p1.t) },
            { timestamp: tEnd, value: yAt(tEnd) },
          ],
        };
      }
    }
  }

  return best ? [best] : [];
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
