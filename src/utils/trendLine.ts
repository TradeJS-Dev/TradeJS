import _ from 'lodash';
import { KlineChartData } from '@types';

type Point = { x: number; y: number; t: number };
type Mode = 'lows' | 'highs';

export type TrendLine = {
  id: string;
  points: { timestamp: number; value: number }[];
};

// авто-детект секунд/миллисекунд
const toMs = (ts: number) => (ts < 1e12 ? ts * 1000 : ts);

// body/fitil helpers
const getOpen  = (c: any) => (typeof c.open  === 'number' ? c.open  : c.o ?? c.openPrice ?? c.close);
const getClose = (c: any) => (typeof c.close === 'number' ? c.close : c.price ?? c.open ?? 0);

const getBodyLow  = (c: any) => Math.min(getOpen(c), getClose(c));
const getBodyHigh = (c: any) => Math.max(getOpen(c), getClose(c));

const getLow  = (c: any) => (typeof c.low  === 'number' ? c.low  : Math.min(getOpen(c), getClose(c)));
const getHigh = (c: any) => (typeof c.high === 'number' ? c.high : Math.max(getOpen(c), getClose(c)));

const isStrongExtremum = (
  candles: KlineChartData,
  idx: number,
  mode: Mode,
  firstRange: number,
): boolean => {
  const start = Math.max(0, idx - firstRange);
  const end   = Math.min(candles.length - 1, idx + firstRange);
  const slice = candles.slice(start, end + 1);
  if (mode === 'lows') {
    const target = Math.min(...slice.map(getBodyLow));
    return getBodyLow(candles[idx]) === target;
  } else {
    const target = Math.max(...slice.map(getBodyHigh));
    return getBodyHigh(candles[idx]) === target;
  }
};

const findTrendlines = (
  candles: KlineChartData,
  mode: Mode,
  maxLines = 10,          // не влияет на отбор (возвращаем лучшую), но ограничит перебор кандидатов
  range = 10,
  epsilon = 0.0001,
  minTouches = 3,
  minDistanceBars = 5,    // МИНИМАЛЬНАЯ дистанция между опорами
  firstRange = 10,        // «сила» первой опоры
  offset = 3,             // последние N баров можно игнорировать на ПРОДЛЕНИИ
): TrendLine[] => {
  if (!candles?.length) return [];

  // какие значения берем для ОПОР и КАСАНИЙ (по телам)
  const pickExt   = mode === 'lows' ? getBodyLow  : getBodyHigh;
  const pickTouch = mode === 'lows' ? getBodyLow  : getBodyHigh;

  // 1) Опорные точки: локальные экстремумы тел (min(open,close) / max(open,close))
  const exts: Point[] = [];
  for (let i = range; i < candles.length - range; i++) {
    const segment = candles.slice(i - range, i + range + 1);
    const target =
      mode === 'lows' ? Math.min(...segment.map(pickExt)) : Math.max(...segment.map(pickExt));
    if (pickExt(candles[i]) === target) {
      exts.push({ x: i, y: pickExt(candles[i]), t: toMs(candles[i].timestamp) });
    }
  }
  if (exts.length < minTouches) return [];

  const lastIdx = candles.length - 1;
  const tEnd = toMs(candles[lastIdx].timestamp);

  let bestLine: TrendLine | null = null;
  let bestLenBars = -1;

  let produced = 0;

  // 2) Перебор пар опор
  for (let a = exts.length - 1; a >= 0; a--) {
    for (let b = a - 1; b >= 0; b--) {
      if (produced >= maxLines) break; // ограничение перебора кандидатов

      const p1 = exts[b];
      const p2 = exts[a];

      if (p2.x === p1.x || p2.t === p1.t) continue;

      // Минимальная дистанция между опорами
      const spanBars = p2.x - p1.x;
      if (spanBars < minDistanceBars) continue;

      // Для первой точки требуем «сильный» экстремум на окне firstRange
      if (!isStrongExtremum(candles, p1.x, mode, firstRange)) continue;

      // Направление: support — вверх, resistance — вниз (по индексам)
      const slopeIdx = (p2.y - p1.y) / (p2.x - p1.x);
      if (mode === 'lows' && slopeIdx <= 0) continue;
      if (mode === 'highs' && slopeIdx >= 0) continue;

      // 3) Линия — отрезок по времени (t1,y1)->(t2,y2) + ПРОДЛЕНИЕ вправо
      const t1 = p1.t, y1 = p1.y;
      const t2 = p2.t, y2 = p2.y;
      const yAt = (tMs: number) => y1 + (y2 - y1) * ((tMs - t1) / (t2 - t1));

      // 4) КАСАНИЯ: по всем барам между p1..p2 (по телу)
      const firstX = p1.x;
      const lastX  = p2.x;

      let touches = 0;
      for (let k = firstX; k <= lastX; k++) {
        const tMs = toMs(candles[k].timestamp);
        const lineY = yAt(tMs);
        const bodyVal = pickTouch(candles[k]);
        if (Math.abs(bodyVal - lineY) <= epsilon) {
          touches++;
        }
      }
      if (touches < minTouches) continue;

      // 5) Проверка «нет пересечений» фитилём между p1..p2
      let invalid = false;
      for (let k = firstX; k <= lastX; k++) {
        const tMs = toMs(candles[k].timestamp);
        const lineY = yAt(tMs);
        if (mode === 'lows') {
          if (getLow(candles[k]) < lineY - epsilon) { invalid = true; break; }   // вниз нельзя
        } else {
          if (getHigh(candles[k]) > lineY + epsilon) { invalid = true; break; }  // вверх нельзя
        }
      }
      if (invalid) continue;

      // 6) ПРОДЛЕНИЕ: до конца, но игнорируем последние `offset` баров
      const lastToCheck = Math.max(lastX + 1, lastIdx - offset);
      for (let k = lastX + 1; k <= lastToCheck; k++) {
        const tMs = toMs(candles[k].timestamp);
        const lineY = yAt(tMs);
        if (mode === 'lows') {
          if (getLow(candles[k]) < lineY - epsilon) { invalid = true; break; }
        } else {
          if (getHigh(candles[k]) > lineY + epsilon) { invalid = true; break; }
        }
      }
      if (invalid) continue;

      produced++;

      // 7) Кандидат валиден — оценим длину и, если он лучший, запоминаем
      if (spanBars > bestLenBars) {
        bestLenBars = spanBars;
        bestLine = {
          id: `TrendLine-1`,
          points: [
            { timestamp: p1.t, value: yAt(p1.t) },
            { timestamp: tEnd, value: yAt(tEnd) }, // продление до конца графика
          ],
        };
      }
    }
  }

  return bestLine ? [bestLine] : [];
};

export const findTrendlinesByLows = (
  candles: KlineChartData,
  maxLines = 10,
  range = 10,
  epsilon = 0.0001,
  minTouches = 3,
  minDistanceBars = 5,
  firstRange = 10,
  offset = 3,
): TrendLine[] =>
  findTrendlines(
    candles,
    'lows',
    maxLines,
    range,
    epsilon,
    minTouches,
    minDistanceBars,
    firstRange,
    offset,
  );

export const findTrendlinesByHighs = (
  candles: KlineChartData,
  maxLines = 10,
  range = 10,
  epsilon = 0.0001,
  minTouches = 3,
  minDistanceBars = 5,
  firstRange = 10,
  offset = 3,
): TrendLine[] =>
  findTrendlines(
    candles,
    'highs',
    maxLines,
    range,
    epsilon,
    minTouches,
    minDistanceBars,
    firstRange,
    offset,
  );
