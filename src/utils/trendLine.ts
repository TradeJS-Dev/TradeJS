import _ from 'lodash';
import { KlineChartData } from '@types';

type Point = { x: number; y: number; t: number };
type Mode = 'lows' | 'highs';

export type TrendLine = {
  id: string;
  points: { timestamp: number; value: number }[];
};

export interface TrendLineOptions {
  /** режим: по минимумам (поддержка) или по максимумам (сопротивление) */
  mode: Mode;
  /** ограничение перебора кандидатов (чтобы не взрывать сложность) */
  maxLines?: number;
  /** окно для поиска локальных экстремумов (в барах) */
  range?: number;
  /** допуск в долях от цены (0.01 = 1%) */
  epsilon?: number;
  /** мин. число касаний по телам между опорами (с учётом minTouchGap) */
  minTouches?: number;
  /** мин. расстояние между опорами (в барах) */
  minDistanceBars?: number;
  /** «сила» первой опоры: окно для проверки сильного экстремума (в барах) */
  firstRange?: number;
  /** сколько последних баров можно игнорировать при проверке продления */
  offset?: number;
  /** минимальный зазор между касаниями (в барах) */
  minTouchGap?: number;
}

// авто-детект секунд/миллисекунд
const toMs = (ts: number) => (ts < 1e12 ? ts * 1000 : ts);

// body/wick helpers
const getOpen = (c: any) =>
  typeof c.open === 'number' ? c.open : c.o ?? c.openPrice ?? c.close;
const getClose = (c: any) =>
  typeof c.close === 'number' ? c.close : c.price ?? c.open ?? 0;

const getBodyLow = (c: any) => Math.min(getOpen(c), getClose(c));
const getBodyHigh = (c: any) => Math.max(getOpen(c), getClose(c));

const getLow = (c: any) =>
  typeof c.low === 'number' ? c.low : Math.min(getOpen(c), getClose(c));
const getHigh = (c: any) =>
  typeof c.high === 'number' ? c.high : Math.max(getOpen(c), getClose(c));

// процентный допуск от уровня линии
const tolAt = (lineY: number, epsilonPct: number) =>
  Math.max(0, Math.abs(lineY) * epsilonPct);

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

/** ядро */
const findTrendlines = (
  data: KlineChartData,
  {
    mode,
    maxLines = 10,
    range = 10,
    epsilon = 0.01, // 1%
    minTouches = 3,
    minDistanceBars = 5,
    firstRange = 10,
    offset = 3,
    minTouchGap = 2,
  }: TrendLineOptions,
): TrendLine[] => {
  if (!data?.length) return [];

  // значения для ОПОР/КАСАНИЙ (по телам)
  const pickExt = mode === 'lows' ? getBodyLow : getBodyHigh;
  const pickTouch = mode === 'lows' ? getBodyLow : getBodyHigh;

  // 1) Опорные точки: локальные экстремумы тел
  const exts: Point[] = [];
  for (let i = range; i < data.length - range; i++) {
    const segment = data.slice(i - range, i + range + 1);
    const target =
      mode === 'lows'
        ? Math.min(...segment.map(pickExt))
        : Math.max(...segment.map(pickExt));
    if (pickExt(data[i]) === target) {
      exts.push({ x: i, y: pickExt(data[i]), t: toMs(data[i].timestamp) });
    }
  }
  if (exts.length < minTouches) return [];

  const lastIdx = data.length - 1;
  const tEnd = toMs(data[lastIdx].timestamp);

  let bestLine: TrendLine | null = null;
  let bestLenBars = -1; // длина кандидата в барах (между крайними опорами)
  let produced = 0;

  // 2) Перебор пар опор
  for (let a = exts.length - 1; a >= 0; a--) {
    for (let b = a - 1; b >= 0; b--) {
      if (produced >= maxLines) break;

      const p1 = exts[b];
      const p2 = exts[a];

      if (p2.x === p1.x || p2.t === p1.t) continue;

      // минимум расстояния между опорами
      const firstX = p1.x;
      const lastX = p2.x;
      const spanBars = lastX - firstX;
      if (spanBars < minDistanceBars) continue;

      // требуем «сильную» первую опору
      if (!isStrongExtremum(data, firstX, mode, firstRange)) continue;

      // направление: support — вверх, resistance — вниз (по индексам)
      const slopeIdx = (p2.y - p1.y) / (p2.x - p1.x);
      if (mode === 'lows' && slopeIdx <= 0) continue;
      if (mode === 'highs' && slopeIdx >= 0) continue;

      // 3) Отрезок по времени (p1 -> p2) + продление вправо
      const t1 = p1.t,
        y1 = p1.y;
      const t2 = p2.t,
        y2 = p2.y;
      const yAt = (tMs: number) => y1 + (y2 - y1) * ((tMs - t1) / (t2 - t1));

      // 4) КАСАНИЯ по телу, с процентным допуском и GAP
      let touches = 0;
      for (let k = firstX; k <= lastX; k++) {
        const tMs = toMs(data[k].timestamp);
        const lineY = yAt(tMs);
        const tol = tolAt(lineY, epsilon);
        const bodyVal = pickTouch(data[k]);

        if (Math.abs(bodyVal - lineY) <= tol) {
          touches++;
          k += Math.max(0, minTouchGap); // пропускаем N баров после касания
        }
      }
      if (touches < minTouches) continue;

      // 5) Проверка: нет пересечений фитилём между p1..p2 (с процентным допуском)
      let invalid = false;
      for (let k = firstX; k <= lastX; k++) {
        const tMs = toMs(data[k].timestamp);
        const lineY = yAt(tMs);
        const tol = tolAt(lineY, epsilon);
        if (mode === 'lows') {
          if (getLow(data[k]) < lineY - tol) {
            invalid = true;
            break;
          } // вниз нельзя
        } else {
          if (getHigh(data[k]) > lineY + tol) {
            invalid = true;
            break;
          } // вверх нельзя
        }
      }
      if (invalid) continue;

      // 6) ПРОДЛЕНИЕ до конца, игнорируя последние `offset` баров
      const checkEnd = lastIdx - offset; // индекс последнего бара, который ещё проверяем
      if (checkEnd >= lastX + 1) {
        for (let k = lastX + 1; k <= checkEnd; k++) {
          const tMs = toMs(data[k].timestamp);
          const lineY = yAt(tMs);
          const tol = tolAt(lineY, epsilon);
          if (mode === 'lows') {
            if (getLow(data[k]) < lineY - tol) {
              invalid = true;
              break;
            }
          } else {
            if (getHigh(data[k]) > lineY + tol) {
              invalid = true;
              break;
            }
          }
        }
      }
      if (invalid) continue;

      produced++;

      // 7) выбираем самую длинную по расстоянию МЕЖДУ КРАЙНИМИ ТОЧКАМИ (в барах)
      if (spanBars > bestLenBars) {
        bestLenBars = spanBars;
        bestLine = {
          id: `TrendLine-1`,
          points: [
            { timestamp: p1.t, value: yAt(p1.t) }, // начало = первая опора
            { timestamp: tEnd, value: yAt(tEnd) }, // конец = продление к последней свече
          ],
        };
      }
    }
  }

  return bestLine ? [bestLine] : [];
};

/** Обёртки с объектом настроек вторым параметром */

export const findTrendlinesByLows = (
  data: KlineChartData,
  options: Omit<TrendLineOptions, 'mode'> = {},
): TrendLine[] => findTrendlines(data, { mode: 'lows', ...options });

export const findTrendlinesByHighs = (
  data: KlineChartData,
  options: Omit<TrendLineOptions, 'mode'> = {},
): TrendLine[] => findTrendlines(data, { mode: 'highs', ...options });
